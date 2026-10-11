// Execution: the ONLY path from an approved proposal to the exchange.
import crypto from "crypto";
import { tx, load, id, now, audit, type DB } from "./db";
import type { Order, Position, TradeProposal } from "./types";
import { placeOrder, getOrderStatus } from "./exchange";
import { sendToUser } from "./notify";
import { exitLevels } from "./risk";

const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

type TrackedOrder = Order & { appliedQuantity?: number };

export function approvalUrl(p: TradeProposal): string {
  return `${APP_URL}/approve/${p.id}?t=${p.approvalToken}`;
}

function tokenOk(expected: string, given?: string): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Current at-risk dollars: open positions' cost basis + unfilled buy orders still working. */
function atRiskUsd(db: DB, userId: string): number {
  const pos = db.positions
    .filter((p) => p.userId === userId && p.status === "open")
    .reduce((s, p) => s + p.costBasisUsd, 0);
  const working = db.orders
    .filter((o) => o.userId === userId && o.action === "buy" && ["submitted", "open", "partially_filled"].includes(o.status))
    .reduce((s, o) => s + (o.quantity - o.filledQuantity) * o.limitPrice, 0);
  return pos + working;
}

/** Apply `qty` newly-filled contracts at `price` to positions. Mutates db. */
function applyFill(db: DB, order: TrackedOrder, qty: number, price: number) {
  if (qty <= 0) return;
  const proposal = db.proposals.find((p) => p.id === order.proposalId);
  const t = now();
  order.appliedQuantity = (order.appliedQuantity ?? 0) + qty;
  if (order.action === "buy") {
    let pos = db.positions.find(
      (p) => p.userId === order.userId && p.marketId === order.marketId && p.side === order.side && p.status === "open",
    );
    if (pos) {
      const newQty = pos.quantity + qty;
      pos.avgEntryPrice = (pos.avgEntryPrice * pos.quantity + price * qty) / newQty;
      pos.quantity = newQty;
      pos.costBasisUsd += price * qty;
      pos.updatedAt = t;
      if (pos.stopPrice != null) {
        // Re-anchor the exit watch to the new average entry.
        const lv = exitLevels(pos.avgEntryPrice);
        pos.stopPrice = lv.stopPrice;
        pos.takeProfitPrice = lv.takeProfitPrice;
        pos.watchConditions = lv.watchConditions;
      }
    } else {
      const isHedge = proposal?.kind === "hedge";
      const hedged = isHedge ? db.positions.find((x) => x.id === proposal?.hedgeForPositionId) : undefined;
      // Hedges get no stop/take-profit alerts: a hedge losing value usually means the main position is winning.
      const lv = isHedge ? undefined : exitLevels(price);
      pos = {
        id: id("pos_"),
        userId: order.userId,
        marketId: order.marketId,
        market: proposal?.market ?? db.markets.find((m) => m.id === order.marketId)!,
        side: order.side,
        quantity: qty,
        avgEntryPrice: price,
        currentPrice: price,
        costBasisUsd: price * qty,
        realizedPnlUsd: 0,
        status: "open",
        proposalId: order.proposalId,
        latestAssessment: isHedge
          ? `Hedge for position ${proposal?.hedgeForPositionId}${hedged ? ` (${hedged.side} on "${hedged.market.title}")` : ""}. ${proposal?.thesis ?? ""}`.trim()
          : proposal?.thesis,
        watchConditions: isHedge
          ? `Partial hedge, not guaranteed. Review it together with the position it protects (${proposal?.hedgeForPositionId}); if you close that position, consider closing this too.`
          : lv!.watchConditions,
        stopPrice: lv?.stopPrice,
        takeProfitPrice: lv?.takeProfitPrice,
        openedAt: t,
        updatedAt: t,
      } satisfies Position;
      db.positions.push(pos);
    }
  } else {
    const pos = db.positions.find(
      (p) => p.userId === order.userId && p.marketId === order.marketId && p.side === order.side && p.status === "open",
    );
    if (!pos) return;
    const q = Math.min(qty, pos.quantity);
    pos.realizedPnlUsd += (price - pos.avgEntryPrice) * q;
    pos.costBasisUsd = Math.max(0, pos.costBasisUsd - pos.avgEntryPrice * q);
    pos.quantity -= q;
    pos.currentPrice = price;
    pos.updatedAt = t;
    if (pos.quantity <= 0) {
      pos.quantity = 0;
      pos.costBasisUsd = 0;
      pos.status = "closed";
    }
  }
}

function describeOrder(o: Order): string {
  const label = o.mode === "simulated" ? "simulated" : "Gemini sandbox – shared account";
  const what = `${o.action === "buy" ? "Buy" : "Sell"} ${o.quantity} ${o.side} @ ${usd(o.limitPrice)} limit`;
  switch (o.status) {
    case "filled":
      return `${what}: filled at ${usd(o.avgFillPrice ?? o.limitPrice)} (${label}).`;
    case "partially_filled":
      return `${what}: partially filled, ${o.filledQuantity}/${o.quantity} at ${usd(o.avgFillPrice ?? o.limitPrice)} (${label}). The rest is still working.`;
    case "open":
    case "submitted":
      return `${what}: submitted, status: ${o.status} — not filled yet (${label}). I'll tell you when it fills.`;
    default:
      return `${what}: ${o.status}${o.error ? ` — ${o.error}` : ""} (${label}). No position was opened.`;
  }
}

export async function approveAndExecute(
  proposalId: string,
  token: string,
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  // Validate + claim the proposal atomically (status -> approved) so double-taps can't double-execute.
  const pre = tx((db) => {
    const p = db.proposals.find((x) => x.id === proposalId);
    if (!p) return { error: "Proposal not found." };
    if (!tokenOk(p.approvalToken, token)) return { error: "Invalid approval link." };
    if (p.status !== "pending") return { error: `Proposal is already ${p.status}.` };
    if (new Date(p.expiresAt).getTime() < Date.now()) {
      p.status = "expired";
      return { error: "This proposal has expired — prices may have moved. Ask me for a fresh one." };
    }
    const user = db.users.find((u) => u.id === p.userId);
    if (!user) return { error: "User not found." };
    if (user.paused) return { error: "Trading is paused. Unpause in settings to approve orders." };
    if (db.orders.some((o) => o.proposalId === p.id)) return { error: "An order already exists for this proposal." };
    if (p.kind === "open" || p.kind === "hedge") {
      if (p.kind === "hedge" && !db.positions.some((x) => x.id === p.hedgeForPositionId && x.status === "open"))
        return { error: "The position this hedge protects is no longer open." };
      if (p.costUsd > user.limits.maxPerTradeUsd + 1e-9)
        return { error: `Order cost ${usd(p.costUsd)} exceeds your per-trade limit ${usd(user.limits.maxPerTradeUsd)}.` };
      const risk = atRiskUsd(db, user.id);
      if (risk + p.costUsd > user.limits.maxTotalExposureUsd + 1e-9)
        return { error: `This would take your at-risk total to ${usd(risk + p.costUsd)}, above your ${usd(user.limits.maxTotalExposureUsd)} limit.` };
    } else {
      const pos = db.positions.find((x) => x.userId === p.userId && x.marketId === p.marketId && x.side === p.side && x.status === "open");
      if (!pos || pos.quantity <= 0) return { error: "No open position to close/reduce." };
    }
    p.status = "approved";
    const firstLink = !user.geminiLinked;
    user.geminiLinked = true;
    return { proposal: { ...p }, firstLink };
  });
  if ("error" in pre) {
    audit({ userId: undefined, actor: "user", action: "approve_rejected", ref: proposalId, detail: { error: pre.error } });
    return { ok: false, error: pre.error };
  }
  const p = pre.proposal as TradeProposal;
  audit({ userId: p.userId, actor: "user", action: "approve", ref: p.id, detail: { side: p.side, quantity: p.quantity, limitPrice: p.limitPrice } });
  if (pre.firstLink) audit({ userId: p.userId, actor: "system", action: "gemini_linked", detail: { account: "Sandbox – shared account" } });

  // "hedge" is a buy of the hedge market (its own position, linked via hedgeForPositionId).
  const action: Order["action"] = p.kind === "open" || p.kind === "hedge" ? "buy" : "sell";
  let result: Awaited<ReturnType<typeof placeOrder>>;
  try {
    result = await placeOrder({
      marketId: p.marketId, side: p.side, action, quantity: p.quantity, limitPrice: p.limitPrice, clientOrderId: p.id,
    });
  } catch (e) {
    result = { status: "error", filledQuantity: 0, mode: "simulated", error: e instanceof Error ? e.message : String(e) };
  }

  const order = tx((db) => {
    const t = now();
    const o: TrackedOrder = {
      id: id("ord_"), userId: p.userId, proposalId: p.id, exchangeOrderId: result.exchangeOrderId,
      marketId: p.marketId, side: p.side, action, quantity: p.quantity, limitPrice: p.limitPrice,
      status: result.status, filledQuantity: result.filledQuantity ?? 0, avgFillPrice: result.avgFillPrice,
      error: result.error, mode: result.mode, createdAt: t, updatedAt: t, appliedQuantity: 0,
    };
    db.orders.push(o);
    applyFill(db, o, o.filledQuantity, o.avgFillPrice ?? o.limitPrice);
    const prop = db.proposals.find((x) => x.id === p.id);
    if (prop) prop.status = ["rejected", "error", "cancelled"].includes(o.status) ? "failed" : "executed";
    return o;
  });
  audit({ userId: p.userId, actor: "system", action: "order_placed", ref: order.id, detail: { status: order.status, mode: order.mode, error: order.error } });

  await sendToUser(p.userId, `${p.market.title}\n${describeOrder(order)}`);
  const ok = !["rejected", "error", "cancelled"].includes(order.status);
  return { ok, order, error: ok ? undefined : order.error ?? `Order ${order.status}` };
}

export async function rejectProposal(proposalId: string, token?: string): Promise<{ ok: boolean; error?: string }> {
  const res = tx((db) => {
    const p = db.proposals.find((x) => x.id === proposalId);
    if (!p) return { error: "Proposal not found." };
    if (token !== undefined && !tokenOk(p.approvalToken, token)) return { error: "Invalid link." };
    if (p.status !== "pending") return { error: `Proposal is already ${p.status}.` };
    p.status = "rejected";
    return { userId: p.userId };
  });
  if ("error" in res) return { ok: false, error: res.error };
  audit({ userId: res.userId, actor: "user", action: "reject", ref: proposalId });
  return { ok: true };
}

/** Poll the exchange for working orders and apply any new fills to positions. */
export async function reconcileOrders(userId?: string): Promise<Order[]> {
  const working = load().orders.filter(
    (o) => (!userId || o.userId === userId) && o.exchangeOrderId && ["submitted", "open", "partially_filled"].includes(o.status),
  );
  const changed: Order[] = [];
  for (const o of working) {
    let st: Awaited<ReturnType<typeof getOrderStatus>>;
    try { st = await getOrderStatus(o.exchangeOrderId!); } catch { continue; }
    if (!st) continue;
    const updated = tx((db) => {
      const cur = db.orders.find((x) => x.id === o.id) as TrackedOrder | undefined;
      if (!cur) return undefined;
      const applied = cur.appliedQuantity ?? 0;
      const statusChanged = cur.status !== st.status || cur.filledQuantity !== st.filledQuantity;
      cur.status = st.status;
      cur.filledQuantity = st.filledQuantity;
      if (st.avgFillPrice !== undefined) cur.avgFillPrice = st.avgFillPrice;
      cur.updatedAt = now();
      const delta = st.filledQuantity - applied;
      if (delta > 0) applyFill(db, cur, delta, cur.avgFillPrice ?? cur.limitPrice);
      return statusChanged ? { ...cur } : undefined;
    });
    if (updated) {
      changed.push(updated);
      audit({ userId: updated.userId, actor: "system", action: "order_update", ref: updated.id, detail: { status: updated.status, filled: updated.filledQuantity } });
      if (["filled", "partially_filled", "cancelled", "rejected"].includes(updated.status)) {
        await sendToUser(updated.userId, `Order update — ${describeOrder(updated)}`);
      }
    }
  }
  return changed;
}
