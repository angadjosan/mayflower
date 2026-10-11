import ContextDev from "context.dev";
import type { Citation, MarketContract } from "@mayflower/shared";
import { demoEvidenceFor } from "./demo-evidence";

export type Freshness = "last_24_hours" | "last_week" | "last_month" | "last_year";

export interface ResearchQuery {
  query: string;
  freshness?: Freshness;
  purpose: "context" | "contrary" | "update" | "user";
}

export interface ResearchResult {
  citations: Citation[];
  queries: ResearchQuery[];
  provider: "context.dev" | "demo" | "none";
  errors: string[];
  partial: boolean;
}

export interface ResearchProvider {
  readonly label: "live" | "demo" | "offline";
  search(queries: ResearchQuery[], opts?: { market?: MarketContract; maxPerQuery?: number }): Promise<ResearchResult>;
}

function hashId(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `c${(h >>> 0).toString(36)}`;
}

/** Live research through Context.dev's web search with relevant passages. */
export class ContextDevResearch implements ResearchProvider {
  readonly label = "live" as const;
  private client: ContextDev;

  constructor(apiKey: string, opts: { baseURL?: string } = {}) {
    this.client = new ContextDev({ apiKey, timeout: 30_000, maxRetries: 1, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) });
  }

  async search(queries: ResearchQuery[], opts: { maxPerQuery?: number } = {}): Promise<ResearchResult> {
    const maxPer = opts.maxPerQuery ?? 4;
    const errors: string[] = [];
    let partial = false;
    const seen = new Set<string>();
    const citations: Citation[] = [];
    const results = await Promise.allSettled(
      queries.map((q) =>
        this.client.web.search({
          query: q.query,
          numResults: 10,
          ...(q.freshness ? { freshness: q.freshness } : {}),
          highlightsOptions: { enabled: true, maxCharacters: 700 },
          descriptionMaxCharacters: 400,
          timeoutOpts: { milliseconds: 20_000, behavior: "return-partial" },
          tags: ["mayflower", q.purpose],
        }),
      ),
    );
    const retrievedAt = new Date().toISOString();
    results.forEach((r, i) => {
      const q = queries[i];
      if (r.status === "rejected") {
        errors.push(`Context.dev search failed for "${q.query}": ${(r.reason as Error)?.message ?? String(r.reason)}`);
        return;
      }
      if (r.value.partial) partial = true;
      const ranked = [...r.value.results].sort((a, b) => rank(a.relevance) - rank(b.relevance));
      let taken = 0;
      for (const item of ranked) {
        if (taken >= maxPer) break;
        if (!item.url || seen.has(item.url)) continue;
        if (item.relevance === "low" && taken > 0) continue;
        seen.add(item.url);
        const passages = item.highlights?.code === "SUCCESS" && item.highlights.highlights ? item.highlights.highlights : [];
        const snippet = (passages.length ? passages.join(" … ") : item.description || "").slice(0, 900);
        citations.push({
          id: hashId(item.url),
          title: item.title || item.url,
          url: item.url,
          snippet,
          query: q.query,
          relevance: item.relevance ?? null,
          retrievedAt,
          publishedAt: null,
          provider: "context.dev",
        });
        taken++;
      }
    });
    return { citations, queries, provider: "context.dev", errors, partial };
  }
}

function rank(r: string | undefined): number {
  return r === "high" ? 0 : r === "medium" ? 1 : 2;
}

/** Offline demo evidence for the demo catalog. Labelled as demo everywhere. */
export class DemoResearch implements ResearchProvider {
  readonly label = "demo" as const;
  async search(queries: ResearchQuery[], opts: { market?: MarketContract } = {}): Promise<ResearchResult> {
    const citations = opts.market ? demoEvidenceFor(opts.market, queries) : [];
    return { citations, queries, provider: "demo", errors: [], partial: false };
  }
}

/** No research provider configured: returns nothing, and says so. */
export class NoResearch implements ResearchProvider {
  readonly label = "offline" as const;
  async search(queries: ResearchQuery[]): Promise<ResearchResult> {
    return { citations: [], queries, provider: "none", errors: ["Context.dev is not configured (CONTEXT_DEV_API_KEY missing)."], partial: false };
  }
}

/** Standard research plan for a contract: current context plus deliberately contrary evidence. */
export function researchPlan(market: MarketContract, extraTopic?: string): ResearchQuery[] {
  const subject = market.eventType === "categorical" && market.label !== market.eventTitle ? `${market.eventTitle} ${market.label}` : market.eventTitle;
  const clean = subject.replace(/\?/g, "").replace(/\s+/g, " ").trim();
  const plan: ResearchQuery[] = [
    { query: `${clean} latest news`, freshness: "last_week", purpose: "context" },
    { query: `${market.label.replace(/\?/g, "")} unlikely OR risks OR doubts OR against`, freshness: "last_month", purpose: "contrary" },
  ];
  if (extraTopic) plan.push({ query: `${extraTopic} ${clean}`, freshness: "last_month", purpose: "user" });
  return plan;
}

/** Narrow, recent-only plan used by position monitoring. */
export function monitorPlan(market: MarketContract): ResearchQuery[] {
  return [{ query: `${market.label.replace(/\?/g, "")} news`, freshness: "last_24_hours", purpose: "update" }];
}
