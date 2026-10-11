// Exchange router. Gemini Exchange Prediction Markets (sandbox) is the primary venue; Polymarket (./polymarket),
// then Hyperliquid HIP-4 outcomes (./hyperliquid), fill in markets Gemini doesn't list.
// Each venue falls back to clearly-labeled simulated orders.
// Docs: https://developer.gemini.com/prediction-markets/getting-started
import crypto from "crypto";
import type { Market, Order, OrderMode, Side, Venue } from "./types";
import {
  listPolymarketMarkets, getPolymarketMarket, placePolymarketOrder, getPolymarketOrderStatus,
  getPolymarketBalance, isPolymarketId, polymarketMode, polymarketEnabled,
} from "./polymarket";
import {
  listHyperliquidMarkets, getHyperliquidMarket, placeHyperliquidOrder, getHyperliquidOrderStatus,
  getHyperliquidBalance, isHyperliquidId, hyperliquidMode, hyperliquidEnabled,
} from "./hyperliquid";

export { polymarketMode, polymarketEnabled, hyperliquidMode, hyperliquidEnabled };

const API_KEY = process.env.GEMINI_EXCHANGE_API_KEY;
const API_SECRET = process.env.GEMINI_EXCHANGE_API_SECRET;
const BASE_URL = (process.env.GEMINI_EXCHANGE_BASE_URL || "https://api.sandbox.gemini.com").replace(/\/$/, "");

/** Gemini's mode. Use orderModeFor(market) for what an order on a given market will actually do. */
export const exchangeMode: "sandbox" | "simulated" = API_KEY && API_SECRET ? "sandbox" : "simulated";

export const venueOf = (m: Pick<Market, "id" | "source">): Venue =>
  m.source === "polymarket" || isPolymarketId(m.id) ? "polymarket"
  : m.source === "hyperliquid" || isHyperliquidId(m.id) ? "hyperliquid"
  : "gemini";
const venueOfId = (id: string): Venue => venueOf({ id, source: "gemini" });

/** How an order on this market would execute right now. */
export function orderModeFor(m: Market): OrderMode {
  if (m.source === "mock" || m.paperOnly) return "simulated";
  const v = venueOf(m);
  return v === "polymarket" ? polymarketMode : v === "hyperliquid" ? hyperliquidMode : exchangeMode;
}

const VENUE_NAME: Record<Venue, string> = { gemini: "Gemini", polymarket: "Polymarket", hyperliquid: "Hyperliquid" };

export function venueLabel(mode: OrderMode, venue: Venue = "gemini"): string {
  if (mode === "simulated") return venue === "gemini" ? "simulated" : `simulated, ${VENUE_NAME[venue]} prices`;
  if (mode === "testnet") return "Hyperliquid testnet";
  return mode === "live" ? `${VENUE_NAME[venue]} – live, real funds` : "Gemini sandbox – shared account";
}

// All paths below verified against the sandbox on 2026-10-11 (a real order was placed, filled and found in history).
// Public, no auth. GET /v1/prediction-markets/events?status=active&limit=N
const EVENTS_PATH = "/v1/prediction-markets/events";
const ORDER_PATH = "/v1/prediction-markets/order";
const ACTIVE_ORDERS_PATH = "/v1/prediction-markets/orders/active"; // body {symbol?, limit<=100, offset}
const ORDER_HISTORY_PATH = "/v1/prediction-markets/orders/history"; // body {status?, symbol?, limit<=1000, offset}
// Orders fail with TERMS_NOT_ACCEPTED until this is called once per account.
const TERMS_ACCEPT_PATH = "/v1/prediction-markets/terms/accept";
// Standard Gemini REST balances endpoint (not prediction-market specific)
const BALANCES_PATH = "/v1/balances";
const ACCOUNT = process.env.GEMINI_EXCHANGE_ACCOUNT || "primary";
// Sandbox only lists crypto/commodity markets. Set to 1 to also discover production markets (sports, politics...)
// using public data; those can't be ordered in sandbox, so they're marked paperOnly and always simulated.
const INCLUDE_PRODUCTION = process.env.GEMINI_DISCOVERY_INCLUDE_PRODUCTION === "1";
const PRODUCTION_URL = "https://api.gemini.com";
// Keys are created with a nonce mode: "incremental" accepts ms timestamps; "time-based" needs Unix seconds.
const NONCE_SECONDS = process.env.GEMINI_EXCHANGE_NONCE === "seconds";
let lastNonce = 0;
function nextNonce(): number {
  const n = NONCE_SECONDS ? Math.floor(Date.now() / 1000) : Date.now();
  // Incremental keys reject a repeated nonce; seconds mode tolerates repeats within its 30s window.
  lastNonce = NONCE_SECONDS ? n : Math.max(n, lastNonce + 1);
  return lastNonce;
}

// ---------- auth ----------
async function privatePost<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  // Master API keys must name a sub-account; account-scoped keys ignore it.
  const payload = { request: path, nonce: nextNonce(), account: ACCOUNT, ...body };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sig = crypto.createHmac("sha384", API_SECRET!).update(b64).digest("hex");
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Content-Length": "0",
      "X-GEMINI-APIKEY": API_KEY!,
      "X-GEMINI-PAYLOAD": b64,
      "X-GEMINI-SIGNATURE": sig,
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini ${path} ${res.status}: ${text.slice(0, 300)}`);
  // Order ids exceed Number.MAX_SAFE_INTEGER; quote long integers so they survive JSON.parse intact.
  return JSON.parse(text.replace(/([:\[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"')) as T;
}

// ---------- markets ----------
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function descriptionText(d: any): string | undefined {
  try {
    return (d?.content ?? []).map((c: any) => c?.value ?? "").join(" ").trim() || undefined;
  } catch {
    return undefined;
  }
}

// Contracts this close to expiry can't be researched and approved in time.
const MIN_TIME_TO_EXPIRY_MS = 10 * 60 * 1000;

function mapEvents(events: any[], paperOnly = false): Market[] {
  const out: Market[] = [];
  const cutoff = Date.now() + MIN_TIME_TO_EXPIRY_MS;
  for (const ev of events) {
    const contracts: any[] = ev.contracts ?? [];
    for (const c of contracts) {
      if (!c.instrumentSymbol) continue;
      if (c.marketState && c.marketState !== "open") continue;
      if (c.expiryDate && Date.parse(c.expiryDate) < cutoff) continue;
      const p = c.prices ?? {};
      const yesAsk = num(p.buy?.yes);
      const yesBid = num(p.sell?.yes);
      if (yesAsk === undefined && yesBid === undefined) continue; // no quotes, not useful
      out.push({
        id: c.instrumentSymbol,
        eventId: String(ev.id ?? ev.ticker ?? ""),
        eventTitle: ev.title,
        title: contracts.length > 1 ? `${ev.title} — ${c.label}` : ev.title,
        category: ev.category,
        rules: descriptionText(c.description) ?? c.termsAndConditionsUrl,
        expiresAt: c.expiryDate,
        status: "open",
        yesAsk,
        yesBid,
        noAsk: num(p.buy?.no),
        noBid: num(p.sell?.no),
        lastPrice: num(p.lastTradePrice),
        volume: num(c.volume ?? ev.volume),
        source: "gemini",
        ...(paperOnly ? { paperOnly: true } : {}),
      });
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const iso = (s: string) => new Date(s).toISOString();
function mk(id: string, eventTitle: string, category: string, yes: number, expires: string, rules: string): Market {
  const spread = 0.02;
  const yesAsk = Math.min(0.99, +(yes + spread / 2).toFixed(2));
  const yesBid = Math.max(0.01, +(yes - spread / 2).toFixed(2));
  return {
    id, eventId: id.split("-")[1], eventTitle, title: eventTitle, category, rules,
    expiresAt: iso(expires), status: "open",
    yesAsk, yesBid, noAsk: +(1 - yesBid).toFixed(2), noBid: +(1 - yesAsk).toFixed(2),
    lastPrice: yes, volume: Math.round(5000 + yes * 40000), source: "mock",
  };
}

const MOCK_MARKETS: Market[] = [
  mk("MOCK-NFLSEA27-YES", "Will the Seattle Seahawks make the 2026-27 NFL playoffs?", "Sports", 0.48, "2027-01-10T00:00:00Z", "Resolves YES if the Seahawks qualify for the NFL postseason for the 2026 season."),
  mk("MOCK-SB61-KC", "Will the Kansas City Chiefs win Super Bowl LXI?", "Sports", 0.14, "2027-02-14T23:59:00Z", "Resolves YES if the Chiefs win Super Bowl LXI."),
  mk("MOCK-NBA27-OKC", "Will the Oklahoma City Thunder win the 2027 NBA Finals?", "Sports", 0.22, "2027-06-30T00:00:00Z", "Resolves YES if OKC wins the 2027 NBA championship."),
  mk("MOCK-AIGPT6-26", "Will OpenAI publicly release GPT-6 before Jan 1, 2027?", "AI/Tech", 0.31, "2026-12-31T23:59:00Z", "Resolves YES on general availability of a model named GPT-6 before 2027."),
  mk("MOCK-NVDA5T-26", "Will NVIDIA's market cap exceed $5T on Dec 31, 2026?", "AI/Tech", 0.57, "2026-12-31T21:00:00Z", "Resolves YES if NVDA market cap at close on Dec 31, 2026 exceeds $5 trillion."),
  mk("MOCK-AICAPEX-27", "Will combined Big Tech capex exceed $500B in 2026 (reported by Feb 2027)?", "AI/Tech", 0.66, "2027-02-28T00:00:00Z", "Resolves YES if MSFT+GOOGL+AMZN+META reported 2026 capex sums above $500B."),
  mk("MOCK-RECESS-27", "Will the US enter a recession in 2027 (NBER-declared)?", "Economy", 0.27, "2027-12-31T23:59:00Z", "Resolves YES if NBER dates a recession starting in 2027."),
  mk("MOCK-FEDDEC26-CUT", "Will the Fed cut rates at the December 2026 FOMC meeting?", "Economy", 0.42, "2026-12-16T19:00:00Z", "Resolves YES if the FOMC lowers the target range at its December 2026 meeting."),
  mk("MOCK-CPI-DEC26", "Will US CPI YoY for November 2026 be above 3.0%?", "Economy", 0.35, "2026-12-11T13:30:00Z", "Resolves YES if BLS-reported Nov 2026 CPI YoY exceeds 3.0%."),
  mk("MOCK-HOUSE26-DEM", "Will Democrats win control of the US House in the 2026 midterms?", "Politics", 0.63, "2026-12-31T23:59:00Z", "Resolves YES if Democrats hold a House majority after the Nov 2026 elections."),
  mk("MOCK-NYCSNOW-26", "Will Central Park record measurable snow before Dec 25, 2026?", "Weather", 0.38, "2026-12-25T05:00:00Z", "Resolves YES if NWS records >=0.1in of snow at Central Park before Dec 25, 2026."),
  mk("MOCK-BTC150K-26", "Will Bitcoin trade above $150,000 before Jan 1, 2027?", "Crypto", 0.18, "2026-12-31T23:59:00Z", "Resolves YES if BTC/USD trades above $150,000 on a major index before 2027."),
  mk("MOCK-ETH10K-27", "Will Ethereum trade above $10,000 before July 1, 2027?", "Crypto", 0.09, "2027-06-30T23:59:00Z", "Resolves YES if ETH/USD trades above $10,000 before July 2027."),
];

let cache: { at: number; markets: Market[] } | null = null;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchEvents(base: string, limit: number): Promise<any[]> {
  const res = await fetch(`${base}${EVENTS_PATH}?status=active&limit=${limit}`, {
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`events ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : json.data ?? [];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function listGeminiMarkets(): Promise<Market[]> {
  let markets: Market[] = [];
  const [own, prod] = await Promise.allSettled([
    fetchEvents(BASE_URL, 500),
    INCLUDE_PRODUCTION && BASE_URL !== PRODUCTION_URL ? fetchEvents(PRODUCTION_URL, 500) : Promise.resolve([]),
  ]);
  if (own.status === "fulfilled") markets = mapEvents(own.value);
  else console.warn("[exchange] listMarkets failed:", (own.reason as Error).message);
  if (prod.status === "fulfilled" && prod.value.length) {
    // Same instrument listed on both: keep the tradable (sandbox) one.
    const tradable = new Set(markets.map((m) => m.id));
    markets = [...markets, ...mapEvents(prod.value, true).filter((m) => !tradable.has(m.id))];
  }
  return markets;
}

// ---------- cross-venue matching ----------
const STOP = new Set(["will", "the", "a", "an", "be", "in", "on", "of", "by", "to", "at", "for", "before", "after", "than", "or", "and", "is", "this", "its", "who", "what", "which"]);
const toWords = (txt: string) => new Set(
  txt.toLowerCase().replace(/[$,]/g, "").replace(/[^a-z0-9.%\s]/g, " ").split(/\s+/)
    .map((w) => w.replace(/\.$/, "")).filter((w) => w && !STOP.has(w)),
);
const tokenCache = new WeakMap<Market, { words: Set<string>; nums: string; label?: Set<string> }>();
function tokens(m: Market) {
  let t = tokenCache.get(m);
  if (!t) {
    const words = toWords(`${m.eventTitle} ${m.title}`);
    // Multi-outcome contracts are titled "Event — Outcome"; the outcome label is what tells siblings apart.
    const label = m.title.includes(" — ") ? toWords(m.title.split(" — ").slice(1).join(" ")) : undefined;
    t = { words, nums: [...words].filter((w) => /\d/.test(w)).sort().join(), label };
    tokenCache.set(m, t);
  }
  return t;
}

/** Same real-world question on two venues: high word overlap, identical numbers (strikes, years), close expiry. */
export function sameQuestion(a: Market, b: Market): boolean {
  if (a.expiresAt && b.expiresAt && Math.abs(Date.parse(a.expiresAt) - Date.parse(b.expiresAt)) > 7 * 86400_000) return false;
  const { words: ta, nums: na, label: la } = tokens(a), { words: tb, nums: nb, label: lb } = tokens(b);
  if (na !== nb) return false;
  if (la?.size && lb?.size && ![...la].some((w) => lb.has(w))) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter) >= 0.65;
}

/**
 * All tradable markets, by venue priority Gemini > Polymarket > Hyperliquid: a market is only included when
 * no higher-priority venue lists an orderable equivalent. Paper-only listings (real markets the configured
 * sandbox/testnet can't trade) yield to an orderable equivalent anywhere.
 */
export async function listMarkets(): Promise<Market[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.markets;
  const results = await Promise.allSettled([listGeminiMarkets(), listPolymarketMarkets(), listHyperliquidMarkets()]);
  const names = ["Gemini", "Polymarket", "Hyperliquid"];
  results.forEach((r, i) => {
    if (r.status === "rejected") console.warn(`[exchange] ${names[i]} listMarkets failed:`, (r.reason as Error).message);
  });

  const tradable: Market[] = [];
  const paper: Market[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const m of r.value) {
      // Only dedupe across venues: sibling contracts on one venue ("— Lakers" / "— Celtics") stay distinct.
      const dup = (x: Market) => venueOf(x) !== venueOf(m) && sameQuestion(x, m);
      if (m.paperOnly) { if (!paper.some(dup)) paper.push(m); }
      else if (!tradable.some(dup)) tradable.push(m);
    }
  }
  let markets = [...tradable, ...paper.filter((p) => !tradable.some((t) => t.id !== p.id && venueOf(t) !== venueOf(p) && sameQuestion(t, p)))];
  if (!markets.length) {
    console.warn("[exchange] no live markets, using mock markets");
    markets = MOCK_MARKETS;
  }
  cache = { at: Date.now(), markets };
  return markets;
}

export async function getMarket(id: string): Promise<Market | undefined> {
  const all = await listMarkets();
  const listed = all.find((m) => m.id === id);
  if (listed) return listed;
  if (isPolymarketId(id)) return getPolymarketMarket(id).catch(() => undefined);
  if (isHyperliquidId(id)) return getHyperliquidMarket(id).catch(() => undefined);
  return MOCK_MARKETS.find((m) => m.id === id);
}

// ---------- orders ----------
type OrderResult = {
  exchangeOrderId?: string;
  status: Order["status"];
  filledQuantity: number;
  avgFillPrice?: number;
  mode: OrderMode;
  venue: Venue;
  error?: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapStatus(o: any): { status: Order["status"]; filledQuantity: number; avgFillPrice?: number } {
  const filled = num(o.filledQuantity) ?? 0;
  const remaining = num(o.remainingQuantity);
  let status: Order["status"];
  switch (o.status) {
    case "filled": status = "filled"; break;
    case "cancelled": status = filled > 0 ? "partially_filled" : "cancelled"; break;
    case "open": status = filled > 0 && (remaining ?? 1) > 0 ? "partially_filled" : "open"; break;
    default: status = "submitted";
  }
  return { status, filledQuantity: filled, avgFillPrice: num(o.avgExecutionPrice) };
}

export async function placeOrder(o: {
  marketId: string;
  side: Side;
  action: "buy" | "sell";
  quantity: number;
  limitPrice: number;
  clientOrderId: string;
}): Promise<OrderResult> {
  const market = await getMarket(o.marketId);
  const venue: Venue = market ? venueOf(market) : venueOfId(o.marketId);
  const simulate = !market || orderModeFor(market) === "simulated";

  if (simulate) {
    if (!market) return { status: "rejected", filledQuantity: 0, mode: "simulated", venue, error: "Unknown market" };
    const yes = o.side === "YES";
    const ask = yes ? market.yesAsk : market.noAsk;
    const bid = yes ? market.yesBid : market.noBid;
    const crosses = o.action === "buy" ? ask !== undefined && o.limitPrice >= ask : bid !== undefined && o.limitPrice <= bid;
    const fillPx = o.action === "buy" ? ask : bid;
    return crosses
      ? { exchangeOrderId: `sim-${o.clientOrderId}`, status: "filled", filledQuantity: o.quantity, avgFillPrice: fillPx, mode: "simulated", venue }
      : { exchangeOrderId: `sim-${o.clientOrderId}`, status: "open", filledQuantity: 0, mode: "simulated", venue };
  }

  if (venue === "polymarket") return { ...(await placePolymarketOrder(market, o)), venue };
  if (venue === "hyperliquid") return { ...(await placeHyperliquidOrder(market, o)), venue };

  const body = {
    symbol: o.marketId,
    orderType: "limit",
    side: o.action,
    quantity: String(o.quantity),
    price: o.limitPrice.toFixed(2),
    outcome: o.side === "YES" ? "yes" : "no",
    timeInForce: "good-til-cancel",
    clientOrderId: o.clientOrderId,
  };
  try {
    let resp: any;
    try {
      resp = await privatePost<any>(ORDER_PATH, body);
    } catch (e) {
      if (!/TERMS_NOT_ACCEPTED/i.test((e as Error).message)) throw e;
      // First order on a fresh account: accept the prediction-market terms once, then retry.
      await privatePost(TERMS_ACCEPT_PATH);
      resp = await privatePost<any>(ORDER_PATH, body);
    }
    const s = mapStatus(resp);
    return { exchangeOrderId: resp.orderId != null ? String(resp.orderId) : undefined, ...s, mode: "sandbox", venue };
  } catch (e) {
    return { status: "error", filledQuantity: 0, mode: "sandbox", venue, error: (e as Error).message };
  }
}

export async function getOrderStatus(
  exchangeOrderId: string,
  venue: Venue = "gemini",
): Promise<{ status: Order["status"]; filledQuantity: number; avgFillPrice?: number } | undefined> {
  if (venue === "polymarket") return getPolymarketOrderStatus(exchangeOrderId);
  if (venue === "hyperliquid") return getHyperliquidOrderStatus(exchangeOrderId);
  if (exchangeMode === "simulated" || exchangeOrderId.startsWith("sim-")) return undefined;
  for (const [path, body] of [[ACTIVE_ORDERS_PATH, { limit: 100 }], [ORDER_HISTORY_PATH, { limit: 500 }]] as const) {
    try {
      const resp = await privatePost<any>(path, body);
      const list: any[] = Array.isArray(resp) ? resp : resp.orders ?? resp.data ?? [];
      const found = list.find((x) => String(x.orderId) === exchangeOrderId);
      if (found) return mapStatus(found);
    } catch (e) {
      console.warn("[exchange] getOrderStatus", path, (e as Error).message);
    }
  }
  return undefined;
}

export async function getBalance(venue: Venue = "gemini"): Promise<{ availableUsd: number; mode: OrderMode }> {
  if (venue === "polymarket") return getPolymarketBalance();
  if (venue === "hyperliquid") return getHyperliquidBalance();
  if (exchangeMode === "simulated") return { availableUsd: 1000, mode: "simulated" };
  try {
    const resp = await privatePost<any[]>(BALANCES_PATH);
    const usd = (resp ?? []).find((b: any) => b.currency === "USD");
    return { availableUsd: num(usd?.available) ?? 0, mode: "sandbox" };
  } catch (e) {
    console.warn("[exchange] getBalance failed:", (e as Error).message);
    return { availableUsd: 0, mode: "sandbox" };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
