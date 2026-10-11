/**
 * Deterministic mock provider for tests and offline development. Clearly
 * labelled so no mock evidence is ever mistaken for real research.
 */
import type { MonitorChange, MonitorSpec, PageContent, ResearchProvider, SearchHit, SearchOptions } from "./provider";

export class MockResearchProvider implements ResearchProvider {
  readonly name = "mock";
  constructor(private hits: SearchHit[] = []) {}
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    if (this.hits.length) return this.hits.slice(0, opts.limit ?? 10);
    return [
      { url: "https://example.com/mock-1", title: `[MOCK] Coverage of: ${query}`, snippet: "Mock evidence supporting the thesis.", relevance: "high", publishedAt: new Date().toISOString() },
      { url: "https://example.com/mock-2", title: `[MOCK] Counterpoint on: ${query}`, snippet: "Mock evidence contradicting the thesis.", relevance: "medium", publishedAt: new Date().toISOString() },
    ];
  }
  async fetch(url: string): Promise<PageContent> {
    return { url, title: "[MOCK] page", markdown: "Mock page content." };
  }
  async monitor(spec: MonitorSpec) {
    return { id: `mock_mon_${spec.name.replace(/\W+/g, "_")}` };
  }
  async changes(): Promise<MonitorChange[]> {
    return [];
  }
}
