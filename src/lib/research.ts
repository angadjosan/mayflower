// Context.dev web search for research evidence. Falls back to clearly-labeled mock citations.
import type { Citation } from "./types";

const apiKey = process.env.CONTEXT_DEV_API_KEY;
// Accept the base URL with or without a trailing /v1.
const baseUrl = (process.env.CONTEXT_DEV_BASE_URL || "https://api.context.dev").replace(/\/$/, "").replace(/\/v1$/, "");
// From context.dev openapi.json: POST /web/search, Authorization: Bearer <key>,
// body { query, numResults (10..100) }, response { results: [{ url, title, description }] }.
const SEARCH_PATH = "/v1/web/search";

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
): Promise<{ citations: Citation[]; source: "context.dev" | "mock" }> {
  if (!apiKey) return { citations: mockCitations(query, limit), source: "mock" };
  try {
    const res = await fetch(baseUrl + SEARCH_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, numResults: 10 }),
      signal: AbortSignal.timeout(20000),
    });
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
