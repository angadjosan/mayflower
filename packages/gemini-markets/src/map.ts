import type { PredictionMarketsComponents } from "@gemini-markets/sdk/server";
import type { GeminiEnv, MarketContract, Outcome, Quote } from "@mayflower/shared";

type ApiEvent = PredictionMarketsComponents["schemas"]["Event"];
type ApiContract = PredictionMarketsComponents["schemas"]["Contract"];

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function richTextToString(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const parts: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.text === "string") parts.push(o.text);
      if (o.children) walk(o.children);
      if (o.content) walk(o.content);
    }
  };
  walk(value);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function mapQuote(contract: ApiContract): Quote {
  const p = contract.prices ?? null;
  return {
    buyYes: num(p?.buy?.yes),
    buyNo: num(p?.buy?.no),
    sellYes: num(p?.sell?.yes),
    sellNo: num(p?.sell?.no),
    bestBid: num(p?.bestBid),
    bestAsk: num(p?.bestAsk),
    lastTrade: num(p?.lastTradePrice),
    ts: new Date().toISOString(),
  };
}

export function mapEvent(event: ApiEvent, env: GeminiEnv): MarketContract[] {
  const contracts = event.contracts ?? [];
  const title = event.title ?? event.ticker ?? "Untitled event";
  const eventDescription = event.description ?? "";
  return contracts
    .filter((c) => Boolean(c.instrumentSymbol))
    .map((c) => {
      const resolution = c.resolutionSide as Outcome | undefined | null;
      return {
        symbol: c.instrumentSymbol as string,
        contractId: c.id ?? null,
        eventTicker: event.ticker ?? "",
        eventTitle: title,
        label: c.label ?? title,
        category: event.category ?? "other",
        subcategoryPath: event.subcategory?.path ?? [],
        tags: event.tags ?? [],
        description: [eventDescription, richTextToString(c.description)].filter(Boolean).join("\n\n"),
        rulesUrl: c.termsAndConditionsUrl ?? null,
        eventType: (event.type ?? (contracts.length > 1 ? "categorical" : "binary")) as "binary" | "categorical",
        status: c.status ?? event.status ?? "active",
        marketState: (c.marketState ?? null) as "open" | "closed" | null,
        expiry: c.expiryDate ?? event.expiryDate ?? null,
        quote: mapQuote(c),
        liquidityUsd: num(event.liquidity),
        volumeUsd: num(event.volume),
        increments: {
          quantityIncrement: num(c.quantityIncrement) ?? 1,
          quantityMinimum: num(c.quantityMinimum) ?? 1,
          priceIncrement: num(c.priceIncrement) ?? 0.01,
          priceMinimum: num(c.priceMinimum) ?? 0.01,
        },
        priceHistory: (c.priceHistory ?? [])
          .map((pt) => ({ ts: pt.timestamp ?? "", price: num(pt.price) ?? NaN }))
          .filter((pt) => pt.ts && Number.isFinite(pt.price)),
        resolutionSide: resolution === "yes" || resolution === "no" ? resolution : null,
        source: "live" as const,
        env,
      };
    });
}
