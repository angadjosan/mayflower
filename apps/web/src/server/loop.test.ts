// End-to-end test of the core loop on an in-memory Postgres (PGlite):
// onboarding → discovery → research → forecast → critic → sizing → approval gate
// → (simulated) execution → positions → monitoring → adjustment proposal.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DemoMarketData, resetDemoPrices, shiftDemoPrice } from "@mayflower/gemini-markets";
import { DemoResearch, clearDemoNews, pushDemoNews } from "@mayflower/context";
import type { JsonRequest, LLM, TextRequest } from "@mayflower/agents";
import { createPglite, setDb, schema, type DB } from "./db/client";
import { setIntegrationOverrides } from "./integrations";
import { setVenueOverride } from "./gemini-link";
import { handleInbound } from "./conversation";
import { getOrCreateUserByHandle, getUser } from "./users";
import { approveProposal, pendingProposals, termsHash } from "./proposals";
import { executeApproval } from "./execution";
import { monitorUser } from "./monitor";

process.env.MAYFLOWER_DEMO_MODE = "true";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.APP_URL = "http://localhost:3000";
delete process.env.GEMINI_OAUTH_CLIENT_ID;
delete process.env.GEMINI_API_KEY;
delete process.env.BLUEBUBBLES_URL;

/** Deterministic stand-in for Google Gemini that returns schema-valid structured output. */
class FakeLLM implements LLM {
  readonly model = "fake-llm";
  forecastProbability = 0.62;
  async json<T>(req: JsonRequest<T>): Promise<T> {
    let out: unknown;
    if (req.system.includes("forecasting analyst")) {
      const evidence = JSON.parse(req.prompt).evidence as { id: string }[];
      // The forecaster must not see the market price.
      expect(req.prompt).not.toMatch(/marketImpliedProbability|bestBid|buyYes/);
      out = {
        probability: this.forecastProbability,
        uncertainty: "medium",
        thesis: "Seattle's line is healthy again and the home crowd matters in this rivalry.",
        whatHasToHappen: "The Seahawks must win the game, including overtime.",
        whyNow: "The game is this weekend and injury news just broke in Seattle's favor.",
        evidenceFor: evidence.slice(0, 2).map((e) => ({ claim: "Supportive reporting", citationIds: [e.id, "made-up-id"], weight: "moderate" })),
        evidenceAgainst: evidence.slice(-1).map((e) => ({ claim: "The 49ers are favored by most models", citationIds: [e.id], weight: "strong" })),
        risks: ["Late injuries"],
        resolutionRisks: ["Postponement beyond 48 hours resolves NO"],
        whatWouldChangeMind: ["A key Seattle injury"],
        watchConditions: ["Injury reports"],
      };
    } else if (req.system.includes("critic")) {
      const body = JSON.parse(req.prompt);
      out = { verdict: "ok", issues: [], adjustedProbability: body.forecast.probability, adjustedUncertainty: body.forecast.uncertainty, notes: "Reasonable." };
    } else {
      throw new Error("use heuristic");
    }
    return req.schema.parse(out);
  }
  async text(_req: TextRequest): Promise<string> {
    throw new Error("use heuristic");
  }
}

let db: DB;
const fake = new FakeLLM();

async function reply(userId: string, text: string): Promise<string> {
  const msgs = await handleInbound(userId, text, "imessage");
  return msgs.map((m) => m.text).join("\n---\n");
}

async function countOrders(userId: string): Promise<number> {
  return (await db.select().from(schema.orders).where(eq(schema.orders.userId, userId))).length;
}

beforeAll(async () => {
  db = await createPglite();
  setDb(db);
});

beforeEach(() => {
  resetDemoPrices();
  clearDemoNews();
  setVenueOverride(null);
  setIntegrationOverrides({ marketData: new DemoMarketData("sandbox"), research: new DemoResearch(), llm: fake });
});

describe("Mayflower core loop", () => {
  it("onboards, recommends, enforces approval, executes once, monitors and proposes an adjustment", async () => {
    const user = await getOrCreateUserByHandle("+12065550100");

    // 1. Conversational onboarding
    const r1 = await reply(user.id, "I follow the Seahawks closely, think AI infrastructure spending will keep growing, and I'm worried about a recession. I have $200 I can afford to risk.");
    expect(r1).toMatch(/\$200/);
    expect(r1).toMatch(/Reply “OK”/);
    expect((await getUser(user.id)).onboardingState).toBe("confirm_limits");

    // 2. Confirm limits → personalized + general discovery
    const r2 = await reply(user.id, "OK");
    expect((await getUser(user.id)).onboardingState).toBe("complete");
    expect(r2).toMatch(/DEMO/);
    expect(r2).toMatch(/Idea from your interests/);
    expect(r2).toMatch(/Broader market idea/);
    const pending = await pendingProposals(user.id);
    if (process.env.DEBUG_LOOP) console.log(r2, JSON.stringify((await db.select().from(schema.tradeProposals)).map((p) => ({ s: p.symbol, d: p.decision, st: p.status, why: p.rationale.noTradeReason, sz: (p.sizing as any).steps })), null, 1));
    const seahawks = pending.find((p) => p.discovery === "personalized" && p.symbol.startsWith("DEMO-NFLSEA"));
    expect(seahawks).toBeTruthy();
    expect(seahawks!.maxCost).toBeLessThanOrEqual(20); // default per-position limit = 10% of $200
    expect(seahawks!.rationale.method.forecast).toBe("llm");
    const proposals = await db.select().from(schema.tradeProposals).where(eq(schema.tradeProposals.userId, user.id));
    expect(proposals.some((p) => p.discovery === "general")).toBe(true);

    // 3. Unapproved orders cannot be submitted
    expect(await countOrders(user.id)).toBe(0);
    const fakeApproval = await executeApproval(user.id, "00000000-0000-0000-0000-000000000000");
    expect(fakeApproval.status).toBe("blocked");
    const wrongTerms = await approveProposal({ userId: user.id, proposalId: seahawks!.id, termsHash: "tampered", channel: "web" });
    expect(wrongTerms.ok).toBe(false);
    // A vague "yes" is not an approval.
    await reply(user.id, "sure");
    expect(await countOrders(user.id)).toBe(0);

    // 4. "Why only $X?" is answered from the stored sizing logic
    const why = await reply(user.id, `Why only $${seahawks!.maxCost}?`);
    expect(why).toMatch(/Kelly|limit|risk/i);

    // 5. Approve → exact terms + one-time code → execution
    const challenge = await reply(user.id, `Approve the $${seahawks!.maxCost} trade`);
    expect(challenge).toMatch(/To approve exactly this order/);
    expect(challenge).toMatch(/SIMULATED/);
    const code = /APPROVE ([A-Z2-9]{6})/.exec(challenge)?.[1];
    expect(code).toBeTruthy();
    expect(await countOrders(user.id)).toBe(0);
    const done = await reply(user.id, `APPROVE ${code}`);
    expect(done).toMatch(/SIMULATED order filled/);
    expect(await countOrders(user.id)).toBe(1);

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.userId, user.id));
    expect(order.simulated).toBe(true);
    expect(order.status).toBe("filled");
    const [position] = await db.select().from(schema.positions).where(eq(schema.positions.userId, user.id));
    expect(position.symbol).toBe(seahawks!.symbol);
    expect(position.quantity).toBe(order.quantity);
    expect(position.watchConditions.length).toBeGreaterThan(0);

    // 6. The same approval can never send a second order; the code is single-use.
    const again = await executeApproval(user.id, order.approvalId);
    expect(again.status).toBe("submitted");
    expect(await countOrders(user.id)).toBe(1);
    const reuse = await reply(user.id, `APPROVE ${code}`);
    expect(reuse).toMatch(/doesn't match/);
    expect(await countOrders(user.id)).toBe(1);

    // 7. Portfolio reflects the stored position
    const portfolio = await reply(user.id, "How's my portfolio?");
    expect(portfolio).toMatch(/Seahawks/);

    // 8. New evidence + price drop → monitor proposes a sell, but never executes it
    fake.forecastProbability = 0.2;
    shiftDemoPrice(position.symbol, -0.12);
    pushDemoNews(position.eventTicker, { title: "Seahawks QB ruled out", url: "https://www.seahawks.com/news/", snippet: "Seattle's starting quarterback was ruled out with an injury, a major risk to the team's chances." });
    const mon = await monitorUser(user.id);
    expect(mon.events.length).toBeGreaterThan(0);
    const sell = (await pendingProposals(user.id)).find((p) => p.side === "sell");
    expect(sell).toBeTruthy();
    expect(sell!.relatedPositionId).toBe(position.id);
    expect(await countOrders(user.id)).toBe(1);

    // 9. Pause blocks execution even for an approved sell
    await reply(user.id, "pause trading");
    const approved = await approveProposal({ userId: user.id, proposalId: sell!.id, termsHash: termsHash(sell!), channel: "web" });
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      const res = await executeApproval(user.id, approved.approvalId);
      expect(res.status).toBe("blocked");
    }
    expect(await countOrders(user.id)).toBe(1);

    // Audit trail exists for every step
    const audits = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.userId, user.id));
    const actions = new Set(audits.map((a) => a.action));
    for (const a of ["proposal.created", "approval.challenge_issued", "proposal.approved", "order.submitted", "order.fill", "monitor.event", "trading.paused", "execution.blocked"]) {
      expect(actions).toContain(a);
    }
  });

  it("enforces the user's limits and can recommend no trade", async () => {
    const user = await getOrCreateUserByHandle("+12065550101");
    await reply(user.id, "I follow the Seahawks and I have $10 to risk. Keep it conservative.");
    await reply(user.id, "max $0.50 per position");
    const u = await getUser(user.id);
    expect(u.maxPerPosition).toBe(0.5);
    const proposals = await db.select().from(schema.tradeProposals).where(eq(schema.tradeProposals.userId, user.id));
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.decision === "no_trade" || p.maxCost <= 0.5)).toBe(true);
  });

  it("works without an LLM using labelled heuristics", async () => {
    setIntegrationOverrides({ marketData: new DemoMarketData("sandbox"), research: new DemoResearch(), llm: null });
    const user = await getOrCreateUserByHandle("+12065550102");
    await reply(user.id, "I'm a big Seahawks fan, I think they'll win this weekend. I can risk $200.");
    const r = await reply(user.id, "OK");
    expect(r).toMatch(/Seahawks/);
    const proposals = await db.select().from(schema.tradeProposals).where(eq(schema.tradeProposals.userId, user.id));
    expect(proposals.every((p) => p.rationale.method.forecast === "heuristic")).toBe(true);
  });
});
