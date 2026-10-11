/**
 * Deterministic position sizing. This module — not the LLM — enforces limits.
 *
 * Model: binary contract priced at `price` (0..1) paying 1 if correct.
 *   edge      = p - price
 *   fullKelly = (p - price) / (1 - price)      (fraction of bankroll on a 1:(1-price)/price bet)
 * We then apply: uncertainty discount, fractional Kelly, per-position cap,
 * remaining budget cap, theme concentration cap, available balance cap.
 */
import type { RiskLimits, RiskSnapshot, Side } from "@mayflower/shared";

export interface SizingInput {
  side: Side;
  /** Mayflower's YES probability estimate. */
  estimatedYesProbability: number;
  /** Uncertainty half-width, 0..0.5. */
  uncertainty: number;
  /** Executable YES ask (to buy YES) and YES bid (to buy NO = sell YES). */
  yesAsk: number | null;
  yesBid: number | null;
  limits: RiskLimits;
  /** Dollars currently at risk across open positions. */
  currentExposure: number;
  /** Dollars at risk in positions sharing a theme tag with this market. */
  themeExposure: number;
  /** Real exchange balance available (null when unknown, e.g. not linked yet). */
  availableBalance: number | null;
  /** Exchange minimum order quantity / tick, if any. */
  minQuantity?: number;
  priceTick?: number;
}

export interface SizingResult {
  snapshot: RiskSnapshot;
  /** False when the engine refuses the trade entirely. */
  tradeable: boolean;
  reason: string | null;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Convert a YES-side quote and probability to the side being bought. */
export function toSideView(side: Side, pYes: number, yesAsk: number | null, yesBid: number | null) {
  if (side === "YES") return { p: pYes, price: yesAsk };
  // Buying NO is equivalent to buying a contract at (1 - yesBid) with probability (1 - pYes).
  return { p: 1 - pYes, price: yesBid == null ? null : 1 - yesBid };
}

export function fullKelly(p: number, price: number): number {
  if (price <= 0 || price >= 1) return 0;
  return Math.max(0, (p - price) / (1 - price));
}

export function sizePosition(input: SizingInput): SizingResult {
  const { limits } = input;
  const constraints: RiskSnapshot["constraints"] = [];
  const { p: pRaw, price } = toSideView(input.side, input.estimatedYesProbability, input.yesAsk, input.yesBid);

  const refuse = (reason: string): SizingResult => ({
    tradeable: false,
    reason,
    snapshot: {
      stake: 0, quantity: 0, limitPrice: price ?? 0, maxLoss: 0, maxGain: 0, edge: price == null ? 0 : pRaw - price,
      expectedValue: 0, kellyFraction: limits.kellyFraction, fullKelly: price == null ? 0 : fullKelly(pRaw, price),
      budgetUtilisationAfter: limits.totalBudget > 0 ? input.currentExposure / limits.totalBudget : 0,
      themeConcentrationAfter: limits.totalBudget > 0 ? input.themeExposure / limits.totalBudget : 0,
      constraints: [...constraints, { name: "refused", bound: true, detail: reason }],
      explanation: reason,
    },
  });

  if (limits.paused) return refuse("Trading is paused by the user.");
  if (price == null) return refuse("No executable price is available for this side.");
  if (limits.totalBudget <= 0) return refuse("No risk budget has been set yet.");

  // Discount the estimate toward the market price by uncertainty: a wide interval
  // shrinks the edge we are willing to act on.
  const shrink = Math.min(1, input.uncertainty / 0.5); // 0 (certain) .. 1 (max uncertainty)
  const p = pRaw - shrink * 0.5 * (pRaw - price);
  const edge = p - price;
  constraints.push({ name: "uncertainty_discount", bound: shrink > 0, detail: `estimate ${round(pRaw, 3)} shrunk to ${round(p, 3)} (uncertainty ±${round(input.uncertainty, 2)})` });

  if (edge < limits.minEdge) {
    return refuse(`Edge after uncertainty (${round(edge * 100, 1)}%) is below the minimum ${round(limits.minEdge * 100, 1)}%.`);
  }

  const fk = fullKelly(p, price);
  let stake = fk * limits.kellyFraction * limits.totalBudget;
  constraints.push({ name: "fractional_kelly", bound: true, detail: `full Kelly ${round(fk * 100, 1)}% × ${limits.kellyFraction} × $${limits.totalBudget} = $${round(stake)}` });

  const caps: Array<[string, number, string]> = [
    ["max_per_position", limits.maxPerPosition, `per-position cap $${limits.maxPerPosition}`],
    ["remaining_budget", Math.max(0, limits.totalBudget - input.currentExposure), `remaining budget $${round(Math.max(0, limits.totalBudget - input.currentExposure))}`],
    ["theme_concentration", Math.max(0, limits.maxThemeConcentration * limits.totalBudget - input.themeExposure), `theme cap ${limits.maxThemeConcentration * 100}% of budget minus existing related exposure`],
  ];
  if (input.availableBalance != null) caps.push(["available_balance", input.availableBalance, `exchange balance $${round(input.availableBalance)}`]);

  for (const [name, cap, detail] of caps) {
    const bound = stake > cap;
    if (bound) stake = cap;
    constraints.push({ name, bound, detail });
  }

  const tick = input.priceTick ?? 0.01;
  const limitPrice = Math.ceil(price / tick) * tick; // pay up to the ask, rounded to tick
  let quantity = Math.floor(stake / limitPrice);
  if (input.minQuantity && quantity < input.minQuantity) quantity = 0;
  stake = round(quantity * limitPrice);

  if (quantity <= 0 || stake <= 0) {
    return refuse("After applying your limits the position would be too small to place.");
  }

  const maxLoss = stake;
  const maxGain = round(quantity * (1 - limitPrice));
  const expectedValue = round(quantity * (p - limitPrice));
  const budgetUtilisationAfter = (input.currentExposure + stake) / limits.totalBudget;
  const themeConcentrationAfter = (input.themeExposure + stake) / limits.totalBudget;

  const binding = constraints.filter((c) => c.bound && c.name !== "fractional_kelly" && c.name !== "uncertainty_discount").map((c) => c.name);
  const explanation =
    `Risk $${stake} (${quantity} contracts at ${round(limitPrice, 2)}). ` +
    `Edge ${round(edge * 100, 1)}% after discounting for uncertainty; ` +
    (binding.length ? `size was capped by: ${binding.join(", ")}. ` : `size follows ${limits.kellyFraction}× Kelly. `) +
    `If the contract expires worthless you lose $${maxLoss}; if it pays out you gain $${maxGain}.`;

  return {
    tradeable: true,
    reason: null,
    snapshot: {
      stake, quantity, limitPrice: round(limitPrice, 4), maxLoss, maxGain, edge: round(edge, 4), expectedValue,
      kellyFraction: limits.kellyFraction, fullKelly: round(fk, 4), budgetUtilisationAfter: round(budgetUtilisationAfter, 4),
      themeConcentrationAfter: round(themeConcentrationAfter, 4), constraints, explanation,
    },
  };
}
