import type { Citation, Market } from "@mayflower/shared";
import type { ResearchProvider, SearchHit } from "@mayflower/context";

export interface EvidenceBundle {
  citations: Citation[];
  /** Compact text handed to the forecaster, one numbered entry per citation. */
  digest: string;
  providerName: string;
}

/** Build search queries that look for BOTH confirming and disconfirming evidence. */
export function buildQueries(m: Market): string[] {
  const core = m.title.replace(/^will\s+/i, "").replace(/\?$/, "");
  return [core, `${core} latest news`, `${core} unlikely OR doubts OR risks`];
}

function toCitation(h: SearchHit): Citation {
  return { url: h.url, title: h.title, snippet: (h.passages?.[0] ?? h.snippet ?? "").slice(0, 500), publishedAt: h.publishedAt ?? null, stance: "neutral" };
}

/** Research agent: gathers sourced, recent evidence through the research provider. */
export async function gatherEvidence(provider: ResearchProvider, market: Market, opts: { perQuery?: number } = {}): Promise<EvidenceBundle> {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const q of buildQueries(market)) {
    try {
      const hits = await provider.search(q, { limit: opts.perQuery ?? 5, freshness: "month", withPassages: true });
      for (const h of hits) {
        if (seen.has(h.url)) continue;
        seen.add(h.url);
        citations.push(toCitation(h));
      }
    } catch (e) {
      console.warn(`[research] query failed: ${q}:`, (e as Error).message);
    }
  }
  const digest = citations.map((c, i) => `[${i}] ${c.title} (${c.publishedAt ?? "date unknown"}) ${c.url}\n    ${c.snippet}`).join("\n");
  return { citations, digest, providerName: provider.name };
}
