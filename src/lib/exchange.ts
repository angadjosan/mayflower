// Gemini Exchange Prediction Markets client (sandbox) with a simulated fallback.
// Docs: https://developer.gemini.com/prediction-markets/getting-started
import crypto from "crypto";
import type { Market, Order, Side } from "./types";

const API_KEY = process.env.GEMINI_EXCHANGE_API_KEY;
const API_SECRET = process.env.GEMINI_EXCHANGE_API_SECRET;
const BASE_URL = (process.env.GEMINI_EXCHANGE_BASE_URL || "https://api.sandbox.gemini.com").replace(/\/$/, "");

export const exchangeMode: "sandbox" | "simulated" = API_KEY && API_SECRET ? "sandbox" : "simulated";

// Verified: public, no auth. GET /v1/prediction-markets/events?status=active&limit=N
const EVENTS_PATH = "/v1/prediction-markets/events";
// Verified from docs: POST /v1/prediction-markets/order (authenticated)
const ORDER_PATH = "/v1/prediction-markets/order";
// TODO: unverified paths (docs pages exist as "Get Active Orders" / "Get Order History"; exact paths guessed)
const ACTIVE_ORDERS_PATH = "/v1/prediction-markets/orders/active";
const ORDER_HISTORY_PATH = "/v1/prediction-markets/orders/history";
// Standard Gemini REST balances endpoint (not prediction-market specific)
const BALANCES_PATH = "/v1/balances";

// ---------- auth ----------
async function privatePost<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const payload = { request: path, nonce: Date.now().toString(), ...body };
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
  return JSON.parse(text) as T;
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

function mapEvents(events: any[]): Market[] {
  const out: Market[] = [];
  for (const ev of events) {
    const contracts: any[] = ev.contracts ?? [];
    for (const c of contracts) {
      if (!c.instrumentSymbol) continue;
      if (c.marketState && c.marketState !== "open") continue;
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

export async function listMarkets(): Promise<Market[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.markets;
  let markets: Market[] = [];
  try {
    const res = await fetch(`${BASE_URL}${EVENTS_PATH}?status=active&limit=100`, {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      markets = mapEvents(Array.isArray(json) ? json : json.data ?? []);
    }
  } catch (e) {
    console.warn("[exchange] listMarkets failed, using mock:", (e as Error).message);
  }
  if (!markets.length) markets = MOCK_MARKETS;
  cache = { at: Date.now(), markets };
  return markets;
}

export async function getMarket(id: string): Promise<Market | undefined> {
  const all = await listMarkets();
  return all.find((m) => m.id === id) ?? MOCK_MARKETS.find((m) => m.id === id);
}

// ---------- orders ----------
type OrderResult = {
  exchangeOrderId?: string;
  status: Order["status"];
  filledQuantity: number;
  avgFillPrice?: number;
  mode: "sandbox" | "simulated";
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
  const simulate = exchangeMode === "simulated" || !market || market.source === "mock";

  if (simulate) {
    if (!market) return { status: "rejected", filledQuantity: 0, mode: "simulated", error: "Unknown market" };
    const yes = o.side === "YES";
    const ask = yes ? market.yesAsk : market.noAsk;
    const bid = yes ? market.yesBid : market.noBid;
    const crosses = o.action === "buy" ? ask !== undefined && o.limitPrice >= ask : bid !== undefined && o.limitPrice <= bid;
    const fillPx = o.action === "buy" ? ask : bid;
    return crosses
      ? { exchangeOrderId: `sim-${o.clientOrderId}`, status: "filled", filledQuantity: o.quantity, avgFillPrice: fillPx, mode: "simulated" }
      : { exchangeOrderId: `sim-${o.clientOrderId}`, status: "open", filledQuantity: 0, mode: "simulated" };
  }

  try {
    const resp = await privatePost<any>(ORDER_PATH, {
      symbol: o.marketId,
      orderType: "limit",
      side: o.action,
      quantity: String(o.quantity),
      price: o.limitPrice.toFixed(2),
      outcome: o.side === "YES" ? "yes" : "no",
      timeInForce: "good-til-cancel",
      clientOrderId: o.clientOrderId,
    });
    const s = mapStatus(resp);
    return { exchangeOrderId: resp.orderId != null ? String(resp.orderId) : undefined, ...s, mode: "sandbox" };
  } catch (e) {
    return { status: "error", filledQuantity: 0, mode: "sandbox", error: (e as Error).message };
  }
}

export async function getOrderStatus(
  exchangeOrderId: string,
): Promise<{ status: Order["status"]; filledQuantity: number; avgFillPrice?: number } | undefined> {
  if (exchangeMode === "simulated" || exchangeOrderId.startsWith("sim-")) return undefined;
  for (const path of [ACTIVE_ORDERS_PATH, ORDER_HISTORY_PATH]) {
    try {
      const resp = await privatePost<any>(path, {});
      const list: any[] = Array.isArray(resp) ? resp : resp.orders ?? resp.data ?? [];
      const found = list.find((x) => String(x.orderId) === exchangeOrderId);
      if (found) return mapStatus(found);
    } catch (e) {
      console.warn("[exchange] getOrderStatus", path, (e as Error).message);
    }
  }
  return undefined;
}

export async function getBalance(): Promise<{ availableUsd: number; mode: "sandbox" | "simulated" }> {
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
