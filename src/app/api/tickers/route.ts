import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public Gemini market data (production, no auth): last price, 24h change and hourly closes for a sparkline.
const BASE = "https://api.gemini.com";
const SYMBOLS = [
  { symbol: "BTC", pair: "btcusd" },
  { symbol: "ETH", pair: "ethusd" },
  { symbol: "SOL", pair: "solusd" },
] as const;
const TTL_MS = 15_000;

export interface Ticker { symbol: string; price: number; change24h: number | null; spark: number[] }

let cache: { at: number; tickers: Ticker[] } | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

async function loadTickers(): Promise<Ticker[]> {
  const v2 = await Promise.all(
    SYMBOLS.map(async ({ symbol, pair }) => {
      try {
        const t = await fetchJson<{ open: string; close: string; changes?: string[] }>(`${BASE}/v2/ticker/${pair}`);
        const price = Number(t.close), open = Number(t.open);
        // `changes` is the last 24 hourly prices. Observed order is oldest first: the first entry sits next to
        // `open` and the last next to `close`. Orient by that so the sparkline never comes out backwards.
        let spark = (t.changes ?? []).map(Number).filter(Number.isFinite);
        if (spark.length > 1 && Math.abs(spark[0] - Number(t.close)) < Math.abs(spark[spark.length - 1] - Number(t.close))) spark = spark.reverse();
        if (Number.isFinite(price)) spark.push(price);
        return { symbol, price, change24h: open > 0 ? price / open - 1 : null, spark } satisfies Ticker;
      } catch {
        return null;
      }
    }),
  );
  if (v2.every(Boolean)) return v2 as Ticker[];
  // Fallback for any symbol v2 missed: one pricefeed call covers all pairs.
  let feed: { pair: string; price: string; percentChange24h: string }[] = [];
  try { feed = await fetchJson(`${BASE}/v1/pricefeed`); } catch { /* keep what we have */ }
  return SYMBOLS.map(({ symbol, pair }, i) => {
    if (v2[i]) return v2[i] as Ticker;
    const f = feed.find((x) => x.pair === pair.toUpperCase());
    return f ? { symbol, price: Number(f.price), change24h: Number(f.percentChange24h), spark: [] } : null;
  }).filter((t): t is Ticker => t !== null);
}

export async function GET() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const tickers = await loadTickers();
    if (tickers.length || !cache) cache = { at: Date.now(), tickers };
  }
  return NextResponse.json(
    { tickers: cache.tickers, at: new Date(cache.at).toISOString() },
    { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" } },
  );
}
