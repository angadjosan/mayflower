import { and, desc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { canonicalJson, formatCents, formatUsd, outcomeLabel, round, type Outcome, type OrderSide, type ProposalTerms } from "@mayflower/shared";
import { config } from "./config";
import { hashSecret, randomCode, safeEqual, sha256 } from "./crypto";
import { getDb, schema } from "./db/client";
import type { Proposal } from "./db/schema";
import { audit } from "./audit";
import { consumeSignedLink, createSignedLink } from "./auth";

export function proposalTerms(p: Pick<Proposal, "id" | "version" | "symbol" | "side" | "outcome" | "quantity" | "limitPrice" | "maxCost">): ProposalTerms {
  return {
    proposalId: p.id,
    version: p.version,
    symbol: p.symbol,
    side: (p.side ?? "buy") as OrderSide,
    outcome: (p.outcome ?? "yes") as Outcome,
    quantity: p.quantity,
    limitPrice: p.limitPrice ?? 0,
    maxCost: p.maxCost,
  };
}

/** Hash binding an approval to the exact action, amount, price and contract. */
export function termsHash(p: Parameters<typeof proposalTerms>[0]): string {
  return sha256(canonicalJson(proposalTerms(p)));
}

export function describeTerms(p: Pick<Proposal, "side" | "outcome" | "quantity" | "limitPrice" | "maxCost">, label: string): string {
  const side = p.side === "sell" ? "Sell" : "Buy";
  const out = outcomeLabel((p.outcome ?? "yes") as Outcome);
  const qty = round(p.quantity, 2);
  if (p.side === "sell") {
    return `${side} ${qty} ${out} contract${qty === 1 ? "" : "s"} of “${label}” at no less than ${formatCents(p.limitPrice)} each (about ${formatUsd(qty * (p.limitPrice ?? 0))} back).`;
  }
  return `${side} ${qty} ${out} contract${qty === 1 ? "" : "s"} of “${label}” at up to ${formatCents(p.limitPrice)} each — total ${formatUsd(p.maxCost)}, which is the most you can lose. Pays ${formatUsd(qty)} if ${out} wins.`;
}

export async function getProposal(userId: string, id: string): Promise<Proposal | null> {
  const db = await getDb();
  const [p] = await db.select().from(schema.tradeProposals).where(and(eq(schema.tradeProposals.id, id), eq(schema.tradeProposals.userId, userId))).limit(1);
  return p ?? null;
}

export async function pendingProposals(userId: string): Promise<Proposal[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.tradeProposals)
    .where(and(eq(schema.tradeProposals.userId, userId), inArray(schema.tradeProposals.status, ["pending", "awaiting_link"]), gt(schema.tradeProposals.expiresAt, new Date())))
    .orderBy(desc(schema.tradeProposals.createdAt));
}

export type NewProposal = Omit<typeof schema.tradeProposals.$inferInsert, "id" | "version" | "termsHash" | "status" | "expiresAt" | "createdAt" | "updatedAt">;

export async function createProposal(input: NewProposal): Promise<Proposal> {
  const db = await getDb();
  const isTrade = input.decision === "trade";
  const ttlHours = input.kind === "open" ? config().proposalTtlHours : Math.min(config().proposalTtlHours, 6);
  if (isTrade) {
    // A fresh recommendation for the same contract replaces older pending ones.
    await db
      .update(schema.tradeProposals)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(and(eq(schema.tradeProposals.userId, input.userId), eq(schema.tradeProposals.symbol, input.symbol), eq(schema.tradeProposals.status, "pending")));
  }
  const [row] = await db
    .insert(schema.tradeProposals)
    .values({ ...input, status: isTrade ? "pending" : "informational", expiresAt: new Date(Date.now() + ttlHours * 3600_000) })
    .returning();
  if (isTrade) {
    const hash = termsHash(row);
    await db.update(schema.tradeProposals).set({ termsHash: hash }).where(eq(schema.tradeProposals.id, row.id));
    row.termsHash = hash;
  }
  await audit({
    userId: input.userId,
    actor: "agent",
    action: isTrade ? "proposal.created" : "proposal.no_trade",
    refType: "proposal",
    refId: row.id,
    details: { symbol: row.symbol, kind: row.kind, discovery: row.discovery, side: row.side, outcome: row.outcome, quantity: row.quantity, limitPrice: row.limitPrice, maxCost: row.maxCost },
  });
  return row;
}

export interface ApprovalChallenge {
  code: string | null;
  link: string;
  expiresAt: Date;
}

/** Issue an exact, expiring confirmation (iMessage code and signed web link) for one proposal version. */
export async function issueApprovalChallenge(userId: string, p: Proposal): Promise<ApprovalChallenge> {
  const c = config();
  const db = await getDb();
  const expiresAt = new Date(Date.now() + c.approvalLinkMinutes * 60_000);
  let code: string | null = null;
  if (c.imessageCodeApproval) {
    code = randomCode(6);
    await db
      .update(schema.tradeProposals)
      .set({ approvalCodeHash: hashSecret(code), approvalCodeExpiresAt: expiresAt })
      .where(eq(schema.tradeProposals.id, p.id));
  }
  const link = await createSignedLink(userId, "approve", c.approvalLinkMinutes, { pid: p.id, th: p.termsHash ?? termsHash(p) });
  await audit({ userId, actor: "agent", action: "approval.challenge_issued", refType: "proposal", refId: p.id, details: { viaCode: Boolean(code), expiresAt: expiresAt.toISOString() } });
  return { code, link, expiresAt };
}

export type ApprovalChannel = "web" | "imessage_link" | "imessage_code";

export type ApproveResult =
  | { ok: true; approvalId: string; proposal: Proposal }
  | { ok: false; error: string; code: "not_found" | "not_pending" | "expired" | "terms_changed" | "already_approved" | "invalid" };

/**
 * The approval gate. An approval is recorded only for the exact current
 * version of a pending, unexpired proposal owned by this user.
 */
export async function approveProposal(input: { userId: string; proposalId: string; termsHash: string; channel: ApprovalChannel }): Promise<ApproveResult> {
  const db = await getDb();
  const p = await getProposal(input.userId, input.proposalId);
  if (!p) return { ok: false, error: "Proposal not found.", code: "not_found" };
  if (p.decision !== "trade") return { ok: false, error: "This was a no-trade recommendation; there is nothing to approve.", code: "invalid" };
  if (p.status !== "pending") return { ok: false, error: `This proposal is ${p.status.replace("_", " ")}, not awaiting approval.`, code: p.status === "approved" ? "already_approved" : "not_pending" };
  if (!p.expiresAt || p.expiresAt < new Date()) return { ok: false, error: "This proposal has expired. Ask Mayflower for a fresh recommendation.", code: "expired" };
  const current = termsHash(p);
  if (!p.termsHash || !safeEqual(current, p.termsHash) || !safeEqual(input.termsHash, current)) {
    return { ok: false, error: "The order terms changed since you reviewed them. Please review the new terms.", code: "terms_changed" };
  }
  let approvalId: string;
  try {
    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.tradeProposals)
        .set({ status: "approved", decidedAt: new Date(), updatedAt: new Date(), approvalCodeHash: null })
        .where(and(eq(schema.tradeProposals.id, p.id), eq(schema.tradeProposals.status, "pending"), eq(schema.tradeProposals.version, p.version)))
        .returning();
      if (updated.length !== 1) throw new Error("not_pending");
      const [a] = await tx
        .insert(schema.approvals)
        .values({ proposalId: p.id, userId: input.userId, proposalVersion: p.version, termsHash: current, decision: "approved", channel: input.channel })
        .returning();
      return a.id;
    });
    approvalId = result;
  } catch {
    return { ok: false, error: "This proposal was already decided.", code: "already_approved" };
  }
  await audit({ userId: input.userId, actor: "user", action: "proposal.approved", refType: "proposal", refId: p.id, details: { channel: input.channel, version: p.version, termsHash: current } });
  const fresh = (await getProposal(input.userId, p.id))!;
  return { ok: true, approvalId, proposal: fresh };
}

/** "APPROVE K7Q2MX" over iMessage: must match an unexpired code for a pending proposal. */
export async function approveByCode(userId: string, code: string): Promise<ApproveResult> {
  if (!config().imessageCodeApproval) return { ok: false, error: "Code approval is disabled. Use the secure link.", code: "invalid" };
  const db = await getDb();
  const candidates = await db
    .select()
    .from(schema.tradeProposals)
    .where(and(eq(schema.tradeProposals.userId, userId), eq(schema.tradeProposals.status, "pending"), gt(schema.tradeProposals.approvalCodeExpiresAt, new Date())));
  const h = hashSecret(code);
  const match = candidates.find((p) => p.approvalCodeHash && safeEqual(p.approvalCodeHash, h));
  if (!match) return { ok: false, error: "That approval code doesn't match a current proposal (codes expire after a few minutes). Ask me to approve again for a fresh code.", code: "invalid" };
  return approveProposal({ userId, proposalId: match.id, termsHash: match.termsHash ?? "", channel: "imessage_code" });
}

/** Signed, expiring, single-use link bound to the proposal id and terms hash. */
export async function approveByLink(token: string, sessionUserId: string | null): Promise<ApproveResult> {
  const claims = await consumeSignedLink(token, "approve");
  if (!claims?.pid || !claims.th) return { ok: false, error: "This approval link is invalid, expired, or was already used.", code: "invalid" };
  if (sessionUserId && sessionUserId !== claims.sub) return { ok: false, error: "This link belongs to a different account.", code: "invalid" };
  return approveProposal({ userId: claims.sub, proposalId: claims.pid, termsHash: claims.th, channel: "imessage_link" });
}

export async function rejectProposal(userId: string, proposalId: string, channel: ApprovalChannel | "chat"): Promise<boolean> {
  const db = await getDb();
  const p = await getProposal(userId, proposalId);
  if (!p || !["pending", "awaiting_link"].includes(p.status)) return false;
  await db
    .update(schema.tradeProposals)
    .set({ status: "rejected", decidedAt: new Date(), updatedAt: new Date(), approvalCodeHash: null })
    .where(eq(schema.tradeProposals.id, p.id));
  await db.insert(schema.approvals).values({ proposalId: p.id, userId, proposalVersion: p.version, termsHash: p.termsHash ?? "", decision: "rejected", channel });
  await audit({ userId, actor: "user", action: "proposal.rejected", refType: "proposal", refId: p.id, details: { channel } });
  return true;
}

export async function expireStaleProposals(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .update(schema.tradeProposals)
    .set({ status: "expired", updatedAt: new Date(), approvalCodeHash: null })
    .where(and(inArray(schema.tradeProposals.status, ["pending", "awaiting_link"]), lt(schema.tradeProposals.expiresAt, new Date())))
    .returning({ id: schema.tradeProposals.id, userId: schema.tradeProposals.userId });
  for (const r of rows) await audit({ userId: r.userId, actor: "system", action: "proposal.expired", refType: "proposal", refId: r.id });
  return rows.length;
}

export async function recentRecommendations(userId: string, limit = 20): Promise<Proposal[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.tradeProposals)
    .where(and(eq(schema.tradeProposals.userId, userId), ne(schema.tradeProposals.status, "superseded")))
    .orderBy(desc(schema.tradeProposals.createdAt))
    .limit(limit);
}
