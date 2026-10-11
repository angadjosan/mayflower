// Position monitor: refresh prices, re-assess on big moves / near expiry, recommend (never execute) exits.
import crypto from "crypto";
import { tx, load, id, now, audit } from "./db";
import { getMarket } from "./exchange";
import { sendToUser } from "./notify";
import { approvalUrl } from "./execution";
import { recordSnapshot, exitLevels, concentrationReport } from "./risk";
import { scoreSettledMarkets } from "./calibration";
import { researchAndForecast } from "./agent/discover";
import type { Market, MonitorEvent, Position, TradeProposal } from "./types";

const MOVE_TRIGGER = 0.08; // 8 points vs entry
const EXIT_MARGIN = 0.05; // sell if our P(side) is this far below the bid
const NEAR_EXPIRY_MS = 48 * 3600 * 1000;
const RECHECK_MS = 6 * 3600 * 1000; // don't re-research the same position more than every 6h

const bidFor = (m: Market, side: Position["side"]) =>
  side === "YES" ? m.yesBid ?? (m.noAsk != null ? 1 - m.noAsk : m.lastPrice) : m.noBid ?? (m.yesAsk != null ? 1 - m.yesAsk : m.lastPrice != null ? 1 - m.lastPrice : undefined);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const DAY_MS = 24 * 3600 * 1000;
const isExit = (p: TradeProposal) => p.kind === "close" || p.kind === "reduce";

/** Mark pending proposals past their expiry as "expired". Returns how many changed. */
export function expireProposals(): number {
  const t = Date.now();
  const expired = tx((db) => {
    const hit = db.proposals.filter((p) => p.status === "pending" && Date.parse(p.expiresAt) < t);
    for (const p of hit) p.status = "expired";
    return hit.map((p) => ({ id: p.id, userId: p.userId }));
  });
  for (const e of expired) audit({ userId: e.userId, actor: "system", action: "proposal.expired", ref: e.id });
  return expired.length;
}

function hasPendingExit(positionUserId: string, marketId: string) {
  return load().proposals.some((p) => p.userId === positionUserId && p.marketId === marketId && p.status === "pending" && isExit(p));
}

/** Create a pending sell (close/reduce) proposal + MonitorEvent and alert the user. Never executes anything. */
async function recommendExit(a: {
  pos: Position; market: Market; bid: number; recommendation: "close" | "reduce"; quantity: number;
  trigger: string; explanation: string; researchId: string; estimatedProbability: number; thesis: string; riskNote?: string;
}): Promise<MonitorEvent> {
  const { pos, market, bid, recommendation, quantity: qty } = a;
  const proceeds = +(qty * bid).toFixed(2);
  const proposal: TradeProposal = {
    id: id("prop_"), userId: pos.userId, marketId: market.id, market, researchId: a.researchId,
    kind: recommendation, discovery: "monitor", side: pos.side, quantity: qty, limitPrice: bid, costUsd: proceeds,
    marketProbability: bid, estimatedProbability: a.estimatedProbability, edge: +(bid - a.estimatedProbability).toFixed(4),
    thesis: a.thesis, sizingExplanation: `Selling ${qty} of ${pos.quantity} contracts at $${bid.toFixed(2)} each locks in ~$${proceeds} instead of holding to resolution.`,
    riskNotes: [a.riskNote, "Price alerts are not guaranteed stops; fills can slip in thin markets.", market.source === "mock" ? "Mock market data." : ""].filter(Boolean).join(" "),
    status: "pending", approvalToken: crypto.randomBytes(16).toString("hex"),
    createdAt: now(), expiresAt: new Date(Date.now() + DAY_MS).toISOString(), version: 1,
  };
  const ev: MonitorEvent = { id: id("mon_"), userId: pos.userId, positionId: pos.id, trigger: a.trigger, recommendation, explanation: a.explanation, proposalId: proposal.id, createdAt: now() };
  tx((d) => {
    d.proposals.push(proposal);
    d.monitorEvents.push(ev);
    const p = d.positions.find((x) => x.id === pos.id);
    if (p) p.latestAssessment = a.explanation;
  });
  audit({ userId: pos.userId, actor: "agent", action: "monitor.recommend", ref: proposal.id, detail: { positionId: pos.id, recommendation, trigger: a.trigger, bid } });
  try { await sendToUser(pos.userId, `${a.explanation}\nReview & approve: ${approvalUrl(proposal)}`); } catch { /* delivery best-effort */ }
  return ev;
}

/** Stop / take-profit watch. Returns an event if an exit alert fired. */
async function checkExitWatch(pos: Position, market: Market, bid: number): Promise<MonitorEvent | undefined> {
  let { stopPrice, takeProfitPrice } = pos;
  if (stopPrice == null && takeProfitPrice == null) {
    // Backfill positions opened before exit levels existed (skip hedges: their losses offset the main position).
    if (load().proposals.find((p) => p.id === pos.proposalId)?.kind === "hedge") return undefined;
    const lv = exitLevels(pos.avgEntryPrice);
    ({ stopPrice, takeProfitPrice } = lv);
    tx((d) => {
      const p = d.positions.find((x) => x.id === pos.id);
      if (p) { p.stopPrice = lv.stopPrice; p.takeProfitPrice = lv.takeProfitPrice; p.watchConditions = lv.watchConditions; }
    });
  }
  const stopHit = stopPrice != null && bid <= stopPrice;
  const tpHit = !stopHit && takeProfitPrice != null && bid >= takeProfitPrice;
  if (!stopHit && !tpHit) return undefined;

  const kind = stopHit ? "exit watch" : "take-profit";
  const db = load();
  const alertedRecently = db.monitorEvents.some((e) => e.positionId === pos.id && e.trigger.startsWith(kind) && Date.now() - Date.parse(e.createdAt) < DAY_MS);
  if (alertedRecently || hasPendingExit(pos.userId, pos.marketId)) return undefined;

  const label = market.title || market.eventTitle;
  const origin = db.proposals.find((p) => p.id === pos.proposalId);
  const recommendation: "close" | "reduce" = stopHit || pos.quantity < 2 ? "close" : "reduce";
  const qty = recommendation === "close" ? pos.quantity : Math.max(1, Math.floor(pos.quantity / 2));
  const trigger = stopHit
    ? `exit watch: ${pos.side} price ${pct(bid)} ≤ ${pct(stopPrice!)} alert level`
    : `take-profit: ${pos.side} price ${pct(bid)} ≥ ${pct(takeProfitPrice!)} alert level`;
  const what = recommendation === "close" ? `selling all ${qty} contracts` : `selling half (${qty} contracts)`;
  const explanation = stopHit
    ? `Alert, not an executed stop: ${label} — your ${pos.side} has fallen to ${pct(bid)} (you paid ${pct(pos.avgEntryPrice)}), at or below the ${pct(stopPrice!)} exit level we set. I suggest ${what} for ~$${(qty * bid).toFixed(2)} to limit further losses. Nothing has been sold. Thin markets may not fill at this price, and the price can gap past it.`
    : `Alert, not an executed order: ${label} — your ${pos.side} has risen to ${pct(bid)} (you paid ${pct(pos.avgEntryPrice)}), past the ${pct(takeProfitPrice!)} take-profit level. I suggest ${what} for ~$${(qty * bid).toFixed(2)} to lock in gains. Nothing has been sold. Thin markets may not fill at this price.`;
  return recommendExit({
    pos, market, bid, recommendation, quantity: qty, trigger, explanation,
    researchId: origin?.researchId ?? "", estimatedProbability: origin?.estimatedProbability ?? bid,
    thesis: origin?.thesis ?? explanation,
  });
}

/** At most once per user per day: if concentration limits are breached, suggest reducing the largest correlated position. */
async function checkConcentration(userId: string): Promise<MonitorEvent | undefined> {
  const rep = concentrationReport(userId);
  if (!rep.flagged || !rep.rebalanceCandidateId) return undefined;
  const db = load();
  const sentToday = db.monitorEvents.some((e) => e.userId === userId && e.trigger.startsWith("concentration") && Date.now() - Date.parse(e.createdAt) < DAY_MS);
  if (sentToday) return undefined;
  const pos = db.positions.find((p) => p.id === rep.rebalanceCandidateId && p.status === "open");
  if (!pos || hasPendingExit(userId, pos.marketId)) return undefined;
  const market = pos.market;
  const bid = pos.currentPrice ?? bidFor(market, pos.side);
  if (bid == null || bid <= 0) return undefined;
  const recommendation: "close" | "reduce" = pos.quantity < 2 ? "close" : "reduce";
  const qty = recommendation === "close" ? pos.quantity : Math.max(1, Math.floor(pos.quantity / 2));
  const f = rep.flags[0];
  const trigger = `concentration: ${f.kind} "${f.label}" is ${pct(f.pct)} of at-risk (limit ${pct(f.limit)})`;
  const explanation = `Rebalancing suggestion: ${rep.explanation} The largest position there is "${market.title || market.eventTitle}" (${pos.quantity} ${pos.side}). I suggest ${recommendation === "close" ? "closing it" : `selling half (${qty} contracts)`} for ~$${(qty * bid).toFixed(2)}. This is only a suggestion; nothing is sold without your approval, and thin markets may not fill at this price.`;
  const origin = db.proposals.find((p) => p.id === pos.proposalId);
  return recommendExit({
    pos, market, bid, recommendation, quantity: qty, trigger, explanation,
    researchId: origin?.researchId ?? "", estimatedProbability: origin?.estimatedProbability ?? bid,
    thesis: origin?.thesis ?? explanation, riskNote: "Suggested to reduce concentration, not because the forecast changed.",
  });
}

export async function runMonitor(userId?: string): Promise<MonitorEvent[]> {
  expireProposals();
  const db0 = load();
  const positions = db0.positions.filter((p) => p.status === "open" && (!userId || p.userId === userId));
  const events: MonitorEvent[] = [];

  for (const pos of positions) {
    let market: Market | undefined;
    try { market = await getMarket(pos.marketId); } catch { /* keep stale */ }
    if (!market) continue;
    const bid = bidFor(market, pos.side);
    tx((db) => {
      const p = db.positions.find((x) => x.id === pos.id);
      if (p) { p.market = market!; if (bid != null) p.currentPrice = bid; p.updatedAt = now(); }
    });
    if (bid == null) continue;

    try {
      const exitEv = await checkExitWatch(pos, market, bid);
      if (exitEv) { events.push(exitEv); continue; }
    } catch (e) {
      console.warn("[monitor] exit watch failed", pos.id, (e as Error).message);
    }

    const moved = Math.abs(bid - pos.avgEntryPrice) >= MOVE_TRIGGER;
    const nearExpiry = market.expiresAt ? Date.parse(market.expiresAt) - Date.now() < NEAR_EXPIRY_MS : false;
    if (!moved && !nearExpiry) continue;

    const db = load();
    const recent = db.monitorEvents.some((e) => e.positionId === pos.id && Date.now() - Date.parse(e.createdAt) < RECHECK_MS);
    const pendingExit = db.proposals.some((p) => p.userId === pos.userId && p.marketId === pos.marketId && p.status === "pending" && isExit(p));
    if (recent || pendingExit) continue;

    const trigger = [moved ? `price moved ${pct(pos.avgEntryPrice)} → ${pct(bid)}` : "", nearExpiry ? "market expires within 48h" : ""].filter(Boolean).join("; ");
    const report = await researchAndForecast(market, pos.userId);
    const pSide = pos.side === "YES" ? report.estimatedProbability : 1 - report.estimatedProbability;
    const label = market.title || market.eventTitle;

    let ev: MonitorEvent;
    if (pSide < bid - EXIT_MARGIN) {
      const recommendation: "close" | "reduce" = pSide < bid - 2 * EXIT_MARGIN || nearExpiry || pos.quantity < 2 ? "close" : "reduce";
      const qty = recommendation === "close" ? pos.quantity : Math.max(1, Math.floor(pos.quantity / 2));
      const proceeds = +(qty * bid).toFixed(2);
      const explanation = `${label}: ${trigger}. My updated estimate for ${pos.side} is ${pct(pSide)}, below the ${pct(bid)} you could sell at, so I suggest ${recommendation === "close" ? "closing" : "selling half"} (${qty} contracts, ~$${proceeds}). Sells may not fill at this price in thin markets.`;
      const proposal: TradeProposal = {
        id: id("prop_"), userId: pos.userId, marketId: market.id, market, researchId: report.id,
        kind: recommendation, discovery: "monitor", side: pos.side, quantity: qty, limitPrice: bid, costUsd: proceeds,
        marketProbability: bid, estimatedProbability: pSide, edge: +(bid - pSide).toFixed(4),
        thesis: report.summary, sizingExplanation: `Selling ${qty} of ${pos.quantity} contracts at $${bid.toFixed(2)} each locks in ~$${proceeds} instead of holding to resolution.`,
        riskNotes: [report.criticNotes, "Price alerts are not guaranteed stops; fills can slip in thin markets.", market.source === "mock" ? "Mock market data." : ""].filter(Boolean).join(" "),
        status: "pending", approvalToken: crypto.randomBytes(16).toString("hex"),
        createdAt: now(), expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), version: 1,
      };
      ev = { id: id("mon_"), userId: pos.userId, positionId: pos.id, trigger, recommendation, explanation, proposalId: proposal.id, createdAt: now() };
      tx((d) => {
        d.proposals.push(proposal);
        d.monitorEvents.push(ev);
        const p = d.positions.find((x) => x.id === pos.id);
        if (p) p.latestAssessment = explanation;
      });
      audit({ userId: pos.userId, actor: "agent", action: "monitor.recommend", ref: proposal.id, detail: { positionId: pos.id, recommendation, pSide, bid } });
      try { await sendToUser(pos.userId, `${explanation}\nReview & approve: ${approvalUrl(proposal)}`); } catch { /* delivery best-effort */ }
    } else {
      const explanation = `${label}: ${trigger}. Re-checked — my estimate for ${pos.side} is ${pct(pSide)} vs ${pct(bid)} bid, so holding still looks reasonable.`;
      ev = { id: id("mon_"), userId: pos.userId, positionId: pos.id, trigger, recommendation: "hold", explanation, createdAt: now() };
      tx((d) => {
        d.monitorEvents.push(ev);
        const p = d.positions.find((x) => x.id === pos.id);
        if (p) p.latestAssessment = explanation;
      });
      audit({ userId: pos.userId, actor: "agent", action: "monitor.hold", ref: pos.id, detail: { pSide, bid } });
    }
    events.push(ev);
  }

  const users = userId ? [userId] : [...new Set(load().users.map((u) => u.id))];
  for (const u of users) {
    try {
      const ev = await checkConcentration(u);
      if (ev) events.push(ev);
    } catch (e) {
      console.warn("[monitor] concentration check failed", u, (e as Error).message);
    }
    recordSnapshot(u);
  }
  try { await scoreSettledMarkets(); } catch (e) { console.warn("[monitor] calibration scoring failed", (e as Error).message); }
  return events;
}
