import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { critiqueForecast, forecastMarket } from "@mayflower/agents";
import { monitorPlan } from "@mayflower/context";
import { evaluateWatchConditions, findHedges, GROUP_CAP_SHARE, recommendPositionAction, riskCapacity, type WatchTrigger } from "@mayflower/risk";
import { bidFor, formatCents, formatPct, formatUsd, round, type Citation, type MarketContract, type Outcome, type RiskStyle } from "@mayflower/shared";
import { getDb, schema } from "./db/client";
import type { MonitorEvent, Position, PositionAssessment, User } from "./db/schema";
import { audit, logError } from "./audit";
import { describeOrderStatus, reconcileOrders, settlePosition } from "./execution";
import { balanceInfo } from "./gemini-link";
import { llm, marketData, research } from "./integrations";
import { groupOf, refreshContract } from "./markets";
import { openPositions, portfolioOverview, recordSnapshot } from "./portfolio";
import { createProposal, expireStaleProposals } from "./proposals";
import { sendToUser } from "./notify";
import { effectiveLimits, getUser } from "./users";

const NOTIFY_COOLDOWN_MS = 6 * 3600_000;
const PRICE_MOVE_ALERT = 0.08;

interface PositionCheck {
  event: MonitorEvent | null;
  notified: boolean;
}

async function priorCitations(position: Position): Promise<Citation[]> {
  const db = await getDb();
  const [report] = await db
    .select()
    .from(schema.researchReports)
    .where(and(eq(schema.researchReports.symbol, position.symbol), eq(schema.researchReports.userId, position.userId)))
    .orderBy(desc(schema.researchReports.createdAt))
    .limit(1);
  return [...(report?.citations ?? []), ...(position.latestAssessment?.citations ?? [])];
}

function sellQuantity(position: Position, fraction: number, increment: number): number {
  const step = increment > 0 ? increment : 1;
  const raw = Math.floor((position.quantity * fraction) / step) * step;
  return round(Math.min(position.quantity, Math.max(fraction >= 1 ? position.quantity : step, raw)), 8);
}

async function checkPosition(user: User, position: Position, market: MarketContract, opts: { forceResearch?: boolean }): Promise<PositionCheck> {
  const db = await getDb();
  const outcome = position.outcome as Outcome;
  if (market.resolutionSide || market.status === "settled") {
    if (market.resolutionSide) {
      await settlePosition(position.id, market.resolutionSide);
      const won = market.resolutionSide === outcome;
      const [ev] = await db
        .insert(schema.monitorEvents)
        .values({
          userId: user.id,
          positionId: position.id,
          trigger: "settled",
          severity: "high",
          summary: `“${market.label}” resolved ${market.resolutionSide.toUpperCase()}. Your ${outcome.toUpperCase()} position ${won ? `won — payout ${formatUsd(position.quantity)}` : `lost its ${formatUsd(position.costBasis)} cost`}.`,
          recommendation: "hold",
        })
        .returning();
      await sendToUser(user, ev.summary);
      await db.update(schema.monitorEvents).set({ notifiedAt: new Date() }).where(eq(schema.monitorEvents.id, ev.id));
      return { event: ev, notified: true };
    }
    return { event: null, notified: false };
  }

  const exitPrice = bidFor(market.quote, outcome);
  const triggers: WatchTrigger[] = evaluateWatchConditions(position.watchConditions, { heldPrice: exitPrice, expiry: market.expiry });
  const last = position.latestAssessment;
  const reference = last?.exitPrice ?? position.avgPrice;
  const moved = exitPrice !== null && Math.abs(exitPrice - reference) >= PRICE_MOVE_ALERT;
  if (moved && exitPrice !== null) {
    triggers.push({ condition: { kind: "thesis", description: "price move" }, message: `The price of your ${outcome.toUpperCase()} side moved from ${formatCents(reference)} to ${formatCents(exitPrice)}.` });
  }

  // Look for genuinely new evidence since the last check.
  const seen = new Set((await priorCitations(position)).map((c) => c.url));
  const update = await research().search(monitorPlan(market), { market });
  const fresh = update.citations.filter((c) => !seen.has(c.url));

  let heldProbability: number | null = last?.heldProbability ?? (position.thesis?.probability != null ? (outcome === "yes" ? position.thesis.probability : 1 - position.thesis.probability) : null);
  let summary = "No meaningful change.";
  const methods: { forecast: "llm" | "heuristic"; critic: "llm" | "heuristic" } = { forecast: "heuristic", critic: "heuristic" };
  if (fresh.length > 0 || triggers.length > 0 || opts.forceResearch) {
    const all = [...(await priorCitations(position)), ...fresh].slice(-12);
    const model = llm();
    const f = await forecastMarket(market, all, {}, model, logError("monitor-forecast"));
    const crit = await critiqueForecast(market, f, all, model, logError("monitor-critic"));
    heldProbability = outcome === "yes" ? crit.adjustedProbability : round(1 - crit.adjustedProbability, 4);
    methods.forecast = f.method;
    methods.critic = crit.method;
    summary = fresh.length ? `New: ${fresh[0].title}. ${f.thesis}` : f.thesis;
  }

  const limits = effectiveLimits(user);
  const capacity = riskCapacity(limits);
  const groupRows = await db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.userId, user.id), eq(schema.positions.status, "open"), eq(schema.positions.correlationGroup, position.correlationGroup ?? "__none__")));
  const groupShare = capacity > 0 ? groupRows.reduce((s, p) => s + p.costBasis, 0) / capacity : 0;
  const rec = recommendPositionAction({
    heldProbability,
    exitPrice,
    entryPrice: position.avgPrice,
    triggers,
    groupShare,
    groupCapShare: GROUP_CAP_SHARE[limits.riskStyle as RiskStyle],
  });

  const assessment: PositionAssessment = {
    at: new Date().toISOString(),
    heldProbability,
    exitPrice,
    action: rec.action,
    reasons: rec.reasons,
    summary,
    citations: fresh,
  };
  await db.update(schema.positions).set({ latestAssessment: assessment, lastMonitoredAt: new Date(), updatedAt: new Date() }).where(eq(schema.positions.id, position.id));

  const meaningful = rec.action !== "hold" || fresh.length > 0 || triggers.length > 0;
  if (!meaningful) return { event: null, notified: false };

  // Propose (never execute) any adjustment.
  let proposalId: string | null = null;
  let hedgeText: string | null = null;
  const existingPending = await db
    .select()
    .from(schema.tradeProposals)
    .where(and(eq(schema.tradeProposals.relatedPositionId, position.id), inArray(schema.tradeProposals.status, ["pending", "awaiting_link"])))
    .limit(1);
  if ((rec.action === "reduce" || rec.action === "close") && exitPrice !== null && existingPending.length === 0) {
    const qty = sellQuantity(position, rec.fraction, market.increments.quantityIncrement);
    if (qty > 0) {
      const p = await createProposal({
        userId: user.id,
        symbol: position.symbol,
        kind: rec.action,
        discovery: "monitor",
        decision: "trade",
        side: "sell",
        outcome,
        quantity: qty,
        limitPrice: exitPrice,
        maxCost: 0,
        estProbability: heldProbability !== null ? (outcome === "yes" ? heldProbability : 1 - heldProbability) : null,
        marketProbability: null,
        edge: rec.holdEdge,
        expectedValue: null,
        sizing: { kind: "exit", fraction: rec.fraction, exitPrice, proceeds: round(qty * exitPrice, 2), realizedVsCost: round(qty * (exitPrice - position.avgPrice), 2) },
        rationale: {
          title: market.label,
          whatHasToHappen: `Sell ${qty} of your ${round(position.quantity, 2)} ${outcome.toUpperCase()} contracts at ${formatCents(exitPrice)} or better.`,
          whyNow: rec.reasons[0] ?? "Conditions changed.",
          thesis: summary,
          discoveryReason: "Position monitoring",
          sizingSummary: `${rec.action === "close" ? "Close the whole position" : `Sell ${Math.round(rec.fraction * 100)}%`} — about ${formatUsd(qty * exitPrice)} back (${formatUsd(qty * (exitPrice - position.avgPrice), { signed: true })} vs. cost on those contracts).`,
          noTradeReason: null,
          risks: ["The price can move before the order fills; a limit order may not fill at all in a thin market.", "Selling locks in the current result — if the original thesis was right after all, you give up the upside."],
          resolutionRisks: [],
          whatWouldChangeMind: [],
          watchConditions: [],
          hedgeNote: null,
          criticIssues: [],
          method: { ...methods, research: update.provider, marketData: market.source },
          monitor: { reasons: rec.reasons, action: rec.action },
        },
        relatedPositionId: position.id,
        executionMode: position.mode,
      });
      proposalId = p.id;
    }
  } else if (rec.action === "hedge") {
    const candidates = await marketData().getEventContracts(market.eventTicker).catch(() => [] as MarketContract[]);
    const ideas = findHedges(
      { symbol: position.symbol, eventTicker: position.eventTicker, outcome, quantity: position.quantity, avgPrice: position.avgPrice, label: market.label, correlationGroup: position.correlationGroup },
      candidates,
      (m) => groupOf(m),
    );
    const real = ideas.find((i) => i.relationship === "mutually_exclusive");
    hedgeText = real ? `${real.explanation} ${real.caveat}` : "There's no genuinely offsetting contract in the same event, so the cleaner way to cut this concentration is to reduce the position.";
  }

  const severity = rec.severity === "low" && fresh.length > 0 ? "medium" : rec.severity;
  const headline =
    rec.action === "hold"
      ? `Update on “${market.label}”: ${rec.reasons[0] ?? summary}`
      : `Update on “${market.label}”: ${rec.reasons[0] ?? "conditions changed"}.`;
  const [ev] = await db
    .insert(schema.monitorEvents)
    .values({
      userId: user.id,
      positionId: position.id,
      trigger: fresh.length ? "new_evidence" : triggers[0]?.condition.kind ?? "reassessment",
      severity,
      summary: headline,
      recommendation: rec.action,
      evidence: fresh,
      details: { reasons: rec.reasons, heldProbability, exitPrice, hedge: hedgeText, thesis: summary },
      proposalId,
    })
    .returning();
  await audit({ userId: user.id, actor: "agent", action: "monitor.event", refType: "position", refId: position.id, details: { action: rec.action, severity, proposalId } });

  // Selective notifications: only important changes, rate-limited per position.
  const cooled = !position.lastNotifiedAt || Date.now() - position.lastNotifiedAt.getTime() > NOTIFY_COOLDOWN_MS;
  const important = severity !== "low" && (rec.action !== "hold" || fresh.length > 0);
  if (important && (cooled || rec.action === "close") && user.notifyLevel !== "none") {
    const lines = [headline];
    if (heldProbability !== null && exitPrice !== null) lines.push(`Mayflower now estimates ${formatPct(heldProbability)} for your ${outcome.toUpperCase()} side vs. a ${formatCents(exitPrice)} exit price.`);
    if (rec.action === "reduce" || rec.action === "close") lines.push(`I recommend you ${rec.action === "close" ? "close the position" : `sell about ${Math.round(rec.fraction * 100)}%`}. Reply “approve” to review the exact order — nothing is sold without your OK.`);
    else if (rec.action === "hedge") lines.push(hedgeText ?? "");
    else lines.push("I'd keep holding for now.");
    await sendToUser(user, lines.filter(Boolean).join(" "));
    await db.update(schema.monitorEvents).set({ notifiedAt: new Date() }).where(eq(schema.monitorEvents.id, ev.id));
    await db.update(schema.positions).set({ lastNotifiedAt: new Date() }).where(eq(schema.positions.id, position.id));
    return { event: ev, notified: true };
  }
  return { event: ev, notified: false };
}

/** Monitor one user's positions, reconcile their orders, and snapshot the portfolio. */
export async function monitorUser(userId: string, opts: { forceResearch?: boolean; notifyFills?: boolean } = {}): Promise<{ events: MonitorEvent[]; errors: string[] }> {
  const user = await getUser(userId);
  const errors: string[] = [];
  const events: MonitorEvent[] = [];
  const rec = await reconcileOrders(userId);
  if (opts.notifyFills !== false) {
    for (const o of rec.changed) if (["filled", "partially_filled", "cancelled"].includes(o.status)) await sendToUser(user, describeOrderStatus(o));
  }
  for (const pos of await openPositions(userId)) {
    try {
      const fresh = await refreshContract(pos.symbol, pos.eventTicker);
      if (!fresh.contract) {
        errors.push(`${pos.symbol}: ${fresh.error ?? "contract unavailable"}`);
        continue;
      }
      const r = await checkPosition(user, pos, fresh.contract, opts);
      if (r.event) events.push(r.event);
    } catch (err) {
      errors.push(`${pos.symbol}: ${(err as Error).message}`);
    }
  }
  await maybeSnapshot(user);
  return { events, errors };
}

async function maybeSnapshot(user: User): Promise<void> {
  const db = await getDb();
  const [recent] = await db
    .select()
    .from(schema.portfolioSnapshots)
    .where(and(eq(schema.portfolioSnapshots.userId, user.id), gt(schema.portfolioSnapshots.ts, new Date(Date.now() - 30 * 60_000))))
    .limit(1);
  if (recent) return;
  const overview = await portfolioOverview(user, await balanceInfo(user.id));
  await recordSnapshot(user.id, overview);
}

/** Cron entry point: expire stale proposals, then monitor every user with open positions or orders. */
export async function monitorAll(): Promise<{ users: number; events: number; expired: number; errors: string[] }> {
  const db = await getDb();
  const expired = await expireStaleProposals();
  const withPositions = await db.selectDistinct({ userId: schema.positions.userId }).from(schema.positions).where(eq(schema.positions.status, "open"));
  const withOrders = await db
    .selectDistinct({ userId: schema.orders.userId })
    .from(schema.orders)
    .where(inArray(schema.orders.status, ["submitting", "open", "partially_filled", "unknown"]));
  const ids = [...new Set([...withPositions, ...withOrders].map((r) => r.userId))];
  let events = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      const r = await monitorUser(id);
      events += r.events.length;
      errors.push(...r.errors);
    } catch (err) {
      errors.push(`${id}: ${(err as Error).message}`);
    }
  }
  return { users: ids.length, events, expired, errors };
}

export async function recentMonitorEvents(userId: string, since?: Date, limit = 20): Promise<MonitorEvent[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.monitorEvents)
    .where(since ? and(eq(schema.monitorEvents.userId, userId), gt(schema.monitorEvents.createdAt, since)) : eq(schema.monitorEvents.userId, userId))
    .orderBy(desc(schema.monitorEvents.createdAt))
    .limit(limit);
}
