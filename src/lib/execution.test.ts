// proposeClose / cancelOrder against a scratch file store. The exchange is mocked: no network, no real orders.
import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Market, Order, Position, TradeProposal, User } from "./types";

const market: Market = {
  id: "MOCK-FEDDEC26-CUT", eventTitle: "Fed cut in December?", title: "Fed cut in December?", status: "open",
  yesBid: 0.6, yesAsk: 0.62, noBid: 0.38, noAsk: 0.4, source: "mock",
};

const ex = vi.hoisted(() => ({ cancelExchangeOrder: vi.fn(), placeOrder: vi.fn(), market: { current: undefined as unknown } }));
vi.mock("./exchange", async (orig) => ({
  ...(await orig<typeof import("./exchange")>()),
  getMarket: vi.fn(async () => ex.market.current),
  placeOrder: ex.placeOrder,
  cancelExchangeOrder: ex.cancelExchangeOrder,
  getOrderStatus: vi.fn(async () => undefined),
}));
vi.mock("./notify", () => ({ sendToUser: vi.fn(async () => {}) }));
vi.mock("./receipts", () => ({ onApproved: vi.fn(async () => {}) }));

let X: typeof import("./execution");
let D: typeof import("./db");
const U = "user_t";

beforeAll(async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "mf-exec-")));
  D = await import("./db");
  D.__setClientForTests(null);
  X = await import("./execution");
});

const t = new Date().toISOString();
const pos = (o: Partial<Position> = {}): Position => ({
  id: "pos_1", userId: U, marketId: market.id, market, side: "YES", quantity: 10, avgEntryPrice: 0.5,
  costBasisUsd: 5, realizedPnlUsd: 0, status: "open", proposalId: "prop_0", openedAt: t, updatedAt: t, ...o,
});
const order = (o: Partial<Order> = {}): Order => ({
  id: "ord_1", userId: U, proposalId: "prop_x", exchangeOrderId: "sim-prop_x", marketId: market.id, side: "YES", action: "buy",
  quantity: 8, limitPrice: 0.55, status: "open", filledQuantity: 0, mode: "simulated", venue: "gemini", createdAt: t, updatedAt: t, ...o,
});

beforeEach(async () => {
  ex.market.current = market;
  ex.cancelExchangeOrder.mockReset();
  ex.placeOrder.mockReset();
  await D.tx((db) => {
    for (const k of ["users", "positions", "orders", "proposals", "audit"] as const) (db[k] as unknown[]).length = 0;
    db.users.push({ id: U, createdAt: t, onboarded: true, paused: false, geminiLinked: false, limits: { ...D.DEFAULT_LIMITS } } as User);
    db.positions.push(pos());
  });
});

describe("proposeClose", () => {
  it("closes the whole position at the side's bid with honest proceeds", async () => {
    const r = await X.proposeClose(U, "pos_1");
    if (!r.ok) throw new Error(r.error);
    expect(r.proposal).toMatchObject({ kind: "close", quantity: 10, limitPrice: 0.6, costUsd: 6, side: "YES", status: "pending" });
    expect(r.approvalUrl).toContain(`/approve/${r.proposal.id}?t=`);
    expect(r.proposal.riskNotes).toMatch(/may fill partially or not at all/);
  });

  it("reduces by a fraction, rounding to at least 1 contract", async () => {
    const half = await X.proposeClose(U, "pos_1", 0.5);
    expect(half.ok && half.proposal).toMatchObject({ kind: "reduce", quantity: 5 });
    const tiny = await X.proposeClose(U, "pos_1", 0.01);
    expect(tiny.ok && tiny.proposal.quantity).toBe(1);
  });

  it("reuses a matching pending exit and replaces a different one", async () => {
    const a = await X.proposeClose(U, "pos_1", 0.5);
    const b = await X.proposeClose(U, "pos_1", 0.5);
    expect(a.ok && b.ok && b.reused && b.proposal.id === a.proposal.id).toBe(true);
    const c = await X.proposeClose(U, "pos_1", 1);
    expect(c.ok && !c.reused && c.proposal.id !== (a.ok && a.proposal.id)).toBe(true);
    const db = await D.load();
    expect(db.proposals.filter((p) => p.status === "pending")).toHaveLength(1);
  });

  it("refuses other users' positions, bad fractions and missing bids", async () => {
    expect((await X.proposeClose("someone_else", "pos_1")).ok).toBe(false);
    expect((await X.proposeClose(U, "pos_1", 0)).ok).toBe(false);
    ex.market.current = { ...market, yesBid: undefined, noAsk: undefined };
    expect((await X.proposeClose(U, "pos_1")).ok).toBe(false);
  });

  it("doesn't double-sell contracts already in a working sell order", async () => {
    await D.tx((db) => { db.orders.push(order({ action: "sell", quantity: 10 })); });
    const r = await X.proposeClose(U, "pos_1");
    expect(r.ok).toBe(false);
  });

  it("executes through approveAndExecute and books realized P&L", async () => {
    ex.placeOrder.mockImplementation(async (o: { quantity: number; clientOrderId: string }) => ({
      exchangeOrderId: `sim-${o.clientOrderId}`, status: "filled", filledQuantity: o.quantity, avgFillPrice: 0.6, mode: "simulated", venue: "gemini",
    }));
    const r = await X.proposeClose(U, "pos_1", 0.5);
    if (!r.ok) throw new Error(r.error);
    const res = await X.approveAndExecute(r.proposal.id, r.proposal.approvalToken);
    expect(res.ok).toBe(true);
    expect(ex.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ action: "sell", quantity: 5, limitPrice: 0.6 }));
    const p = (await D.load()).positions[0];
    expect(p.quantity).toBe(5);
    expect(p.realizedPnlUsd).toBeCloseTo(0.5);
    expect((await D.load()).proposals.find((x: TradeProposal) => x.id === r.proposal.id)?.status).toBe("executed");
  });
});

describe("cancelOrder", () => {
  it("cancels an unfilled simulated order locally, without touching the exchange", async () => {
    await D.tx((db) => { db.orders.push(order()); });
    const r = await X.cancelOrder(U, "ord_1");
    expect(r).toMatchObject({ ok: true, order: { status: "cancelled", filledQuantity: 0 } });
    expect(ex.cancelExchangeOrder).not.toHaveBeenCalled();
    expect((await D.load()).audit.some((a) => a.action === "order.cancel" && a.ref === "ord_1")).toBe(true);
  });

  it("keeps the filled part of a partially filled order", async () => {
    await D.tx((db) => { db.orders.push({ ...order({ status: "partially_filled", filledQuantity: 3, avgFillPrice: 0.55 }), appliedQuantity: 3 } as Order); });
    const r = await X.cancelOrder(U, "ord_1");
    expect(r.order).toMatchObject({ status: "cancelled", filledQuantity: 3 });
    expect((await D.load()).positions[0].quantity).toBe(10); // no double-applied fill
  });

  it("rejects other users' and already-final orders", async () => {
    await D.tx((db) => { db.orders.push(order(), order({ id: "ord_2", status: "filled", filledQuantity: 8 })); });
    expect((await X.cancelOrder("someone_else", "ord_1")).ok).toBe(false);
    expect((await X.cancelOrder(U, "ord_2")).error).toMatch(/already filled/);
  });

  it("cancels real (sandbox) orders on the venue and reports failures", async () => {
    await D.tx((db) => { db.orders.push(order({ exchangeOrderId: "123456789012345678", mode: "sandbox" })); });
    ex.cancelExchangeOrder.mockResolvedValueOnce({ ok: false, error: "Gemini 422" });
    expect(await X.cancelOrder(U, "ord_1")).toMatchObject({ ok: false, error: "Gemini 422" });
    ex.cancelExchangeOrder.mockResolvedValueOnce({ ok: true });
    expect(await X.cancelOrder(U, "ord_1")).toMatchObject({ ok: true, order: { status: "cancelled" } });
    expect(ex.cancelExchangeOrder).toHaveBeenLastCalledWith(expect.objectContaining({ exchangeOrderId: "123456789012345678", venue: "gemini", userId: U }));
  });
});
