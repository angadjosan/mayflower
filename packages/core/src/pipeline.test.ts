import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@mayflower/db";
import { MockLLM } from "@mayflower/agents";
import { CriticOutput, DiscoveryRanking, ForecastOutput, type User } from "@mayflower/shared";
import { MockResearchProvider } from "@mayflower/context";
import { SimulatedExchange } from "@mayflower/gemini-markets";
import { InMemoryChannel } from "@mayflower/messaging";
import { getContainer, resetContainer } from "./container.js";
import { discoverForUser } from "./proposals.js";

describe("discovery → proposal pipeline", () => {
  it("creates a sized proposal for a compelling market and a no-trade for a weak one", async () => {
    resetContainer();
    const llm = new MockLLM()
      .on(DiscoveryRanking, () => ({ ranked: [{ marketId: "SIM-NFL-SEA-NFCW-2026", relevance: 0.9, reason: "Seahawks fan", matchedTopic: "seahawks" }, { marketId: "SIM-BTC-150K-2026", relevance: 0.5, reason: "notable price", matchedTopic: null }] }))
      .on(ForecastOutput, (prompt) => prompt.includes("Seahawks")
        ? { whatMustHappen: "Win the division", whyNow: "Hot start", thesis: "Underpriced", evidenceFor: ["a"], evidenceAgainst: ["b"], risks: ["injury"], estimatedProbability: 0.55, uncertainty: 0.08, citationStances: [{ index: 0, stance: "for" }], watchConditions: ["QB injury"], recommendTrade: true, noTradeReason: null }
        : { whatMustHappen: "BTC > 150k", whyNow: "", thesis: "No edge", evidenceFor: [], evidenceAgainst: [], risks: [], estimatedProbability: 0.31, uncertainty: 0.2, citationStances: [], watchConditions: [], recommendTrade: false, noTradeReason: "Price already fair" })
      .on(CriticOutput, () => ({ blockers: [], concerns: ["small sample"], adjustedProbability: null, adjustedUncertainty: null, resolutionMismatch: false }));
    const c = getContainer({ repo: new MemoryRepo(), llm, research: new MockResearchProvider(), exchangeFor: () => new SimulatedExchange(), imessage: null, webChannel: new InMemoryChannel() });
    const user: User = { id: "u1", riskLimits: { totalBudget: 200, maxPerPosition: 20, maxThemeConcentration: 0.4, kellyFraction: 0.25, minEdge: 0.05, excludedTopics: [], paused: false }, createdAt: new Date().toISOString() };
    await c.repo.upsertUser(user);
    await c.repo.upsertThesis({ id: "t1", userId: "u1", topic: "seahawks", belief: "Follows the Seahawks", confidence: 0.5, isInterest: true, source: "conversation", active: true, updatedAt: new Date().toISOString() });
    const { proposals, noTrades } = await discoverForUser(c, user);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.marketId).toBe("SIM-NFL-SEA-NFCW-2026");
    expect(proposals[0]!.risk.stake).toBeGreaterThan(0);
    expect(proposals[0]!.risk.stake).toBeLessThanOrEqual(20);
    expect(proposals[0]!.status).toBe("pending_approval");
    expect(noTrades).toHaveLength(1);
    expect(noTrades[0]!.noTradeReason).toMatch(/fair/);
    const report = await c.repo.getReport(proposals[0]!.researchReportId!);
    expect(report?.citations.length).toBeGreaterThan(0);
  });
});
