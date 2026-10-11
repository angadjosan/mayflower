/**
 * Venue-agnostic exchange interface. The agents, risk engine and execution
 * service only ever talk to this. Gemini is the P0 venue; a simulated venue
 * exists so the whole loop runs offline and so "simulated" is always labelled.
 */
import type { ExecutionMode, Fill, Market, MarketQuote, OrderAction, OrderStatus, Side } from "@mayflower/shared";

export interface PlaceOrderRequest {
  marketId: string;
  side: Side;
  action: OrderAction;
  quantity: number;
  limitPrice: number;
  /** Idempotency key; the venue must reject or dedupe a repeat. */
  clientOrderId: string;
}

export interface ExchangeOrder {
  exchangeOrderId: string;
  clientOrderId: string;
  status: OrderStatus;
  filledQuantity: number;
  avgFillPrice: number | null;
  fills: Fill[];
  raw?: unknown;
}

export interface ExchangePosition {
  marketId: string;
  side: Side;
  quantity: number;
  avgPrice: number;
  raw?: unknown;
}

export interface ExchangeBalance {
  currency: string;
  available: number;
  total: number;
}

export interface ExchangeClient {
  readonly venue: "gemini";
  readonly mode: ExecutionMode;
  /** Human label shown in the UI, e.g. "Gemini sandbox" or "Simulated". */
  readonly label: string;
  listMarkets(opts?: { status?: "open" | "all"; query?: string }): Promise<Market[]>;
  getMarket(marketId: string): Promise<Market | null>;
  getQuote(marketId: string): Promise<MarketQuote>;
  placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder>;
  getOrder(exchangeOrderId: string): Promise<ExchangeOrder>;
  cancelOrder(exchangeOrderId: string): Promise<ExchangeOrder>;
  getPositions(): Promise<ExchangePosition[]>;
  getBalances(): Promise<ExchangeBalance[]>;
}

export class ExchangeError extends Error {
  constructor(message: string, public code: string = "EXCHANGE_ERROR", public raw?: unknown) {
    super(message);
  }
}
