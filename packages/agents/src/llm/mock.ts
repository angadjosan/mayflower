/**
 * Scripted / heuristic LLM for tests and zero-config demos.
 *  - `on(schema, fn)` registers a canned answer for a schema (tests).
 *  - Without a canned answer it falls back to simple heuristics so the whole
 *    loop (onboard → discover → size → approve → monitor) runs with no API key.
 * Output is deterministic and clearly NOT a real forecast; the container
 * reports llm.mode = "mock" so the UI can say so.
 */
import type { ZodType } from "zod";
import { ClassifiedIntent, CriticOutput, DiscoveryRanking, ExtractedProfile, ForecastOutput } from "@mayflower/shared";
import type { LLM, StructuredRequest } from "./llm";

export class MockLLM implements LLM {
  readonly name = "mock";
  private canned = new Map<ZodType<unknown>, (prompt: string) => unknown>();
  on<T>(schema: ZodType<T>, fn: (prompt: string) => T) { this.canned.set(schema as ZodType<unknown>, fn as (p: string) => unknown); return this; }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const fn = this.canned.get(req.schema as ZodType<unknown>) ?? heuristic(req.schema as ZodType<unknown>);
    if (!fn) throw new Error(`MockLLM: no canned response for schema in prompt: ${req.prompt.slice(0, 60)}`);
    return req.schema.parse(fn(req.prompt));
  }
  async text(_system: string, prompt: string) {
    const facts = prompt.split("FACTS YOU MAY USE (do not invent others):")[1]?.split("USER SAID:")[0]?.trim();
    return facts ? `[mock LLM — set GOOGLE_API_KEY for real replies]\n${facts}` : `[mock reply to: ${prompt.slice(0, 80)}]`;
  }
}

function heuristic(schema: ZodType<unknown>): ((prompt: string) => unknown) | null {
  if (schema === DiscoveryRanking) return (prompt) => {
    const j = safeJson(prompt) as { interests?: string[]; beliefs?: Array<{ topic: string }>; markets?: Array<{ id: string; title: string; tags: string[] }> };
    const topics = [...(j.interests ?? []), ...(j.beliefs ?? []).map((b) => b.topic)].map((t) => t.toLowerCase());
    const ranked = (j.markets ?? []).map((m) => {
      const hay = `${m.title} ${m.tags.join(" ")}`.toLowerCase();
      const hit = topics.find((t) => hay.includes(t));
      return { marketId: m.id, relevance: hit ? 0.9 : 0.4, reason: hit ? `Matches your interest in ${hit}` : "General-market candidate", matchedTopic: hit ?? null };
    }).sort((a, b) => b.relevance - a.relevance).slice(0, 4);
    return { ranked };
  };
  if (schema === ForecastOutput) return (prompt) => {
    const implied = Number(/implied ≈ (\d+)%/.exec(prompt)?.[1] ?? 50) / 100;
    const title = /MARKET: (.*)/.exec(prompt)?.[1] ?? "this market";
    const p = Math.min(0.95, Math.max(0.05, implied + 0.09));
    return {
      whatMustHappen: `The contract resolves YES if the stated event occurs: ${title}`, whyNow: "Mock heuristic: demo-only estimate (no real research).",
      thesis: `[MOCK] Demo thesis: the market price of ${(implied * 100).toFixed(0)}% may modestly underweight YES.`,
      evidenceFor: ["[MOCK] Placeholder supporting evidence"], evidenceAgainst: ["[MOCK] Placeholder opposing evidence"], risks: ["Resolution-rule ambiguity", "This is a mock forecast, not research"],
      estimatedProbability: p, uncertainty: 0.12, citationStances: [{ index: 0, stance: "for" }, { index: 1, stance: "against" }], watchConditions: ["Major news on the event", "Price moves >10 points"],
      recommendTrade: true, noTradeReason: null,
    };
  };
  if (schema === CriticOutput) return () => ({ blockers: [], concerns: ["Mock critic: evidence is placeholder"], adjustedProbability: null, adjustedUncertainty: null, resolutionMismatch: false });
  if (schema === ClassifiedIntent) return (prompt) => {
    const msg = (prompt.split("USER MESSAGE:")[1] ?? prompt).trim().toLowerCase();
    const ref = /\b([a-f0-9]{4})\b/i.exec(msg)?.[1] ?? null;
    const amt = /\$\s?(\d+(?:\.\d+)?)/.exec(msg)?.[1];
    const pick = (intent: string, conf = 0.9) => ({ intent, proposalRef: ref, amount: amt ? Number(amt) : null, topic: null, confidence: conf });
    if (/^(approve|yes,? place|place it|go ahead)/.test(msg)) return pick("approve", ref || amt ? 0.95 : 0.7);
    if (/^(skip|reject|no thanks|pass)/.test(msg)) return pick("reject");
    if (/^why|explain|reason/.test(msg)) return pick("ask_why");
    if (/pause|stop trading/.test(msg)) return pick("pause");
    if (/resume|unpause/.test(msg)) return pick("resume");
    if (/what changed|overnight|update on/.test(msg)) return pick("what_changed");
    if (/portfolio|positions|how am i doing|balance/.test(msg)) return pick("portfolio_status");
    if (/sell|close|reduce/.test(msg)) return pick("close_or_reduce");
    if (/find|opportunit|ideas|look for|scan/.test(msg)) return pick("find_opportunities");
    if (/follow|interested|believe|think|budget|risk|\$\d/.test(msg)) return pick("onboard_or_update_profile");
    return pick("unknown", 0.3);
  };
  if (schema === ExtractedProfile) return (prompt) => {
    const msg = (prompt.split("USER MESSAGE:")[1] ?? prompt).trim();
    const lower = msg.toLowerCase();
    const budget = /\$\s?(\d+(?:\.\d+)?)/.exec(msg)?.[1];
    const known = ["seahawks", "nfl", "football", "ai", "crypto", "bitcoin", "fed", "recession", "weather", "politics", "macro", "economics"];
    const interests = known.filter((k) => lower.includes(k)).map((topic) => ({ topic }));
    const beliefs: Array<{ topic: string; belief: string; confidence: number }> = [];
    if (/recession/.test(lower)) beliefs.push({ topic: "recession", belief: "Worried a recession is coming", confidence: 0.6 });
    if (/ai.*(grow|spend|capex|infra)/.test(lower)) beliefs.push({ topic: "ai", belief: "AI infrastructure spending will keep growing", confidence: 0.7 });
    const excluded = /(no|exclude|stop|avoid)\s+(\w+)\s+markets?/.exec(lower)?.[2];
    return { interests, beliefs, totalBudget: budget ? Number(budget) : null, maxPerPosition: null, excludedTopics: excluded ? [excluded] : [], isUpdate: /less|more|stop|change|update|now/.test(lower) };
  };
  // MonitorAssessment is declared in agents/monitor.ts; match by shape name.
  if ((schema as { _def?: { shape?: () => Record<string, unknown> } })._def?.shape?.()?.notable) return () => ({ recommendation: "hold", summary: "[MOCK] No material change detected.", notable: false, updatedProbability: null });
  return null;
}

function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return {}; } }
