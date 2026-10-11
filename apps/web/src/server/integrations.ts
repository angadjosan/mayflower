import { ContextDevResearch, DemoResearch, NoResearch, type ResearchProvider } from "@mayflower/context";
import { DemoMarketData, LiveMarketData, type MarketDataSource } from "@mayflower/gemini-markets";
import { GoogleGeminiLLM, type LLM } from "@mayflower/agents";
import { config } from "./config";

interface Overrides {
  marketData?: MarketDataSource;
  research?: ResearchProvider;
  llm?: LLM | null;
}

const g = globalThis as unknown as {
  __mayflowerOverrides?: Overrides;
  __mayflowerMarketData?: { key: string; source: MarketDataSource };
};

/** Tests can swap integrations for deterministic fakes. */
export function setIntegrationOverrides(o: Overrides | null): void {
  g.__mayflowerOverrides = o ?? undefined;
}

export function marketData(): MarketDataSource {
  const o = g.__mayflowerOverrides?.marketData;
  if (o) return o;
  const c = config();
  const key = `${c.demoMode ? "demo" : "live"}:${c.geminiEnv}`;
  if (g.__mayflowerMarketData?.key !== key) {
    g.__mayflowerMarketData = { key, source: c.demoMode ? new DemoMarketData(c.geminiEnv) : new LiveMarketData(c.geminiEnv) };
  }
  return g.__mayflowerMarketData.source;
}

export function research(): ResearchProvider {
  const o = g.__mayflowerOverrides?.research;
  if (o) return o;
  const c = config();
  if (c.contextDevApiKey) return new ContextDevResearch(c.contextDevApiKey);
  if (c.demoMode) return new DemoResearch();
  return new NoResearch();
}

export function llm(): LLM | null {
  const o = g.__mayflowerOverrides;
  if (o && "llm" in o) return o.llm ?? null;
  const c = config();
  return c.googleApiKey ? new GoogleGeminiLLM(c.googleApiKey, c.googleModel) : null;
}
