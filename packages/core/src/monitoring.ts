import type { MonitorEvent, Position, TradeProposal, User } from "@mayflower/shared";
import { contentHash, newId, proposalBindingFields } from "@mayflower/shared";
import { monitorPosition } from "@mayflower/agents";
import { sizePosition } from "@mayflower/risk";
import type { Container } from "./container.js";
import { PROPOSAL_TTL_MS, userExchangeAuth } from "./proposals.js";
import { refreshPositions } from "./portfolio.js";

/**
 * Monitor every open position for a user. Produces MonitorEvents and, for
 * actionable recommendations, a NEW proposal that requires fresh approval.
 * Never executes anything.
 */
export async function monitorUser(c: Container, user: User): Promise<MonitorEvent[]> {
  if (user.riskLimits.paused) return [];
  const positions = (await refreshPositions(c, user)).filter((p) => p.status === "open" && p.quantity > 0);
  const exchange = c.exchangeFor(await userExchangeAuth(c, user.id));
  const events: MonitorEvent[] = [];
  for (const pos of positions) {
    try {
      const market = (await c.repo.getMarket(pos.marketId)) ?? (await exchange.getMarket(pos.marketId));
      if (!market) continue;
      const quote = await exchange.getQuote(pos.marketId);
      const report = pos.latestReportId ? await c.repo.getReport(pos.latestReportId) : null;
      const r = await monitorPosition({ llm: c.llm, research: c.research }, { position: pos, market, quote, report });
      if (!r.assessment.notable && r.assessment.recommendation === "hold") continue;
      let proposal: TradeProposal | null = null;
      if (r.assessment.recommendation === "reduce" || r.assessment.recommendation === "close") proposal = await proposeReduction(c, user, pos, r.assessment.recommendation, r.assessment.summary, quote.yesBid, quote.yesAsk);
      const ev: MonitorEvent = { id: newId(), userId: user.id, positionId: pos.id, marketId: pos.marketId, trigger: r.trigger, summary: r.assessment.summary, evidence: r.evidence, recommendation: r.assessment.recommendation, proposalId: proposal?.id ?? null, notified: false, createdAt: new Date().toISOString() };
      await c.repo.saveMonitorEvent(ev);
      await c.repo.audit({ userId: user.id, actor: "agent", action: "monitor.recommendation", refType: "position", refId: pos.id, payload: { recommendation: ev.recommendation, proposalId: ev.proposalId } });
      events.push(ev);
    } catch (e) { console.warn(`[monitor] failed for ${pos.marketId}:`, (e as Error).message); }
  }
  return events;
}

async function proposeReduction(c: Container, user: User, pos: Position, kind: "reduce" | "close", summary: string, yesBid: number | null, yesAsk: number | null): Promise<TradeProposal | null> {
  // Selling YES hits the YES bid; selling NO hits (1 - yesAsk).
  const price = pos.side === "YES" ? yesBid : yesAsk == null ? null : 1 - yesAsk;
  if (price == null) return null;
  const qty = kind === "close" ? pos.quantity : Math.max(1, Math.floor(pos.quantity / 2));
  const now = new Date();
  const base = { id: newId(), version: 1, marketId: pos.marketId, side: pos.side, action: "SELL" as const, quantity: qty, limitPrice: Math.round(price * 100) / 100, kind };
  const proposal: TradeProposal = {
    ...base, userId: user.id, researchReportId: pos.latestReportId ?? null,
    risk: { stake: 0, quantity: qty, limitPrice: base.limitPrice, maxLoss: 0, maxGain: Math.round(qty * base.limitPrice * 100) / 100, edge: 0, expectedValue: 0, kellyFraction: user.riskLimits.kellyFraction, fullKelly: 0, budgetUtilisationAfter: 0, themeConcentrationAfter: 0, constraints: [{ name: "monitor", bound: true, detail: kind }], explanation: `Sell ${qty} of ${pos.quantity} contracts at about ${base.limitPrice.toFixed(2)} to ${kind === "close" ? "exit" : "cut"} the position. A limit sell may not fill in a thin market.` },
    discoveryReason: "monitor", summary, status: "pending_approval",
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(),
    bindingHash: contentHash(proposalBindingFields(base)),
  };
  await c.repo.saveProposal(proposal);
  return proposal;
}

export { sizePosition };
