import type { Research } from '../core/ports.js';
import type { Source } from '../core/types.js';

const BASE = 'https://api.context.dev/v1';
const FRESHNESS = { day: 'last_24_hours', week: 'last_week', month: 'last_month' } as const;

export class ContextDevResearch implements Research {
  readonly mode = 'contextdev' as const;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private apiKey: string) {}

  search(query: string, opts?: { freshness?: 'day' | 'week' | 'month'; limit?: number }): Promise<Source[]> {
    return this.serial(() => this.doSearch(query, opts));
  }

  async scrape(url: string): Promise<string | null> {
    const res = await this.serial(() =>
      this.post('/web/scrape', {
        url,
        formats: { markdown: true },
        maxAgeMs: 0,
        sharedParams: { mainContentOnly: true },
      }),
    );
    const md = res?.markdown;
    return md?.success ? String(md.data) : null;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async doSearch(query: string, opts?: { freshness?: 'day' | 'week' | 'month'; limit?: number }): Promise<Source[]> {
    const limit = opts?.limit ?? 6;
    const body: Record<string, unknown> = {
      query: query.slice(0, 500),
      numResults: 10,
      markdownOptions: { enabled: false },
      highlightsOptions: { enabled: true, maxCharacters: 800 },
      descriptionMaxCharacters: 400,
    };
    if (opts?.freshness) body.freshness = FRESHNESS[opts.freshness];
    const res = await this.post('/web/search', body);
    const now = new Date().toISOString();
    const results: any[] = Array.isArray(res?.results) ? res.results : [];
    return results.slice(0, limit).map((r) => {
      const hl: string[] = r.highlights?.highlights ?? [];
      const snippet = [r.description, ...hl].filter(Boolean).join(' ').slice(0, 900);
      return {
        url: String(r.url),
        title: String(r.title ?? r.url),
        publishedAt: null,
        retrievedAt: now,
        snippet,
        stance: 'neutral' as const,
      };
    });
  }

  private async post(path: string, body: unknown, retried = false): Promise<any> {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 && !retried) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 2, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return this.post(path, body, true);
    }
    if (!res.ok) throw new Error(`Context.dev ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
}

export class NoResearch implements Research {
  readonly mode = 'none' as const;
  async search(): Promise<Source[]> {
    return [];
  }
}
