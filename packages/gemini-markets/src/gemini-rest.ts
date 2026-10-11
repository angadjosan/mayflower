/**
 * Gemini Exchange Prediction Markets REST adapter.
 * Verified against https://developer.gemini.com/prediction-markets-spec (Oct 2026):
 *   GET  /v1/prediction-markets/events?status[]=active&limit=..   (public)
 *   GET  /v1/prediction-markets/events/{eventTicker}               (public)
 *   GET  /v1/prediction-markets/terms/status, POST .../terms/accept (auth)
 *   POST /v1/prediction-markets/order                               (auth, Trader role)
 *   POST /v1/prediction-markets/order/cancel  { orderId }
 *   POST /v1/prediction-markets/orders/active { symbol?, limit? }
 *   POST /v1/prediction-markets/orders/history{ status?, symbol? }
 *   POST /v1/prediction-markets/positions                           (auth)
 *   POST /v1/balances                                               (auth, spot endpoint)
 * Auth: HMAC-SHA384 over base64(JSON{request, nonce, ...params}); headers
 *   X-GEMINI-APIKEY / X-GEMINI-PAYLOAD / X-GEMINI-SIGNATURE, empty body, text/plain.
 * OAuth: Authorization: Bearer + X-GEMINI-PAYLOAD (no nonce). Prices are decimal
 * strings in 0..1; one market = one contract (instrumentSymbol).
 * Mayflower only ever requests the Trader role / orders:create scope — never Fund Manager.
 */
import { createHmac } from "node:crypto";
import type { ExecutionMode, Fill, Market, MarketQuote, OrderStatus } from "@mayflower/shared";
import { ExchangeError, type ExchangeBalance, type ExchangeClient, type ExchangeOrder, type ExchangePosition, type PlaceOrderRequest } from "./exchange";

export type GeminiAuth = { kind: "hmac"; apiKey: string; apiSecret: string } | { kind: "oauth"; accessToken: string };

export interface GeminiRestOptions {
  mode: Exclude<ExecutionMode, "simulated">;
  auth?: GeminiAuth;
  fetchImpl?: typeof fetch;
  /** Label override, e.g. "Sandbox – shared account" for Plan B. */
  label?: string;
}

// --- Venue payload shapes (subset) -----------------------------------------
interface GContract {
  id: string; label: string; description?: string; ticker: string; instrumentSymbol: string;
  prices?: { buy?: { yes?: string; no?: string }; sell?: { yes?: string; no?: string }; bestBid?: string; bestAsk?: string; lastTradePrice?: string };
  status?: string; marketState?: "open" | "closed"; quantityIncrement?: string; quantityMinimum?: string; priceIncrement?: string; expiryDate?: string; termsAndConditionsUrl?: string;
}
interface GEvent {
  id: string; title: string; slug?: string; description?: string; type: "binary" | "categorical"; category?: string; subcategory?: string; ticker: string;
  status: string; expiryDate?: string; contracts?: GContract[]; tags?: string[]; liquidity?: string | number; volume?: string | number; settlement?: unknown; sourceDetails?: unknown;
}
interface GOrder {
  orderId: number | string; clientOrderId?: string; status: "open" | "filled" | "cancelled" | string; symbol: string; side: string; outcome: string;
  quantity: string; filledQuantity?: string; remainingQuantity?: string; price?: string; avgExecutionPrice?: string; createdAt?: string; updatedAt?: string;
}

const num = (s: string | number | null | undefined): number | null => (s == null || s === "" ? null : Number(s));

export function eventToMarkets(e: GEvent): Market[] {
  const tags = [e.category, e.subcategory, ...(e.tags ?? [])].filter((x): x is string => Boolean(x)).map((t) => t.toLowerCase());
  return (e.contracts ?? []).map((c) => ({
    id: c.instrumentSymbol,
    exchange: "gemini" as const,
    title: e.type === "binary" || !c.label ? e.title : `${e.title} — ${c.label}`,
    eventId: e.ticker,
    resolutionRules: [e.description, c.description].filter(Boolean).join("\n\n") || null,
    tags,
    expiresAt: c.expiryDate ?? e.expiryDate ?? null,
    status: c.marketState === "open" && (c.status === "active" || e.status === "active") ? "open" : c.marketState === "closed" ? "closed" : e.status === "settled" ? "settled" : "unknown",
    url: e.slug ? `https://www.gemini.com/predictions/${e.slug}` : null,
    raw: { eventTicker: e.ticker, contractTicker: c.ticker, quantityIncrement: c.quantityIncrement, quantityMinimum: c.quantityMinimum, priceIncrement: c.priceIncrement, termsUrl: c.termsAndConditionsUrl, prices: c.prices },
  }));
}

export function contractToQuote(symbol: string, c: GContract | undefined): MarketQuote {
  const p = c?.prices;
  // buy.yes = price to buy YES (ask). sell.yes = price received selling YES (bid).
  const yesAsk = num(p?.buy?.yes) ?? num(p?.bestAsk);
  const yesBid = num(p?.sell?.yes) ?? num(p?.bestBid);
  return { marketId: symbol, timestamp: new Date().toISOString(), yesBid, yesAsk, last: num(p?.lastTradePrice), liquidity: null };
}

export function mapOrderStatus(s: string, filled: number, qty: number): OrderStatus {
  if (s === "filled") return "filled";
  if (s === "cancelled") return filled > 0 ? "partially_filled" : "cancelled";
  if (s === "open") return filled > 0 ? "partially_filled" : "open";
  if (s === "rejected") return "rejected";
  return filled >= qty && qty > 0 ? "filled" : "open";
}

export function mapOrder(o: GOrder): ExchangeOrder {
  const qty = Number(o.quantity), filled = Number(o.filledQuantity ?? 0);
  const avg = num(o.avgExecutionPrice);
  const fills: Fill[] = filled > 0 && avg != null ? [{ id: `${o.orderId}-agg`, quantity: filled, price: avg, fee: 0, timestamp: o.updatedAt ?? new Date().toISOString() }] : [];
  return { exchangeOrderId: String(o.orderId), clientOrderId: o.clientOrderId ?? "", status: mapOrderStatus(o.status, filled, qty), filledQuantity: filled, avgFillPrice: avg, fills, raw: o };
}

export class GeminiRestExchange implements ExchangeClient {
  readonly venue = "gemini" as const;
  readonly mode: ExecutionMode;
  readonly label: string;
  private base: string;
  private f: typeof fetch;
  private termsAccepted = false;
  private marketCache = new Map<string, { m: Market; c: GContract; at: number }>();

  constructor(private opts: GeminiRestOptions) {
    this.mode = opts.mode;
    this.base = opts.mode === "sandbox" ? "https://api.sandbox.gemini.com" : "https://api.gemini.com";
    this.f = opts.fetchImpl ?? fetch;
    this.label = opts.label ?? (opts.mode === "sandbox" ? "Gemini sandbox" : "Gemini live");
  }

  // --- transport -----------------------------------------------------------
  private async publicGet<T>(path: string, query?: Record<string, string | string[] | number | undefined>): Promise<T> {
    const u = new URL(this.base + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(`${k}[]`, x));
      else u.searchParams.set(k, String(v));
    }
    const res = await this.f(u, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new ExchangeError(`Gemini GET ${path} ${res.status}`, "HTTP_" + res.status, await res.text().catch(() => ""));
    return (await res.json()) as T;
  }

  private async privatePost<T>(path: string, params: Record<string, unknown> = {}, query?: Record<string, string | number | undefined>): Promise<T> {
    if (!this.opts.auth) throw new ExchangeError("No Gemini credentials linked for this user", "NOT_LINKED");
    const u = new URL(this.base + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const headers: Record<string, string> = { "Content-Type": "text/plain", "Content-Length": "0", "Cache-Control": "no-cache" };
    if (this.opts.auth.kind === "hmac") {
      const payload = Buffer.from(JSON.stringify({ request: path, nonce: Math.floor(Date.now() / 1000), ...params })).toString("base64");
      headers["X-GEMINI-APIKEY"] = this.opts.auth.apiKey;
      headers["X-GEMINI-PAYLOAD"] = payload;
      headers["X-GEMINI-SIGNATURE"] = createHmac("sha384", this.opts.auth.apiSecret).update(payload).digest("hex");
    } else {
      headers["Authorization"] = `Bearer ${this.opts.auth.accessToken}`;
      headers["X-GEMINI-PAYLOAD"] = Buffer.from(JSON.stringify({ request: path, ...params })).toString("base64");
    }
    const res = await this.f(u, { method: "POST", headers, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    if (!res.ok) {
      const b = body as { reason?: string; message?: string } | string;
      const reason = typeof b === "object" && b ? b.reason ?? b.message ?? res.statusText : res.statusText;
      throw new ExchangeError(`Gemini ${path} failed: ${reason}`, typeof b === "object" && b?.reason ? b.reason : "HTTP_" + res.status, body);
    }
    return body as T;
  }

  // --- markets -------------------------------------------------------------
  async listMarkets(opts: { status?: "open" | "all"; query?: string } = {}): Promise<Market[]> {
    const r = await this.publicGet<{ data: GEvent[] }>("/v1/prediction-markets/events", {
      status: opts.status === "all" ? undefined : ["active"], search: opts.query, limit: 200,
    });
    const out: Market[] = [];
    for (const e of r.data ?? []) {
      for (const c of e.contracts ?? []) {
        const [m] = eventToMarkets({ ...e, contracts: [c] });
        if (!m) continue;
        this.marketCache.set(m.id, { m, c, at: Date.now() });
        if (opts.status === "all" || m.status === "open") out.push(m);
      }
    }
    return out;
  }

  private async refreshContract(symbol: string): Promise<{ m: Market; c: GContract } | null> {
    const cached = this.marketCache.get(symbol);
    const eventTicker = (cached?.m.raw as { eventTicker?: string } | undefined)?.eventTicker;
    if (eventTicker) {
      const e = await this.publicGet<{ data?: GEvent } | GEvent>(`/v1/prediction-markets/events/${encodeURIComponent(eventTicker)}`);
      const ev = ("data" in e && e.data ? e.data : e) as GEvent;
      for (const c of ev.contracts ?? []) {
        const [m] = eventToMarkets({ ...ev, contracts: [c] });
        if (m) this.marketCache.set(m.id, { m, c, at: Date.now() });
      }
    } else {
      await this.listMarkets({ status: "all" });
    }
    const hit = this.marketCache.get(symbol);
    return hit ? { m: hit.m, c: hit.c } : null;
  }

  async getMarket(marketId: string): Promise<Market | null> {
    const cached = this.marketCache.get(marketId);
    if (cached && Date.now() - cached.at < 60_000) return cached.m;
    return (await this.refreshContract(marketId))?.m ?? null;
  }

  async getQuote(marketId: string): Promise<MarketQuote> {
    const hit = await this.refreshContract(marketId);
    if (!hit) throw new ExchangeError(`Unknown market ${marketId}`, "NOT_FOUND");
    return contractToQuote(marketId, hit.c);
  }

  // --- trading -------------------------------------------------------------
  async ensureTermsAccepted(): Promise<void> {
    if (this.termsAccepted) return;
    const s = await this.privatePost<{ hasAcceptedLatest: boolean }>("/v1/prediction-markets/terms/status");
    if (!s.hasAcceptedLatest) await this.privatePost("/v1/prediction-markets/terms/accept");
    this.termsAccepted = true;
  }

  async placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder> {
    await this.ensureTermsAccepted();
    // Idempotency: if an order with this clientOrderId already exists, return it instead of re-sending.
    const existing = await this.findByClientOrderId(req.clientOrderId, req.marketId).catch(() => null);
    if (existing) return existing;
    const o = await this.privatePost<GOrder>("/v1/prediction-markets/order", {
      symbol: req.marketId,
      orderType: "limit",
      side: req.action.toLowerCase(),
      outcome: req.side.toLowerCase(),
      quantity: String(req.quantity),
      price: req.limitPrice.toFixed(2),
      timeInForce: "good-til-cancel",
      clientOrderId: req.clientOrderId,
    });
    return { ...mapOrder(o), clientOrderId: req.clientOrderId };
  }

  private async findByClientOrderId(clientOrderId: string, symbol: string): Promise<ExchangeOrder | null> {
    const active = await this.privatePost<GOrder[] | { orders?: GOrder[] }>("/v1/prediction-markets/orders/active", { symbol, limit: 100 });
    const list = Array.isArray(active) ? active : active.orders ?? [];
    const hit = list.find((o) => o.clientOrderId === clientOrderId);
    return hit ? mapOrder(hit) : null;
  }

  async getOrder(exchangeOrderId: string): Promise<ExchangeOrder> {
    const active = await this.privatePost<GOrder[] | { orders?: GOrder[] }>("/v1/prediction-markets/orders/active", { limit: 100 });
    const a = (Array.isArray(active) ? active : active.orders ?? []).find((o) => String(o.orderId) === exchangeOrderId);
    if (a) return mapOrder(a);
    const hist = await this.privatePost<GOrder[] | { orders?: GOrder[] }>("/v1/prediction-markets/orders/history", { limit: 200 });
    const h = (Array.isArray(hist) ? hist : hist.orders ?? []).find((o) => String(o.orderId) === exchangeOrderId);
    if (!h) throw new ExchangeError(`Order ${exchangeOrderId} not found`, "NOT_FOUND");
    return mapOrder(h);
  }

  async cancelOrder(exchangeOrderId: string): Promise<ExchangeOrder> {
    await this.privatePost("/v1/prediction-markets/order/cancel", { orderId: Number(exchangeOrderId) });
    return this.getOrder(exchangeOrderId);
  }

  async getPositions(): Promise<ExchangePosition[]> {
    const r = await this.privatePost<{ positions?: Array<{ symbol: string; totalQuantity: string; avgPrice: string; outcome: string }> }>("/v1/prediction-markets/positions", {}, { limit: 200 });
    return (r.positions ?? []).map((p) => ({ marketId: p.symbol, side: p.outcome.toUpperCase() === "NO" ? "NO" : "YES", quantity: Number(p.totalQuantity), avgPrice: Number(p.avgPrice), raw: p }));
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    const r = await this.privatePost<Array<{ currency: string; amount: string; available: string }>>("/v1/balances");
    return r.map((b) => ({ currency: b.currency, available: Number(b.available), total: Number(b.amount) }));
  }
}
