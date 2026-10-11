import { desc, eq, inArray } from "drizzle-orm";
import { correlationGroupFor, type MarketContract, type Quote } from "@mayflower/shared";
import { getDb, schema } from "./db/client";
import type { MarketRow, QuoteRow } from "./db/schema";
import { marketData } from "./integrations";

export function groupOf(m: { category: string; eventTitle: string; label: string; tags: string[] }): string {
  return correlationGroupFor({ category: m.category, title: m.eventTitle, label: m.label, tags: m.tags });
}

/** Store the contract and a quote snapshot. */
export async function upsertMarket(m: MarketContract): Promise<void> {
  const db = await getDb();
  const values = {
    symbol: m.symbol,
    eventTicker: m.eventTicker,
    eventTitle: m.eventTitle,
    label: m.label,
    category: m.category,
    correlationGroup: groupOf(m),
    description: m.description || null,
    rulesUrl: m.rulesUrl,
    eventType: m.eventType,
    status: m.status,
    marketState: m.marketState,
    expiry: m.expiry ? new Date(m.expiry) : null,
    increments: m.increments,
    resolutionSide: m.resolutionSide,
    source: m.source,
    env: m.env,
    tags: m.tags,
    updatedAt: new Date(),
  };
  await db.insert(schema.markets).values(values).onConflictDoUpdate({ target: schema.markets.symbol, set: values });
  await db.insert(schema.marketQuotes).values({
    symbol: m.symbol,
    buyYes: m.quote.buyYes,
    buyNo: m.quote.buyNo,
    sellYes: m.quote.sellYes,
    sellNo: m.quote.sellNo,
    bestBid: m.quote.bestBid,
    bestAsk: m.quote.bestAsk,
    lastTrade: m.quote.lastTrade,
    liquidityUsd: m.liquidityUsd,
    volumeUsd: m.volumeUsd,
  });
}

export function quoteFromRow(q: QuoteRow | undefined | null): Quote | null {
  if (!q) return null;
  return {
    buyYes: q.buyYes,
    buyNo: q.buyNo,
    sellYes: q.sellYes,
    sellNo: q.sellNo,
    bestBid: q.bestBid,
    bestAsk: q.bestAsk,
    lastTrade: q.lastTrade,
    ts: q.ts.toISOString(),
  };
}

export function contractFromRow(row: MarketRow, quote: Quote | null): MarketContract {
  return {
    symbol: row.symbol,
    contractId: null,
    eventTicker: row.eventTicker,
    eventTitle: row.eventTitle,
    label: row.label,
    category: row.category,
    subcategoryPath: [],
    tags: row.tags,
    description: row.description ?? "",
    rulesUrl: row.rulesUrl,
    eventType: row.eventType as "binary" | "categorical",
    status: row.status,
    marketState: row.marketState as "open" | "closed" | null,
    expiry: row.expiry?.toISOString() ?? null,
    quote: quote ?? { buyYes: null, buyNo: null, sellYes: null, sellNo: null, bestBid: null, bestAsk: null, lastTrade: null, ts: row.updatedAt.toISOString() },
    liquidityUsd: null,
    volumeUsd: null,
    increments: row.increments,
    priceHistory: [],
    resolutionSide: (row.resolutionSide as "yes" | "no" | null) ?? null,
    source: row.source as "live" | "demo",
    env: row.env as "sandbox" | "production",
  };
}

export async function getMarketRow(symbol: string): Promise<MarketRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.markets).where(eq(schema.markets.symbol, symbol)).limit(1);
  return row ?? null;
}

export async function latestQuotes(symbols: string[]): Promise<Map<string, QuoteRow>> {
  const out = new Map<string, QuoteRow>();
  if (symbols.length === 0) return out;
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.marketQuotes)
    .where(inArray(schema.marketQuotes.symbol, symbols))
    .orderBy(desc(schema.marketQuotes.ts));
  for (const r of rows) if (!out.has(r.symbol)) out.set(r.symbol, r);
  return out;
}

export async function quoteHistory(symbol: string, limit = 200): Promise<QuoteRow[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.marketQuotes).where(eq(schema.marketQuotes.symbol, symbol)).orderBy(desc(schema.marketQuotes.ts)).limit(limit);
  return rows.reverse();
}

/**
 * Fetch the latest contract from Gemini (never from a stale cache) and store a
 * fresh quote. Falls back to the stored row only when the exchange is unreachable.
 */
export async function refreshContract(symbol: string, eventTicker: string): Promise<{ contract: MarketContract | null; fresh: boolean; error?: string }> {
  try {
    const c = await marketData().getContract(symbol, eventTicker);
    if (c) {
      await upsertMarket(c);
      return { contract: c, fresh: true };
    }
    return { contract: null, fresh: true, error: "Contract no longer listed" };
  } catch (err) {
    const row = await getMarketRow(symbol);
    const q = (await latestQuotes([symbol])).get(symbol);
    return { contract: row ? contractFromRow(row, quoteFromRow(q)) : null, fresh: false, error: (err as Error).message };
  }
}
