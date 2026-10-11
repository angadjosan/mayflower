// Settlement against a scratch file store. Market resolution, texts, the LLM and calls are mocked: nothing dials.
import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Market, Order, Position, TradeProposal, User } from "./types";

const m = vi.hoisted(() => ({
  resolveMarket: vi.fn(),
  getMarket: vi.fn(),
  sendToUser: vi.fn(async () => {}),
  generateText: vi.fn(async () => "BRO. WHAT WAS THAT. the 49ers?? the market had it at fifty! 😭"),
  claimCall: vi.fn(async () => true),
  canRing: vi.fn(async () => true),
}));
vi.mock("./notify", () => ({ sendToUser: m.sendToUser }));
vi.mock("./llm", () => ({ generateText: m.generateText }));
vi.mock("./calls", () => ({ claimCall: m.claimCall, canRing: m.canRing, ringUserAbout: vi.fn(async () => false) }));

let S: typeof import("./settlement");
let D: typeof import("./db");
let C: typeof import("./calibration");
const U = "user_s";

beforeAll(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "mf-settle-")));
  D = await import("./db");
  D.__setClientForTests(null);
  S = await import("./settlement");
  C = await import("./calibration");
});

const t = new Date().toISOString();
const past = new Date(Date.now() - 3600e3).toISOString();
const gem: Market = { id: "GEMI-NFL2610110000-SF", eventTitle: "49ers vs Seahawks", title: "49ers win?", status: "open", expiresAt: past, yesBid: 0.5, yesAsk: 0.52, source: "gemini" };
const hl: Market = { id: "HL-testnet-123", eventTitle: "BTC above 100k?", title: "BTC above 100k?", status: "open", source: "hyperliquid", hyperliquid: { network: "testnet", outcome: 123, quoteToken: "USDH" } };
const pos = (o: Partial<Position> = {}): Position => ({
  id: "pos_w", userId: U, marketId: gem.id, market: gem, side: "YES", quantity: 10, avgEntryPrice: 0.5,
  costBasisUsd: 5, realizedPnlUsd: 0, status: "open", proposalId: "prop_0", openedAt: t, updatedAt: t, ...o,
});

async function seed(positions: Position[], user: Partial<User> = {}, extra: (db: Awaited<ReturnType<typeof D.load>>) => void = () => {}) {
  await D.tx((db) => {
    for (const k of ["users", "positions", "orders", "proposals", "audit", "monitorEvents"] as const) (db[k] as unknown[]).length = 0;
    db.users.push({
      id: U, handle: "+14155550100", createdAt: t, onboarded: true, paused: false, geminiLinked: false, limits: { ...D.DEFAULT_LIMITS },
      testWallet: { address: "0xabc", keyEnc: "x", usdc: 1000, createdAt: t }, ...user,
    } as User);
    db.positions.push(...positions);
    extra(db);
  });
}

// 3pm Los Angeles on a fixed day (UTC-7 in October).
const AFTERNOON = Date.parse("2026-10-11T22:00:00Z");

describe("pure math", () => {
  it("pays $1/contract to the winning side and $0 to the loser", () => {
    expect(S.settlementFor({ side: "YES", quantity: 10, costBasisUsd: 5 }, 1)).toEqual({ settledOutcome: "YES", outcome: "won", payoutUsd: 10, pnlUsd: 5 });
    expect(S.settlementFor({ side: "YES", quantity: 10, costBasisUsd: 5 }, 0)).toEqual({ settledOutcome: "NO", outcome: "lost", payoutUsd: 0, pnlUsd: -5 });
    expect(S.settlementFor({ side: "NO", quantity: 4, costBasisUsd: 1.2 }, 0)).toMatchObject({ outcome: "won", payoutUsd: 4, pnlUsd: 2.8 });
  });

  it("quiet hours are 10pm to 8am Los Angeles", () => {
    expect(S.inQuietHours(Date.parse("2026-10-12T05:30:00Z"))).toBe(true); // 10:30pm PDT
    expect(S.inQuietHours(Date.parse("2026-10-12T14:59:00Z"))).toBe(true); // 7:59am PDT
    expect(S.inQuietHours(Date.parse("2026-10-12T15:00:00Z"))).toBe(false); // 8:00am PDT
    expect(S.inQuietHours(Date.parse("2026-10-12T04:59:00Z"))).toBe(false); // 9:59pm PDT
    expect(S.inQuietHours(Date.parse("2026-10-12T04:59:00Z"), "America/New_York")).toBe(true); // 12:59am EDT
    expect(S.inQuietHours(AFTERNOON, "Not/AZone")).toBe(false);
  });

  it("cleans model openers into one speakable line of at most 25 words", () => {
    expect(S.cleanOpener(`"uwu... you WON 🥺 *squeals*"\nextra`)).toBe("uwu... you WON");
    expect(S.cleanOpener(Array(40).fill("word").join(" ")).split(" ")).toHaveLength(25);
  });
});

describe("resolveMarket (outcome inference)", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
  });

  it("uses Hyperliquid's settled value as the result", async () => {
    vi.doMock("./exchange", async (orig) => ({ ...(await orig<typeof import("./exchange")>()), getMarket: m.getMarket }));
    vi.resetModules();
    const Cal = await import("./calibration");
    m.getMarket.mockResolvedValueOnce({ ...hl, status: "settled", lastPrice: 1 });
    expect(await Cal.resolveMarket(hl.id, hl)).toEqual({ outcome: 1, inferred: false, source: "hyperliquid settlement" });
    m.getMarket.mockResolvedValueOnce({ ...hl, status: "settled", lastPrice: 0 });
    expect(await Cal.resolveMarket(hl.id, hl)).toMatchObject({ outcome: 0, inferred: false });
    // Expired Gemini market: pinned final price => inferred; mid-range price => unknown (never guessed).
    m.getMarket.mockResolvedValueOnce(undefined);
    expect(await Cal.resolveMarket(gem.id, { ...gem, yesBid: 0.995, yesAsk: 1 })).toMatchObject({ outcome: 1, inferred: true });
    m.getMarket.mockResolvedValueOnce(undefined);
    expect(await Cal.resolveMarket(gem.id, { ...gem, yesBid: 0.4, yesAsk: 0.45 })).toBeUndefined();
    // Not expired and still open => not resolved.
    m.getMarket.mockResolvedValueOnce({ ...gem, expiresAt: undefined, yesBid: 0.999 });
    expect(await Cal.resolveMarket(gem.id, { ...gem, expiresAt: undefined })).toBeUndefined();
    vi.doUnmock("./exchange");
  });

  it("mock markets never resolve", async () => {
    expect(await C.resolveMarket("MOCK-X", { ...gem, id: "MOCK-X", source: "mock" })).toBeUndefined();
  });
});

describe("settlePositions", () => {
  beforeEach(() => {
    vi.resetModules();
    m.sendToUser.mockClear();
    m.claimCall.mockClear();
    m.generateText.mockClear();
  });

  async function fresh() {
    vi.doMock("./calibration", async (orig) => ({ ...(await orig<typeof import("./calibration")>()), resolveMarket: m.resolveMarket }));
    return import("./settlement");
  }

  it("settles a win and a loss, credits Hyperliquid testUSDC, texts once, calls once for the batch", async () => {
    const Sx = await fresh();
    const prop = { id: "prop_p", userId: U, marketId: gem.id, status: "pending", kind: "close" } as TradeProposal;
    const ord = { id: "ord_s", userId: U, marketId: gem.id, status: "open", mode: "simulated", filledQuantity: 0, exchangeOrderId: "sim-x" } as Order;
    await seed([pos({ id: "pos_l", side: "NO", quantity: 10, costBasisUsd: 5 }), pos({ id: "pos_h", marketId: hl.id, market: hl, side: "YES", quantity: 20, avgEntryPrice: 0.3, costBasisUsd: 6 })], {}, (db) => {
      db.proposals.push(prop);
      db.orders.push(ord);
    });
    m.resolveMarket.mockImplementation(async (id: string) => ({ outcome: 1, inferred: id === gem.id, source: id === gem.id ? "inferred from final exchange price" : "hyperliquid settlement" }));
    const ring = vi.fn(async () => true);

    const r = await Sx.settlePositions({ ring, now: () => AFTERNOON });
    expect(r.settled.map((s) => [s.positionId, s.outcome, s.pnlUsd])).toEqual([["pos_l", "lost", -5], ["pos_h", "won", 14]]);
    const db = await D.load();
    expect(db.positions.find((p) => p.id === "pos_l")).toMatchObject({ status: "closed", quantity: 0, costBasisUsd: 0, realizedPnlUsd: -5, outcome: "lost", settledOutcome: "YES", settlementPayoutUsd: 0 });
    expect(db.positions.find((p) => p.id === "pos_h")).toMatchObject({ status: "closed", realizedPnlUsd: 14, outcome: "won", settlementPayoutUsd: 20 });
    expect((db.users[0] as User & { testWallet: { usdc: number } }).testWallet.usdc).toBe(1020); // only the Hyperliquid payout
    expect(db.proposals[0].status).toBe("expired");
    expect(db.orders[0].status).toBe("cancelled");
    expect(db.monitorEvents.map((e) => e.id).sort()).toEqual(["mon_settle_pos_h", "mon_settle_pos_l"]);
    expect(db.audit.filter((a) => a.action === "position.settled")).toHaveLength(2);

    expect(m.sendToUser).toHaveBeenCalledTimes(1);
    expect(String((m.sendToUser.mock.calls[0] as unknown[])[1])).toMatch(/results are in:[\s\S]*net \+\$9/);
    expect(ring).toHaveBeenCalledTimes(1);
    expect(ring.mock.calls[0]).toEqual([U, expect.objectContaining({ kind: "win", summary: expect.stringContaining("BTC above 100k") })]);
    // Emoji stripped from the spoken line.
    expect((ring.mock.calls[0] as unknown[] as [string, { opener: string }])[1].opener).not.toMatch(/😭/);

    // Idempotent: a second run pays nothing, texts nothing, calls nothing.
    const again = await Sx.settlePositions({ ring, now: () => AFTERNOON });
    expect(again.settled).toHaveLength(0);
    expect(m.sendToUser).toHaveBeenCalledTimes(1);
    expect(ring).toHaveBeenCalledTimes(1);
    expect(((await D.load()).users[0] as User & { testWallet: { usdc: number } }).testWallet.usdc).toBe(1020);
  });

  it("never settles twice, even when two runs race", async () => {
    const Sx = await fresh();
    await seed([pos({ id: "pos_r", marketId: hl.id, market: hl, quantity: 5, costBasisUsd: 2 })]);
    m.resolveMarket.mockResolvedValue({ outcome: 1, inferred: false, source: "hyperliquid settlement" });
    const ring = vi.fn(async () => true);
    const [a, b] = await Promise.all([Sx.settlePositions({ ring, now: () => AFTERNOON }), Sx.settlePositions({ ring, now: () => AFTERNOON })]);
    expect(a.settled.length + b.settled.length).toBe(1);
    expect(((await D.load()).users[0] as User & { testWallet: { usdc: number } }).testWallet.usdc).toBe(1005);
  });

  it("leaves positions open when the outcome is unknown", async () => {
    const Sx = await fresh();
    await seed([pos()]);
    m.resolveMarket.mockResolvedValue(undefined);
    const r = await Sx.settlePositions({ ring: vi.fn() });
    expect(r.settled).toHaveLength(0);
    expect((await D.load()).positions[0].status).toBe("open");
  });

  it("texts but doesn't call in quiet hours or when paused", async () => {
    const Sx = await fresh();
    m.resolveMarket.mockResolvedValue({ outcome: 0, inferred: false, source: "exchange result" });
    const ring = vi.fn(async () => true);

    await seed([pos()]);
    const night = await Sx.settlePositions({ ring, now: () => Date.parse("2026-10-12T06:00:00Z") }); // 11pm PDT
    expect(night.notified[0]).toMatchObject({ texted: true, called: false, kind: "loss", skippedCall: "quiet hours" });

    await seed([pos()], { paused: true });
    const paused = await Sx.settlePositions({ ring, now: () => AFTERNOON });
    expect(paused.notified[0]).toMatchObject({ texted: true, called: false, skippedCall: "paused" });

    expect(ring).not.toHaveBeenCalled();
    expect(m.sendToUser).toHaveBeenCalledTimes(2);
    expect(String((m.sendToUser.mock.calls[0] as unknown[])[1])).toMatch(/settled NO\. your YES at 50¢ didn't make it, -\$5 rip/);
  });

  it("falls back to a fixed opener when the model is unavailable", async () => {
    const Sx = await fresh();
    m.generateText.mockRejectedValueOnce(new Error("LLM_REFUSED"));
    await seed([pos()]);
    m.resolveMarket.mockResolvedValue({ outcome: 1, inferred: false, source: "exchange result" });
    const ring = vi.fn(async () => true);
    const r = await Sx.settlePositions({ ring, now: () => AFTERNOON });
    expect(r.notified[0]).toMatchObject({ called: true, kind: "win", opener: "uwu... you WON. 49ers vs Seahawks came in YES. look at you." });
  });
});
