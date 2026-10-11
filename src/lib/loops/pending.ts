// Loop B: keep pending trade ideas honest. Re-research every pending "open" proposal (fresh search + full pages)
// at most every 10 min; withdraw it if the edge is gone, re-issue a new version if the numbers moved materially.
import crypto from "crypto";
import { load, tx, id, now, audit } from "../db";
import { llmEnabled } from "../llm";
import { getMarket, getBalance, venueOf } from "../exchange";
import { approvalUrl } from "../execution";
import { MIN_EDGE } from "../risk";
import { researchAndForecast, buildOpenProposal, yesAsk, noAsk } from "../agent/discover";
import { auditLoop, label, notify, pct, textable, firstSentence, mapLimit } from "./shared";
import type { Market, ResearchReport, TradeProposal } from "../types";

export const PENDING_RECHECK_MS = 10 * 60 * 1000;
const MAX_PER_RUN = 10;
const MATERIAL_MOVE = 0.05; // 5 points in our probability or the price

export interface PendingOutcome {
  proposalId: string;
  userId: string;
  marketId: string;
  action: "unchanged" | "withdrawn" | "revised" | "skipped";
  detail: string;
  newProposalId?: string;
  text?: string;
}
export interface PendingResult { ran: boolean; checked: number; outcomes: PendingOutcome[]; error?: string }

export async function refreshPendingProposals(): Promise<PendingResult> {
  const out: PendingResult = { ran: false, checked: 0, outcomes: [] };
  try {
    if (!llmEnabled) return out; // the heuristic fallback forecast would just add noise
    const db0 = await load();
    const t = Date.now();
    const due = db0.proposals
      // Group/contest entries are referenced by id from the group's records, so they aren't re-versioned here.
      .filter((p) => p.status === "pending" && p.kind === "open" && !p.groupId && !p.contestId && Date.parse(p.expiresAt) > t)
      .filter((p) => textable(db0.users.find((u) => u.id === p.userId)))
      .filter((p) => t - Date.parse(p.lastResearchedAt ?? p.createdAt) >= PENDING_RECHECK_MS)
      .sort((a, b) => Date.parse(a.lastResearchedAt ?? a.createdAt) - Date.parse(b.lastResearchedAt ?? b.createdAt))
      .slice(0, MAX_PER_RUN);
    if (!due.length) return out;
    out.ran = true;
    out.checked = due.length;

    // One fresh market quote + one research report per market, shared by every user pending on it.
    const marketIds = [...new Set(due.map((p) => p.marketId))];
    const fresh = new Map<string, { market?: Market; report?: ResearchReport; error?: string }>();
    await mapLimit(marketIds, 3, async (mid) => {
      const snapshot = due.find((p) => p.marketId === mid)!.market;
      try {
        const market = (await getMarket(mid).catch(() => undefined)) ?? snapshot;
        const report = await researchAndForecast(market, undefined, { readPages: true, freshness: "last_week" });
        fresh.set(mid, { market, report });
      } catch (e) {
        fresh.set(mid, { error: (e as Error).message });
      }
    });

    for (const p of due) {
      try {
        out.outcomes.push(await reassess(p, fresh.get(p.marketId)));
      } catch (e) {
        out.outcomes.push({ proposalId: p.id, userId: p.userId, marketId: p.marketId, action: "skipped", detail: `error: ${(e as Error).message}` });
      }
    }
    return out;
  } catch (e) {
    out.error = (e as Error).message;
    console.warn("[pending] refresh failed:", out.error);
    return out;
  } finally {
    await auditLoop("pending", {
      error: out.error, checked: out.checked,
      outcomes: out.outcomes.map((o) => ({ id: o.proposalId, action: o.action, newId: o.newProposalId })),
    }, out.ran);
  }
}

async function reassess(p: TradeProposal, f?: { market?: Market; report?: ResearchReport; error?: string }): Promise<PendingOutcome> {
  const base = { proposalId: p.id, userId: p.userId, marketId: p.marketId };
  if (!f?.market || !f.report) return { ...base, action: "skipped", detail: `research failed: ${f?.error ?? "unknown"}` };
  const { market, report } = f;
  const name = label(market);

  // Same side as the original idea: we're re-checking THIS proposal, not flipping it.
  const price = p.side === "YES" ? yesAsk(market) : noAsk(market);
  const pSide = p.side === "YES" ? report.estimatedProbability : 1 - report.estimatedProbability;
  const edge = pSide - price;
  const closed = market.status === "closed" || market.status === "settled";
  const pMove = Math.abs(pSide - p.estimatedProbability), priceMove = Math.abs(price - p.limitPrice);

  // 1. Edge collapsed (or the market closed): withdraw.
  if (closed || edge < MIN_EDGE) {
    const why = closed
      ? "the market is no longer open"
      : `${p.side} now costs ${pct(price)} and my updated estimate is ${pct(pSide)}, so there's no edge left (was ${pct(p.estimatedProbability)} vs ${pct(p.limitPrice)})`;
    const reason = `${why}. ${firstSentence(report.summary)}`.trim();
    const ok = await tx((d) => {
      const x = d.proposals.find((y) => y.id === p.id);
      if (!x || x.status !== "pending") return false;
      x.status = "expired";
      x.statusReason = `withdrawn: ${reason}`;
      x.lastResearchedAt = now();
      return true;
    });
    if (!ok) return { ...base, action: "skipped", detail: "no longer pending (approved/rejected meanwhile)" };
    await audit({ userId: p.userId, actor: "agent", action: "proposal.withdrawn", ref: p.id, detail: { pSide, price, edge, researchId: report.id } });
    const text = `Withdrawing my ${name} idea (${p.side} at $${p.limitPrice.toFixed(2)}) because ${reason} That approval link won't work anymore.`;
    await notify(p.userId, text);
    return { ...base, action: "withdrawn", detail: reason, text };
  }

  // 2. Material move: re-issue as a new version (new id + token), expire the old one.
  if (pMove >= MATERIAL_MOVE || priceMove >= MATERIAL_MOVE) {
    const db = await load();
    const user = db.users.find((u) => u.id === p.userId);
    if (!user) return { ...base, action: "skipped", detail: "user missing" };
    const availableUsd = await getBalance(venueOf(market), user.id).then((b) => b.availableUsd).catch(() => Infinity);
    const built = buildOpenProposal({
      db, user, market, report, discovery: p.discovery, availableUsd, forceSide: p.side, ignorePendingIds: [p.id],
    });
    if ("blockedReason" in built) {
      // Sizing says no trade any more (limits/balance): treat like a withdrawal.
      const reason = built.blockedReason;
      const ok = await tx((d) => {
        const x = d.proposals.find((y) => y.id === p.id);
        if (!x || x.status !== "pending") return false;
        x.status = "expired"; x.statusReason = `withdrawn: ${reason}`; x.lastResearchedAt = now();
        return true;
      });
      if (!ok) return { ...base, action: "skipped", detail: "no longer pending" };
      await audit({ userId: p.userId, actor: "agent", action: "proposal.withdrawn", ref: p.id, detail: { reason } });
      const text = `Withdrawing my ${name} idea because the numbers changed: ${reason}`;
      await notify(p.userId, text);
      return { ...base, action: "withdrawn", detail: reason, text };
    }
    const next: TradeProposal = {
      ...built.proposal,
      id: id("prop_"), approvalToken: crypto.randomBytes(16).toString("hex"),
      version: (p.version ?? 1) + 1, supersedesId: p.id, loop: p.loop ?? "pending",
      lastResearchedAt: now(),
    };
    const ok = await tx((d) => {
      const x = d.proposals.find((y) => y.id === p.id);
      if (!x || x.status !== "pending") return false;
      x.status = "expired";
      x.statusReason = `superseded by v${next.version} (${next.id})`;
      x.supersededById = next.id;
      x.lastResearchedAt = now();
      d.proposals.push(next);
      return true;
    });
    if (!ok) return { ...base, action: "skipped", detail: "no longer pending" };
    await audit({ userId: p.userId, actor: "agent", action: "proposal.revised", ref: next.id, detail: { from: p.id, version: next.version, pSide, price, quantity: next.quantity, costUsd: next.costUsd } });
    const text = [
      `Update on ${name}: price ${pct(p.limitPrice)} → ${pct(price)}, my estimate ${pct(p.estimatedProbability)} → ${pct(pSide)} for ${p.side}.`,
      `Still worth it: ${next.quantity} contracts at $${price.toFixed(2)}, risk $${next.costUsd.toFixed(2)}.`,
      `What changed: ${firstSentence(report.summary)}`,
      `New approval link (the old one is retired): ${approvalUrl(next)}`,
    ].join("\n");
    await notify(p.userId, text);
    return { ...base, action: "revised", detail: `p ${pct(p.estimatedProbability)}→${pct(pSide)}, price ${pct(p.limitPrice)}→${pct(price)}`, newProposalId: next.id, text };
  }

  // 3. Nothing material: just note that we looked.
  await tx((d) => {
    const x = d.proposals.find((y) => y.id === p.id);
    if (x && x.status === "pending") x.lastResearchedAt = now();
  });
  return { ...base, action: "unchanged", detail: `p ${pct(pSide)} vs price ${pct(price)} (edge ${pct(edge)})` };
}
