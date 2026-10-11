/**
 * Conversation handler: one inbound message → intent → action → reply.
 * Shared by the iMessage webhook, web chat and (later) voice. Approval via
 * text requires an explicit proposal reference; otherwise we send a signed link.
 */
import type { Channel, Message, TradeProposal, User } from "@mayflower/shared";
import { newId, optionalEnv } from "@mayflower/shared";
import { classifyIntent, composeReply } from "@mayflower/agents";
import { signApprovalLink } from "@mayflower/messaging";
import type { Container } from "./container.js";
import { applyProfileMessage } from "./profile.js";
import { discoverForUser, formatProposalForMessage, shortRef } from "./proposals.js";
import { approveAndExecute, ApprovalError, recordDecision } from "./execution.js";
import { portfolioSnapshot } from "./portfolio.js";
import { monitorUser } from "./monitoring.js";

export interface HandleResult { reply: string; actions: string[] }

function findProposal(pending: TradeProposal[], ref: string | null, amount: number | null): TradeProposal | null {
  if (ref) {
    const r = ref.replace(/[^a-z0-9]/gi, "").toUpperCase();
    const hit = pending.find((p) => shortRef(p.id) === r || p.id.toUpperCase().startsWith(r));
    if (hit) return hit;
  }
  if (amount != null) {
    const hit = pending.filter((p) => Math.abs(p.risk.stake - amount) < 0.01);
    if (hit.length === 1) return hit[0]!;
  }
  return pending.length === 1 ? pending[0]! : null;
}

export async function handleUserMessage(c: Container, user: User, text: string, channel: Channel, externalId?: string | null): Promise<HandleResult> {
  const now = new Date().toISOString();
  const inbound: Message = { id: newId(), userId: user.id, role: "user", channel, text, externalId: externalId ?? null, createdAt: now };
  await c.repo.saveMessage(inbound);
  const pending = await c.repo.listProposals(user.id, ["pending_approval"]);
  const titles = new Map<string, string>();
  for (const p of pending) titles.set(p.id, (await c.repo.getMarket(p.marketId))?.title ?? p.marketId);
  const intent = await classifyIntent(c.llm, text, { pendingProposals: pending.map((p) => ({ id: shortRef(p.id), short: shortRef(p.id), stake: p.risk.stake, title: titles.get(p.id) ?? "" })) });
  const actions: string[] = [intent.intent];
  let facts = "";
  const appBase = optionalEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000")!;
  const linkSecret = optionalEnv("MAYFLOWER_APPROVAL_SECRET", "dev-approval-secret")!;

  switch (intent.intent) {
    case "onboard_or_update_profile": {
      const r = await applyProfileMessage(c, user, text);
      const fresh = (await c.repo.getUser(user.id)) ?? user;
      facts = `Profile saved. ${r.summary}`;
      if (fresh.riskLimits.totalBudget > 0 && r.theses.length) {
        const { proposals, noTrades } = await discoverForUser(c, fresh, { max: 3 });
        actions.push(`discovered:${proposals.length}`);
        facts += proposals.length ? `\nNew ideas:\n${proposals.map((p) => formatProposalForMessage(p, titles.get(p.id) ?? p.marketId)).join("\n\n")}` : `\nI looked at ${noTrades.length} markets and none cleared the bar right now: ${noTrades.map((n) => `${n.market.title} (${n.noTradeReason})`).join("; ")}`;
        for (const p of proposals) titles.set(p.id, (await c.repo.getMarket(p.marketId))?.title ?? p.marketId);
        if (proposals.length) return finish(c, user, channel, proposals.map((p) => formatProposalForMessage(p, titles.get(p.id)!)).join("\n\n"), actions, facts);
      }
      break;
    }
    case "find_opportunities": {
      const { proposals, noTrades } = await discoverForUser(c, user, { max: 3 });
      actions.push(`discovered:${proposals.length}`);
      for (const p of proposals) titles.set(p.id, (await c.repo.getMarket(p.marketId))?.title ?? p.marketId);
      if (proposals.length) return finish(c, user, channel, proposals.map((p) => formatProposalForMessage(p, titles.get(p.id)!)).join("\n\n"), actions, "");
      facts = noTrades.length ? `No trade recommended. Markets reviewed: ${noTrades.map((n) => `${n.market.title} — ${n.noTradeReason}`).join("; ")}` : "No open markets matched. Try broadening interests or check that the exchange is reachable.";
      break;
    }
    case "approve": {
      const p = findProposal(pending, intent.proposalRef, intent.amount);
      if (!p) { facts = pending.length ? `Ambiguous approval. Pending: ${pending.map((x) => `${shortRef(x.id)} ($${x.risk.stake} on ${titles.get(x.id)})`).join("; ")}. Ask the user to name one.` : "Nothing is pending approval."; break; }
      if (intent.confidence < 0.8 || channel === "voice") {
        const token = signApprovalLink({ proposalId: p.id, version: p.version, bindingHash: p.bindingHash, userId: user.id, exp: Math.floor(Date.now() / 1000) + 900 }, linkSecret);
        facts = `To be safe, confirm this exact order here (expires in 15 min): ${appBase}/approve/${token}`;
        break;
      }
      try {
        const { order } = await approveAndExecute(c, { userId: user.id, proposalId: p.id, version: p.version, channel, evidence: text });
        actions.push(`order:${order.status}`);
        const label = order.mode === "simulated" ? "SIMULATED" : order.mode === "sandbox" ? "Gemini sandbox" : "Gemini";
        facts = order.status === "error" ? `Order could not be placed (${label}): ${order.error}` : `Order sent to ${label}. Exchange status: ${order.status}${order.exchangeOrderId ? ` (id ${order.exchangeOrderId})` : ""}. ${order.status === "filled" ? "It is filled." : "I will tell you when it fills; it is not filled yet."}`;
      } catch (e) { facts = e instanceof ApprovalError ? e.message : `Could not approve: ${(e as Error).message}`; }
      break;
    }
    case "reject": {
      const p = findProposal(pending, intent.proposalRef, intent.amount);
      if (!p) { facts = "Nothing matching to skip."; break; }
      try { await recordDecision(c, { userId: user.id, proposalId: p.id, version: p.version, decision: "rejected", channel, evidence: text }); facts = `Skipped ${titles.get(p.id)}. I won't place it.`; } catch (e) { facts = (e as Error).message; }
      break;
    }
    case "ask_why": {
      const p = findProposal(pending, intent.proposalRef, intent.amount) ?? pending[0] ?? null;
      if (!p) { facts = "No proposal to explain. Ask me to find opportunities."; break; }
      const report = p.researchReportId ? await c.repo.getReport(p.researchReportId) : null;
      facts = [
        `Proposal ${shortRef(p.id)}: ${titles.get(p.id)}`,
        report ? `What must happen: ${report.whatMustHappen}` : "",
        report ? `Thesis: ${report.thesis}` : "",
        report ? `For: ${report.evidenceFor.join(" | ")}` : "",
        report ? `Against: ${report.evidenceAgainst.join(" | ")}` : "",
        report ? `Estimate ${(report.estimatedProbability * 100).toFixed(0)}% ±${(report.uncertainty * 100).toFixed(0)} vs market ${report.marketProbability == null ? "?" : (report.marketProbability * 100).toFixed(0) + "%"}` : "",
        `Sizing: ${p.risk.explanation}`,
        report?.citations.length ? `Sources: ${report.citations.slice(0, 3).map((s) => s.url).join(" ")}` : "",
        `Full detail: ${appBase}/proposals/${p.id}`,
      ].filter(Boolean).join("\n");
      break;
    }
    case "portfolio_status": {
      const s = await portfolioSnapshot(c, user);
      facts = `Open positions: ${s.positions.filter((p) => p.status === "open").length}. Invested $${s.pnl.invested.toFixed(2)}, unrealized P&L $${s.pnl.unrealized.toFixed(2)}, realized $${s.pnl.realized.toFixed(2)}. ${s.exposure.explanation} Available exchange balance: ${s.availableBalance == null ? "not linked" : "$" + s.availableBalance.toFixed(2)}. Sharpe: ${s.sharpe.reason}. Dashboard: ${appBase}/`;
      break;
    }
    case "what_changed": {
      const evs = await monitorUser(c, user);
      facts = evs.length ? evs.map((e) => `${e.marketId}: ${e.summary} → recommend ${e.recommendation}${e.proposalId ? ` (proposal ${shortRef(e.proposalId)} awaiting your approval)` : ""}`).join("\n") : "Nothing notable changed on your open positions.";
      break;
    }
    case "close_or_reduce": {
      const evs = await monitorUser(c, user);
      facts = `Any sell needs your approval. ${evs.filter((e) => e.proposalId).length ? "Proposed: " + evs.filter((e) => e.proposalId).map((e) => `${shortRef(e.proposalId!)} ${e.recommendation} ${e.marketId}`).join("; ") : "Tell me which position (or 'sell half of X') and I'll draft the exact order for approval."}`;
      break;
    }
    case "pause": await c.repo.updateRiskLimits(user.id, { ...user.riskLimits, paused: true }); facts = "Paused. I won't propose or place anything until you say resume."; break;
    case "resume": await c.repo.updateRiskLimits(user.id, { ...user.riskLimits, paused: false }); facts = "Resumed."; break;
    case "request_research": facts = `Research request noted for "${intent.topic ?? text}". Say "find opportunities" to have me search markets about it.`; break;
    default: facts = pending.length ? `There are ${pending.length} proposals awaiting a decision: ${pending.map((p) => `${shortRef(p.id)} $${p.risk.stake} ${titles.get(p.id)}`).join("; ")}. The user can approve by naming one.` : "No pending proposals. Offer to learn their interests or find opportunities.";
  }
  const reply = await composeReply(c.llm, facts, text);
  return finish(c, user, channel, reply, actions, facts);
}

async function finish(c: Container, user: User, channel: Channel, reply: string, actions: string[], _facts: string): Promise<HandleResult> {
  await c.repo.saveMessage({ id: newId(), userId: user.id, role: "assistant", channel, text: reply, createdAt: new Date().toISOString() });
  return { reply, actions };
}
