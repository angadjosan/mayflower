import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepo } from "@mayflower/db";
import { MockLLM } from "@mayflower/agents";
import { MockResearchProvider } from "@mayflower/context";
import { SimulatedExchange } from "@mayflower/gemini-markets";
import { InMemoryChannel } from "@mayflower/messaging";
import { contentHash, proposalBindingFields, type TradeProposal, type User } from "@mayflower/shared";
import { getContainer, resetContainer, type Container } from "./container";
import { approveAndExecute, executeApproved, recordDecision, ApprovalError } from "./execution";

const user: User = { id: "u1", riskLimits: { totalBudget: 200, maxPerPosition: 20, maxThemeConcentration: 0.4, kellyFraction: 0.25, minEdge: 0.05, excludedTopics: [], paused: false }, createdAt: new Date().toISOString() };

function proposal(over: Partial<TradeProposal> = {}): TradeProposal {
  const base = { id: "p1", version: 1, marketId: "SIM-NFL-SEA-NFCW-2026", side: "YES" as const, action: "BUY" as const, quantity: 19, limitPrice: 0.42, kind: "open" as const };
  const now = new Date().toISOString();
  return { ...base, userId: "u1", researchReportId: null, risk: { stake: 7.98, quantity: 19, limitPrice: 0.42, maxLoss: 7.98, maxGain: 11.02, edge: 0.07, expectedValue: 1, kellyFraction: 0.25, fullKelly: 0.15, budgetUtilisationAfter: 0.04, themeConcentrationAfter: 0.04, constraints: [], explanation: "x" }, discoveryReason: "personalized", summary: "s", status: "pending_approval", expiresAt: new Date(Date.now() + 3600e3).toISOString(), createdAt: now, updatedAt: now, bindingHash: contentHash(proposalBindingFields(base)), ...over };
}

describe("approval gate + execution", () => {
  let c: Container; let sim: SimulatedExchange;
  beforeEach(async () => {
    resetContainer();
    sim = new SimulatedExchange();
    c = getContainer({ repo: new MemoryRepo(), llm: new MockLLM(), research: new MockResearchProvider(), exchangeFor: () => sim, imessage: null, webChannel: new InMemoryChannel() });
    await c.repo.upsertUser(user);
    await c.repo.upsertMarket((await sim.getMarket("SIM-NFL-SEA-NFCW-2026"))!);
    await c.repo.saveProposal(proposal());
  });

  it("executes an approved proposal exactly once and records a position", async () => {
    const { order } = await approveAndExecute(c, { userId: "u1", proposalId: "p1", version: 1, channel: "web" });
    expect(order.status).toBe("filled");
    expect(order.mode).toBe("simulated");
    const positions = await c.repo.listPositions("u1");
    expect(positions).toHaveLength(1);
    expect(positions[0]!.quantity).toBe(19);
    // second approval attempt is rejected as duplicate
    await expect(recordDecision(c, { userId: "u1", proposalId: "p1", version: 1, decision: "approved", channel: "web" })).rejects.toBeInstanceOf(ApprovalError);
    // re-executing the same approval is idempotent
    const approval = (await c.repo.getApprovalForProposal("p1", 1))!;
    const again = await executeApproved(c, approval);
    expect(again.id).toBe(order.id);
    expect(await sim.getPositions()).toHaveLength(1);
  });

  it("refuses stale versions, expired proposals, and rejected decisions", async () => {
    await expect(recordDecision(c, { userId: "u1", proposalId: "p1", version: 2, decision: "approved", channel: "web" })).rejects.toMatchObject({ code: "STALE_VERSION" });
    await c.repo.saveProposal(proposal({ id: "p2", expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await expect(recordDecision(c, { userId: "u1", proposalId: "p2", version: 1, decision: "approved", channel: "web" })).rejects.toMatchObject({ code: "EXPIRED" });
    const { approval } = await recordDecision(c, { userId: "u1", proposalId: "p1", version: 1, decision: "rejected", channel: "imessage" });
    await expect(executeApproved(c, approval)).rejects.toMatchObject({ code: "NOT_APPROVED" });
    expect(await c.repo.listOrders("u1")).toHaveLength(0);
  });

  it("refuses a tampered proposal (hash mismatch)", async () => {
    await c.repo.saveProposal(proposal({ id: "p3", quantity: 999 })); // hash computed from base qty 19 → mismatch
    await expect(recordDecision(c, { userId: "u1", proposalId: "p3", version: 1, decision: "approved", channel: "web" })).rejects.toMatchObject({ code: "HASH_MISMATCH" });
  });
});
