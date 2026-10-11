import { and, eq, inArray } from "drizzle-orm";
import { ExchangeError, type ExchangeOrder, type TradingVenue } from "@mayflower/gemini-markets";
import { watchConditionsFor, riskCapacity } from "@mayflower/risk";
import { formatUsd, round, type ExecutionMode, type OrderStatus, type Outcome, type RiskStyle, type SizingResult } from "@mayflower/shared";
import { config } from "./config";
import { getDb, schema } from "./db/client";
import type { Order, Proposal, User } from "./db/schema";
import { audit } from "./audit";
import { activeConnection, balanceInfo, markTermsAccepted, resolveVenue, venueForConnection } from "./gemini-link";
import { refreshContract, groupOf } from "./markets";
import { currentExposures, OPEN_ORDER_STATUSES } from "./portfolio";
import { termsHash } from "./proposals";
import { effectiveLimits, getUser } from "./users";

export type ExecutionResult =
  | { status: "submitted"; order: Order; message: string }
  | { status: "needs_link"; message: string }
  | { status: "needs_terms"; message: string }
  | { status: "blocked"; message: string }
  | { status: "failed"; order?: Order; message: string };

export async function tradingGloballyEnabled(): Promise<boolean> {
  if (!config().tradingEnabled) return false;
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "trading_enabled")).limit(1);
  return row ? row.value !== false : true;
}

export async function setGlobalTrading(enabled: boolean, actorUserId: string | null): Promise<void> {
  const db = await getDb();
  await db
    .insert(schema.appSettings)
    .values({ key: "trading_enabled", value: enabled })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: enabled, updatedAt: new Date() } });
  await audit({ userId: actorUserId, actor: "user", action: enabled ? "kill_switch.off" : "kill_switch.on" });
}

async function setProposalStatus(id: string, status: Proposal["status"]): Promise<void> {
  const db = await getDb();
  await db.update(schema.tradeProposals).set({ status, updatedAt: new Date() }).where(eq(schema.tradeProposals.id, id));
}

function mapStatus(o: ExchangeOrder): OrderStatus {
  if (o.status === "filled") return "filled";
  if (o.status === "cancelled") return "cancelled";
  return o.filledQuantity > 0 ? "partially_filled" : "open";
}

/**
 * Apply newly filled quantity from an order to positions and (for ledger modes) the ledger.
 * Idempotent: only the delta above the stored filled quantity is applied.
 */
async function applyFills(order: Order, newFilled: number, avgPrice: number | null): Promise<void> {
  const delta = round(newFilled - order.filledQuantity, 8);
  if (delta <= 0) return;
  const db = await getDb();
  const prevCost = order.filledQuantity * (order.avgFillPrice ?? order.limitPrice);
  const newAvg = avgPrice ?? order.limitPrice;
  const deltaCost = round(newFilled * newAvg - prevCost, 4);
  const fillPrice = round(deltaCost / delta, 4);
  const [proposal] = await db.select().from(schema.tradeProposals).where(eq(schema.tradeProposals.id, order.proposalId)).limit(1);
  const [market] = await db.select().from(schema.markets).where(eq(schema.markets.symbol, order.symbol)).limit(1);
  const user = await getUser(order.userId);
  const mode = order.mode as ExecutionMode;

  await db.transaction(async (tx) => {
    await tx.insert(schema.fills).values({ orderId: order.id, quantity: delta, price: fillPrice });
    const [pos] = await tx
      .select()
      .from(schema.positions)
      .where(and(eq(schema.positions.userId, order.userId), eq(schema.positions.symbol, order.symbol), eq(schema.positions.outcome, order.outcome), eq(schema.positions.mode, mode), eq(schema.positions.status, "open")))
      .limit(1);
    if (order.side === "buy") {
      if (pos) {
        const quantity = round(pos.quantity + delta, 8);
        const costBasis = round(pos.costBasis + deltaCost, 4);
        await tx.update(schema.positions).set({ quantity, costBasis, avgPrice: round(costBasis / quantity, 6), updatedAt: new Date() }).where(eq(schema.positions.id, pos.id));
      } else {
        const sizing = proposal?.sizing as SizingResult | undefined;
        const held = order.outcome === "yes" ? (sizing?.adjustedProbability ?? proposal?.estProbability ?? fillPrice) : 1 - (sizing?.adjustedProbability ?? proposal?.estProbability ?? 1 - fillPrice);
        await tx.insert(schema.positions).values({
          userId: order.userId,
          symbol: order.symbol,
          eventTicker: order.eventTicker,
          outcome: order.outcome,
          mode,
          quantity: delta,
          costBasis: deltaCost,
          avgPrice: fillPrice,
          correlationGroup: market?.correlationGroup ?? (market ? groupOf({ category: market.category, eventTitle: market.eventTitle, label: market.label, tags: market.tags }) : null),
          originProposalId: order.proposalId,
          thesis: proposal ? { text: proposal.rationale.thesis, probability: proposal.estProbability, sizingSummary: proposal.rationale.sizingSummary } : null,
          watchConditions: watchConditionsFor({
            outcome: order.outcome as Outcome,
            entryPrice: fillPrice,
            heldProbability: held,
            expiry: market?.expiry?.toISOString() ?? null,
            riskStyle: user.riskStyle as RiskStyle,
            thesisWatch: proposal?.rationale.watchConditions?.slice(0, 3),
          }),
        });
      }
      if (mode !== "oauth") {
        await tx.insert(schema.ledgerEntries).values({ userId: order.userId, mode, kind: "buy", amount: -round(deltaCost, 2), refType: "order", refId: order.id, memo: `Bought ${delta} ${order.outcome.toUpperCase()} ${order.symbol}` });
      }
    } else {
      if (pos) {
        const qty = Math.min(delta, pos.quantity);
        const basisOut = round(pos.avgPrice * qty, 4);
        const quantity = round(pos.quantity - qty, 8);
        const realized = round(pos.realizedPnl + deltaCost - basisOut, 4);
        await tx
          .update(schema.positions)
          .set({
            quantity,
            costBasis: round(Math.max(0, pos.costBasis - basisOut), 4),
            realizedPnl: realized,
            status: quantity <= 1e-9 ? "closed" : "open",
            closedAt: quantity <= 1e-9 ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(schema.positions.id, pos.id));
      }
      if (mode !== "oauth") {
        await tx.insert(schema.ledgerEntries).values({ userId: order.userId, mode, kind: "sell", amount: round(deltaCost, 2), refType: "order", refId: order.id, memo: `Sold ${delta} ${order.outcome.toUpperCase()} ${order.symbol}` });
      }
    }
    await tx.update(schema.orders).set({ filledQuantity: newFilled, avgFillPrice: newAvg, updatedAt: new Date() }).where(eq(schema.orders.id, order.id));
  });
  await audit({ userId: order.userId, actor: "system", action: "order.fill", refType: "order", refId: order.id, details: { quantity: delta, price: fillPrice, simulated: order.simulated } });
}

/** Deterministic pre-trade checks, re-run at execution time with fresh data. */
async function preTradeChecks(user: User, p: Proposal, freshAsk: number | null): Promise<string | null> {
  if (p.side === "sell") {
    const db = await getDb();
    const [pos] = await db
      .select()
      .from(schema.positions)
      .where(and(eq(schema.positions.userId, user.id), eq(schema.positions.symbol, p.symbol), eq(schema.positions.outcome, p.outcome ?? "yes"), eq(schema.positions.status, "open")))
      .limit(1);
    if (!pos || pos.quantity + 1e-9 < p.quantity) return "You no longer hold enough of this position to sell that amount.";
    return null;
  }
  const limits = effectiveLimits(user);
  const exposures = await currentExposures(user.id);
  const total = exposures.reduce((s, e) => s + e.atRisk, 0);
  const sameContract = exposures.filter((e) => e.symbol === p.symbol && e.outcome === p.outcome).reduce((s, e) => s + e.atRisk, 0);
  if (p.maxCost > limits.maxPerPosition - sameContract + 0.005) return `This order (${formatUsd(p.maxCost)}) would exceed your ${formatUsd(limits.maxPerPosition)} per-position limit.`;
  if (total + p.maxCost > riskCapacity(limits) + 0.005) return `This order would take your total at risk above your ${formatUsd(riskCapacity(limits))} limit.`;
  const bal = await balanceInfo(user.id);
  if (bal.available !== null && p.maxCost > bal.available + 0.005) return `Your available balance (${formatUsd(bal.available)}) is less than the order cost (${formatUsd(p.maxCost)}).`;
  if (freshAsk === null) return "The contract has no executable price right now.";
  return null;
}

/**
 * Execute an approved proposal. This is the ONLY path that places orders, and
 * it requires a recorded approval matching the exact proposal version/terms.
 */
export async function executeApproval(userId: string, approvalId: string): Promise<ExecutionResult> {
  const db = await getDb();
  const [approval] = await db.select().from(schema.approvals).where(and(eq(schema.approvals.id, approvalId), eq(schema.approvals.userId, userId))).limit(1);
  if (!approval || approval.decision !== "approved") return { status: "blocked", message: "No approval on record for this order." };
  const [p] = await db.select().from(schema.tradeProposals).where(eq(schema.tradeProposals.id, approval.proposalId)).limit(1);
  if (!p || p.userId !== userId) return { status: "blocked", message: "Proposal not found." };
  if (!["approved", "awaiting_link"].includes(p.status)) {
    const [existing] = await db.select().from(schema.orders).where(eq(schema.orders.proposalId, p.id)).limit(1);
    if (existing) return { status: "submitted", order: existing, message: "This approved order was already submitted; Mayflower never sends it twice." };
    return { status: "blocked", message: `Proposal is ${p.status}.` };
  }
  if (approval.proposalVersion !== p.version || approval.termsHash !== termsHash(p)) {
    await setProposalStatus(p.id, "failed");
    return { status: "blocked", message: "The approved terms don't match the proposal anymore, so nothing was sent." };
  }
  const user = await getUser(userId);
  if (!(await tradingGloballyEnabled())) {
    await setProposalStatus(p.id, "failed");
    await audit({ userId, actor: "system", action: "execution.blocked", refType: "proposal", refId: p.id, details: { reason: "kill_switch" } });
    return { status: "blocked", message: "Trading is currently switched off by the Mayflower kill switch. Nothing was sent." };
  }
  if (user.tradingPaused) {
    await setProposalStatus(p.id, "failed");
    await audit({ userId, actor: "system", action: "execution.blocked", refType: "proposal", refId: p.id, details: { reason: "user_paused" } });
    return { status: "blocked", message: "Your trading is paused. Nothing was sent. Say “resume” to turn it back on, then ask for a fresh recommendation." };
  }
  if (!p.expiresAt || p.expiresAt < new Date()) {
    await setProposalStatus(p.id, "expired");
    return { status: "blocked", message: "The proposal expired before it could be sent. Ask for a fresh recommendation." };
  }

  const venueRes = await resolveVenue(userId);
  if (venueRes.status === "needs_link") {
    await setProposalStatus(p.id, "awaiting_link");
    await audit({ userId, actor: "system", action: "execution.awaiting_link", refType: "proposal", refId: p.id });
    return { status: "needs_link", message: "Approved. Link your Gemini account (trade-only — Mayflower can't withdraw or move money) and I'll submit this exact order." };
  }
  const { venue, mode, connection } = venueRes;

  const [market] = await db.select().from(schema.markets).where(eq(schema.markets.symbol, p.symbol)).limit(1);
  if (!market) return { status: "failed", message: "Market data missing for this contract." };
  const fresh = await refreshContract(p.symbol, market.eventTicker);
  if (!fresh.contract) {
    await setProposalStatus(p.id, "failed");
    return { status: "failed", message: `Couldn't confirm the contract on Gemini (${fresh.error ?? "not found"}). Nothing was sent.` };
  }
  if (fresh.contract.status !== "active" || fresh.contract.marketState === "closed") {
    await setProposalStatus(p.id, "failed");
    return { status: "failed", message: "The market is no longer open for trading. Nothing was sent." };
  }
  const outcome = (p.outcome ?? "yes") as Outcome;
  const q = fresh.contract.quote;
  const freshAsk = p.side === "sell" ? (outcome === "yes" ? q.sellYes ?? q.bestBid : q.sellNo) : outcome === "yes" ? q.buyYes ?? q.bestAsk : q.buyNo;
  const blocker = await preTradeChecks(user, p, freshAsk ?? null);
  if (blocker) {
    await setProposalStatus(p.id, "failed");
    await audit({ userId, actor: "system", action: "execution.blocked", refType: "proposal", refId: p.id, details: { reason: blocker } });
    return { status: "blocked", message: `${blocker} Nothing was sent.` };
  }

  // Prediction-market terms must be accepted on the account before orders.
  try {
    const terms = await venue.termsStatus();
    if (!terms.hasAcceptedLatest) {
      if (mode === "shared_sandbox") {
        await venue.acceptTerms();
        await markTermsAccepted(connection.id);
        await audit({ userId, actor: "system", action: "gemini.terms_accepted", details: { account: "shared sandbox (operator)" } });
      } else {
        await setProposalStatus(p.id, "awaiting_link");
        return { status: "needs_terms", message: "Gemini requires you to accept its prediction-market terms before your first order. Open the link page to review and accept them; I'll submit the approved order right after." };
      }
    }
  } catch (err) {
    await setProposalStatus(p.id, "failed");
    return { status: "failed", message: `Couldn't verify Gemini terms status: ${(err as Error).message}. Nothing was sent.` };
  }

  // Reserve the order row first: the unique proposal_id/approval_id constraints make duplicate submission impossible.
  const inserted = await db
    .insert(schema.orders)
    .values({
      userId,
      proposalId: p.id,
      approvalId: approval.id,
      mode,
      env: connection.env,
      simulated: venue.simulated,
      symbol: p.symbol,
      eventTicker: market.eventTicker,
      side: p.side ?? "buy",
      outcome,
      quantity: p.quantity,
      limitPrice: p.limitPrice ?? 0,
      status: "submitting",
      submittedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    const [existing] = await db.select().from(schema.orders).where(eq(schema.orders.proposalId, p.id)).limit(1);
    return { status: "submitted", order: existing, message: "This order was already submitted once; it will not be sent again." };
  }
  let order = inserted[0];
  await setProposalStatus(p.id, "executing");
  await audit({ userId, actor: "system", action: "order.submitting", refType: "order", refId: order.id, details: { mode, simulated: venue.simulated, symbol: p.symbol, side: p.side, outcome, quantity: p.quantity, limitPrice: p.limitPrice } });

  try {
    const res = await venue.placeLimitOrder({
      symbol: p.symbol,
      eventTicker: market.eventTicker,
      side: (p.side ?? "buy") as "buy" | "sell",
      outcome,
      quantity: p.quantity,
      limitPrice: p.limitPrice ?? 0,
      timeInForce: config().defaultTimeInForce,
    });
    const status = mapStatus(res);
    const [updated] = await db
      .update(schema.orders)
      .set({ exchangeOrderId: res.orderId || null, status, raw: (res.raw ?? null) as Record<string, unknown> | null, updatedAt: new Date() })
      .where(eq(schema.orders.id, order.id))
      .returning();
    order = updated;
    if (res.filledQuantity > 0) await applyFills(order, res.filledQuantity, res.avgExecutionPrice);
    await setProposalStatus(p.id, "executed");
    const [final] = await db.select().from(schema.orders).where(eq(schema.orders.id, order.id)).limit(1);
    await audit({ userId, actor: "system", action: "order.submitted", refType: "order", refId: order.id, details: { exchangeOrderId: res.orderId, status, filled: res.filledQuantity, simulated: venue.simulated } });
    return { status: "submitted", order: final, message: describeOrderStatus(final) };
  } catch (err) {
    const ex = err instanceof ExchangeError ? err : null;
    // 4xx (and SDK input validation) means the exchange definitely did not accept it; anything else is ambiguous.
    const definite = (ex?.status != null && ex.status >= 400 && ex.status < 500) || ex?.code === "ValidationError";
    const status: OrderStatus = definite ? "rejected" : "unknown";
    const message = (err as Error).message;
    const [updated] = await db.update(schema.orders).set({ status, error: message, updatedAt: new Date() }).where(eq(schema.orders.id, order.id)).returning();
    await setProposalStatus(p.id, definite ? "failed" : "executing");
    await audit({ userId, actor: "system", action: definite ? "order.rejected" : "order.unknown", refType: "order", refId: order.id, details: { error: message, code: ex?.code } });
    return {
      status: "failed",
      order: updated,
      message: definite
        ? `Gemini rejected the order: ${message}`
        : `I couldn't confirm whether Gemini received the order (${message}). Mayflower will NOT resend it; check the order status on the dashboard.`,
    };
  }
}

export function describeOrderStatus(o: Order): string {
  const tag = o.simulated ? "SIMULATED order" : o.mode === "shared_sandbox" ? "Gemini sandbox order (shared account)" : o.env === "sandbox" ? "Gemini sandbox order" : "Gemini order";
  const what = `${o.side} ${round(o.quantity, 2)} ${o.outcome.toUpperCase()} @ ≤${Math.round(o.limitPrice * 100)}¢`;
  switch (o.status) {
    case "filled":
      return `${tag} filled: ${what}, average ${Math.round((o.avgFillPrice ?? o.limitPrice) * 100)}¢${o.exchangeOrderId ? ` (order ${o.exchangeOrderId})` : ""}.`;
    case "partially_filled":
      return `${tag} partially filled: ${round(o.filledQuantity, 2)} of ${round(o.quantity, 2)} so far (${what}). The rest is resting on the book.`;
    case "open":
      return `${tag} accepted and resting on the book, not filled yet (${what}). I'll tell you when it fills.`;
    case "cancelled":
      return `${tag} was cancelled without a full fill (${round(o.filledQuantity, 2)} filled).`;
    case "rejected":
      return `${tag} was rejected: ${o.error ?? "unknown reason"}.`;
    case "unknown":
      return `${tag} status is unknown — it will not be resent.`;
    default:
      return `${tag} is ${o.status}.`;
  }
}

/** Poll the venue for open orders and apply fills/cancellations. */
export async function reconcileOrders(userId?: string): Promise<{ checked: number; changed: Order[] }> {
  const db = await getDb();
  const where = userId
    ? and(eq(schema.orders.userId, userId), inArray(schema.orders.status, [...OPEN_ORDER_STATUSES]))
    : inArray(schema.orders.status, [...OPEN_ORDER_STATUSES]);
  const open = await db.select().from(schema.orders).where(where);
  const changed: Order[] = [];
  const venues = new Map<string, TradingVenue | null>();
  for (const o of open) {
    if (!o.exchangeOrderId) continue;
    let venue = venues.get(o.userId);
    if (venue === undefined) {
      const conn = await activeConnection(o.userId);
      venue = conn && conn.mode === o.mode ? venueForConnection(o.userId, conn) : null;
      venues.set(o.userId, venue);
    }
    if (!venue) continue;
    try {
      const res = await venue.refreshOrder({
        exchangeOrderId: o.exchangeOrderId,
        symbol: o.symbol,
        eventTicker: o.eventTicker,
        side: o.side as "buy" | "sell",
        outcome: o.outcome as Outcome,
        quantity: o.quantity,
        limitPrice: o.limitPrice,
        createdAt: o.createdAt.toISOString(),
      });
      if (!res) continue;
      const status = mapStatus(res);
      if (res.filledQuantity > o.filledQuantity) await applyFills(o, res.filledQuantity, res.avgExecutionPrice);
      if (status !== o.status) {
        const [u] = await db.update(schema.orders).set({ status, updatedAt: new Date() }).where(eq(schema.orders.id, o.id)).returning();
        changed.push(u);
        await audit({ userId: o.userId, actor: "system", action: "order.status", refType: "order", refId: o.id, details: { from: o.status, to: status } });
      }
    } catch (err) {
      await audit({ userId: o.userId, actor: "system", action: "order.reconcile_failed", refType: "order", refId: o.id, details: { error: (err as Error).message } });
    }
  }
  return { checked: open.length, changed };
}

/** User-initiated cancel of a resting order (never increases exposure). */
export async function cancelOrder(userId: string, orderId: string): Promise<{ ok: boolean; message: string }> {
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.userId, userId))).limit(1);
  if (!o) return { ok: false, message: "Order not found." };
  if (!["open", "partially_filled"].includes(o.status) || !o.exchangeOrderId) return { ok: false, message: `Order is ${o.status}; nothing to cancel.` };
  const conn = await activeConnection(userId);
  if (!conn || conn.mode !== o.mode) return { ok: false, message: "The account that placed this order is no longer linked." };
  const venue = venueForConnection(userId, conn);
  await reconcileOrders(userId);
  try {
    await venue.cancelOrder({ exchangeOrderId: o.exchangeOrderId, symbol: o.symbol, eventTicker: o.eventTicker, side: o.side as "buy" | "sell", outcome: o.outcome as Outcome, quantity: o.quantity, limitPrice: o.limitPrice, createdAt: o.createdAt.toISOString() });
  } catch (err) {
    return { ok: false, message: `Cancel failed: ${(err as Error).message}` };
  }
  await db.update(schema.orders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.orders.id, o.id));
  await audit({ userId, actor: "user", action: "order.cancelled", refType: "order", refId: o.id });
  return { ok: true, message: "Order cancelled." };
}

/** After linking Gemini (and accepting terms), submit orders that were approved while unlinked. */
export async function executeAwaitingLink(userId: string): Promise<ExecutionResult[]> {
  const db = await getDb();
  const rows = await db
    .select({ a: schema.approvals })
    .from(schema.approvals)
    .innerJoin(schema.tradeProposals, eq(schema.tradeProposals.id, schema.approvals.proposalId))
    .where(and(eq(schema.approvals.userId, userId), eq(schema.approvals.decision, "approved"), eq(schema.tradeProposals.status, "awaiting_link")));
  const out: ExecutionResult[] = [];
  for (const r of rows) out.push(await executeApproval(userId, r.a.id));
  return out;
}

/** Settle positions whose contracts have resolved. */
export async function settlePosition(positionId: string, resolution: Outcome): Promise<void> {
  const db = await getDb();
  const [pos] = await db.select().from(schema.positions).where(eq(schema.positions.id, positionId)).limit(1);
  if (!pos || pos.status !== "open") return;
  const payout = pos.outcome === resolution ? round(pos.quantity, 2) : 0;
  const realized = round(pos.realizedPnl + payout - pos.costBasis, 4);
  await db.transaction(async (tx) => {
    await tx.update(schema.positions).set({ status: "settled", realizedPnl: realized, closedAt: new Date(), updatedAt: new Date() }).where(eq(schema.positions.id, pos.id));
    if (pos.mode !== "oauth" && payout > 0) {
      await tx.insert(schema.ledgerEntries).values({ userId: pos.userId, mode: pos.mode, kind: "payout", amount: payout, refType: "position", refId: pos.id, memo: `Settlement payout ${pos.symbol}` });
    }
  });
  await audit({ userId: pos.userId, actor: "system", action: "position.settled", refType: "position", refId: pos.id, details: { resolution, payout, realized } });
}
