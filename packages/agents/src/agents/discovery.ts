import type { DiscoveryRanking as DiscoveryRankingT, Market, RiskLimits, UserThesis } from "@mayflower/shared";
import { DiscoveryRanking } from "@mayflower/shared";
import type { ExchangeClient } from "@mayflower/gemini-markets";
import type { LLM } from "../llm/llm";
import { DISCOVERY_SYSTEM } from "../prompts";

export interface DiscoveredMarket {
  market: Market;
  relevance: number;
  reason: string;
  matchedTopic: string | null;
  discoveryReason: "personalized" | "general";
}

/** Cheap pre-filter so the LLM only ranks plausible candidates. */
export function keywordMatch(m: Market, theses: UserThesis[]): string | null {
  const hay = `${m.title} ${m.tags.join(" ")}`.toLowerCase();
  for (const t of theses) {
    const needles = [t.topic, ...t.belief.split(/\W+/).filter((w) => w.length > 4)].map((s) => s.toLowerCase());
    if (needles.some((n) => n && hay.includes(n))) return t.topic;
  }
  return null;
}

export function isExcluded(m: Market, limits: RiskLimits): boolean {
  const hay = `${m.title} ${m.tags.join(" ")}`.toLowerCase();
  return limits.excludedTopics.some((x) => hay.includes(x.toLowerCase()));
}

/**
 * Discovery agent: finds REAL tradable contracts from the exchange catalog and
 * ranks them. Returns personalised matches plus general-market candidates.
 */
export async function discoverMarkets(deps: { exchange: ExchangeClient; llm: LLM }, input: { theses: UserThesis[]; limits: RiskLimits; max?: number; openMarketIds?: Set<string> }): Promise<DiscoveredMarket[]> {
  const all = (await deps.exchange.listMarkets({ status: "open" })).filter((m) => !isExcluded(m, input.limits)).filter((m) => !input.openMarketIds?.has(m.id));
  if (!all.length) return [];
  const candidates = all.slice(0, 60); // keep the prompt bounded; iterate later with embeddings
  const ranking = await deps.llm.structured<DiscoveryRankingT>({
    system: DISCOVERY_SYSTEM,
    tier: "fast",
    schema: DiscoveryRanking,
    prompt: JSON.stringify({
      interests: input.theses.filter((t) => t.isInterest).map((t) => t.topic),
      beliefs: input.theses.filter((t) => !t.isInterest).map((t) => ({ topic: t.topic, belief: t.belief, confidence: t.confidence })),
      excludedTopics: input.limits.excludedTopics,
      markets: candidates.map((m) => ({ id: m.id, title: m.title, tags: m.tags, expiresAt: m.expiresAt })),
    }),
  });
  const byId = new Map(candidates.map((m) => [m.id, m]));
  const out: DiscoveredMarket[] = [];
  for (const r of ranking.ranked) {
    const m = byId.get(r.marketId);
    if (!m) continue;
    const kw = keywordMatch(m, input.theses);
    const matched = r.matchedTopic ?? kw;
    out.push({ market: m, relevance: r.relevance, reason: r.reason, matchedTopic: matched, discoveryReason: matched ? "personalized" : "general" });
  }
  out.sort((a, b) => b.relevance - a.relevance);
  const max = input.max ?? 4;
  const personalized = out.filter((o) => o.discoveryReason === "personalized").slice(0, Math.max(1, max - 1));
  const general = out.filter((o) => o.discoveryReason === "general").slice(0, 1);
  return [...personalized, ...general].slice(0, max);
}
