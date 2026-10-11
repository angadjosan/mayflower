import {
  askFor,
  formatCents,
  formatPct,
  formatUsd,
  impliedProbability,
  outcomeLabel,
  round,
  spreadOf,
  type ContractIncrements,
  type ExposureItem,
  type Outcome,
  type Quote,
  type RiskStyle,
  type SizingCap,
  type SizingResult,
  type Uncertainty,
  type UserRiskLimits,
} from "@mayflower/shared";

/** How much of the gap between our estimate and the market we trust, by uncertainty. */
export const TRUST_BY_UNCERTAINTY: Record<Uncertainty, number> = { low: 0.85, medium: 0.65, high: 0.4 };
/** Fraction of full Kelly used, by risk style. */
export const KELLY_MULTIPLIER: Record<RiskStyle, number> = { conservative: 0.25, balanced: 0.35, aggressive: 0.5 };
/** Minimum edge (in $ per $1 contract, after costs) required to recommend a trade. */
export const MIN_EDGE: Record<RiskStyle, number> = { conservative: 0.04, balanced: 0.03, aggressive: 0.02 };
/** Maximum share of the risk capacity allowed in one correlation group. */
export const GROUP_CAP_SHARE: Record<RiskStyle, number> = { conservative: 0.3, balanced: 0.4, aggressive: 0.5 };
/** Spreads wider than this are considered too illiquid to trade. */
export const MAX_SPREAD = 0.15;
const MIN_PRICE = 0.02;
const MAX_PRICE = 0.98;

export interface SizingInput {
  /** Mayflower's (post-critic) probability that YES resolves true. */
  probability: number;
  uncertainty: Uncertainty;
  quote: Quote;
  increments: ContractIncrements;
  limits: UserRiskLimits;
  /** Real spendable balance (exchange balance, or ledger balance in shared/simulated mode). */
  availableBalance: number;
  /** Existing open positions and reserved (approved, unfilled) orders. */
  exposures: ExposureItem[];
  symbol: string;
  eventTicker: string;
  correlationGroup: string | null;
  /** Estimated trading fee per contract, in dollars. */
  feePerContract?: number;
  /** Restrict to one side (e.g. the user asked for YES). */
  forcedSide?: Outcome;
}

interface SideEval {
  side: Outcome;
  ask: number;
  pSide: number;
  edge: number;
  kelly: number;
}

function floorToIncrement(value: number, increment: number): number {
  if (increment <= 0) return value;
  return round(Math.floor(round(value / increment, 8)) * increment, 8);
}

export function riskCapacity(limits: UserRiskLimits): number {
  return Math.max(0, Math.min(limits.riskBudget, limits.maxTotalExposure));
}

export function sizePosition(input: SizingInput): SizingResult {
  const { limits, quote, uncertainty } = input;
  const fee = input.feePerContract ?? 0;
  const steps: string[] = [];
  const noTradeReasons: string[] = [];
  const capsApplied: SizingCap[] = [];
  const rawP = input.probability;
  const marketP = impliedProbability(quote);
  const capacity = riskCapacity(limits);
  const correlated = input.exposures.filter(
    (e) => e.eventTicker === input.eventTicker || (input.correlationGroup !== null && e.correlationGroup === input.correlationGroup),
  );

  const base: SizingResult = {
    decision: "no_trade",
    side: null,
    limitPrice: null,
    quantity: 0,
    cost: 0,
    maxLoss: 0,
    maxPayout: 0,
    expectedValue: 0,
    edge: 0,
    marketProbability: marketP,
    rawProbability: rawP,
    adjustedProbability: rawP,
    kellyFraction: 0,
    fractionalKelly: 0,
    stakeBeforeCaps: 0,
    capsApplied,
    bindingCap: null,
    steps,
    noTradeReasons,
    correlated,
    bankroll: capacity,
  };

  if (!(rawP > 0 && rawP < 1)) {
    noTradeReasons.push("No usable probability estimate.");
    return base;
  }
  if (marketP === null) {
    noTradeReasons.push("The market has no usable price right now.");
    return base;
  }

  const trust = TRUST_BY_UNCERTAINTY[uncertainty];
  const adjP = round(marketP + (rawP - marketP) * trust, 4);
  base.adjustedProbability = adjP;
  steps.push(`The market price implies about ${formatPct(marketP)} for YES.`);
  steps.push(
    `Mayflower estimates ${formatPct(rawP)}. Uncertainty is ${uncertainty}, so it only trusts ${formatPct(trust)} of the gap and sizes as if the true chance were ${formatPct(adjP, 1)}.`,
  );

  const spread = spreadOf(quote);
  if (spread !== null && spread > MAX_SPREAD) {
    noTradeReasons.push(`The bid/ask spread is ${formatCents(spread)}, too wide to trade without giving away the edge.`);
  }

  const sides: Outcome[] = input.forcedSide ? [input.forcedSide] : ["yes", "no"];
  const evals: SideEval[] = [];
  for (const side of sides) {
    const ask = askFor(quote, side);
    if (ask === null || ask <= 0 || ask >= 1) continue;
    const pSide = side === "yes" ? adjP : 1 - adjP;
    const cost = ask + fee;
    const edge = round(pSide - cost, 4);
    const kelly = cost < 1 ? Math.max(0, edge / (1 - cost)) : 0;
    evals.push({ side, ask, pSide, edge, kelly });
  }
  if (evals.length === 0) {
    noTradeReasons.push("There is no executable price to buy this contract.");
    return base;
  }
  const best = evals.reduce((a, b) => (b.edge > a.edge ? b : a));
  base.side = best.side;
  base.edge = best.edge;
  base.limitPrice = best.ask;

  const opposite = input.exposures.find((e) => e.symbol === input.symbol && e.outcome !== best.side && e.quantity > 0);
  if (opposite) {
    noTradeReasons.push(
      `You already hold ${outcomeLabel(opposite.outcome)} on this contract. Buying the other side would just offset it; Mayflower would propose selling instead.`,
    );
  }

  const minEdge = MIN_EDGE[limits.riskStyle];
  steps.push(
    `Buying ${outcomeLabel(best.side)} costs ${formatCents(best.ask)}${fee > 0 ? ` plus about ${formatCents(fee)} in fees` : ""}, for an edge of about ${formatCents(best.edge)} per $1 contract.`,
  );
  if (best.edge < minEdge) {
    noTradeReasons.push(
      `The edge (${formatCents(best.edge)}) is below the ${formatCents(minEdge)} minimum for a ${limits.riskStyle} profile — fees, spread and model error could easily erase it.`,
    );
  }
  if (best.ask < MIN_PRICE || best.ask > MAX_PRICE) {
    noTradeReasons.push(`At ${formatCents(best.ask)} the contract is priced at an extreme where small estimation errors dominate.`);
  }

  const kmult = KELLY_MULTIPLIER[limits.riskStyle];
  const fractional = round(best.kelly * kmult, 6);
  base.kellyFraction = round(best.kelly, 6);
  base.fractionalKelly = fractional;
  const kellyStake = round(fractional * capacity, 2);
  base.stakeBeforeCaps = kellyStake;
  steps.push(
    `Full Kelly sizing would risk ${formatPct(best.kelly, 1)} of your ${formatUsd(capacity)} risk capacity; a ${limits.riskStyle} profile uses ${formatPct(kmult)} of Kelly, which is ${formatUsd(kellyStake)}.`,
  );

  // Hard limits enforced by the engine, never by the LLM.
  const totalAtRisk = input.exposures.reduce((s, e) => s + e.atRisk, 0);
  const sameContract = input.exposures
    .filter((e) => e.symbol === input.symbol && e.outcome === best.side)
    .reduce((s, e) => s + e.atRisk, 0);
  const groupAtRisk = correlated.reduce((s, e) => s + e.atRisk, 0);
  const groupCap = round(GROUP_CAP_SHARE[limits.riskStyle] * capacity, 2);

  const caps: SizingCap[] = [
    {
      name: "per_position",
      limit: round(Math.max(0, limits.maxPerPosition - sameContract), 2),
      detail:
        sameContract > 0
          ? `your ${formatUsd(limits.maxPerPosition)} max per position, minus ${formatUsd(sameContract)} already in this contract`
          : `your ${formatUsd(limits.maxPerPosition)} max loss per position`,
    },
    {
      name: "total_exposure",
      limit: round(Math.max(0, capacity - totalAtRisk), 2),
      detail: `your ${formatUsd(capacity)} total risk limit, with ${formatUsd(totalAtRisk)} already at risk`,
    },
    {
      name: "balance",
      limit: round(Math.max(0, input.availableBalance), 2),
      detail: `your available balance of ${formatUsd(input.availableBalance)}`,
    },
  ];
  if (correlated.length > 0) {
    caps.push({
      name: "correlation",
      limit: round(Math.max(0, groupCap - groupAtRisk), 2),
      detail: `a ${formatUsd(groupCap)} cap on related outcomes — you already have ${formatUsd(groupAtRisk)} in ${correlated.length} related position${correlated.length === 1 ? "" : "s"}`,
    });
  }

  let stake = kellyStake;
  for (const cap of caps) {
    if (cap.limit < stake) {
      stake = cap.limit;
      base.bindingCap = cap.name;
      capsApplied.push(cap);
    }
  }
  for (const cap of capsApplied) steps.push(`Capped at ${formatUsd(cap.limit)} by ${cap.detail}.`);
  if (correlated.length > 0 && !capsApplied.some((c) => c.name === "correlation")) {
    steps.push(`You already have ${formatUsd(groupAtRisk)} in related outcomes; this stays within the ${formatUsd(groupCap)} related-outcome cap.`);
  }
  const zeroCap = caps.find((c) => c.limit <= 0);
  if (zeroCap) noTradeReasons.push(`No room left under ${zeroCap.detail}.`);

  const costPer = best.ask + fee;
  const quantity = floorToIncrement(stake / costPer, input.increments.quantityIncrement || 1);
  if (noTradeReasons.length === 0 && quantity < Math.max(input.increments.quantityMinimum, input.increments.quantityIncrement || 0, 1e-9)) {
    noTradeReasons.push(
      `The risk-sized amount (${formatUsd(stake)}) is too small to buy the minimum ${input.increments.quantityMinimum} contract${input.increments.quantityMinimum === 1 ? "" : "s"}.`,
    );
  }

  if (noTradeReasons.length > 0) {
    steps.push("Recommendation: no trade.");
    return base;
  }

  const cost = round(quantity * costPer, 2);
  base.decision = "trade";
  base.quantity = quantity;
  base.cost = cost;
  base.maxLoss = cost;
  base.maxPayout = round(quantity, 2);
  base.expectedValue = round(quantity * best.edge, 2);
  steps.push(
    `Final: buy ${quantity} ${outcomeLabel(best.side)} at ${formatCents(best.ask)} = ${formatUsd(cost)}. If it loses you lose ${formatUsd(cost)}; if it wins you get ${formatUsd(quantity)} back (${formatUsd(quantity - cost, { signed: true })}).`,
  );
  return base;
}
