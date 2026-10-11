/**
 * Dependency wiring. One place decides real vs. mock for every integration,
 * based on environment, and labels the result honestly.
 */
import { optionalEnv } from "@mayflower/shared";
import { createResearchProvider, type ResearchProvider } from "@mayflower/context";
import { createExchangeClient, type ExchangeClient } from "@mayflower/gemini-markets";
import type { GeminiAuth } from "@mayflower/gemini-markets";
import { GoogleLLM, MockLLM, type LLM } from "@mayflower/agents";
import { MemoryRepo, type Repo } from "@mayflower/db";
import { BlueBubblesChannel, InMemoryChannel, type OutboundChannel } from "@mayflower/messaging";

export interface Container {
  repo: Repo;
  llm: LLM;
  research: ResearchProvider;
  /** Exchange client for a given user's credentials (null → shared/sim). */
  exchangeFor: (auth?: GeminiAuth | null) => ExchangeClient;
  imessage: OutboundChannel | null;
  webChannel: InMemoryChannel;
  /** Honest status of each integration for the dashboard footer. */
  status: Record<string, { mode: string; detail: string }>;
}

// Stored on globalThis so Next.js dev (one module graph per route) and HMR share one in-memory state.
const g = globalThis as unknown as { __mayflowerContainer?: Container | null };

export function getContainer(overrides: Partial<Container> = {}): Container {
  if (g.__mayflowerContainer && !Object.keys(overrides).length) return g.__mayflowerContainer;
  const googleKey = optionalEnv("GOOGLE_API_KEY") ?? optionalEnv("GEMINI_API_KEY");
  const llm: LLM = overrides.llm ?? (googleKey ? new GoogleLLM({ apiKey: googleKey }) : new MockLLM());
  const research = overrides.research ?? createResearchProvider();
  const bbUrl = optionalEnv("BLUEBUBBLES_URL"), bbPw = optionalEnv("BLUEBUBBLES_PASSWORD");
  const imessage = overrides.imessage !== undefined ? overrides.imessage : bbUrl && bbPw ? new BlueBubblesChannel({ baseUrl: bbUrl, password: bbPw }) : null;
  const repo = overrides.repo ?? new MemoryRepo();
  const exchangeFor = overrides.exchangeFor ?? ((auth?: GeminiAuth | null) => createExchangeClient(auth));
  const sample = exchangeFor(null);
  const c: Container = {
    repo, llm, research, exchangeFor, imessage,
    webChannel: overrides.webChannel ?? new InMemoryChannel(),
    status: {
      llm: { mode: llm.name === "mock" ? "mock" : "live", detail: llm.name },
      research: { mode: research.name === "mock" ? "mock" : "live", detail: research.name },
      exchange: { mode: sample.mode, detail: sample.label },
      imessage: { mode: imessage ? "live" : "not configured", detail: imessage ? "BlueBubbles" : "web chat fallback only" },
      database: { mode: repo instanceof MemoryRepo ? "in-memory" : "supabase", detail: repo instanceof MemoryRepo ? "resets on restart" : "persistent" },
    },
  };
  if (!Object.keys(overrides).length) g.__mayflowerContainer = c;
  return c;
}

export function resetContainer() { g.__mayflowerContainer = null; }
