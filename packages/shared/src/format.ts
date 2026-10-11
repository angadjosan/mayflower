import type { Outcome, Quote } from "./types";

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatUsd(value: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const str = abs.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value < 0) return `-${str}`;
  if (opts.signed && value > 0) return `+${str}`;
  return str;
}

export function formatPct(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Price of a binary contract, shown in cents like "42¢". */
export function formatCents(price: number | null | undefined): string {
  if (price === null || price === undefined || Number.isNaN(price)) return "—";
  const cents = price * 100;
  return `${Number.isInteger(round(cents, 2)) ? cents.toFixed(0) : cents.toFixed(1)}¢`;
}

/** Market-implied probability for YES: mid of best bid/ask, else the YES ask, else last trade. */
export function impliedProbability(quote: Quote): number | null {
  if (quote.bestBid !== null && quote.bestAsk !== null && quote.bestAsk >= quote.bestBid) {
    return (quote.bestBid + quote.bestAsk) / 2;
  }
  if (quote.buyYes !== null && quote.sellYes !== null) return (quote.buyYes + quote.sellYes) / 2;
  if (quote.buyYes !== null) return quote.buyYes;
  if (quote.lastTrade !== null) return quote.lastTrade;
  return null;
}

/** Executable price to buy the given outcome. */
export function askFor(quote: Quote, outcome: Outcome): number | null {
  if (outcome === "yes") return quote.buyYes ?? quote.bestAsk ?? null;
  if (quote.buyNo !== null) return quote.buyNo;
  return quote.bestBid !== null ? round(1 - quote.bestBid, 4) : null;
}

/** Executable price to sell (close) the given outcome. */
export function bidFor(quote: Quote, outcome: Outcome): number | null {
  if (outcome === "yes") return quote.sellYes ?? quote.bestBid ?? null;
  if (quote.sellNo !== null) return quote.sellNo;
  return quote.bestAsk !== null ? round(1 - quote.bestAsk, 4) : null;
}

/** Spread of the YES book in price units, if both sides exist. */
export function spreadOf(quote: Quote): number | null {
  if (quote.bestBid !== null && quote.bestAsk !== null) return round(quote.bestAsk - quote.bestBid, 4);
  if (quote.buyYes !== null && quote.sellYes !== null) return round(quote.buyYes - quote.sellYes, 4);
  return null;
}

/** Deterministic JSON serialization (sorted keys) for hashing proposal terms. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function daysUntil(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (t - now.getTime()) / 86_400_000;
}

export function outcomeLabel(outcome: Outcome): string {
  return outcome === "yes" ? "YES" : "NO";
}
