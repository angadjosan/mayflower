/**
 * Context.dev adapter. Verified against https://docs.context.dev/openapi.json (Oct 2026).
 *  - Auth:   Authorization: Bearer ctxt_secret_...
 *  - Search: POST /v1/web/search    (numResults min 10, max 100; no published date on hits)
 *  - Scrape: POST /v1/web/scrape    (formats.markdown; metadata.publishedTime)
 *  - Monitor: POST /v1/monitors, GET /v1/monitors/{id}/changes
 * Rate limiting is concurrency-based; 429 carries Retry-After. We retry once.
 */
import type { Freshness, MonitorChange, MonitorSpec, PageContent, ResearchProvider, SearchHit, SearchOptions } from "./provider";

const FRESHNESS: Record<Freshness, string> = { day: "last_24_hours", week: "last_week", month: "last_month", year: "last_year" };

export class ContextDevError extends Error {
  constructor(message: string, public status: number, public code?: string, public requestId?: string) {
    super(message);
  }
}

export interface ContextDevOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ContextDevProvider implements ResearchProvider {
  readonly name = "context.dev";
  private base: string;
  private f: typeof fetch;
  private timeoutMs: number;

  constructor(private opts: ContextDevOptions) {
    this.base = (opts.baseUrl ?? "https://api.context.dev/v1").replace(/\/$/, "");
    this.f = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, attempt = 0): Promise<T> {
    const res = await this.f(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(60, Number(res.headers.get("Retry-After") ?? 2)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return this.call<T>(method, path, body, 1);
    }
    if (!res.ok) {
      let msg = res.statusText, code: string | undefined, rid: string | undefined;
      try { const j = (await res.json()) as { message?: string; error_code?: string; request_id?: string }; msg = j.message ?? msg; code = j.error_code; rid = j.request_id; } catch { /* ignore */ }
      throw new ContextDevError(`Context.dev ${method} ${path} failed: ${msg}`, res.status, code, rid);
    }
    return (await res.json()) as T;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    type R = { results: Array<{ url: string; title: string; description: string; relevance: "high" | "medium" | "low"; highlights?: { highlights?: string[] } }> };
    const r = await this.call<R>("POST", "/web/search", {
      query: query.slice(0, 500),
      numResults: Math.min(100, Math.max(10, opts.limit ?? 10)),
      ...(opts.freshness ? { freshness: FRESHNESS[opts.freshness] } : {}),
      ...(opts.includeDomains?.length ? { includeDomains: opts.includeDomains } : {}),
      ...(opts.excludeDomains?.length ? { excludeDomains: opts.excludeDomains } : {}),
      highlightsOptions: { enabled: opts.withPassages ?? true, maxCharacters: 2000 },
      timeoutOpts: { milliseconds: this.timeoutMs - 5000, behavior: "return-partial" },
    });
    return r.results.slice(0, opts.limit ?? 10).map((x) => ({
      url: x.url,
      title: x.title,
      snippet: x.description ?? "",
      relevance: x.relevance,
      passages: x.highlights?.highlights,
    }));
  }

  async fetch(url: string, opts: { fresh?: boolean } = {}): Promise<PageContent> {
    type R = { url: string; markdown: { success: boolean | null; data: string | null }; metadata?: { title?: string; publishedTime?: string; modifiedTime?: string; author?: string } };
    const r = await this.call<R>("POST", "/web/scrape", {
      url,
      formats: { markdown: true },
      sharedParams: { mainContentOnly: true },
      ...(opts.fresh ? { maxAgeMs: 0 } : {}),
    });
    return {
      url: r.url,
      title: r.metadata?.title,
      markdown: r.markdown.success ? (r.markdown.data ?? "") : "",
      publishedAt: r.metadata?.publishedTime,
      modifiedAt: r.metadata?.modifiedTime,
      author: r.metadata?.author,
    };
  }

  async monitor(spec: MonitorSpec): Promise<{ id: string; webhookSecret?: string }> {
    type R = { id: string; webhook?: { secret?: string } };
    const mins = Math.max(10, spec.intervalMinutes ?? 360);
    const r = await this.call<R>("POST", "/monitors", {
      mode: "web",
      name: spec.name,
      target: { type: "page", url: spec.url, ...(spec.instructions ? { instructions: spec.instructions } : {}) },
      change_detection: { type: spec.instructions ? "semantic" : "exact" },
      schedule: mins % 60 === 0 ? { type: "interval", frequency: mins / 60, unit: "hours" } : { type: "interval", frequency: mins, unit: "minutes" },
      ...(spec.webhookUrl ? { webhook: { url: spec.webhookUrl, events: ["change.detected"] } } : {}),
    });
    return { id: r.id, webhookSecret: r.webhook?.secret };
  }

  async changes(monitorId: string, since?: string): Promise<MonitorChange[]> {
    type R = { data: Array<{ id: string; monitor_id: string; url: string; title: string; summary: string; detected_at: string; importance?: "low" | "medium" | "high" }> };
    const q = since ? `?since=${encodeURIComponent(since)}` : "";
    const r = await this.call<R>("GET", `/monitors/${monitorId}/changes${q}`);
    return r.data.map((c) => ({ id: c.id, monitorId: c.monitor_id, url: c.url, title: c.title, summary: c.summary, detectedAt: c.detected_at, importance: c.importance }));
  }
}

/** Verify a Context.dev monitor webhook: X-Context-Signature: t=<unix>,v1=<hex> over `${t}.${rawBody}`. */
export async function verifyContextWebhook(rawBody: string, signatureHeader: string, secret: string, toleranceSec = 300): Promise<boolean> {
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const parts = Object.fromEntries(signatureHeader.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t), v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return expected.length === v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
