// Context.dev web search for research evidence. Falls back to clearly-labeled mock citations.
import type { Citation } from "./types";

const apiKey = process.env.CONTEXT_DEV_API_KEY;
// Accept the base URL with or without a trailing /v1.
const baseUrl = (process.env.CONTEXT_DEV_BASE_URL || "https://api.context.dev").replace(/\/$/, "").replace(/\/v1$/, "");
// From context.dev openapi.json: POST /web/search, Authorization: Bearer <key>,
// body { query, numResults (10..100), freshness? }, response { results: [{ url, title, description }] }.
const SEARCH_PATH = "/v1/web/search";
// POST /web/scrape { url, formats: { markdown: true }, sharedParams: { mainContentOnly } } -> { markdown: { success, data } }.
const SCRAPE_PATH = "/v1/web/scrape";

export type Freshness = "last_24_hours" | "last_week" | "last_month" | "last_year";

// The Context.dev plan allows 10 concurrent requests; keep a little headroom for the chat agent.
const MAX_CONCURRENT = 8;
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export const researchMode: "context.dev" | "mock" = apiKey ? "context.dev" : "mock";

function mockCitations(query: string, limit: number): Citation[] {
  const slug = encodeURIComponent(query.toLowerCase().replace(/\s+/g, "-").slice(0, 60));
  const angles = ["Latest news", "Analyst outlook", "Historical base rates", "Expert commentary", "Market sentiment"];
  return angles.slice(0, limit).map((a, i) => ({
    title: `[mock] ${a}: ${query}`,
    url: `https://example.com/mock/${slug}/${i + 1}`,
    snippet: `[mock] Placeholder evidence for "${query}". Configure CONTEXT_DEV_API_KEY for real sources.`,
  }));
}

export async function searchEvidence(
  query: string,
  limit = 5,
  opts: { freshness?: Freshness } = {},
): Promise<{ citations: Citation[]; source: "context.dev" | "mock" }> {
  if (!apiKey) return { citations: mockCitations(query, limit), source: "mock" };
  try {
    const res = await limited(() => fetch(baseUrl + SEARCH_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.slice(0, 500), numResults: 10, ...(opts.freshness ? { freshness: opts.freshness } : {}) }),
      signal: AbortSignal.timeout(20000),
    }));
    if (!res.ok) throw new Error(`context.dev ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { results?: { url: string; title: string; description?: string }[] };
    const citations: Citation[] = (data.results ?? [])
      .filter((r) => r.url)
      .slice(0, limit)
      .map((r) => ({ title: r.title || r.url, url: r.url, snippet: r.description || undefined }));
    if (!citations.length) throw new Error("context.dev returned no results");
    return { citations, source: "context.dev" };
  } catch (e) {
    console.warn("[research] falling back to mock:", (e as Error).message);
    return { citations: mockCitations(query, limit), source: "mock" };
  }
}

// ---------------------------------------------------------------- Full-page reading

export interface PageText { url: string; text: string; via: "context.dev" | "direct" | "none"; error?: string }

/** Markdown/HTML -> plain readable text: drop images, keep link text, collapse whitespace. */
export function cleanText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

async function scrapeContextDev(url: string): Promise<string> {
  const res = await limited(() => fetch(baseUrl + SCRAPE_PATH, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url, formats: { markdown: true }, markdownParams: { includeLinks: false },
      sharedParams: { mainContentOnly: true, dismissCookies: true, dismissPopups: true },
      timeoutOpts: { milliseconds: 12000, behavior: "return-partial" },
    }),
    signal: AbortSignal.timeout(15000),
  }));
  if (!res.ok) throw new Error(`context.dev scrape ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { markdown?: { success?: boolean | null; data?: string | null; message?: string } };
  if (!data.markdown?.success || !data.markdown.data) throw new Error(data.markdown?.message || "no markdown returned");
  return data.markdown.data;
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

async function fetchDirect(url: string): Promise<string> {
  if (PRIVATE_HOST.test(new URL(url).hostname)) throw new Error("refusing to fetch a private host");
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MayflowerResearch/1.0)", Accept: "text/html,text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/|html|xml|json/.test(type)) throw new Error(`unsupported content-type ${type}`);
  const html = (await res.text()).slice(0, 2_000_000);
  const body = html.match(/<(article|main)[\s\S]*?<\/\1>/i)?.[0] ?? html;
  return body;
}

/**
 * Read the full text of up to 3 pages (Context.dev scrape, falling back to a direct fetch + HTML strip).
 * Never throws: a page that can't be read comes back with empty text and an `error`.
 */
export async function readPages(urls: string[], maxChars = 4000, max = 3): Promise<PageText[]> {
  const unique = [...new Set(urls.filter((u) => /^https?:\/\//.test(u) && !u.startsWith("https://example.com/mock/")))].slice(0, max);
  return Promise.all(unique.map(async (url): Promise<PageText> => {
    let ctxErr: string | undefined;
    if (apiKey) {
      try {
        const text = cleanText(await scrapeContextDev(url)).slice(0, maxChars);
        if (text.length > 200) return { url, text, via: "context.dev" };
        ctxErr = "too little text";
      } catch (e) { ctxErr = (e as Error).message; }
    }
    try {
      const text = cleanText(await fetchDirect(url)).slice(0, maxChars);
      if (text.length > 200) return { url, text, via: "direct" };
      return { url, text: "", via: "none", error: "page had too little readable text" };
    } catch (e) {
      return { url, text: "", via: "none", error: [ctxErr, (e as Error).message].filter(Boolean).join("; ") };
    }
  }));
}

/** Prompt block with page excerpts, numbered to match `citations` when possible. */
export function pagesBlock(pages: PageText[], citations: Citation[] = []): string {
  const ok = pages.filter((p) => p.text);
  if (!ok.length) return "";
  return ok.map((p) => {
    const i = citations.findIndex((c) => c.url === p.url);
    const title = i >= 0 ? citations[i].title : p.url;
    return `--- ${i >= 0 ? `[${i}] ` : ""}${title} (${p.url})\n${p.text}`;
  }).join("\n\n");
}
