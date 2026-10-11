// Forecast calibration: once a market resolves, score Mayflower's P(YES) and the market's P(YES) with Brier scores.
import { tx, load, id, now, audit } from "./db";
import { getMarket } from "./exchange";
import type { ForecastScore, Market, TradeProposal } from "./types";

const BASE_URL = (process.env.GEMINI_EXCHANGE_BASE_URL || "https://api.sandbox.gemini.com").replace(/\/$/, "");
const PROD_URL = "https://api.gemini.com";

/** Stored score plus how the outcome was determined (extra fields are fine in the JSON store). */
export type ScoredForecast = ForecastScore & { inferred?: boolean; resolutionSource?: string; side?: TradeProposal["side"] };

export type Resolution = { outcome: 0 | 1; inferred: boolean; source: string };

const mid = (m: Market) =>
  m.yesBid != null && m.yesAsk != null ? (m.yesBid + m.yesAsk) / 2 : m.lastPrice ?? m.yesAsk ?? m.yesBid;

/** Infer YES/NO from a final quote pinned at the extremes. */
function fromPrice(m: Market): 0 | 1 | undefined {
  const lo = m.yesAsk ?? m.lastPrice, hi = m.yesBid ?? m.lastPrice;
  if (hi != null && hi >= 0.99) return 1;
  if (lo != null && lo <= 0.01) return 0;
  return undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Explicit result field on a raw Gemini contract, if the API exposes one (field names unverified). */
function explicitOutcome(c: any): 0 | 1 | undefined {
  for (const k of ["resolvedOutcome", "resolution", "outcome", "result", "settledOutcome", "winningOutcome", "resolvedSide"]) {
    const v = String(c?.[k] ?? "").toLowerCase();
    if (v === "yes" || v === "true") return 1;
    if (v === "no" || v === "false") return 0;
  }
  const sv = Number(c?.settlementValue ?? c?.settlementPrice ?? NaN);
  if (sv === 1) return 1;
  if (sv === 0) return 0;
  return undefined;
}

/**
 * Try the public event endpoint (GET /v1/prediction-markets/events/{ticker}); settled events are often no longer listed.
 * Paper-only markets come from production Gemini, so fall back to it when the sandbox doesn't know the event.
 */
async function fetchContract(marketId: string): Promise<any | undefined> {
  const ticker = marketId.match(/^GEMI-([A-Z0-9]+?\d{10})-/)?.[1];
  if (!ticker) return undefined;
  for (const base of [...new Set([BASE_URL, PROD_URL])]) {
    try {
      const res = await fetch(`${base}/v1/prediction-markets/events/${ticker}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (!res.ok) continue;
      const ev = await res.json();
      const c = (ev?.contracts ?? []).find((c: any) => c.instrumentSymbol === marketId);
      if (c) return c;
    } catch { /* try the next base */ }
  }
  return undefined;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * How a market resolved, or undefined while it's still open or the result isn't known yet (never a guess).
 * Exchange result fields first; else a final price pinned at >=0.99 / <=0.01 once the market is expired/settled/closed.
 * Hyperliquid settled outcomes come back from getMarket as status "settled" with lastPrice = YES settle value.
 */
export async function resolveMarket(marketId: string, snapshot: Market): Promise<Resolution | undefined> {
  if (snapshot.source === "mock" || marketId.startsWith("MOCK-")) return undefined; // mock markets never resolve
  const expired = snapshot.expiresAt ? Date.parse(snapshot.expiresAt) < Date.now() : false;
  const live = await getMarket(marketId).catch(() => undefined);
  if (live && live.status === "open" && !expired) return undefined;
  // Hyperliquid settledOutcome / Polymarket outcomePrices: the venue's own result, carried in lastPrice.
  if (live && (live.status === "settled" || live.status === "closed") && (live.source === "hyperliquid" || live.source === "polymarket") && live.lastPrice != null) {
    if (live.lastPrice >= 0.99) return { outcome: 1, inferred: false, source: `${live.source} settlement` };
    if (live.lastPrice <= 0.01) return { outcome: 0, inferred: false, source: `${live.source} settlement` };
  }

  const raw = await fetchContract(marketId);
  if (raw) {
    const o = explicitOutcome(raw);
    if (o !== undefined) return { outcome: o, inferred: false, source: "exchange result" };
    const state = String(raw.status ?? raw.marketState ?? "").toLowerCase();
    if (state && ["open", "active"].includes(state) && !expired) return undefined;
    const p = raw.prices ?? {};
    const yesBid = Number(p.sell?.yes), yesAsk = Number(p.buy?.yes), last = Number(p.lastTradePrice);
    const m: Market = { ...snapshot, yesBid: isFinite(yesBid) ? yesBid : undefined, yesAsk: isFinite(yesAsk) ? yesAsk : undefined, lastPrice: isFinite(last) ? last : undefined };
    const f = fromPrice(m);
    if (f !== undefined && (expired || state !== "open")) return { outcome: f, inferred: true, source: "inferred from final exchange price" };
  }
  if (!expired && !(live && (live.status === "settled" || live.status === "closed"))) return undefined;
  // Fall back to the freshest quote we stored (monitor refreshes position snapshots).
  const latest = (await load()).positions
    .filter((p) => p.marketId === marketId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]?.market;
  for (const m of [live, latest, snapshot].filter(Boolean) as Market[]) {
    const f = fromPrice(m);
    if (f !== undefined) return { outcome: f, inferred: true, source: "inferred from last known price" };
  }
  return undefined;
}

/**
 * Score every forecast ("open" proposals with research) whose market has resolved. Idempotent: one score per proposal.
 * Returns the number of new scores.
 */
export async function scoreSettledMarkets(): Promise<number> {
  const db = await load();
  const scored = new Set(db.forecastScores.map((s) => s.proposalId).filter(Boolean));
  const todo = db.proposals.filter((p) => p.kind === "open" && !scored.has(p.id));
  const byMarket = new Map<string, TradeProposal[]>();
  for (const p of todo) byMarket.set(p.marketId, [...(byMarket.get(p.marketId) ?? []), p]);

  const fresh: ScoredForecast[] = [];
  for (const [marketId, props] of byMarket) {
    const r = await resolveMarket(marketId, props[0].market);
    if (!r) continue;
    for (const p of props) {
      const research = db.research.find((x) => x.id === p.researchId);
      const est = research?.estimatedProbability ?? (p.side === "YES" ? p.estimatedProbability : 1 - p.estimatedProbability);
      const mkt = mid(p.market) ?? (p.side === "YES" ? p.marketProbability : 1 - p.marketProbability);
      fresh.push({
        id: id("fs_"), userId: p.userId, marketId, proposalId: p.id,
        estimatedProbability: +est.toFixed(4), marketProbability: +mkt.toFixed(4), outcome: r.outcome,
        brier: +((est - r.outcome) ** 2).toFixed(4), marketBrier: +((mkt - r.outcome) ** 2).toFixed(4),
        scoredAt: now(), inferred: r.inferred, resolutionSource: r.source, side: p.side,
      });
    }
  }
  if (fresh.length) {
    await tx((d) => {
      const have = new Set(d.forecastScores.map((s) => s.proposalId));
      for (const s of fresh) if (!have.has(s.proposalId)) d.forecastScores.push(s);
    });
    await audit({ actor: "system", action: "calibration.scored", detail: { count: fresh.length } });
  }
  return fresh.length;
}

export interface CalibrationSummary {
  count: number;
  inferredCount: number;
  avgBrier: number | null; // lower is better; 0.25 = always guessing 50%
  marketAvgBrier: number | null;
  hitRate: number | null; // share of recommended sides that won
  buckets: { range: string; count: number; avgForecast: number; observedYesRate: number }[];
  explanation: string;
}

export async function calibrationSummary(userId?: string): Promise<CalibrationSummary> {
  const scores = ((await load()).forecastScores as ScoredForecast[]).filter((s) => !userId || s.userId === userId);
  const n = scores.length;
  if (!n) {
    return {
      count: 0, inferredCount: 0, avgBrier: null, marketAvgBrier: null, hitRate: null, buckets: [],
      explanation: "N/A until markets settle. Once markets I forecast resolve, I'll compare my accuracy (Brier score) with the market's.",
    };
  }
  const avg = (xs: number[]) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4);
  const avgBrier = avg(scores.map((s) => s.brier));
  const marketAvgBrier = avg(scores.map((s) => s.marketBrier));
  const hits = scores.map((s) => {
    const side = s.side ?? (s.estimatedProbability >= 0.5 ? "YES" : "NO");
    return (side === "YES") === (s.outcome === 1) ? 1 : 0;
  });
  const hitRate = avg(hits);
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const buckets = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const b = scores.filter((s) => s.estimatedProbability >= lo && s.estimatedProbability < hi);
    return {
      range: `${Math.round(lo * 100)}–${Math.min(100, Math.round(hi * 100))}%`, count: b.length,
      avgForecast: b.length ? avg(b.map((s) => s.estimatedProbability)) : 0,
      observedYesRate: b.length ? avg(b.map((s) => s.outcome)) : 0,
    };
  }).filter((b) => b.count > 0);
  const inferredCount = scores.filter((s) => s.inferred).length;
  const better = avgBrier < marketAvgBrier;
  const explanation =
    `${n} resolved forecast${n > 1 ? "s" : ""}. My average Brier score is ${avgBrier.toFixed(3)} vs the market's ${marketAvgBrier.toFixed(3)} (lower is better), ` +
    `so I've been ${better ? "more" : "less"} accurate than the market price so far. The side I recommended won ${Math.round(hitRate * 100)}% of the time.` +
    (n < 20 ? " That's a small sample, so don't read much into it yet." : "") +
    (inferredCount ? ` ${inferredCount} outcome${inferredCount > 1 ? "s were" : " was"} inferred from final prices because the exchange didn't report the result.` : "");
  return { count: n, inferredCount, avgBrier, marketAvgBrier, hitRate, buckets, explanation };
}
