/**
 * Provider-agnostic research interface. Context.dev is the P0 implementation;
 * the interface keeps the agents decoupled so a substitute (Exa, Tavily) or a
 * mock can be swapped in without touching agent code.
 */
export type Freshness = "day" | "week" | "month" | "year";

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
  relevance?: "high" | "medium" | "low";
  /** Query-relevant passages, when requested. */
  passages?: string[];
}

export interface PageContent {
  url: string;
  title?: string;
  markdown: string;
  publishedAt?: string;
  modifiedAt?: string;
  author?: string;
}

export interface MonitorSpec {
  name: string;
  url: string;
  instructions?: string;
  intervalMinutes?: number;
  webhookUrl?: string;
}

export interface MonitorChange {
  id: string;
  monitorId: string;
  url: string;
  title: string;
  summary: string;
  detectedAt: string;
  importance?: "low" | "medium" | "high";
}

export interface SearchOptions {
  limit?: number;
  freshness?: Freshness;
  includeDomains?: string[];
  excludeDomains?: string[];
  withPassages?: boolean;
}

export interface ResearchProvider {
  readonly name: string;
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  fetch(url: string, opts?: { fresh?: boolean }): Promise<PageContent>;
  monitor(spec: MonitorSpec): Promise<{ id: string; webhookSecret?: string }>;
  changes(monitorId: string, since?: string): Promise<MonitorChange[]>;
}
