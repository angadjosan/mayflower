import type { Position, TradeProposal, User } from "@mayflower/shared";
import { contentHash, newId, proposalBindingFields } from "@mayflower/shared";
import { runDiscoveryPipeline, type Opportunity } from "@mayflower/agents";
import { decryptSecret } from "@mayflower/db";
import type { GeminiAuth } from "@mayflower/gemini-markets";
import type { Container } from "./container.js";

export const PROPOSAL_TTL_MS = 6 * 60 * 60 * 1000;

export async function userExchangeAuth(c: Container, userId: string): Promise<GeminiAuth | null> {
  const conn = await c.repo.getExchangeConnection(userId);
  if (!conn || conn.status !== "active" || !conn.encryptedCredentials) return null;
  try { return JSON.parse(decryptSecret(conn.encryptedCredentials)) as GeminiAuth; } catch { return null; }
}

export async function loadPipelineUser(c: Container, user: User) {
  const [theses, positions] = await Promise.all([c.repo.listTheses(user.id), c.repo.listPositions(user.id)]);
  const exchange = c.exchangeFor(await userExchangeAuth(c, user.id));
  let availableBalance: number | null = null;
  try { availableBalance = (await exchange.getBalances()).find((b) => b.currency === "USD")?.available ?? null; } catch { /* not linked yet */ }
  return { pipelineUser: { id: user.id, theses, limits: user.riskLimits, positions: positions as Position[], availableBalance }, exchange };
}

/** Turn a pipeline opportunity into a persisted proposal awaiting approval. */
export async function persistOpportunity(c: Container, user: User, opp: Opportunity): Promise<TradeProposal | null> {
  await c.repo.upsertMarket(opp.market);
  await c.repo.saveQuote(opp.quote);
  await c.repo.saveReport(opp.report);
  if (!opp.recommendation) {
    await c.repo.audit({ userId: user.id, actor: "agent", action: "discovery.no_trade", refType: "market", refId: opp.market.id, payload: { reason: opp.noTradeReason } });
    return null;
  }
  const now = new Date();
  const base = { id: newId(), version: 1, marketId: opp.market.id, side: opp.recommendation.side, action: "BUY" as const, quantity: opp.recommendation.risk.quantity, limitPrice: opp.recommendation.risk.limitPrice, kind: "open" as const };
  const proposal: TradeProposal = {
    ...base,
    userId: user.id,
    researchReportId: opp.report.id,
    risk: opp.recommendation.risk,
    discoveryReason: opp.discovery.discoveryReason,
    summary: opp.recommendation.summary,
    status: "pending_approval",
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    bindingHash: contentHash(proposalBindingFields(base)),
  };
  await c.repo.saveProposal(proposal);
  await c.repo.audit({ userId: user.id, actor: "agent", action: "proposal.created", refType: "proposal", refId: proposal.id, payload: { marketId: proposal.marketId, stake: proposal.risk.stake } });
  return proposal;
}

/** Discovery run for one user: returns new proposals and the no-trade decisions. */
export async function discoverForUser(c: Container, user: User, opts: { max?: number } = {}): Promise<{ proposals: TradeProposal[]; noTrades: Opportunity[] }> {
  const { pipelineUser, exchange } = await loadPipelineUser(c, user);
  const opps = await runDiscoveryPipeline({ llm: c.llm, exchange, research: c.research }, pipelineUser, opts);
  const proposals: TradeProposal[] = [];
  const noTrades: Opportunity[] = [];
  for (const o of opps) {
    const p = await persistOpportunity(c, user, o);
    if (p) proposals.push(p); else noTrades.push(o);
  }
  return { proposals, noTrades };
}

/** Short human reference like "A1F3" so a user can say "approve A1F3". */
export const shortRef = (id: string) => id.replace(/-/g, "").slice(0, 4).toUpperCase();

export function formatProposalForMessage(p: TradeProposal, marketTitle: string): string {
  const r = p.risk;
  return `${p.discoveryReason === "personalized" ? "Based on your interests" : "Outside your usual topics"}: ${marketTitle}\n` +
    `${p.summary}\n` +
    `If it expires worthless you lose $${r.maxLoss}; if it pays out you gain $${r.maxGain}.\n` +
    `Reply "approve ${shortRef(p.id)}" to place it, "why ${shortRef(p.id)}" for the reasoning, or "skip ${shortRef(p.id)}".`;
}
