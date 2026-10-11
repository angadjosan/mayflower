// Polymarket client: Gamma API for discovery (public) + CLOB for orders, with a simulated fallback.
// Order signing/auth mirror the official @polymarket/clob-client (v5.8.1): EIP-712 orders on Polygon (chainId 137),
// L1 (ClobAuth EIP-712) to derive API creds, L2 (HMAC-SHA256) on every private call.
// Polymarket has no sandbox: live mode moves real USDC, so it needs a key AND an explicit opt-in.
import crypto from "crypto";
import { privateKeyToAccount } from "viem/accounts";
import { parseUnits, type Hex } from "viem";
import type { Market, Order, Side } from "./types";

const GAMMA_URL = (process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com").replace(/\/$/, "");
const CLOB_URL = (process.env.POLYMARKET_CLOB_URL || "https://clob.polymarket.com").replace(/\/$/, "");
const PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY;
const LIVE_OPT_IN = process.env.POLYMARKET_LIVE_TRADING === "1";
// Discovery is public and on by default; set POLYMARKET_ENABLED=0 to trade Gemini only.
export const polymarketEnabled = process.env.POLYMARKET_ENABLED !== "0";
export const polymarketMode: "live" | "simulated" = polymarketEnabled && PRIVATE_KEY && LIVE_OPT_IN ? "live" : "simulated";

// 0 = EOA (key holds the USDC), 1 = Polymarket email/Magic proxy, 2 = browser-wallet Gnosis Safe proxy.
const SIGNATURE_TYPE = Number(process.env.POLYMARKET_SIGNATURE_TYPE || 0);
const FUNDER = process.env.POLYMARKET_FUNDER_ADDRESS; // proxy wallet holding funds (signature types 1/2)
const CHAIN_ID = 137;
const EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const PM_PREFIX = "PM-";
const MIN_TIME_TO_EXPIRY_MS = 10 * 60 * 1000;
const EVENT_LIMIT = Number(process.env.POLYMARKET_EVENT_LIMIT || 100);

export const isPolymarketId = (id: string) => id.startsWith(PM_PREFIX);

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function jsonArray(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

// ---------- markets (Gamma) ----------

/** One Gamma market -> Market. Only binary Yes/No markets map onto Mayflower's YES/NO model. */
function mapMarket(m: any, ev: any | undefined, multi: boolean): Market | undefined {
  if (!m?.conditionId || m.enableOrderBook === false) return undefined;
  const outcomes = jsonArray(m.outcomes).map((o) => String(o).toLowerCase());
  if (outcomes.length !== 2 || outcomes[0] !== "yes" || outcomes[1] !== "no") return undefined;
  const [yesTokenId, noTokenId] = jsonArray(m.clobTokenIds).map(String);
  if (!yesTokenId || !noTokenId) return undefined;

  const closed = m.closed === true;
  const prices = jsonArray(m.outcomePrices).map(num);
  // YES and NO books are mirrored on the CLOB: buying NO at p is selling YES at 1 - p.
  const yesBid = closed ? undefined : num(m.bestBid);
  const yesAsk = closed ? undefined : num(m.bestAsk);
  const eventTitle = ev?.title ?? m.question;
  return {
    id: PM_PREFIX + m.conditionId,
    eventId: ev?.id != null ? `pm-${ev.id}` : undefined,
    eventTitle,
    title: multi && m.groupItemTitle ? `${eventTitle} — ${m.groupItemTitle}` : m.question ?? eventTitle,
    category: m.category ?? ev?.category ?? ev?.tags?.[0]?.label,
    rules: m.description || ev?.description,
    expiresAt: m.endDate ?? ev?.endDate,
    status: closed ? "closed" : m.active === false || m.acceptingOrders === false ? "unknown" : "open",
    yesBid,
    yesAsk,
    noBid: yesAsk !== undefined ? +(1 - yesAsk).toFixed(4) : undefined,
    noAsk: yesBid !== undefined ? +(1 - yesBid).toFixed(4) : undefined,
    // Settled markets report outcomePrices ["1","0"] / ["0","1"]; calibration reads lastPrice.
    lastPrice: closed ? prices[0] : num(m.lastTradePrice) ?? prices[0],
    volume: num(m.volumeNum ?? m.volume),
    source: "polymarket",
    polymarket: {
      conditionId: m.conditionId,
      yesTokenId,
      noTokenId,
      negRisk: m.negRisk === true,
      tickSize: num(m.orderPriceMinTickSize) ?? 0.01,
      minSize: num(m.orderMinSize) ?? 5,
    },
  };
}

async function gamma(path: string): Promise<any> {
  const res = await fetch(`${GAMMA_URL}${path}`, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!res.ok) throw new Error(`gamma ${path.split("?")[0]} ${res.status}`);
  return res.json();
}

let listCache: { at: number; markets: Market[] } | null = null;
const oneCache = new Map<string, { at: number; market?: Market }>();

/** Active, open, quoted binary markets from the highest-volume Polymarket events. */
export async function listPolymarketMarkets(): Promise<Market[]> {
  if (!polymarketEnabled) return [];
  if (listCache && Date.now() - listCache.at < 60_000) return listCache.markets;
  const json = await gamma(`/events?active=true&closed=false&archived=false&order=volume24hr&ascending=false&limit=${EVENT_LIMIT}`);
  const events: any[] = Array.isArray(json) ? json : json.data ?? [];
  const cutoff = Date.now() + MIN_TIME_TO_EXPIRY_MS;
  const out: Market[] = [];
  for (const ev of events) {
    const live = (ev.markets ?? []).filter((m: any) => m.active !== false && m.closed !== true);
    for (const raw of live) {
      const m = mapMarket(raw, ev, live.length > 1);
      if (!m || m.status !== "open") continue;
      if (m.expiresAt && Date.parse(m.expiresAt) < cutoff) continue;
      if (m.yesAsk === undefined && m.yesBid === undefined) continue; // no quotes, not useful
      out.push(m);
    }
  }
  listCache = { at: Date.now(), markets: out };
  return out;
}

/** Fetch one market by id (also closed/settled ones, which the active listing drops). */
export async function getPolymarketMarket(id: string): Promise<Market | undefined> {
  if (!isPolymarketId(id)) return undefined;
  const listed = listCache?.markets.find((m) => m.id === id);
  if (listed && Date.now() - listCache!.at < 60_000) return listed;
  const hit = oneCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.market;
  const conditionId = id.slice(PM_PREFIX.length);
  const json = await gamma(`/markets?condition_ids=${encodeURIComponent(conditionId)}&limit=1`);
  const raw = (Array.isArray(json) ? json : json.data ?? [])[0];
  const ev = raw?.events?.[0];
  const market = raw ? mapMarket(raw, ev, Boolean(raw.groupItemTitle && ev && (ev.markets?.length ?? 2) > 1)) : undefined;
  oneCache.set(id, { at: Date.now(), market });
  return market;
}

// ---------- auth (CLOB) ----------

const account = PRIVATE_KEY ? privateKeyToAccount((PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`) as Hex) : undefined;
type Creds = { key: string; secret: string; passphrase: string };
let creds: Creds | undefined =
  process.env.POLYMARKET_API_KEY && process.env.POLYMARKET_API_SECRET && process.env.POLYMARKET_API_PASSPHRASE
    ? { key: process.env.POLYMARKET_API_KEY, secret: process.env.POLYMARKET_API_SECRET, passphrase: process.env.POLYMARKET_API_PASSPHRASE }
    : undefined;

async function l1Headers(): Promise<Record<string, string>> {
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = await account!.signTypedData({
    domain: { name: "ClobAuthDomain", version: "1", chainId: CHAIN_ID },
    types: {
      ClobAuth: [
        { name: "address", type: "address" },
        { name: "timestamp", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "message", type: "string" },
      ],
    },
    primaryType: "ClobAuth",
    message: { address: account!.address, timestamp: ts, nonce: BigInt(0), message: "This message attests that I control the given wallet" },
  });
  return { POLY_ADDRESS: account!.address, POLY_SIGNATURE: signature, POLY_TIMESTAMP: ts, POLY_NONCE: "0" };
}

/** API creds from env, else derive the wallet's existing key, else create one (nonce 0, like the official client). */
async function getCreds(): Promise<Creds> {
  if (creds) return creds;
  const parse = (j: any): Creds | undefined => (j?.apiKey ? { key: j.apiKey, secret: j.secret, passphrase: j.passphrase } : undefined);
  for (const [method, path] of [["GET", "/auth/derive-api-key"], ["POST", "/auth/api-key"]] as const) {
    const res = await fetch(CLOB_URL + path, { method, headers: await l1Headers(), signal: AbortSignal.timeout(10000) });
    const c = res.ok ? parse(await res.json().catch(() => null)) : undefined;
    if (c) return (creds = c);
  }
  throw new Error("Polymarket: could not derive or create CLOB API credentials");
}

/** L2: url-safe base64 HMAC-SHA256 over timestamp + method + path (no query string) + body. */
async function clob<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const c = await getCreds();
  const ts = String(Math.floor(Date.now() / 1000));
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const secret = Buffer.from(c.secret.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const sig = crypto.createHmac("sha256", secret).update(ts + method + path + (body ?? "")).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_");
  const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
  const res = await fetch(CLOB_URL + path + qs, {
    method,
    headers: {
      "Content-Type": "application/json",
      POLY_ADDRESS: account!.address,
      POLY_SIGNATURE: sig,
      POLY_TIMESTAMP: ts,
      POLY_API_KEY: c.key,
      POLY_PASSPHRASE: c.passphrase,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Polymarket ${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function publicClob(path: string, query: Record<string, string>): Promise<any> {
  const res = await fetch(`${CLOB_URL}${path}?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!res.ok) throw new Error(`Polymarket ${path} ${res.status}`);
  return res.json();
}

// ---------- orders ----------

export type PolymarketOrderResult = {
  exchangeOrderId?: string;
  status: Order["status"];
  filledQuantity: number;
  avgFillPrice?: number;
  mode: "live";
  error?: string;
};

const decimals = (tick: number) => Math.max(0, Math.round(-Math.log10(tick)));

/** Build + EIP-712-sign a GTC limit order. Amounts use 6-decimal USDC/share units, as in the official client. */
async function signOrder(o: { tokenId: string; buy: boolean; size: number; price: number; tickSize: number; negRisk: boolean; feeRateBps: string }) {
  const priceDp = decimals(o.tickSize);
  const price = +o.price.toFixed(priceDp);
  const size = Math.floor(o.size * 100) / 100;
  // size has <=2 dp and price <=priceDp dp, so the product is exact at 2 + priceDp dp.
  const notional = (size * price).toFixed(2 + priceDp);
  const [makerAmount, takerAmount] = o.buy
    ? [parseUnits(notional, 6), parseUnits(size.toFixed(2), 6)]
    : [parseUnits(size.toFixed(2), 6), parseUnits(notional, 6)];
  const order = {
    salt: BigInt(Math.round(Math.random() * Date.now())),
    maker: (FUNDER || account!.address) as Hex,
    signer: account!.address,
    taker: ZERO_ADDRESS as Hex,
    tokenId: BigInt(o.tokenId),
    makerAmount,
    takerAmount,
    expiration: BigInt(0),
    nonce: BigInt(0),
    feeRateBps: BigInt(o.feeRateBps),
    side: o.buy ? 0 : 1,
    signatureType: SIGNATURE_TYPE,
  };
  const signature = await account!.signTypedData({
    domain: { name: "Polymarket CTF Exchange", version: "1", chainId: CHAIN_ID, verifyingContract: o.negRisk ? NEG_RISK_EXCHANGE : EXCHANGE },
    types: {
      Order: [
        { name: "salt", type: "uint256" },
        { name: "maker", type: "address" },
        { name: "signer", type: "address" },
        { name: "taker", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "makerAmount", type: "uint256" },
        { name: "takerAmount", type: "uint256" },
        { name: "expiration", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "feeRateBps", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "signatureType", type: "uint8" },
      ],
    },
    primaryType: "Order",
    message: order,
  });
  // Wire format matches orderToJson() in the official client.
  return {
    salt: Number(order.salt),
    maker: order.maker,
    signer: order.signer,
    taker: order.taker,
    tokenId: o.tokenId,
    makerAmount: makerAmount.toString(),
    takerAmount: takerAmount.toString(),
    side: o.buy ? "BUY" : "SELL",
    expiration: "0",
    nonce: "0",
    feeRateBps: o.feeRateBps,
    signatureType: SIGNATURE_TYPE,
    signature,
  };
}

function mapOpenOrder(o: any): { status: Order["status"]; filledQuantity: number; avgFillPrice?: number } {
  const filled = num(o.size_matched) ?? 0;
  const original = num(o.original_size) ?? 0;
  const s = String(o.status ?? "").toUpperCase();
  let status: Order["status"];
  if (s === "MATCHED" || (original > 0 && filled >= original)) status = "filled";
  else if (s.startsWith("CANCEL")) status = filled > 0 ? "partially_filled" : "cancelled";
  else if (s === "LIVE") status = filled > 0 ? "partially_filled" : "open";
  else status = "submitted";
  // The CLOB reports the order's limit price, not a VWAP; fills at better prices still show the limit.
  return { status, filledQuantity: filled, avgFillPrice: filled > 0 ? num(o.price) : undefined };
}

export async function placePolymarketOrder(market: Market, o: { side: Side; action: "buy" | "sell"; quantity: number; limitPrice: number }): Promise<PolymarketOrderResult> {
  const pm = market.polymarket;
  if (!pm) return { status: "rejected", filledQuantity: 0, mode: "live", error: "Missing Polymarket token ids" };
  if (o.quantity < pm.minSize)
    return { status: "rejected", filledQuantity: 0, mode: "live", error: `Polymarket minimum order is ${pm.minSize} contracts` };
  const tokenId = o.side === "YES" ? pm.yesTokenId : pm.noTokenId;
  try {
    const [tick, fee] = await Promise.all([
      publicClob("/tick-size", { token_id: tokenId }).then((r) => num(r?.minimum_tick_size) ?? pm.tickSize).catch(() => pm.tickSize),
      publicClob("/fee-rate", { token_id: tokenId }).then((r) => String(num(r?.base_fee) ?? 0)).catch(() => "0"),
    ]);
    if (o.limitPrice < tick || o.limitPrice > 1 - tick)
      return { status: "rejected", filledQuantity: 0, mode: "live", error: `Price must be between ${tick} and ${1 - tick}` };
    const order = await signOrder({ tokenId, buy: o.action === "buy", size: o.quantity, price: o.limitPrice, tickSize: tick, negRisk: pm.negRisk, feeRateBps: fee });
    const c = await getCreds();
    const resp = await clob<any>("POST", "/order", { body: { deferExec: false, order, owner: c.key, orderType: "GTC" } });
    if (resp?.success === false || !resp?.orderID)
      return { status: "rejected", filledQuantity: 0, mode: "live", error: resp?.errorMsg || "Order not accepted" };
    // Post response: status matched | live | delayed | unmatched; sizes in shares/USDC strings.
    const st = String(resp.status ?? "").toLowerCase();
    const shares = num(o.action === "buy" ? resp.takingAmount : resp.makingAmount) ?? 0;
    const usdc = num(o.action === "buy" ? resp.makingAmount : resp.takingAmount) ?? 0;
    const status: Order["status"] = st === "matched" ? (shares >= o.quantity - 1e-9 || !shares ? "filled" : "partially_filled") : st === "live" ? "open" : "submitted";
    const filledQuantity = status === "filled" ? o.quantity : status === "partially_filled" ? shares : 0;
    return {
      exchangeOrderId: String(resp.orderID),
      status,
      filledQuantity,
      avgFillPrice: filledQuantity > 0 ? (shares && usdc ? +(usdc / shares).toFixed(4) : o.limitPrice) : undefined,
      mode: "live",
    };
  } catch (e) {
    return { status: "error", filledQuantity: 0, mode: "live", error: (e as Error).message };
  }
}

export async function getPolymarketOrderStatus(orderId: string): Promise<{ status: Order["status"]; filledQuantity: number; avgFillPrice?: number } | undefined> {
  if (polymarketMode !== "live" || orderId.startsWith("sim-")) return undefined;
  try {
    const o = await clob<any>("GET", `/data/order/${orderId}`);
    return o && o.id ? mapOpenOrder(o) : undefined;
  } catch (e) {
    console.warn("[polymarket] getOrderStatus", (e as Error).message);
    return undefined;
  }
}

export async function getPolymarketBalance(): Promise<{ availableUsd: number; mode: "live" | "simulated" }> {
  if (polymarketMode !== "live") return { availableUsd: 1000, mode: "simulated" };
  try {
    const r = await clob<any>("GET", "/balance-allowance", { query: { asset_type: "COLLATERAL", signature_type: String(SIGNATURE_TYPE) } });
    return { availableUsd: (num(r?.balance) ?? 0) / 1e6, mode: "live" };
  } catch (e) {
    console.warn("[polymarket] getBalance failed:", (e as Error).message);
    return { availableUsd: 0, mode: "live" };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
