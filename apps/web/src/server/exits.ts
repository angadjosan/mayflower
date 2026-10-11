import { and, eq } from "drizzle-orm";
import { bidFor, formatCents, formatUsd, outcomeLabel, round, type Outcome } from "@mayflower/shared";
import { getDb, schema } from "./db/client";
import type { Proposal } from "./db/schema";
import { refreshContract } from "./markets";
import { createProposal } from "./proposals";

/** Create a sell proposal (reduce/close) for an open position. It still needs explicit approval. */
export async function proposeExit(userId: string, positionId: string, fraction: number, why = "You asked to reduce this position."): Promise<{ ok: true; proposal: Proposal } | { ok: false; error: string }> {
  const db = await getDb();
  const [row] = await db
    .select({ position: schema.positions, market: schema.markets })
    .from(schema.positions)
    .innerJoin(schema.markets, eq(schema.markets.symbol, schema.positions.symbol))
    .where(and(eq(schema.positions.id, positionId), eq(schema.positions.userId, userId), eq(schema.positions.status, "open")))
    .limit(1);
  if (!row) return { ok: false, error: "That position isn't open." };
  const { position, market } = row;
  const fresh = await refreshContract(position.symbol, position.eventTicker);
  const outcome = position.outcome as Outcome;
  const bid = fresh.contract ? bidFor(fresh.contract.quote, outcome) : null;
  if (bid === null) return { ok: false, error: `There's no bid for “${market.label}” right now, so a sell order couldn't fill. Mayflower will keep watching it.` };
  const inc = fresh.contract?.increments.quantityIncrement ?? 1;
  const f = Math.min(1, Math.max(0, fraction));
  const qty = f >= 1 ? position.quantity : Math.max(Math.min(inc, position.quantity), Math.floor((position.quantity * f) / inc) * inc);
  const proposal = await createProposal({
    userId,
    symbol: position.symbol,
    kind: f >= 1 ? "close" : "reduce",
    discovery: "user_request",
    decision: "trade",
    side: "sell",
    outcome,
    quantity: round(qty, 8),
    limitPrice: bid,
    maxCost: 0,
    estProbability: null,
    marketProbability: null,
    edge: null,
    expectedValue: null,
    sizing: { kind: "exit", fraction: f, exitPrice: bid, proceeds: round(qty * bid, 2), realizedVsCost: round(qty * (bid - position.avgPrice), 2) },
    rationale: {
      title: market.label,
      whatHasToHappen: `Sell ${round(qty, 2)} ${outcomeLabel(outcome)} at ${formatCents(bid)} or better.`,
      whyNow: why,
      thesis: position.latestAssessment?.summary ?? position.thesis?.text ?? "",
      discoveryReason: "Your request",
      sizingSummary: `About ${formatUsd(qty * bid)} back (${formatUsd(qty * (bid - position.avgPrice), { signed: true })} vs. what you paid for those contracts).`,
      noTradeReason: null,
      risks: ["A limit order may not fill if the bid moves away; thin markets can gap.", "Selling locks in the current result and gives up any further upside."],
      resolutionRisks: [],
      whatWouldChangeMind: [],
      watchConditions: [],
      hedgeNote: null,
      criticIssues: [],
      method: { forecast: "heuristic", critic: "heuristic", research: "none", marketData: fresh.contract?.source ?? market.source },
    },
    relatedPositionId: position.id,
    executionMode: position.mode,
  });
  return { ok: true, proposal };
}
