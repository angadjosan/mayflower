import { optionalEnv } from "@mayflower/shared";
import { ContextDevProvider } from "./contextdev";
import { MockResearchProvider } from "./mock";
import type { ResearchProvider } from "./provider";

/** Context.dev when a key is configured, otherwise the mock (and say so). */
export function createResearchProvider(): ResearchProvider {
  const key = optionalEnv("CONTEXT_DEV_API_KEY");
  if (key) return new ContextDevProvider({ apiKey: key });
  console.warn("[mayflower/context] CONTEXT_DEV_API_KEY not set — using MOCK research provider");
  return new MockResearchProvider();
}
