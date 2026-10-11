import { createClient } from "@gemini-markets/sdk/server";
import type { GeminiEnv, MarketContract } from "@mayflower/shared";
import { demoContracts } from "./demo-catalog";
import { mapEvent } from "./map";

export interface ListContractsOptions {
  /** Title search text (Gemini `search` filter). */
  search?: string;
  /** Gemini category filter, e.g. ["Sports"]. */
  categories?: string[];
  limit?: number;
}

export interface MarketDataSource {
  readonly label: "live" | "demo";
  readonly env: GeminiEnv;
  listContracts(opts?: ListContractsOptions): Promise<MarketContract[]>;
  getEventContracts(eventTicker: string): Promise<MarketContract[]>;
  getContract(symbol: string, eventTicker: string): Promise<MarketContract | null>;
}

export class ExchangeError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ExchangeError";
  }
}

export function toExchangeError(err: unknown, context: string): ExchangeError {
  if (err instanceof ExchangeError) return err;
  const e = err as { message?: string; status?: number; reason?: string; code?: string; name?: string };
  const status = typeof e?.status === "number" ? e.status : null;
  const code = e?.reason ?? e?.code ?? e?.name ?? null;
  return new ExchangeError(`${context}: ${e?.message ?? String(err)}`, status, code ? String(code) : null, err);
}

type Client = Awaited<ReturnType<typeof createClient>>;
const g = globalThis as unknown as { __mayflowerPublicClients?: Map<GeminiEnv, Promise<Client>> };

function publicClient(env: GeminiEnv): Promise<Client> {
  g.__mayflowerPublicClients ??= new Map();
  let c = g.__mayflowerPublicClients.get(env);
  if (!c) {
    c = createClient({ env, skipWsInit: true, timeoutMs: 15_000, maxRetries: 2 });
    g.__mayflowerPublicClients.set(env, c);
  }
  return c;
}

/** Real Gemini prediction-market data via the official SDK (public endpoints, no key needed). */
export class LiveMarketData implements MarketDataSource {
  readonly label = "live" as const;
  private cache = new Map<string, { at: number; value: MarketContract[] }>();

  constructor(
    readonly env: GeminiEnv,
    private readonly ttlMs = 30_000,
  ) {}

  private async cached(key: string, load: () => Promise<MarketContract[]>): Promise<MarketContract[]> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = await load();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async listContracts(opts: ListContractsOptions = {}): Promise<MarketContract[]> {
    const key = JSON.stringify(["list", opts]);
    return this.cached(key, async () => {
      try {
        const client = await publicClient(this.env);
        const res = await client.predictions.listEvents({
          status: ["active"],
          ...(opts.search ? { search: opts.search } : {}),
          ...(opts.categories?.length ? { category: opts.categories } : {}),
          limit: Math.min(opts.limit ?? 100, 500),
        });
        return (res.data ?? []).flatMap((ev) => mapEvent(ev, this.env));
      } catch (err) {
        throw toExchangeError(err, "Gemini listEvents failed");
      }
    });
  }

  async getEventContracts(eventTicker: string): Promise<MarketContract[]> {
    return this.cached(`event:${eventTicker}`, async () => {
      try {
        const client = await publicClient(this.env);
        const ev = await client.predictions.getEvent({ eventTicker });
        return ev ? mapEvent(ev, this.env) : [];
      } catch (err) {
        throw toExchangeError(err, `Gemini getEvent(${eventTicker}) failed`);
      }
    });
  }

  async getContract(symbol: string, eventTicker: string): Promise<MarketContract | null> {
    const contracts = await this.getEventContracts(eventTicker);
    return contracts.find((c) => c.symbol === symbol) ?? null;
  }
}

/** Offline demo catalog. Clearly labelled; never used unless demo mode is enabled. */
export class DemoMarketData implements MarketDataSource {
  readonly label = "demo" as const;
  constructor(readonly env: GeminiEnv) {}

  async listContracts(opts: ListContractsOptions = {}): Promise<MarketContract[]> {
    let all = demoContracts(this.env);
    if (opts.categories?.length) {
      const cats = opts.categories.map((c) => c.toLowerCase());
      all = all.filter((c) => cats.includes(c.category.toLowerCase()));
    }
    if (opts.search) {
      const terms = opts.search.toLowerCase().split(/\s+/).filter(Boolean);
      all = all.filter((c) => {
        const text = `${c.eventTitle} ${c.label} ${c.tags.join(" ")}`.toLowerCase();
        return terms.every((t) => text.includes(t));
      });
    }
    return all.slice(0, opts.limit ?? 100);
  }

  async getEventContracts(eventTicker: string): Promise<MarketContract[]> {
    return demoContracts(this.env).filter((c) => c.eventTicker === eventTicker);
  }

  async getContract(symbol: string): Promise<MarketContract | null> {
    return demoContracts(this.env).find((c) => c.symbol === symbol) ?? null;
  }
}
