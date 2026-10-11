import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { config } from '../config.js';
import type { Db } from '../db/index.js';
import type { Catalog } from '../core/ports.js';

const MAX_SYMBOLS = 200;

export class TickRecorder {
  private ws: WebSocket | null = null;
  private stopped = true;
  private inserted = 0;
  private attempt = 0;
  private symbols: string[] = [];
  private lastTrade = new Map<string, string>();
  private tradeSeen = new Set<string>();
  private canon = new Map<string, string>();
  private book = new Map<string, { bid: number | null; ask: number | null }>();
  private buffer: unknown[][] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly db: Db, private readonly catalog: Catalog) {}

  get count(): number { return this.inserted; }

  async start(symbols?: string[]): Promise<void> {
    this.stopped = false;
    this.symbols = symbols ?? (await this.pickSymbols());
    this.canon = new Map(this.symbols.map((x) => [x.toLowerCase(), x]));
    this.flushTimer = setInterval(() => void this.flush(), 1000);
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.ws?.close();
    await this.flush();
  }

  private async pickSymbols(): Promise<string[]> {
    const rows = await this.db.query<{ instrument_symbol: string; category: string; expiry: string | null }>(
      `select instrument_symbol, category, expiry from markets where sandbox_listed or status = 'active'`,
    );
    const now = Date.now();
    const rank = (r: { category: string; expiry: string | null }) => {
      const t = r.expiry ? new Date(r.expiry).getTime() - now : Infinity;
      const pri = r.category === 'Sports' || r.category === 'Crypto' ? 0 : 1;
      return [t < 0 ? Infinity : t, pri] as const;
    };
    return rows
      .filter((r) => !r.expiry || new Date(r.expiry).getTime() > now)
      .sort((a, b) => {
        const [ta, pa] = rank(a);
        const [tb, pb] = rank(b);
        return pa - pb || ta - tb;
      })
      .slice(0, MAX_SYMBOLS)
      .map((r) => r.instrument_symbol);
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(config.gemini.productionWs);
    this.ws = ws;
    ws.on('open', () => {
      this.attempt = 0;
      const params = this.symbols.flatMap((s) => [`${s}@trade`, `${s}@bookTicker`]);
      // frames with ~100 params are silently dropped by the server; 20 per frame is acked
      for (let i = 0; i < params.length; i += 20) {
        setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ id: String(i + 1), method: 'SUBSCRIBE', params: params.slice(i, i + 20) })), (i / 20) * 50);
      }
    });
    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('error', () => undefined);
    ws.on('close', () => {
      if (this.stopped) return;
      const delay = Math.min(30_000, 500 * 2 ** this.attempt++);
      setTimeout(() => this.connect(), delay);
    });
  }

  private onMessage(raw: string): void {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    const d = m?.data ?? m;
    const stream: string | undefined = m?.stream ?? d?.stream;
    const e = d?.e;
    let sym: string | undefined = d?.s ?? (stream ? stream.split('@')[0] : undefined);
    if (!sym) return;
    sym = this.canon.get(sym.toLowerCase()) ?? sym;
    if ((stream?.endsWith('@bookTicker') || (d?.b !== undefined && d?.a !== undefined && d?.p === undefined))) {
      const prev = this.lastTrade.get(sym);
      this.book.set(sym, { bid: Number(d.b) || null, ask: Number(d.a) || null });
      if (d.c !== undefined) {
        const key = `${d.c}@${d.C}`;
        this.lastTrade.set(sym, key);
        if (prev !== undefined && prev !== key && !this.tradeSeen.has(sym)) {
          this.buffer.push([sym, new Date(), Number(d.c), Number(d.C), null, Number(d.b) || null, Number(d.a) || null]);
        }
      }
      return;
    }
    if (stream?.endsWith('@trade') || e === 'trade' || d?.p !== undefined) {
      this.tradeSeen.add(sym);
      const b = this.book.get(sym);
      const t = Number(d.t);
      const ts = t > 1e12 && t < 1e14 ? new Date(t) : new Date();
      this.buffer.push([sym, Number.isNaN(ts.getTime()) ? new Date() : ts, Number(d.p), Number(d.q), d.m === undefined ? null : d.m ? 'sell' : 'buy', b?.bid ?? null, b?.ask ?? null]);
    }
  }

  private async flush(): Promise<void> {
    if (!this.buffer.length) return;
    const batch = this.buffer.splice(0);
    const params: unknown[] = [];
    const rows = batch.map((r, k) => {
      params.push(r[0], (r[1] as Date).toISOString(), r[2], r[3], r[4], r[5], r[6]);
      const b = k * 7;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    try {
      await this.db.query(`insert into ticks (instrument_symbol,ts,last,trade_size,trade_side,bid,ask) values ${rows.join(',')}`, params);
      this.inserted += batch.length;
    } catch (err) {
      console.error('tick insert failed', (err as Error).message);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { openDb } = await import('../db/index.js');
  const { GeminiCatalog } = await import('./catalog.js');
  const db = await openDb();
  const catalog = new GeminiCatalog(db);
  console.log('contracts', await catalog.refresh());
  const rec = new TickRecorder(db, catalog);
  await rec.start();
  setInterval(() => console.log(new Date().toISOString(), 'ticks', rec.count), 30_000);
}
