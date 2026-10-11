// Execution: the ONLY path from an approved proposal to the exchange.
import crypto from "crypto";
import { tx, load, id, now, audit, type DB } from "./db";
import type { Market, Order, Position, TradeProposal } from "./types";
import { placeOrder, getOrderStatus, venueLabel, venueOf, getMarket, cancelExchangeOrder, orderModeFor, hyperliquidMode } from "./exchange";
import { sendToUser } from "./notify";
import { exitLevels } from "./risk";
import { onApproved } from "./receipts";
import { ensureTestWallet, walletOf, adjustTestUsdc } from "./testWallet";

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
const WORKING: Order["status"][] = ["submitted", "open", "partially_filled"];

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
  // Hyperliquid fills settle against the user's test wallet (testUSDC).
  if ((order.venue ?? "gemini") === "hyperliquid") adjustTestUsdc(db, order.userId, (order.action === "buy" ? -1 : 1) * qty * price);
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
  const label = venueLabel(o.mode, o.venue ?? venueOf({ id: o.marketId, source: "gemini" }));
  const what = `${o.action === "buy" ? "Buy" : "Sell"} ${o.quantity} ${o.side} @ ${usd(o.limitPrice)} limit`;
  switch (o.status) {
    case "filled":
      return `${what}: filled at ${usd(o.avgFillPrice ?? o.limitPrice)} (${label}).`;
    case "partially_filled":
      return `${what}: partially filled, ${o.filledQuantity}/${o.quantity} at ${usd(o.avgFillPrice ?? o.limitPrice)} (${label}). The rest is still working.`;
    case "open":
    case "submitted":
      return `${what}: submitted, status: ${o.status} — not filled yet (${label}). I'll tell you when it fills.`;
    case "cancelled":
      if (o.filledQuantity > 0)
        return `${what}: cancelled after ${o.filledQuantity}/${o.quantity} filled at ${usd(o.avgFillPrice ?? o.limitPrice)} (${label}). The filled part stands; the rest was cancelled.`;
      return `${what}: cancelled before anything filled (${label}).`;
    default:
      return `${what}: ${o.status}${o.error ? ` — ${o.error}` : ""} (${label}). No position was opened.`;
  }
}

export async function approveAndExecute(
  proposalId: string,
  token: string,
): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const owner = (await load()).proposals.find((x) => x.id === proposalId)?.userId;
  if (owner) await ensureTestWallet(owner);
  // Validate + claim the proposal atomically (status -> approved) so double-taps can't double-execute.
  const pre = await tx((db) => {
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
      const w = walletOf(db, p.userId);
      if (venueOf(p.market) === "hyperliquid" && w && w.usdc + 1e-9 < p.costUsd)
        return { error: `Not enough testUSDC in your test wallet (${usd(w.usdc)}) for this ${usd(p.costUsd)} order.` };
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
      const selling = db.orders
        .filter((o) => o.userId === p.userId && o.marketId === p.marketId && o.side === p.side && o.action === "sell" && WORKING.includes(o.status))
        .reduce((s, o) => s + o.quantity - o.filledQuantity, 0);
      if (p.quantity > pos.quantity - selling + 1e-9)
        return { error: `You hold ${pos.quantity} contracts${selling ? ` (${selling} already in a working sell order)` : ""}; can't sell ${p.quantity}. Ask for a fresh exit.` };
    }
    p.status = "approved";
    const firstLink = !user.geminiLinked;
    user.geminiLinked = true;
    return { proposal: { ...p }, firstLink };
  });
  if ("error" in pre) {
    await audit({ userId: undefined, actor: "user", action: "approve_rejected", ref: proposalId, detail: { error: pre.error } });
    return { ok: false, error: pre.error };
  }
  const p = pre.proposal as TradeProposal;
  await audit({ userId: p.userId, actor: "user", action: "approve", ref: p.id, detail: { side: p.side, quantity: p.quantity, limitPrice: p.limitPrice } });
  void onApproved(p.id); // YZi: hash of this exact approval committed to BNB testnet (no-op if not configured)
  if (pre.firstLink) await audit({ userId: p.userId, actor: "system", action: "gemini_linked", detail: { account: "Sandbox – shared account" } });

  // "hedge" is a buy of the hedge market (its own position, linked via hedgeForPositionId).
  const action: Order["action"] = p.kind === "open" || p.kind === "hedge" ? "buy" : "sell";
  let result: Awaited<ReturnType<typeof placeOrder>>;
  try {
    result = await placeOrder({
      marketId: p.marketId, side: p.side, action, quantity: p.quantity, limitPrice: p.limitPrice, clientOrderId: p.id, userId: p.userId,
    });
  } catch (e) {
    result = { status: "error", filledQuantity: 0, mode: "simulated", venue: venueOf(p.market), error: e instanceof Error ? e.message : String(e) };
  }

  const order = await tx((db) => {
    const t = now();
    const o: TrackedOrder = {
      id: id("ord_"), userId: p.userId, proposalId: p.id, exchangeOrderId: result.exchangeOrderId,
      marketId: p.marketId, side: p.side, action, quantity: p.quantity, limitPrice: p.limitPrice,
      status: result.status, filledQuantity: result.filledQuantity ?? 0, avgFillPrice: result.avgFillPrice,
      error: result.error, mode: result.mode, venue: result.venue, createdAt: t, updatedAt: t, appliedQuantity: 0,
    };
    db.orders.push(o);
    applyFill(db, o, o.filledQuantity, o.avgFillPrice ?? o.limitPrice);
    const prop = db.proposals.find((x) => x.id === p.id);
    if (prop) prop.status = ["rejected", "error", "cancelled"].includes(o.status) ? "failed" : "executed";
    return o;
  });
  await audit({ userId: p.userId, actor: "system", action: "order_placed", ref: order.id, detail: { status: order.status, mode: order.mode, venue: order.venue, error: order.error } });

  await sendToUser(p.userId, `${p.market.title}\n${describeOrder(order)}`);
  const ok = !["rejected", "error", "cancelled"].includes(order.status);
  return { ok, order, error: ok ? undefined : order.error ?? `Order ${order.status}` };
}

export async function rejectProposal(proposalId: string, token?: string): Promise<{ ok: boolean; error?: string }> {
  const res = await tx((db) => {
    const p = db.proposals.find((x) => x.id === proposalId);
    if (!p) return { error: "Proposal not found." };
    if (token !== undefined && !tokenOk(p.approvalToken, token)) return { error: "Invalid link." };
    if (p.status !== "pending") return { error: `Proposal is already ${p.status}.` };
    p.status = "rejected";
    return { userId: p.userId };
  });
  if ("error" in res) return { ok: false, error: res.error };
  await audit({ userId: res.userId, actor: "user", action: "reject", ref: proposalId });
  return { ok: true };
}

/** Poll the exchange for working orders and apply any new fills to positions. */
export async function reconcileOrders(userId?: string): Promise<Order[]> {
  const working = (await load()).orders.filter(
    (o) => (!userId || o.userId === userId) && o.exchangeOrderId && ["submitted", "open", "partially_filled"].includes(o.status),
  );
  const changed: Order[] = [];
  for (const o of working) {
    let st: Awaited<ReturnType<typeof getOrderStatus>>;
    try { st = await getOrderStatus(o.exchangeOrderId!, o.venue ?? venueOf({ id: o.marketId, source: "gemini" }), o.userId); } catch { continue; }
    if (!st) continue;
    const updated = await tx((db) => {
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
      await audit({ userId: updated.userId, actor: "system", action: "order_update", ref: updated.id, detail: { status: updated.status, filled: updated.filledQuantity } });
      if (["filled", "partially_filled", "cancelled", "rejected"].includes(updated.status)) {
        await sendToUser(updated.userId, `Order update — ${describeOrder(updated)}`);
      }
    }
  }
  return changed;
}

// ---------------------------------------------------------------- exits + cancels

const EXIT_TTL_MS = 30 * 60 * 1000; // exit quotes go stale fast
const isExit = (p: TradeProposal) => p.kind === "close" || p.kind === "reduce";
const bidFor = (m: Market, side: Position["side"]) =>
  side === "YES" ? m.yesBid ?? (m.noAsk != null ? 1 - m.noAsk : undefined) : m.noBid ?? (m.yesAsk != null ? 1 - m.yesAsk : undefined);

export type CloseProposalResult =
  | { ok: true; proposal: TradeProposal; approvalUrl: string; reused: boolean }
  | { ok: false; error: string };

/**
 * Create (or reuse) a pending sell proposal for `fraction` of an open position at the current bid for its side.
 * Never sells anything: the proposal still needs explicit approval (link, or the owner's in-dashboard confirm).
 */
export async function proposeClose(userId: string, positionId: string, fraction = 1): Promise<CloseProposalResult> {
  if (!(fraction > 0 && fraction <= 1)) return { ok: false, error: "fraction must be in (0, 1]" };
  const pre = (await load()).positions.find((p) => p.id === positionId && p.userId === userId);
  if (!pre || pre.status !== "open" || pre.quantity <= 0) return { ok: false, error: "No open position with that id." };
  const market = await getMarket(pre.marketId);
  const bid = market ? bidFor(market, pre.side) : undefined;
  if (!market || !(bid != null && bid > 0 && bid < 1))
    return { ok: false, error: `No ${pre.side} bid on "${pre.market.title}" right now, so there's no price to sell at. Try again later.` };
  const px = +bid.toFixed(4);

  const res = await tx((db): CloseProposalResult & { replaced?: string[] } => {
    const pos = db.positions.find((p) => p.id === positionId && p.userId === userId);
    if (!pos || pos.status !== "open" || pos.quantity <= 0) return { ok: false, error: "No open position with that id." };
    const selling = db.orders
      .filter((o) => o.userId === userId && o.marketId === pos.marketId && o.side === pos.side && o.action === "sell" && WORKING.includes(o.status))
      .reduce((s, o) => s + o.quantity - o.filledQuantity, 0);
    const avail = pos.quantity - selling;
    if (avail < 1)
      return { ok: false, error: `All ${pos.quantity} contracts are already in a working sell order. Cancel that order first to re-price.` };
    const qty = Math.min(avail, fraction >= 1 ? avail : Math.max(1, Math.round(fraction * pos.quantity)));
    const kind: TradeProposal["kind"] = qty >= pos.quantity ? "close" : "reduce";

    // One pending exit per position: reuse it when the terms match, otherwise replace it.
    const pending = db.proposals.filter(
      (p) => p.userId === userId && p.marketId === pos.marketId && p.side === pos.side && p.status === "pending" && isExit(p) && Date.parse(p.expiresAt) > Date.now(),
    );
    const same = pending.find((p) => p.quantity === qty && Math.abs(p.limitPrice - px) < 1e-9);
    if (same) return { ok: true, proposal: { ...same }, approvalUrl: approvalUrl(same), reused: true };
    for (const p of pending) { p.status = "rejected"; p.statusReason = "Replaced by a newer exit proposal."; }

    const proceeds = +(qty * px).toFixed(2);
    const pnl = (px - pos.avgEntryPrice) * qty;
    const simulated = orderModeFor(market) === "simulated";
    const origin = db.proposals.find((p) => p.id === pos.proposalId);
    const proposal: TradeProposal = {
      id: id("prop_"), userId, marketId: pos.marketId, market, researchId: origin?.researchId ?? "",
      kind, discovery: "personalized", side: pos.side, quantity: qty, limitPrice: px, costUsd: proceeds,
      marketProbability: px, estimatedProbability: px, edge: 0,
      thesis: `${kind === "close" ? "Close" : "Reduce"}: sell ${qty} of ${pos.quantity} ${pos.side} contracts at the current bid.`,
      sizingExplanation: `${qty} × ${usd(px)} = ~${usd(proceeds)} estimated proceeds (before fees). Bought at ${usd(pos.avgEntryPrice)}, so that's ${pnl >= 0 ? "+" : "-"}${usd(Math.abs(pnl))} realized on these contracts.`,
      riskNotes: [
        "Limit order at the current bid. Thin markets may fill partially or not at all, and the bid can move before you confirm; an unfilled order can be cancelled.",
        simulated ? "Simulated order (not a real exchange fill)." : "",
      ].filter(Boolean).join(" "),
      status: "pending", approvalToken: crypto.randomBytes(16).toString("hex"),
      createdAt: now(), expiresAt: new Date(Date.now() + EXIT_TTL_MS).toISOString(), version: 1,
    };
    db.proposals.push(proposal);
    return { ok: true, proposal: { ...proposal }, approvalUrl: approvalUrl(proposal), reused: false, replaced: pending.map((p) => p.id) };
  });
  if (res.ok && !res.reused) {
    await audit({
      userId, actor: "user", action: "proposal.close_create", ref: res.proposal.id,
      detail: { positionId, kind: res.proposal.kind, quantity: res.proposal.quantity, limitPrice: res.proposal.limitPrice, fraction, replaced: res.replaced },
    });
  }
  if (!res.ok) return res;
  return { ok: true, proposal: res.proposal, approvalUrl: res.approvalUrl, reused: res.reused };
}

/**
 * Cancel the owner's working order. Filled contracts (and their position) stay; only the unfilled remainder is cancelled.
 * Simulated orders are cancelled locally; real ones on the venue, then their final fill state is re-read.
 */
export async function cancelOrder(userId: string, orderId: string): Promise<{ ok: boolean; order?: Order; error?: string }> {
  const o = (await load()).orders.find((x) => x.id === orderId && x.userId === userId);
  if (!o) return { ok: false, error: "Order not found." };
  if (!WORKING.includes(o.status)) return { ok: false, order: o, error: `Order is already ${o.status}.` };
  const venue = o.venue ?? venueOf({ id: o.marketId, source: "gemini" });
  const local = o.mode === "simulated" || !o.exchangeOrderId || o.exchangeOrderId.startsWith("sim-") || (venue === "hyperliquid" && hyperliquidMode === "simulated");
  if (!local && !o.exchangeOrderId) return { ok: false, order: o, error: "Order has no exchange id yet; try again shortly." };

  let final: Awaited<ReturnType<typeof getOrderStatus>>;
  if (!local) {
    const r = await cancelExchangeOrder({ exchangeOrderId: o.exchangeOrderId!, venue, marketId: o.marketId, side: o.side, userId });
    // Whatever happened, read the order's real state (it may have filled before the cancel landed).
    final = await getOrderStatus(o.exchangeOrderId!, venue, userId).catch(() => undefined);
    if (!r.ok && !(final && !WORKING.includes(final.status))) {
      await audit({ userId, actor: "user", action: "order.cancel_failed", ref: o.id, detail: { venue, mode: o.mode, error: r.error } });
      return { ok: false, order: o, error: r.error ?? "Cancel failed." };
    }
  }

  const updated = await tx((db) => {
    const cur = db.orders.find((x) => x.id === orderId) as TrackedOrder | undefined;
    if (!cur) return undefined;
    if (final) {
      cur.filledQuantity = Math.max(cur.filledQuantity, final.filledQuantity);
      if (final.avgFillPrice !== undefined) cur.avgFillPrice = final.avgFillPrice;
    }
    const delta = cur.filledQuantity - (cur.appliedQuantity ?? 0);
    if (delta > 0) applyFill(db, cur, delta, cur.avgFillPrice ?? cur.limitPrice);
    cur.status = cur.filledQuantity >= cur.quantity ? "filled" : "cancelled";
    cur.updatedAt = now();
    return { ...cur };
  });
  if (!updated) return { ok: false, error: "Order not found." };
  await audit({
    userId, actor: "user", action: "order.cancel", ref: orderId,
    detail: { venue, mode: o.mode, local, status: updated.status, filled: updated.filledQuantity, quantity: updated.quantity },
  });
  if (updated.status === "filled") return { ok: false, order: updated, error: "Too late: the order filled before it could be cancelled." };
  return { ok: true, order: updated };
}
