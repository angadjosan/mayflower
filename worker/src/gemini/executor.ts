import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import type { Catalog, Executor } from '../core/ports.js';
import type { Market, OrderRequest, OrderResult, OrderStatus } from '../core/types.js';

export class SimExecutor implements Executor {
  readonly mode = 'simulated' as const;
  constructor(private readonly catalog: Catalog) {}

  async place(req: OrderRequest, market: Market): Promise<OrderResult> {
    const q = await this.catalog.quote(market.symbol);
    const ask = q ? (req.side === 'yes' ? q.yesAsk : q.noAsk) : null;
    if (ask !== null && req.limitPrice >= ask) {
      return { status: 'filled', exchangeOrderId: `sim-${req.clientOrderId}`, filledQty: req.qty, avgPrice: req.limitPrice, error: null, simulated: true, raw: { ask } };
    }
    return { status: 'open', exchangeOrderId: `sim-${req.clientOrderId}`, filledQty: 0, avgPrice: null, error: null, simulated: true, raw: { ask } };
  }
}

interface GeminiOrder {
  orderId?: number | string;
  status?: string;
  filledQuantity?: string;
  avgExecutionPrice?: string | null;
  [k: string]: unknown;
}

export class SandboxExecutor implements Executor {
  readonly mode = 'sandbox' as const;
  private lastNonce = 0;
  constructor(private readonly apiKey: string, private readonly apiSecret: string, private readonly base = config.gemini.sandboxRest) {}

  private async post(path: string, body: Record<string, unknown> = {}): Promise<{ status: number; json: any }> {
    this.lastNonce = Math.max(this.lastNonce + 1, Date.now());
    const b64 = Buffer.from(JSON.stringify({ request: path, nonce: this.lastNonce, ...body })).toString('base64');
    const sig = createHmac('sha384', this.apiSecret).update(b64).digest('hex');
    const r = await fetch(this.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache', 'X-GEMINI-APIKEY': this.apiKey, 'X-GEMINI-PAYLOAD': b64, 'X-GEMINI-SIGNATURE': sig },
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    let json: unknown = text;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { status: r.status, json };
  }

  async init(): Promise<void> {
    const r = await this.post('/v1/prediction-markets/terms/accept');
    if (r.status >= 400) {
      const msg = JSON.stringify(r.json).toLowerCase();
      if (!msg.includes('already')) throw new Error(`terms/accept failed ${r.status}: ${JSON.stringify(r.json)}`);
    }
  }

  async place(req: OrderRequest, market: Market): Promise<OrderResult> {
    if (!market.sandboxListed) throw new Error('not listed on sandbox');
    const body = {
      symbol: market.symbol,
      orderType: 'limit',
      side: 'buy',
      quantity: String(req.qty),
      price: String(req.limitPrice),
      outcome: req.side,
      timeInForce: 'good-til-cancel',
      makerOrCancel: false,
    };
    const placed = await this.post('/v1/prediction-markets/order', body);
    if (placed.status >= 400 || !placed.json || placed.json.orderId === undefined) {
      const rejected = placed.status >= 400 && placed.status < 500;
      return { status: rejected ? 'rejected' : 'unknown', exchangeOrderId: null, filledQty: 0, avgPrice: null, error: `HTTP ${placed.status}: ${JSON.stringify(placed.json)}`, simulated: false, raw: placed.json };
    }
    let order = placed.json as GeminiOrder;
    const id = String(order.orderId);
    const deadline = Date.now() + 8000;
    while (order.status !== 'filled' && order.status !== 'cancelled' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const found = await this.reconcile(id, market.symbol).catch(() => null);
      if (found) order = found;
    }
    return this.toResult(order);
  }

  private async reconcile(id: string, symbol: string): Promise<GeminiOrder | null> {
    const active = await this.post('/v1/prediction-markets/orders/active', { symbol, limit: 100, offset: 0 });
    const a = this.list(active.json).find((o) => String(o.orderId) === id);
    if (a) return a;
    for (const status of ['filled', 'cancelled']) {
      const h = await this.post('/v1/prediction-markets/orders/history', { status, symbol, limit: 100, offset: 0 });
      const o = this.list(h.json).find((x) => String(x.orderId) === id);
      if (o) return o;
    }
    return null;
  }

  private list(j: any): GeminiOrder[] {
    if (Array.isArray(j)) return j;
    if (Array.isArray(j?.data)) return j.data;
    if (Array.isArray(j?.orders)) return j.orders;
    return [];
  }

  private toResult(o: GeminiOrder): OrderResult {
    const filled = Number(o.filledQuantity ?? 0) || 0;
    const avg = o.avgExecutionPrice ? Number(o.avgExecutionPrice) : null;
    const total = Number((o as { quantity?: string }).quantity ?? 0);
    let status: OrderStatus;
    if (o.status === 'filled') status = 'filled';
    else if (o.status === 'cancelled') status = filled > 0 ? 'partially_filled' : 'cancelled';
    else if (['open', 'accepted', 'new', 'live', 'active', 'booked'].includes(String(o.status).toLowerCase())) status = filled > 0 && (!total || filled < total) ? 'partially_filled' : 'open';
    else status = filled > 0 ? 'partially_filled' : 'unknown';
    return { status, exchangeOrderId: String(o.orderId), filledQty: filled, avgPrice: avg, error: null, simulated: false, raw: o };
  }
}
