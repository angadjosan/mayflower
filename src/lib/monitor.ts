// Position monitor: refresh prices, re-assess on big moves / near expiry, recommend (never execute) exits.
import crypto from "crypto";
import { tx, load, id, now, audit } from "./db";
import { getMarket } from "./exchange";
import { sendToUser } from "./notify";
import { approvalUrl } from "./execution";
import { recordSnapshot } from "./risk";
import { researchAndForecast } from "./agent/discover";
import type { Market, MonitorEvent, Position, TradeProposal } from "./types";

const MOVE_TRIGGER = 0.08; // 8 points vs entry
const EXIT_MARGIN = 0.05; // sell if our P(side) is this far below the bid
const NEAR_EXPIRY_MS = 48 * 3600 * 1000;
const RECHECK_MS = 6 * 3600 * 1000; // don't re-research the same position more than every 6h

const bidFor = (m: Market, side: Position["side"]) =>
  side === "YES" ? m.yesBid ?? (m.noAsk != null ? 1 - m.noAsk : m.lastPrice) : m.noBid ?? (m.yesAsk != null ? 1 - m.yesAsk : m.lastPrice != null ? 1 - m.lastPrice : undefined);
const pct = (n: number) => `${Math.round(n * 100)}%`;

export async function runMonitor(userId?: string): Promise<MonitorEvent[]> {
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

    const moved = Math.abs(bid - pos.avgEntryPrice) >= MOVE_TRIGGER;
    const nearExpiry = market.expiresAt ? Date.parse(market.expiresAt) - Date.now() < NEAR_EXPIRY_MS : false;
    if (!moved && !nearExpiry) continue;

    const db = load();
    const recent = db.monitorEvents.some((e) => e.positionId === pos.id && Date.now() - Date.parse(e.createdAt) < RECHECK_MS);
    const hasPendingExit = db.proposals.some((p) => p.userId === pos.userId && p.marketId === pos.marketId && p.status === "pending" && p.kind !== "open");
    if (recent || hasPendingExit) continue;

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
  for (const u of users) recordSnapshot(u);
  return events;
}
