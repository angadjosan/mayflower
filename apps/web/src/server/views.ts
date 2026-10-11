// Read models for the dashboard pages.
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import type { Order, Proposal, ResearchReport } from "./db/schema";
import { latestQuotes, quoteFromRow } from "./markets";

export interface ProposalView {
  proposal: Proposal;
  report: ResearchReport | null;
  market: typeof schema.markets.$inferSelect | null;
  currentQuote: ReturnType<typeof quoteFromRow>;
  order: Order | null;
}

export async function proposalViews(userId: string, statuses: string[], limit = 20): Promise<ProposalView[]> {
  const db = await getDb();
  const proposals = await db
    .select()
    .from(schema.tradeProposals)
    .where(and(eq(schema.tradeProposals.userId, userId), inArray(schema.tradeProposals.status, statuses)))
    .orderBy(desc(schema.tradeProposals.createdAt))
    .limit(limit);
  return hydrate(proposals);
}

export async function proposalView(userId: string, id: string): Promise<ProposalView | null> {
  const db = await getDb();
  const [p] = await db.select().from(schema.tradeProposals).where(and(eq(schema.tradeProposals.id, id), eq(schema.tradeProposals.userId, userId))).limit(1);
  if (!p) return null;
  return (await hydrate([p]))[0];
}

async function hydrate(proposals: Proposal[]): Promise<ProposalView[]> {
  if (proposals.length === 0) return [];
  const db = await getDb();
  const reportIds = proposals.map((p) => p.researchReportId).filter((x): x is string => Boolean(x));
  const reports = reportIds.length ? await db.select().from(schema.researchReports).where(inArray(schema.researchReports.id, reportIds)) : [];
  const symbols = [...new Set(proposals.map((p) => p.symbol))];
  const markets = await db.select().from(schema.markets).where(inArray(schema.markets.symbol, symbols));
  const quotes = await latestQuotes(symbols);
  const orders = await db.select().from(schema.orders).where(inArray(schema.orders.proposalId, proposals.map((p) => p.id)));
  return proposals.map((p) => ({
    proposal: p,
    report: reports.find((r) => r.id === p.researchReportId) ?? null,
    market: markets.find((m) => m.symbol === p.symbol) ?? null,
    currentQuote: quoteFromRow(quotes.get(p.symbol)),
    order: orders.find((o) => o.proposalId === p.id) ?? null,
  }));
}

export async function recentOrders(userId: string, limit = 10) {
  const db = await getDb();
  return db
    .select({ order: schema.orders, market: schema.markets })
    .from(schema.orders)
    .innerJoin(schema.markets, eq(schema.markets.symbol, schema.orders.symbol))
    .where(eq(schema.orders.userId, userId))
    .orderBy(desc(schema.orders.createdAt))
    .limit(limit);
}

export async function auditLog(userId: string, limit = 100) {
  const db = await getDb();
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.userId, userId)).orderBy(desc(schema.auditEvents.createdAt)).limit(limit);
}

export async function messagesFor(userId: string, limit = 200) {
  const db = await getDb();
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.userId, userId)).orderBy(desc(schema.messages.createdAt)).limit(limit);
  return rows.reverse();
}
