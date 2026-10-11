import { z } from "zod";
import {
  daysUntil,
  detectEntities,
  detectTopics,
  impliedProbability,
  matchesExclusion,
  spreadOf,
  askFor,
  topicForMarket,
  type MarketContract,
} from "@mayflower/shared";
import { withFallback, type LLM } from "./llm";

export interface DiscoveryProfile {
  interests: string[];
  beliefs: { topic: string; belief: string; stance: string; confidence: number }[];
  excludedTopics: string[];
}

export interface SearchTerm {
  term: string;
  reason: string;
}

const TermsSchema = z.object({
  terms: z
    .array(z.object({ term: z.string().describe("1-3 words likely to appear in a prediction market title"), reason: z.string() }))
    .max(8),
});

/** Search terms for personalized discovery, derived from interests and beliefs. */
export async function personalizedSearchTerms(profile: DiscoveryProfile, llm?: LLM | null, onError?: (e: unknown) => void, focus?: string | null): Promise<SearchTerm[]> {
  const heuristic = (): SearchTerm[] => {
    const terms: SearchTerm[] = [];
    const add = (term: string, reason: string) => {
      if (!terms.some((t) => t.term.toLowerCase() === term.toLowerCase())) terms.push({ term, reason });
    };
    const sources = [focus ?? "", ...profile.interests, ...profile.beliefs.map((b) => `${b.topic} ${b.belief}`)].filter(Boolean);
    for (const s of sources) {
      for (const e of detectEntities(s)) add(e[0].toUpperCase() + e.slice(1), `you mentioned ${s.length > 40 ? s.slice(0, 40) + "…" : s}`);
      for (const t of detectTopics(s)) for (const st of t.searchTerms.slice(0, 2)) add(st, `related to your interest in ${t.label}`);
    }
    if (focus && terms.length === 0) add(focus, "you asked about it");
    return terms.slice(0, 8);
  };
  if (profile.interests.length === 0 && profile.beliefs.length === 0 && !focus) return [];
  return withFallback(
    llm,
    async (m) => {
      const out = await m.json({
        system:
          "You turn a user's interests and beliefs into short search keywords for finding prediction-market events by title on the Gemini exchange (sports, economics, crypto, tech, politics, weather, culture). Prefer specific names (teams, companies, indicators). Avoid topics the user excluded.",
        schema: TermsSchema,
        prompt: JSON.stringify({ interests: profile.interests, beliefs: profile.beliefs, excluded: profile.excludedTopics, focus: focus ?? null }),
      });
      return out.terms.length ? out.terms : heuristic();
    },
    heuristic,
    onError,
  );
}

export interface ValidationResult {
  ok: boolean;
  issues: string[];
  warnings: string[];
}

/** Only recommend contracts that really exist, are open, unexpired and have an executable price. */
export function validateContract(m: MarketContract, now = new Date()): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  if (m.status !== "active") issues.push(`market status is ${m.status}`);
  if (m.marketState === "closed") issues.push("trading is closed");
  const d = daysUntil(m.expiry, now);
  if (d !== null && d < 2 / 24) issues.push("expires within two hours");
  if (askFor(m.quote, "yes") === null && askFor(m.quote, "no") === null) issues.push("no executable price");
  const spread = spreadOf(m.quote);
  if (spread !== null && spread > 0.15) issues.push(`spread of ${(spread * 100).toFixed(0)}¢ is too wide`);
  if (m.liquidityUsd !== null && m.liquidityUsd < 500) warnings.push("thin liquidity");
  if (!m.description && !m.rulesUrl) warnings.push("resolution rules not provided — read the contract terms on Gemini before trading");
  if (m.resolutionSide) issues.push("already resolved");
  return { ok: issues.length === 0, issues, warnings };
}

export interface Candidate {
  market: MarketContract;
  kind: "personalized" | "general";
  score: number;
  reason: string;
  matchedInterest: string | null;
}

function textOf(m: MarketContract): string {
  return `${m.eventTitle} ${m.label} ${m.tags.join(" ")} ${m.category}`.toLowerCase();
}

function isExcluded(m: MarketContract, excluded: string[]): boolean {
  return excluded.some((ex) => matchesExclusion(ex, { category: m.category, title: m.eventTitle, label: m.label, tags: m.tags }));
}

function onePerEvent(cands: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const c of cands) {
    const prev = best.get(c.market.eventTicker);
    if (!prev || c.score > prev.score) best.set(c.market.eventTicker, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** Price "interestingness": mid-range prices and real liquidity are where an estimate can matter. */
function marketQuality(m: MarketContract): number {
  const p = impliedProbability(m.quote) ?? 0.5;
  const mid = 1 - Math.abs(p - 0.5) * 2; // 1 at 50%, 0 at extremes
  const liq = m.liquidityUsd ? Math.min(1, Math.log10(Math.max(1, m.liquidityUsd)) / 6) : 0.3;
  const spread = spreadOf(m.quote) ?? 0.05;
  const tight = Math.max(0, 1 - spread / 0.15);
  const d = daysUntil(m.expiry);
  const horizon = d === null ? 0.5 : d < 1 ? 0.3 : d <= 90 ? 1 : 0.5;
  let moved = 0;
  if (m.priceHistory.length >= 2) {
    const first = m.priceHistory[0].price;
    const last = m.priceHistory[m.priceHistory.length - 1].price;
    moved = Math.min(1, Math.abs(last - first) / 0.15);
  }
  return 0.3 * mid + 0.25 * liq + 0.2 * tight + 0.15 * horizon + 0.1 * moved;
}

function hasWord(text: string, k: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);
}

export function rankPersonalized(markets: MarketContract[], profile: DiscoveryProfile, terms: SearchTerm[]): Candidate[] {
  // Direct terms are what the user actually named (or search terms derived from them);
  // expanded terms are topic keywords (e.g. every NFL team for "NFL football") and count for less.
  const direct = new Map<string, string>();
  const expanded = new Map<string, string>();
  for (const i of profile.interests) {
    if (detectTopics(i).length === 0 || detectEntities(i).length > 0) direct.set(i.toLowerCase(), i);
    for (const e of detectEntities(i)) direct.set(e, i);
    for (const t of detectTopics(i)) for (const k of t.keywords) expanded.set(k, i);
  }
  for (const b of profile.beliefs) {
    for (const e of detectEntities(`${b.topic} ${b.belief}`)) direct.set(e, b.topic);
    for (const t of detectTopics(`${b.topic} ${b.belief}`)) for (const k of t.keywords) expanded.set(k, b.topic);
  }
  for (const t of terms) direct.set(t.term.toLowerCase(), t.term);
  for (const k of direct.keys()) expanded.delete(k);

  const cands: Candidate[] = [];
  for (const m of markets) {
    if (!validateContract(m).ok || isExcluded(m, profile.excludedTopics)) continue;
    const text = textOf(m);
    const label = m.label.toLowerCase();
    let directHits = 0;
    let expandedHits = 0;
    let labelHit = false;
    let matched: string | null = null;
    for (const [k, origin] of direct) {
      if (hasWord(text, k)) {
        directHits++;
        matched ??= origin;
        if (hasWord(label, k)) labelHit = true;
      }
    }
    for (const [k, origin] of expanded) {
      if (hasWord(text, k)) {
        expandedHits++;
        matched ??= origin;
      }
    }
    if (directHits === 0 && expandedHits === 0) continue;
    const relevance = Math.min(1, (3 * directHits + expandedHits) / 6);
    const score = 0.65 * relevance + (labelHit ? 0.15 : 0) + 0.2 * marketQuality(m);
    cands.push({ market: m, kind: "personalized", score, reason: `Matches your interest in ${matched}`, matchedInterest: matched });
  }
  return onePerEvent(cands);
}

export function rankGeneral(markets: MarketContract[], profile: DiscoveryProfile, excludeSymbols: Set<string>, extraExclusions: string[] = []): Candidate[] {
  const interestTopics = new Set(profile.interests.flatMap((i) => detectTopics(i).map((t) => t.key)));
  const cands: Candidate[] = [];
  for (const m of markets) {
    if (excludeSymbols.has(m.symbol)) continue;
    if (!validateContract(m).ok || isExcluded(m, [...profile.excludedTopics, ...extraExclusions])) continue;
    const topic = topicForMarket({ category: m.category, title: m.eventTitle, label: m.label, tags: m.tags });
    // General discovery deliberately looks beyond the user's existing interests.
    const novelty = topic && interestTopics.has(topic.key) ? 0 : 0.15;
    const score = marketQuality(m) + novelty;
    const p = impliedProbability(m.quote);
    cands.push({
      market: m,
      kind: "general",
      score,
      reason: `Broad market scan: ${m.liquidityUsd ? `$${Math.round(m.liquidityUsd).toLocaleString()} liquidity, ` : ""}priced near ${p !== null ? Math.round(p * 100) + "%" : "an uncertain level"}${novelty ? ", outside your usual topics" : ""}`,
      matchedInterest: null,
    });
  }
  return onePerEvent(cands);
}
