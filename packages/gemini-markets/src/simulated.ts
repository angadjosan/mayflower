/**
 * In-memory simulated venue. Fills immediately at the limit price. Used for
 * tests and when MAYFLOWER_EXCHANGE_MODE=simulated. Everything it returns is
 * labelled "Simulated" through `label` / `mode`.
 */
import type { Fill, Market, MarketQuote } from "@mayflower/shared";
import { newId } from "@mayflower/shared";
import { ExchangeError, type ExchangeBalance, type ExchangeClient, type ExchangeOrder, type ExchangePosition, type PlaceOrderRequest } from "./exchange";

export interface SimulatedMarketSeed extends Market {
  yesBid: number;
  yesAsk: number;
}

export const DEFAULT_SIM_MARKETS: SimulatedMarketSeed[] = [
  { id: "SIM-NFL-SEA-NFCW-2026", exchange: "gemini", title: "Will the Seattle Seahawks win the NFC West in the 2026 season?", eventId: "nfl-2026-divisions", resolutionRules: "Resolves YES if the Seahawks are the official NFC West champion per NFL standings at the end of the 2026 regular season.", tags: ["nfl", "seahawks", "sports"], expiresAt: "2027-01-10T00:00:00Z", status: "open", yesBid: 0.40, yesAsk: 0.42 },
  { id: "SIM-AI-CAPEX-2026", exchange: "gemini", title: "Will combined 2026 capex of Microsoft, Alphabet, Amazon and Meta exceed $400B?", eventId: "ai-infra-2026", resolutionRules: "Resolves YES if the sum of reported FY2026 capital expenditures exceeds $400B per company filings.", tags: ["ai", "technology", "capex"], expiresAt: "2027-03-01T00:00:00Z", status: "open", yesBid: 0.61, yesAsk: 0.64 },
  { id: "SIM-US-RECESSION-2026", exchange: "gemini", title: "Will the US enter a recession (NBER-dated) beginning in 2026?", eventId: "macro-2026", resolutionRules: "Resolves YES if the NBER Business Cycle Dating Committee dates a peak within calendar 2026.", tags: ["macro", "economics", "recession"], expiresAt: "2027-12-31T00:00:00Z", status: "open", yesBid: 0.22, yesAsk: 0.25 },
  { id: "SIM-FED-CUT-DEC-2026", exchange: "gemini", title: "Will the Fed cut rates at the December 2026 FOMC meeting?", eventId: "macro-2026", resolutionRules: "Resolves YES if the target range upper bound is lower after the December 2026 meeting than before it.", tags: ["macro", "fed", "economics"], expiresAt: "2026-12-17T00:00:00Z", status: "open", yesBid: 0.55, yesAsk: 0.58 },
  { id: "SIM-BTC-150K-2026", exchange: "gemini", title: "Will Bitcoin trade above $150,000 before 2027?", eventId: "crypto-2026", resolutionRules: "Resolves YES if BTC/USD prints above $150,000 on Gemini before 2027-01-01 UTC.", tags: ["crypto", "bitcoin"], expiresAt: "2027-01-01T00:00:00Z", status: "open", yesBid: 0.30, yesAsk: 0.33 },
  { id: "SIM-WEATHER-NYC-SNOW-DEC", exchange: "gemini", title: "Will Central Park record 6+ inches of snow in December 2026?", eventId: "weather-2026", resolutionRules: "Resolves YES per NWS Central Park monthly snowfall total ≥ 6.0 inches.", tags: ["weather", "nyc"], expiresAt: "2027-01-02T00:00:00Z", status: "open", yesBid: 0.35, yesAsk: 0.39 },
];

export class SimulatedExchange implements ExchangeClient {
  readonly venue = "gemini" as const;
  readonly mode = "simulated" as const;
  readonly label = "Simulated (no real venue)";
  private orders = new Map<string, ExchangeOrder>();
  private byClientId = new Map<string, string>();
  private positions = new Map<string, ExchangePosition>();
  private cash: number;

  constructor(private markets: SimulatedMarketSeed[] = DEFAULT_SIM_MARKETS, startingCash = 1000) {
    this.cash = startingCash;
  }

  async listMarkets(opts: { status?: "open" | "all"; query?: string } = {}): Promise<Market[]> {
    const q = opts.query?.toLowerCase();
    return this.markets
      .filter((m) => (opts.status ?? "open") === "all" || m.status === "open")
      .filter((m) => !q || m.title.toLowerCase().includes(q) || m.tags.some((t) => t.includes(q)))
      .map(({ yesBid: _b, yesAsk: _a, ...m }) => m);
  }

  async getMarket(marketId: string): Promise<Market | null> {
    const m = this.markets.find((x) => x.id === marketId);
    if (!m) return null;
    const { yesBid: _b, yesAsk: _a, ...rest } = m;
    return rest;
  }

  async getQuote(marketId: string): Promise<MarketQuote> {
    const m = this.markets.find((x) => x.id === marketId);
    if (!m) throw new ExchangeError(`Unknown market ${marketId}`, "NOT_FOUND");
    return { marketId, timestamp: new Date().toISOString(), yesBid: m.yesBid, yesAsk: m.yesAsk, last: (m.yesBid + m.yesAsk) / 2, liquidity: 500 };
  }

  /** Test helper: move a price to exercise monitoring. */
  setQuote(marketId: string, yesBid: number, yesAsk: number) {
    const m = this.markets.find((x) => x.id === marketId);
    if (m) { m.yesBid = yesBid; m.yesAsk = yesAsk; }
  }

  async placeOrder(req: PlaceOrderRequest): Promise<ExchangeOrder> {
    const existing = this.byClientId.get(req.clientOrderId);
    if (existing) return this.orders.get(existing)!; // idempotent
    const m = this.markets.find((x) => x.id === req.marketId);
    if (!m || m.status !== "open") throw new ExchangeError(`Market ${req.marketId} is not open`, "MARKET_CLOSED");
    const cost = req.quantity * req.limitPrice;
    if (req.action === "BUY" && cost > this.cash) throw new ExchangeError("Insufficient simulated balance", "INSUFFICIENT_FUNDS");
    const fill: Fill = { id: newId(), quantity: req.quantity, price: req.limitPrice, fee: 0, timestamp: new Date().toISOString() };
    const order: ExchangeOrder = { exchangeOrderId: `sim_${newId()}`, clientOrderId: req.clientOrderId, status: "filled", filledQuantity: req.quantity, avgFillPrice: req.limitPrice, fills: [fill] };
    this.orders.set(order.exchangeOrderId, order);
    this.byClientId.set(req.clientOrderId, order.exchangeOrderId);
    const key = `${req.marketId}:${req.side}`;
    const pos = this.positions.get(key) ?? { marketId: req.marketId, side: req.side, quantity: 0, avgPrice: 0 };
    if (req.action === "BUY") {
      const newQty = pos.quantity + req.quantity;
      pos.avgPrice = (pos.avgPrice * pos.quantity + req.limitPrice * req.quantity) / newQty;
      pos.quantity = newQty;
      this.cash -= cost;
    } else {
      pos.quantity = Math.max(0, pos.quantity - req.quantity);
      this.cash += cost;
    }
    this.positions.set(key, pos);
    return order;
  }

  async getOrder(id: string): Promise<ExchangeOrder> {
    const o = this.orders.get(id);
    if (!o) throw new ExchangeError(`Unknown order ${id}`, "NOT_FOUND");
    return o;
  }

  async cancelOrder(id: string): Promise<ExchangeOrder> {
    const o = await this.getOrder(id);
    if (o.status === "open") o.status = "cancelled";
    return o;
  }

  async getPositions(): Promise<ExchangePosition[]> {
    return [...this.positions.values()].filter((p) => p.quantity > 0);
  }

  async getBalances(): Promise<ExchangeBalance[]> {
    return [{ currency: "USD", available: this.cash, total: this.cash }];
  }
}
