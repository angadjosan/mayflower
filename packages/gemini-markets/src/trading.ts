import { createClient, type AuthStrategy } from "@gemini-markets/sdk/server";
import { askFor, bidFor, round, type ExecutionMode, type GeminiEnv, type OrderSide, type Outcome } from "@mayflower/shared";
import { num } from "./map";
import { toExchangeError, type MarketDataSource } from "./market-data";

export type TimeInForce = "good-til-cancel" | "immediate-or-cancel" | "fill-or-kill";

export interface PlaceOrderRequest {
  symbol: string;
  eventTicker: string;
  side: OrderSide;
  outcome: Outcome;
  quantity: number;
  limitPrice: number;
  timeInForce?: TimeInForce;
}

export interface ExchangeOrder {
  orderId: string;
  status: "open" | "filled" | "cancelled";
  symbol: string;
  side: OrderSide;
  outcome: Outcome;
  quantity: number;
  filledQuantity: number;
  avgExecutionPrice: number | null;
  limitPrice: number;
  createdAt: string | null;
  simulated: boolean;
  raw?: unknown;
}

export interface StoredOrderRef {
  exchangeOrderId: string;
  symbol: string;
  eventTicker: string;
  side: OrderSide;
  outcome: Outcome;
  quantity: number;
  limitPrice: number;
  createdAt: string;
}

export interface ExchangePosition {
  symbol: string;
  outcome: Outcome;
  quantity: number;
  avgPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number | null;
  resolutionSide: Outcome | null;
  eventTicker: string | null;
  label: string | null;
}

export interface TermsStatus {
  hasAcceptedLatest: boolean;
  latestVersion: number | null;
}

export interface TradingVenue {
  readonly mode: ExecutionMode;
  readonly simulated: boolean;
  termsStatus(): Promise<TermsStatus>;
  getTerms(): Promise<{ version: number; content: string } | null>;
  acceptTerms(): Promise<void>;
  placeLimitOrder(req: PlaceOrderRequest): Promise<ExchangeOrder>;
  refreshOrder(ref: StoredOrderRef): Promise<ExchangeOrder | null>;
  cancelOrder(ref: StoredOrderRef): Promise<void>;
  /** Exchange-reported positions for this credential; null when not applicable (simulated). */
  listPositions(): Promise<ExchangePosition[] | null>;
  /** Available USD balance for this credential; null when not applicable or unavailable. */
  usdBalance(): Promise<number | null>;
}

/** Format a decimal for the wire without float artifacts (e.g. 0.43, "12"). */
export function wireDecimal(value: number, maxDecimals = 4): string {
  return round(value, maxDecimals).toFixed(maxDecimals).replace(/\.?0+$/, "") || "0";
}

type Client = Awaited<ReturnType<typeof createClient>>;
type ApiOrder = {
  orderId?: bigint | number | string;
  status?: string;
  symbol?: string;
  side?: string;
  outcome?: string;
  quantity?: string;
  filledQuantity?: string;
  price?: string;
  avgExecutionPrice?: string | null;
  createdAt?: string;
};

function mapOrder(o: ApiOrder, fallback?: Partial<ExchangeOrder>): ExchangeOrder {
  const status = o.status === "filled" || o.status === "cancelled" ? o.status : "open";
  return {
    orderId: o.orderId !== undefined ? String(o.orderId) : (fallback?.orderId ?? ""),
    status,
    symbol: o.symbol ?? fallback?.symbol ?? "",
    side: (o.side as OrderSide) ?? fallback?.side ?? "buy",
    outcome: (o.outcome as Outcome) ?? fallback?.outcome ?? "yes",
    quantity: num(o.quantity) ?? fallback?.quantity ?? 0,
    filledQuantity: num(o.filledQuantity) ?? (status === "filled" ? (num(o.quantity) ?? 0) : 0),
    avgExecutionPrice: num(o.avgExecutionPrice),
    limitPrice: num(o.price) ?? fallback?.limitPrice ?? 0,
    createdAt: o.createdAt ?? null,
    simulated: false,
    raw: o,
  };
}

/**
 * Real Gemini prediction-market trading through the official SDK. Used for
 * both OAuth-linked user accounts and the shared sandbox API key.
 */
export class GeminiTradingVenue implements TradingVenue {
  readonly simulated = false;
  private client: Promise<Client>;

  constructor(
    readonly mode: Exclude<ExecutionMode, "simulated">,
    readonly env: GeminiEnv,
    auth: AuthStrategy,
    private readonly account?: string,
  ) {
    this.client = createClient({ env, auth, skipWsInit: true, timeoutMs: 20_000 });
  }

  async termsStatus(): Promise<TermsStatus> {
    try {
      const c = await this.client;
      const s = await c.predictions.getPredictionMarketsTermsStatus();
      return { hasAcceptedLatest: Boolean(s?.hasAcceptedLatest), latestVersion: s?.latestVersion ?? null };
    } catch (err) {
      throw toExchangeError(err, "Gemini terms status failed");
    }
  }

  async getTerms(): Promise<{ version: number; content: string } | null> {
    try {
      const c = await this.client;
      const t = await c.predictions.getPredictionMarketsTerms();
      return t ? { version: t.version, content: t.content } : null;
    } catch (err) {
      throw toExchangeError(err, "Gemini terms fetch failed");
    }
  }

  async acceptTerms(): Promise<void> {
    try {
      const c = await this.client;
      await c.predictions.acceptTerms();
    } catch (err) {
      throw toExchangeError(err, "Gemini terms acceptance failed");
    }
  }

  async placeLimitOrder(req: PlaceOrderRequest): Promise<ExchangeOrder> {
    const c = await this.client;
    try {
      // The SDK never retries order placement, so this is sent at most once per call.
      const res = await c.predictions.placeOrder({
        symbol: req.symbol,
        orderType: "limit",
        side: req.side,
        outcome: req.outcome,
        quantity: wireDecimal(req.quantity, 2),
        price: wireDecimal(req.limitPrice, 4),
        timeInForce: req.timeInForce ?? "good-til-cancel",
        makerOrCancel: false,
      });
      return mapOrder(res as ApiOrder, { symbol: req.symbol, side: req.side, outcome: req.outcome, quantity: req.quantity, limitPrice: req.limitPrice });
    } catch (err) {
      throw toExchangeError(err, "Gemini order placement failed");
    }
  }

  async refreshOrder(ref: StoredOrderRef): Promise<ExchangeOrder | null> {
    const c = await this.client;
    try {
      const active = await c.predictions.getActiveOrders({ symbol: ref.symbol, limit: 100 });
      const a = (active?.orders ?? []).find((o) => String(o.orderId) === ref.exchangeOrderId);
      if (a) return mapOrder(a as ApiOrder);
      const hist = await c.predictions.getOrderHistory({ symbol: ref.symbol, limit: 200 });
      const h = (hist?.orders ?? []).find((o) => String(o.orderId) === ref.exchangeOrderId);
      return h ? mapOrder(h as ApiOrder) : null;
    } catch (err) {
      throw toExchangeError(err, "Gemini order lookup failed");
    }
  }

  async cancelOrder(ref: StoredOrderRef): Promise<void> {
    const c = await this.client;
    try {
      await c.predictions.cancelOrder({ orderId: BigInt(ref.exchangeOrderId) });
    } catch (err) {
      throw toExchangeError(err, "Gemini order cancel failed");
    }
  }

  async listPositions(): Promise<ExchangePosition[] | null> {
    const c = await this.client;
    try {
      const out: ExchangePosition[] = [];
      for await (const p of c.predictions.iteratePositions({ limit: 200 })) {
        out.push({
          symbol: p.symbol ?? "",
          outcome: (p.outcome as Outcome) ?? "yes",
          quantity: num(p.totalQuantity) ?? 0,
          avgPrice: num(p.avgPrice),
          marketValue: num(p.marketValue),
          unrealizedPnl: num(p.unrealizedPnl),
          realizedPnl: num(p.realizedPl),
          resolutionSide: p.resolutionSide === "yes" || p.resolutionSide === "no" ? p.resolutionSide : null,
          eventTicker: p.contractMetadata?.eventTicker ?? null,
          label: p.contractMetadata?.contractName ?? null,
        });
      }
      return out;
    } catch (err) {
      throw toExchangeError(err, "Gemini positions lookup failed");
    }
  }

  async usdBalance(): Promise<number | null> {
    try {
      const c = await this.client;
      const input = (this.account ? { account: this.account } : {}) as Parameters<Client["account"]["getAvailableBalances"]>[0];
      const balances = (await c.account.getAvailableBalances(input)) as unknown as { currency?: string; amount?: string; available?: string }[];
      const usd = (balances ?? []).find((b) => (b.currency ?? "").toUpperCase() === "USD");
      return usd ? (num(usd.available) ?? num(usd.amount)) : 0;
    } catch {
      return null;
    }
  }
}

/**
 * Simulated venue: no exchange credentials. Orders fill against the current
 * quote (assuming enough size at the touch) and are labelled SIMULATED.
 */
export class SimulatedTradingVenue implements TradingVenue {
  readonly mode = "simulated" as const;
  readonly simulated = true;

  constructor(private readonly marketData: MarketDataSource) {}

  async termsStatus(): Promise<TermsStatus> {
    return { hasAcceptedLatest: true, latestVersion: null };
  }
  async getTerms() {
    return null;
  }
  async acceptTerms(): Promise<void> {}

  private async evaluate(req: { symbol: string; eventTicker: string; side: OrderSide; outcome: Outcome; limitPrice: number }) {
    const contract = await this.marketData.getContract(req.symbol, req.eventTicker);
    if (!contract) return { fillable: false, price: null as number | null, reason: "contract not found" };
    if (contract.status !== "active" || contract.marketState === "closed") return { fillable: false, price: null, reason: "market closed" };
    if (req.side === "buy") {
      const ask = askFor(contract.quote, req.outcome);
      return { fillable: ask !== null && req.limitPrice >= ask, price: ask, reason: null };
    }
    const bid = bidFor(contract.quote, req.outcome);
    return { fillable: bid !== null && req.limitPrice <= bid, price: bid, reason: null };
  }

  async placeLimitOrder(req: PlaceOrderRequest): Promise<ExchangeOrder> {
    const ev = await this.evaluate(req);
    const orderId = `SIM-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const base: ExchangeOrder = {
      orderId,
      status: "open",
      symbol: req.symbol,
      side: req.side,
      outcome: req.outcome,
      quantity: req.quantity,
      filledQuantity: 0,
      avgExecutionPrice: null,
      limitPrice: req.limitPrice,
      createdAt: new Date().toISOString(),
      simulated: true,
      raw: { simulated: true, reason: ev.reason },
    };
    if (ev.fillable && ev.price !== null) {
      return { ...base, status: "filled", filledQuantity: req.quantity, avgExecutionPrice: ev.price };
    }
    if (req.timeInForce === "immediate-or-cancel" || req.timeInForce === "fill-or-kill" || ev.reason) {
      return { ...base, status: "cancelled" };
    }
    return base;
  }

  async refreshOrder(ref: StoredOrderRef): Promise<ExchangeOrder | null> {
    const ev = await this.evaluate(ref);
    const base: ExchangeOrder = {
      orderId: ref.exchangeOrderId,
      status: "open",
      symbol: ref.symbol,
      side: ref.side,
      outcome: ref.outcome,
      quantity: ref.quantity,
      filledQuantity: 0,
      avgExecutionPrice: null,
      limitPrice: ref.limitPrice,
      createdAt: ref.createdAt,
      simulated: true,
    };
    if (ev.fillable && ev.price !== null) return { ...base, status: "filled", filledQuantity: ref.quantity, avgExecutionPrice: ev.price };
    if (ev.reason === "market closed") return { ...base, status: "cancelled" };
    return base;
  }

  async cancelOrder(): Promise<void> {}
  async listPositions(): Promise<ExchangePosition[] | null> {
    return null;
  }
  async usdBalance(): Promise<number | null> {
    return null;
  }
}
