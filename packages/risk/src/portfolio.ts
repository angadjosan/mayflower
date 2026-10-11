import { askFor, formatCents, formatPct, formatUsd, round, type MarketContract, type Outcome, type UserRiskLimits } from "@mayflower/shared";
import { riskCapacity } from "./sizing";

export interface PortfolioPositionInput {
  label: string;
  costBasis: number;
  /** Mark-to-market value at the executable exit price; null when there is no bid. */
  marketValue: number | null;
  realizedPnl: number;
  correlationGroup: string | null;
}

export interface ConcentrationItem {
  group: string;
  atRisk: number;
  share: number;
  positions: number;
}

export interface PortfolioSummary {
  cash: number;
  invested: number;
  marketValue: number;
  totalValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
  atRisk: number;
  capacity: number;
  capacityUsed: number;
  concentration: ConcentrationItem[];
  explanation: string;
  noLiquidityPositions: number;
}

export function summarizePortfolio(input: {
  positions: PortfolioPositionInput[];
  cash: number;
  reserved: number;
  realizedFromClosed: number;
  limits: UserRiskLimits;
}): PortfolioSummary {
  const invested = round(input.positions.reduce((s, p) => s + p.costBasis, 0), 2);
  const noLiquidity = input.positions.filter((p) => p.marketValue === null).length;
  // Without a live bid we fall back to cost basis for the total and say so.
  const marketValue = round(input.positions.reduce((s, p) => s + (p.marketValue ?? p.costBasis), 0), 2);
  const unrealized = round(input.positions.reduce((s, p) => s + (p.marketValue === null ? 0 : p.marketValue - p.costBasis), 0), 2);
  const realized = round(input.realizedFromClosed + input.positions.reduce((s, p) => s + p.realizedPnl, 0), 2);
  const atRisk = round(invested + input.reserved, 2);
  const capacity = riskCapacity(input.limits);
  const groups = new Map<string, ConcentrationItem>();
  for (const p of input.positions) {
    const g = p.correlationGroup ?? "uncategorized";
    const item = groups.get(g) ?? { group: g, atRisk: 0, share: 0, positions: 0 };
    item.atRisk = round(item.atRisk + p.costBasis, 2);
    item.positions += 1;
    groups.set(g, item);
  }
  const concentration = [...groups.values()]
    .map((g) => ({ ...g, share: capacity > 0 ? round(g.atRisk / capacity, 4) : 0 }))
    .sort((a, b) => b.atRisk - a.atRisk);

  let explanation: string;
  if (input.positions.length === 0 && input.reserved === 0) {
    explanation = "Nothing is at risk yet. Your full risk budget is available.";
  } else {
    const top = concentration[0];
    const parts = [`${formatUsd(atRisk)} of your ${formatUsd(capacity)} risk limit is at risk (${formatPct(capacity > 0 ? atRisk / capacity : 0)}).`];
    if (top) {
      parts.push(
        `The biggest driver is ${prettyGroup(top.group)} at ${formatUsd(top.atRisk)} across ${top.positions} position${top.positions === 1 ? "" : "s"}${concentration.length > 1 ? "" : " — everything you hold depends on related outcomes"}.`,
      );
    }
    if (input.reserved > 0) parts.push(`${formatUsd(input.reserved)} is reserved for approved orders that have not filled yet.`);
    if (noLiquidity > 0) parts.push(`${noLiquidity} position${noLiquidity === 1 ? " has" : "s have"} no live bid, so ${noLiquidity === 1 ? "it is" : "they are"} valued at cost.`);
    parts.push("Each contract can lose its full cost if it resolves against you.");
    explanation = parts.join(" ");
  }

  return {
    cash: round(input.cash, 2),
    invested,
    marketValue,
    totalValue: round(input.cash + marketValue, 2),
    unrealizedPnl: unrealized,
    realizedPnl: realized,
    atRisk,
    capacity,
    capacityUsed: capacity > 0 ? round(atRisk / capacity, 4) : 0,
    concentration,
    explanation,
    noLiquidityPositions: noLiquidity,
  };
}

export function prettyGroup(group: string): string {
  const names: Record<string, string> = {
    "sports-football": "football",
    "sports-basketball": "basketball",
    "sports-soccer": "soccer",
    "sports-baseball": "baseball",
    "tech-ai": "AI & tech",
    "macro-rates": "interest rates",
    "macro-growth": "the economy",
    crypto: "crypto",
    politics: "politics",
    weather: "weather",
    culture: "entertainment",
    "markets-equities": "stock markets",
  };
  return names[group] ?? group.replace(/^category-/, "").replace(/[-_]/g, " ");
}

export interface SharpeResult {
  value: number | null;
  observations: number;
  reason: string | null;
}

/**
 * Annualized Sharpe ratio from daily portfolio value snapshots. Returns null
 * (shown as "N/A — insufficient history") unless there is a meaningful
 * history: at least `minObservations` daily returns over `minDays` days with
 * non-trivial volatility. Never invents a number from a handful of trades.
 */
export function sharpeRatio(
  snapshots: { ts: string; totalValue: number }[],
  opts: { minObservations?: number; minDays?: number; riskFreeDaily?: number } = {},
): SharpeResult {
  const minObs = opts.minObservations ?? 20;
  const minDays = opts.minDays ?? 20;
  const rf = opts.riskFreeDaily ?? 0;
  // One value per UTC day (last snapshot of the day).
  const byDay = new Map<string, number>();
  for (const s of [...snapshots].sort((a, b) => a.ts.localeCompare(b.ts))) byDay.set(s.ts.slice(0, 10), s.totalValue);
  const days = [...byDay.entries()];
  const returns: number[] = [];
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1][1];
    if (prev > 0) returns.push(days[i][1] / prev - 1);
  }
  if (days.length < 2) return { value: null, observations: returns.length, reason: "insufficient history" };
  const spanDays = (new Date(days[days.length - 1][0]).getTime() - new Date(days[0][0]).getTime()) / 86_400_000;
  if (returns.length < minObs || spanDays < minDays) {
    return { value: null, observations: returns.length, reason: "insufficient history" };
  }
  const excess = returns.map((r) => r - rf);
  const mean = excess.reduce((s, r) => s + r, 0) / excess.length;
  const variance = excess.reduce((s, r) => s + (r - mean) ** 2, 0) / (excess.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 1e-6)) return { value: null, observations: returns.length, reason: "returns have no meaningful volatility yet" };
  return { value: round((mean / sd) * Math.sqrt(365), 2), observations: returns.length, reason: null };
}

export interface HedgeScenario {
  name: string;
  pnl: number;
}

export interface HedgeIdea {
  symbol: string;
  outcome: Outcome;
  label: string;
  relationship: "mutually_exclusive" | "same_contract" | "related";
  price: number;
  quantity: number;
  cost: number;
  scenarios: HedgeScenario[];
  explanation: string;
  caveat: string;
}

/**
 * Basic hedge ideas for one position. Only contracts in the same event are
 * treated as genuinely offsetting; anything else is labelled "related" and
 * never called a guaranteed hedge.
 */
export function findHedges(
  position: { symbol: string; eventTicker: string; outcome: Outcome; quantity: number; avgPrice: number; label: string; correlationGroup: string | null },
  candidates: MarketContract[],
  groupOf: (m: MarketContract) => string,
): HedgeIdea[] {
  const ideas: HedgeIdea[] = [];
  const q = position.quantity;
  const c1 = position.avgPrice;
  const winPnl = round(q * (1 - c1), 2);
  const losePnl = round(-q * c1, 2);

  for (const m of candidates) {
    if (m.symbol === position.symbol) continue;
    if (m.status !== "active" || m.marketState === "closed") continue;
    const sameEvent = m.eventTicker === position.eventTicker && m.eventType === "categorical";
    const related = !sameEvent && position.correlationGroup !== null && groupOf(m) === position.correlationGroup;
    if (!sameEvent && !related) continue;
    if (!sameEvent) {
      ideas.push({
        symbol: m.symbol,
        outcome: "no",
        label: m.label,
        relationship: "related",
        price: askFor(m.quote, "no") ?? 0,
        quantity: 0,
        cost: 0,
        scenarios: [],
        explanation: `“${m.label}” is in the same theme (${groupOf(m)}), so it tends to move with your position.`,
        caveat: "Loosely related, not a hedge: both positions can lose at the same time. Shown for awareness only.",
      });
      continue;
    }
    // Mutually exclusive outcome in the same categorical event: buying its YES pays when ours loses.
    if (position.outcome !== "yes") continue;
    const c2 = askFor(m.quote, "yes");
    if (c2 === null || c2 <= 0 || c2 >= 0.95) continue;
    // Size the hedge to cut the loss in the "other outcome wins" scenario roughly in half.
    const h = Math.max(1, Math.floor((0.5 * q * c1) / (1 - c2)));
    const cost = round(h * c2, 2);
    ideas.push({
      symbol: m.symbol,
      outcome: "yes",
      label: m.label,
      relationship: "mutually_exclusive",
      price: c2,
      quantity: h,
      cost,
      scenarios: [
        { name: `“${position.label}” wins`, pnl: round(winPnl - cost, 2) },
        { name: `“${m.label}” wins`, pnl: round(losePnl + h * (1 - c2), 2) },
        { name: "Neither wins", pnl: round(losePnl - cost, 2) },
      ],
      explanation: `Only one outcome in this event can win. Buying ${h} YES on “${m.label}” at ${formatCents(c2)} (${formatUsd(cost)}) pays out if that rival outcome wins, offsetting part of your loss.`,
      caveat: `It costs ${formatUsd(cost)} and reduces your profit if you are right. It does not protect against outcomes outside these two.`,
    });
  }
  return ideas
    .sort((a, b) => (a.relationship === b.relationship ? 0 : a.relationship === "mutually_exclusive" ? -1 : 1))
    .slice(0, 3);
}
