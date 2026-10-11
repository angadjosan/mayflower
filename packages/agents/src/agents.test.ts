import { describe, expect, it } from "vitest";
import { demoContracts } from "@mayflower/gemini-markets";
import { heuristicProfile } from "./profile";
import { heuristicIntent } from "./intent";
import { rankGeneral, rankPersonalized, validateContract } from "./discovery";
import { heuristicCritic, heuristicForecast, applyCriticGuards } from "./forecast";
import { toGeminiJsonSchema } from "./llm";
import { z } from "zod";

describe("heuristicProfile", () => {
  it("extracts interests, beliefs and budget from the spec's onboarding message", () => {
    const p = heuristicProfile(
      "I follow the Seahawks closely, think AI infrastructure spending will keep growing, and I'm worried about a recession. I have $200 I can afford to risk.",
    );
    expect(p.riskBudget).toBe(200);
    expect(p.interests).toEqual(expect.arrayContaining(["Seahawks"]));
    expect(p.interests.some((i) => /AI/.test(i))).toBe(true);
    const ai = p.beliefs.find((b) => /AI/i.test(b.topic));
    expect(ai?.stance).toBe("bullish");
    const rec = p.beliefs.find((b) => /econom|recession/i.test(b.topic));
    expect(rec?.stance).toBe("bearish");
  });

  it("extracts limits, style and exclusions", () => {
    const p = heuristicProfile("Keep it conservative: max $10 per position and $60 total exposure. Stop looking for political markets.");
    expect(p.riskStyle).toBe("conservative");
    expect(p.maxPerPosition).toBe(10);
    expect(p.maxTotalExposure).toBe(60);
    expect(p.excludedTopics).toContain("political");
  });

  it("detects lowered confidence", () => {
    expect(heuristicProfile("I'm less confident about that now").lowerConfidenceTopics).toEqual(["LAST"]);
  });
});

describe("heuristicIntent", () => {
  const ctx = { onboardingComplete: true };
  it.each([
    ["Why only $8?", "ask_why"],
    ["Approve the $8 trade", "approve"],
    ["What changed overnight?", "what_changed"],
    ["What are my riskiest positions?", "riskiest"],
    ["Find opportunities outside sports.", "find_opportunities"],
    ["Why are you recommending a hedge?", "hedge_question"],
    ["Sell half", "change_position"],
    ["pause trading", "pause"],
    ["send me the dashboard link", "dashboard_link"],
    ["How's my portfolio doing?", "portfolio"],
  ])("%s -> %s", (text, intent) => {
    expect(heuristicIntent(text, ctx).intent).toBe(intent);
  });

  it("extracts exclusions and fractions", () => {
    expect(heuristicIntent("Find opportunities outside sports.", ctx).excludeTopics).toEqual(["sports"]);
    expect(heuristicIntent("Sell half", ctx).fraction).toBe(0.5);
  });

  it("routes profile info to onboarding before onboarding is complete", () => {
    expect(heuristicIntent("I have $200 to risk and love the NBA", { onboardingComplete: false }).intent).toBe("onboarding");
  });
});

describe("discovery", () => {
  const markets = demoContracts("sandbox");
  const profile = { interests: ["Seahawks", "AI & tech"], beliefs: [], excludedTopics: [] as string[] };

  it("finds personalized markets matching interests, one per event", () => {
    const c = rankPersonalized(markets, profile, []);
    expect(c.length).toBeGreaterThan(0);
    expect(c.some((x) => /Seahawks/.test(x.market.eventTitle))).toBe(true);
    expect(new Set(c.map((x) => x.market.eventTicker)).size).toBe(c.length);
  });

  it("general discovery honours exclusions and looks beyond interests", () => {
    const c = rankGeneral(markets, profile, new Set(), ["sports"]);
    expect(c.every((x) => x.market.category !== "Sports")).toBe(true);
  });

  it("validates contracts", () => {
    expect(validateContract(markets[0]).ok).toBe(true);
    expect(validateContract({ ...markets[0], status: "settled" }).ok).toBe(false);
  });
});

describe("forecast heuristics and critic guards", () => {
  const m = demoContracts("sandbox").find((x) => x.symbol === "DEMO-NFLSEASF-SEA")!;
  it("rejects when there is no evidence", () => {
    const f = heuristicForecast(m, []);
    const r = heuristicCritic(m, f, []);
    expect(r.verdict).toBe("reject");
  });

  it("pulls extreme disagreements back toward the market", () => {
    const f = { ...heuristicForecast(m, []), probability: 0.95, evidenceAgainst: [{ claim: "x", citationIds: [], weight: "weak" as const }] };
    const cite = { id: "a", title: "t", url: "https://e.com", snippet: "s", query: "q", relevance: null, retrievedAt: "", publishedAt: null, provider: "context.dev" as const };
    const r = applyCriticGuards(m, f, [cite, { ...cite, id: "b" }], { verdict: "ok", issues: [], adjustedProbability: 0.95, adjustedUncertainty: "low", notes: "", method: "llm" });
    expect(r.adjustedProbability).toBeLessThan(0.75);
    expect(r.verdict).toBe("downgrade");
  });
});

describe("llm schema conversion", () => {
  it("produces a JSON schema without $schema", () => {
    const js = toGeminiJsonSchema(z.object({ a: z.number(), b: z.string().nullable() }));
    expect(js.$schema).toBeUndefined();
    expect(js.type).toBe("object");
  });
});
