/**
 * Approval gate + execution service. The ONLY code path that places orders.
 * Invariants (spec §6, §13):
 *  - An order needs an Approval whose bindingHash matches the proposal version.
 *  - One order per approval (idempotent clientOrderId = approval id).
 *  - Expired proposals cannot be approved.
 *  - Status is whatever the exchange returned; never marked filled early.
 */
import type { Approval, Channel, Order, Position, TradeProposal } from "@mayflower/shared";
import { contentHash, newId, proposalBindingFields } from "@mayflower/shared";
import { ExchangeError, type ExchangeClient } from "@mayflower/gemini-markets";
import type { Container } from "./container.js";
import { userExchangeAuth } from "./proposals.js";

export class ApprovalError extends Error { constructor(message: string, public code: string) { super(message); } }

export async function recordDecision(c: Container, input: { userId: string; proposalId: string; version: number; decision: "approved" | "rejected"; channel: Channel; evidence?: string }): Promise<{ approval: Approval; proposal: TradeProposal }> {
  const p = await c.repo.getProposal(input.proposalId);
  if (!p || p.userId !== input.userId) throw new ApprovalError("Proposal not found", "NOT_FOUND");
  if (p.version !== input.version) throw new ApprovalError("This proposal has changed since you saw it. Please review the latest version.", "STALE_VERSION");
  if (p.status !== "pending_approval") throw new ApprovalError(`Proposal is ${p.status.replace("_", " ")}, not awaiting approval.`, "NOT_PENDING");
  if (new Date(p.expiresAt).getTime() < Date.now()) {
    p.status = "expired"; await c.repo.saveProposal(p);
    throw new ApprovalError("This proposal expired. Ask me to refresh it.", "EXPIRED");
  }
  const expectedHash = contentHash(proposalBindingFields(p));
  if (expectedHash !== p.bindingHash) throw new ApprovalError("Proposal integrity check failed.", "HASH_MISMATCH");
  const existing = await c.repo.getApprovalForProposal(p.id, p.version);
  if (existing) throw new ApprovalError("A decision was already recorded for this proposal.", "DUPLICATE");
  const approval: Approval = { id: newId(), userId: p.userId, proposalId: p.id, proposalVersion: p.version, bindingHash: p.bindingHash, decision: input.decision, channel: input.channel, decidedAt: new Date().toISOString(), evidence: input.evidence ?? null };
  await c.repo.saveApproval(approval);
  p.status = input.decision; p.updatedAt = approval.decidedAt;
  await c.repo.saveProposal(p);
  await c.repo.audit({ userId: p.userId, actor: "user", action: `proposal.${input.decision}`, refType: "proposal", refId: p.id, payload: { channel: input.channel, version: p.version } });
  return { approval, proposal: p };
}

/** Submit an approved proposal exactly once and reconcile with the venue's response. */
export async function executeApproved(c: Container, approval: Approval, exchangeOverride?: ExchangeClient): Promise<Order> {
  if (approval.decision !== "approved") throw new ApprovalError("Cannot execute a rejected proposal", "NOT_APPROVED");
  const p = await c.repo.getProposal(approval.proposalId);
  if (!p || p.bindingHash !== approval.bindingHash || p.version !== approval.proposalVersion) throw new ApprovalError("Approval does not match proposal", "HASH_MISMATCH");
  const dup = await c.repo.getOrderByApproval(approval.id);
  if (dup) return dup;
  const exchange = exchangeOverride ?? c.exchangeFor(await userExchangeAuth(c, p.userId));
  const now = new Date().toISOString();
  const order: Order = {
    id: newId(), userId: p.userId, proposalId: p.id, approvalId: approval.id, marketId: p.marketId, side: p.side, action: p.action,
    quantity: p.quantity, limitPrice: p.limitPrice, mode: exchange.mode, clientOrderId: `mf-${approval.id}`.slice(0, 36), exchangeOrderId: null,
    status: "pending", fills: [], submittedAt: null, updatedAt: now,
  };
  await c.repo.saveOrder(order); // reserve before submitting so a crash can't double-submit
  try {
    const res = await exchange.placeOrder({ marketId: p.marketId, side: p.side, action: p.action, quantity: p.quantity, limitPrice: p.limitPrice, clientOrderId: order.clientOrderId });
    order.exchangeOrderId = res.exchangeOrderId; order.status = res.status; order.fills = res.fills; order.raw = res.raw; order.submittedAt = now;
  } catch (e) {
    order.status = "error"; order.error = e instanceof ExchangeError ? `${e.code}: ${e.message}` : (e as Error).message;
  }
  order.updatedAt = new Date().toISOString();
  await c.repo.saveOrder(order);
  p.status = order.status === "error" ? "failed" : order.status === "filled" ? "filled" : order.status === "partially_filled" ? "partially_filled" : "submitted";
  await c.repo.saveProposal(p);
  await c.repo.audit({ userId: p.userId, actor: "exchange", action: "order.submitted", refType: "order", refId: order.id, payload: { status: order.status, exchangeOrderId: order.exchangeOrderId, error: order.error, mode: order.mode } });
  if (order.fills.length) await applyFillsToPosition(c, order, p);
  return order;
}

async function applyFillsToPosition(c: Container, order: Order, p: TradeProposal) {
  const market = await c.repo.getMarket(order.marketId);
  const positions = await c.repo.listPositions(order.userId);
  const existing = positions.find((x) => x.marketId === order.marketId && x.side === order.side && x.mode === order.mode && x.status === "open");
  const filledQty = order.fills.reduce((s, f) => s + f.quantity, 0);
  const filledCost = order.fills.reduce((s, f) => s + f.quantity * f.price, 0);
  const now = new Date().toISOString();
  if (order.action === "BUY") {
    const qty = (existing?.quantity ?? 0) + filledQty;
    const cost = (existing?.costBasis ?? 0) + filledCost;
    const pos: Position = {
      id: existing?.id ?? newId(), userId: order.userId, marketId: order.marketId, side: order.side, quantity: qty, avgPrice: qty ? cost / qty : 0, costBasis: cost,
      currentPrice: existing?.currentPrice ?? null, unrealizedPnl: existing?.unrealizedPnl ?? null, realizedPnl: existing?.realizedPnl ?? 0, tags: market?.tags ?? [], mode: order.mode, status: "open",
      openedAt: existing?.openedAt ?? now, updatedAt: now, originalReportId: existing?.originalReportId ?? p.researchReportId ?? null, latestReportId: p.researchReportId ?? null,
    };
    await c.repo.upsertPosition(pos);
  } else if (existing) {
    const qty = Math.max(0, existing.quantity - filledQty);
    const realized = filledCost - filledQty * existing.avgPrice;
    await c.repo.upsertPosition({ ...existing, quantity: qty, costBasis: qty * existing.avgPrice, realizedPnl: existing.realizedPnl + realized, status: qty === 0 ? "closed" : "open", updatedAt: now, latestReportId: p.researchReportId ?? existing.latestReportId });
  }
}

/** Poll the venue for an open order and update local state + positions. */
export async function reconcileOrder(c: Container, order: Order): Promise<Order> {
  if (!order.exchangeOrderId || ["filled", "cancelled", "rejected", "error"].includes(order.status)) return order;
  const exchange = c.exchangeFor(await userExchangeAuth(c, order.userId));
  const res = await exchange.getOrder(order.exchangeOrderId);
  const newFills = res.fills.filter((f) => !order.fills.some((o) => o.id === f.id));
  order.status = res.status; order.fills = res.fills; order.updatedAt = new Date().toISOString(); order.raw = res.raw;
  await c.repo.saveOrder(order);
  const p = await c.repo.getProposal(order.proposalId);
  if (p) { p.status = res.status === "filled" ? "filled" : res.status === "partially_filled" ? "partially_filled" : res.status === "cancelled" ? "cancelled" : p.status; await c.repo.saveProposal(p); }
  if (newFills.length && p) await applyFillsToPosition(c, { ...order, fills: newFills }, p);
  return order;
}

/** Convenience: decide + execute in one step (used by web approve button and approval links). */
export async function approveAndExecute(c: Container, input: { userId: string; proposalId: string; version: number; channel: Channel; evidence?: string }): Promise<{ order: Order; proposal: TradeProposal }> {
  const { approval, proposal } = await recordDecision(c, { ...input, decision: "approved" });
  const order = await executeApproved(c, approval);
  return { order, proposal };
}
