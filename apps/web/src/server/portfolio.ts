import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { bidFor, round, type ExecutionMode, type ExposureItem, type Outcome } from "@mayflower/shared";
import { sharpeRatio, summarizePortfolio, type PortfolioSummary, type SharpeResult } from "@mayflower/risk";
import { getDb, schema } from "./db/client";
import type { Position, User } from "./db/schema";
import { latestQuotes, quoteFromRow } from "./markets";
import { effectiveLimits } from "./users";

export const OPEN_ORDER_STATUSES = ["submitting", "open", "partially_filled", "unknown"] as const;

export async function openPositions(userId: string): Promise<Position[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.userId, userId), eq(schema.positions.status, "open")))
    .orderBy(desc(schema.positions.openedAt));
}

/** Ledger balance for shared-sandbox and simulated modes (allocation − buys + sells + payouts). */
export async function ledgerBalance(userId: string, mode: ExecutionMode): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amount}), 0)` })
    .from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.userId, userId), eq(schema.ledgerEntries.mode, mode)));
  return round(Number(row?.total ?? 0), 2);
}

/** Cost reserved by approved buy orders that have not fully filled yet. */
export async function reservedForOpenOrders(userId: string): Promise<{ total: number; items: ExposureItem[] }> {
  const db = await getDb();
  const rows = await db
    .select({ o: schema.orders, m: schema.markets })
    .from(schema.orders)
    .innerJoin(schema.markets, eq(schema.markets.symbol, schema.orders.symbol))
    .where(and(eq(schema.orders.userId, userId), inArray(schema.orders.status, [...OPEN_ORDER_STATUSES]), eq(schema.orders.side, "buy")));
  const items: ExposureItem[] = rows.map(({ o, m }) => ({
    symbol: o.symbol,
    eventTicker: o.eventTicker,
    outcome: o.outcome as Outcome,
    quantity: o.quantity - o.filledQuantity,
    atRisk: round((o.quantity - o.filledQuantity) * o.limitPrice, 2),
    correlationGroup: m.correlationGroup,
    label: m.label,
  }));
  return { total: round(items.reduce((s, i) => s + i.atRisk, 0), 2), items };
}

export async function currentExposures(userId: string): Promise<ExposureItem[]> {
  const db = await getDb();
  const rows = await db
    .select({ p: schema.positions, m: schema.markets })
    .from(schema.positions)
    .innerJoin(schema.markets, eq(schema.markets.symbol, schema.positions.symbol))
    .where(and(eq(schema.positions.userId, userId), eq(schema.positions.status, "open")));
  const positions: ExposureItem[] = rows.map(({ p, m }) => ({
    symbol: p.symbol,
    eventTicker: p.eventTicker,
    outcome: p.outcome as Outcome,
    quantity: p.quantity,
    atRisk: round(p.costBasis, 2),
    correlationGroup: p.correlationGroup ?? m.correlationGroup,
    label: m.label,
  }));
  const reserved = await reservedForOpenOrders(userId);
  return [...positions, ...reserved.items];
}

export interface PositionView {
  position: Position;
  label: string;
  eventTitle: string;
  expiry: Date | null;
  marketStatus: string;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  source: string;
}

export async function positionViews(userId: string, includeClosed = false): Promise<PositionView[]> {
  const db = await getDb();
  const rows = await db
    .select({ p: schema.positions, m: schema.markets })
    .from(schema.positions)
    .innerJoin(schema.markets, eq(schema.markets.symbol, schema.positions.symbol))
    .where(includeClosed ? eq(schema.positions.userId, userId) : and(eq(schema.positions.userId, userId), eq(schema.positions.status, "open")))
    .orderBy(desc(schema.positions.openedAt));
  const quotes = await latestQuotes(rows.map((r) => r.p.symbol));
  return rows.map(({ p, m }) => {
    const q = quoteFromRow(quotes.get(p.symbol));
    const exit = q ? bidFor(q, p.outcome as Outcome) : null;
    const open = p.status === "open";
    const marketValue = open && exit !== null ? round(exit * p.quantity, 2) : null;
    return {
      position: p,
      label: m.label,
      eventTitle: m.eventTitle,
      expiry: m.expiry,
      marketStatus: m.status,
      currentPrice: exit,
      marketValue,
      unrealizedPnl: marketValue !== null ? round(marketValue - p.costBasis, 2) : null,
      source: m.source,
    };
  });
}

export interface BalanceInfo {
  mode: ExecutionMode | null;
  /** Spendable balance used by the risk engine. null when it cannot be read. */
  available: number | null;
  label: string;
  detail: string;
}

export interface PortfolioOverview {
  summary: PortfolioSummary;
  balance: BalanceInfo;
  sharpe: SharpeResult;
  reserved: number;
  positions: PositionView[];
}

export async function portfolioOverview(user: User, balance: BalanceInfo): Promise<PortfolioOverview> {
  const db = await getDb();
  const views = await positionViews(user.id, false);
  const reserved = await reservedForOpenOrders(user.id);
  const [closed] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.positions.realizedPnl}), 0)` })
    .from(schema.positions)
    .where(and(eq(schema.positions.userId, user.id), ne(schema.positions.status, "open")));
  const cash = balance.available ?? 0;
  const summary = summarizePortfolio({
    positions: views.map((v) => ({
      label: v.label,
      costBasis: v.position.costBasis,
      marketValue: v.marketValue,
      realizedPnl: v.position.realizedPnl,
      correlationGroup: v.position.correlationGroup,
    })),
    cash,
    reserved: reserved.total,
    realizedFromClosed: Number(closed?.total ?? 0),
    limits: effectiveLimits(user),
  });
  const snaps = await db
    .select()
    .from(schema.portfolioSnapshots)
    .where(eq(schema.portfolioSnapshots.userId, user.id))
    .orderBy(schema.portfolioSnapshots.ts);
  const sharpe = sharpeRatio(snaps.map((s) => ({ ts: s.ts.toISOString(), totalValue: s.totalValue })));
  return { summary, balance, sharpe, reserved: reserved.total, positions: views };
}

export async function recordSnapshot(userId: string, o: PortfolioOverview): Promise<void> {
  const db = await getDb();
  await db.insert(schema.portfolioSnapshots).values({
    userId,
    totalValue: o.summary.totalValue,
    cash: o.summary.cash,
    atRisk: o.summary.atRisk,
    unrealizedPnl: o.summary.unrealizedPnl,
    realizedPnl: o.summary.realizedPnl,
  });
}

export async function snapshots(userId: string) {
  const db = await getDb();
  return db.select().from(schema.portfolioSnapshots).where(eq(schema.portfolioSnapshots.userId, userId)).orderBy(schema.portfolioSnapshots.ts);
}
