import { config } from '../config.js';
import type { Db } from '../db/index.js';
import type { Catalog } from '../core/ports.js';
import type { Market, MarketCandidate, Quote } from '../core/types.js';

interface RawContract {
  label?: string;
  instrumentSymbol?: string;
  ticker?: string;
  status?: string;
  marketState?: string;
  expiryDate?: string | null;
  description?: { content?: { value?: string }[] };
  prices?: { buy?: { yes?: string; no?: string }; sell?: { yes?: string; no?: string } };
  priceIncrement?: string;
  priceMinimum?: string;
  quantityIncrement?: string;
  quantityMinimum?: string;
}
interface RawEvent {
  title: string;
  ticker: string;
  category?: string;
  tags?: unknown[];
  status?: string;
  expiryDate?: string | null;
  contracts?: RawContract[];
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'will', 'be', 'is', 'are', 'and', 'or', 'for', 'by', 'vs', 'win', 'wins', 'game', 'i', 'think', 'that', 'this', 'with', 'it', 'going', 'next']);
const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ALIAS: Record<string, string[]> = { bitcoin: ['btc'], btc: ['bitcoin'], ethereum: ['eth'], eth: ['ethereum'], solana: ['sol'], sol: ['solana'], gold: ['xau'], oil: ['crude'] };
const tokens = (s: string) => {
  const base = s.toLowerCase().split(/[^a-z0-9$]+/).filter((t) => t.length > 1 && !STOP.has(t));
  return base.flatMap((t) => [t, ...(ALIAS[t] ?? [])]);
};

interface Entry { market: Market; hay: string; labelTokens: string[]; prod?: Quote; sandbox?: Quote; fetchedAt: number }

export class GeminiCatalog implements Catalog {
  private entries = new Map<string, Entry>();
  constructor(private readonly db: Db) {}

  async refresh(): Promise<number> {
    const [prod, sand] = await Promise.all([
      this.fetchAll(config.gemini.productionRest).catch(() => null),
      this.fetchAll(config.gemini.sandboxRest).catch(() => null),
    ]);
    if (!prod && !sand) throw new Error('both Gemini hosts failed');
    // Symbols (GEMI-<eventTicker>-<contractTicker>) are identical across hosts, so sandboxListed keys on symbol.
    const sandSymbols = new Set<string>();
    const next = new Map<string, Entry>();
    const now = Date.now();
    const ingest = (events: RawEvent[], venue: 'prod' | 'sandbox') => {
      for (const ev of events) {
        for (const c of ev.contracts ?? []) {
          if (!c.instrumentSymbol) continue;
          const sym = c.instrumentSymbol;
          const q = this.toQuote(sym, c);
          if (venue === 'sandbox') sandSymbols.add(sym);
          let e = next.get(sym);
          if (!e) {
            const label = c.label ?? '';
            const market: Market = {
              symbol: sym,
              eventTicker: ev.ticker,
              eventTitle: ev.title,
              label,
              title: `${ev.title} — ${label}`,
              category: ev.category ?? 'Other',
              rules: (c.description?.content ?? []).map((x) => x.value ?? '').join(' ').trim() || null,
              expiry: c.expiryDate ?? ev.expiryDate ?? null,
              status: c.marketState === 'closed' ? 'closed' : (c.status ?? ev.status ?? 'active'),
              priceIncrement: num(c.priceIncrement) ?? 0.01,
              priceMinimum: num(c.priceMinimum) ?? 0.01,
              quantityIncrement: num(c.quantityIncrement) ?? 1,
              quantityMinimum: num(c.quantityMinimum) ?? 1,
              sandboxListed: false,
            };
            const tags = (ev.tags ?? []).map((t) => (typeof t === 'string' ? t : JSON.stringify(t))).join(' ');
            e = { market, hay: `${market.title} ${market.category} ${tags}`.toLowerCase(), labelTokens: tokens(`${label} ${ev.title}`), fetchedAt: now };
            next.set(sym, e);
          }
          e[venue === 'prod' ? 'prod' : 'sandbox'] = q;
        }
      }
    };
    if (prod) ingest(prod, 'prod');
    if (sand) ingest(sand, 'sandbox');
    for (const e of next.values()) e.market.sandboxListed = sandSymbols.has(e.market.symbol);
    this.entries = next;
    await this.persist([...next.values()]);
    return next.size;
  }

  private toQuote(symbol: string, c: RawContract): Quote {
    const p = c.prices ?? {};
    return {
      symbol,
      yesAsk: num(p.buy?.yes),
      yesBid: num(p.sell?.yes),
      noAsk: num(p.buy?.no),
      noBid: num(p.sell?.no),
      ts: new Date().toISOString(),
    };
  }

  private async fetchAll(base: string): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    const limit = 500;
    for (let offset = 0; offset < 5000; offset += limit) {
      const r = await fetch(`${base}/v1/prediction-markets/events?status=active&limit=${limit}&offset=${offset}`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`${base} events ${r.status}`);
      const j = (await r.json()) as { data: RawEvent[]; pagination?: { total?: number } };
      out.push(...j.data);
      if (j.data.length < limit || (j.pagination?.total !== undefined && out.length >= j.pagination.total)) break;
    }
    return out;
  }

  private async persist(entries: Entry[]): Promise<void> {
    const cols = 9;
    const chunk = 100;
    for (let i = 0; i < entries.length; i += chunk) {
      const part = entries.slice(i, i + chunk);
      const params: unknown[] = [];
      const rows = part.map((e, k) => {
        const m = e.market;
        params.push(m.symbol, m.eventTicker, m.title, m.label, m.category, m.rules, m.expiry, m.status, m.sandboxListed);
        const b = k * cols;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},now())`;
      });
      await this.db.query(
        `insert into markets (instrument_symbol,event_ticker,title,label,category,rules,expiry,status,sandbox_listed,updated_at) values ${rows.join(',')}
         on conflict (instrument_symbol) do update set event_ticker=excluded.event_ticker,title=excluded.title,label=excluded.label,category=excluded.category,
         rules=excluded.rules,expiry=excluded.expiry,status=excluded.status,sandbox_listed=excluded.sandbox_listed,updated_at=now()`,
        params,
      );
    }
  }

  async search(text: string, limit = 8): Promise<MarketCandidate[]> {
    const q = tokens(text);
    if (!q.length) return [];
    const out: MarketCandidate[] = [];
    for (const e of this.entries.values()) {
      if (e.market.status === 'closed') continue;
      let score = 0;
      for (const t of q) {
        if (e.labelTokens.includes(t)) score += 3;
        else if (e.hay.includes(t)) score += 2;
        else if (t.length >= 4 && e.labelTokens.some((l) => l.startsWith(t.slice(0, 4)) || t.startsWith(l.slice(0, 4)))) score += 1;
      }
      if (score > 0) out.push({ market: e.market, score: Math.min(1, score / (q.length * 3)) + (e.market.sandboxListed ? 0.01 : 0) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async get(symbol: string): Promise<Market | null> {
    return this.entries.get(symbol)?.market ?? null;
  }

  async quote(symbol: string): Promise<Quote | null> {
    const e = this.entries.get(symbol);
    if (!e) return null;
    if (Date.now() - e.fetchedAt > 60_000) await this.refreshOne(e).catch(() => undefined);
    const has = (x?: Quote) => !!x && (x.yesAsk !== null || x.yesBid !== null);
    const primary = e.market.sandboxListed ? e.sandbox : e.prod;
    if (e.market.sandboxListed) return has(e.sandbox) ? e.sandbox! : null;
    return has(e.prod) ? e.prod! : null;
  }

  private async refreshOne(e: Entry): Promise<void> {
    const venues: ['prod' | 'sandbox', string][] = [['prod', config.gemini.productionRest]];
    if (e.market.sandboxListed) venues.push(['sandbox', config.gemini.sandboxRest]);
    await Promise.all(venues.map(async ([v, base]) => {
      const r = await fetch(`${base}/v1/prediction-markets/events/${encodeURIComponent(e.market.eventTicker)}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const j = (await r.json()) as RawEvent | { data: RawEvent };
      const ev = 'data' in j ? j.data : j;
      const c = ev.contracts?.find((x) => x.instrumentSymbol === e.market.symbol);
      if (c) {
        e[v] = this.toQuote(e.market.symbol, c);
        if (c.marketState === 'closed' || c.status === 'closed') e.market.status = 'closed';
      }
    }));
    e.fetchedAt = Date.now();
  }

  async categories(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const e of this.entries.values()) out[e.market.category] = (out[e.market.category] ?? 0) + 1;
    return out;
  }
}
