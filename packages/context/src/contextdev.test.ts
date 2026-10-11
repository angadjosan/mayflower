import { describe, it, expect } from "vitest";
import { ContextDevProvider } from "./contextdev.js";

const fakeFetch = (handler: (url: string, init: RequestInit) => unknown): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify(handler(String(url), init ?? {})), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("ContextDevProvider", () => {
  it("maps search results and clamps numResults to >=10", async () => {
    let sent: any;
    const p = new ContextDevProvider({ apiKey: "k", fetchImpl: fakeFetch((_u, init) => { sent = JSON.parse(String(init.body)); return { results: [{ url: "https://a", title: "A", description: "d", relevance: "high", highlights: { highlights: ["p"] } }] }; }) });
    const hits = await p.search("seahawks", { limit: 3, freshness: "week" });
    expect(sent.numResults).toBe(10);
    expect(sent.freshness).toBe("last_week");
    expect(hits[0]).toMatchObject({ url: "https://a", title: "A", snippet: "d", passages: ["p"] });
  });
  it("maps scrape metadata", async () => {
    const p = new ContextDevProvider({ apiKey: "k", fetchImpl: fakeFetch(() => ({ url: "https://a", markdown: { success: true, data: "# hi" }, metadata: { title: "T", publishedTime: "2026-01-01" } })) });
    const page = await p.fetch("https://a");
    expect(page.markdown).toBe("# hi");
    expect(page.publishedAt).toBe("2026-01-01");
  });
});
