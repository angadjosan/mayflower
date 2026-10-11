// DEMO DATA ONLY. These are not real markets. They exist so the full loop can
// be exercised offline (tests, local development without network access) and
// are only used when MAYFLOWER_DEMO_MODE=true. Every record is tagged
// source: "demo" and the UI labels it as such.
import type { GeminiEnv, MarketContract, Quote } from "@mayflower/shared";
import { round } from "@mayflower/shared";

interface DemoContract {
  key: string;
  label: string;
  basePrice: number;
  spread?: number;
}

interface DemoEvent {
  ticker: string;
  title: string;
  category: string;
  subcategoryPath: string[];
  tags: string[];
  description: string;
  type: "binary" | "categorical";
  expiresInDays: number;
  liquidityUsd: number;
  volumeUsd: number;
  contracts: DemoContract[];
}

export const DEMO_EVENTS: DemoEvent[] = [
  {
    ticker: "DEMO-NFLSEASF",
    title: "Seahawks vs. 49ers — who wins this Sunday?",
    category: "Sports",
    subcategoryPath: ["Sports", "NFL"],
    tags: ["nfl", "seahawks", "49ers", "football"],
    description: "Resolves to the team that wins the game, including overtime. If the game is not completed within 48 hours of the scheduled start, all contracts resolve NO. [DEMO MARKET]",
    type: "categorical",
    expiresInDays: 6,
    liquidityUsd: 84000,
    volumeUsd: 412000,
    contracts: [
      { key: "SEA", label: "Seahawks win", basePrice: 0.42 },
      { key: "SF", label: "49ers win", basePrice: 0.57 },
    ],
  },
  {
    ticker: "DEMO-NFLSEAPLAYOFF",
    title: "Will the Seahawks make the playoffs this season?",
    category: "Sports",
    subcategoryPath: ["Sports", "NFL"],
    tags: ["nfl", "seahawks", "football", "playoffs"],
    description: "Resolves YES if the Seattle Seahawks qualify for the NFL postseason this season. [DEMO MARKET]",
    type: "binary",
    expiresInDays: 85,
    liquidityUsd: 52000,
    volumeUsd: 230000,
    contracts: [{ key: "YES", label: "Seahawks make the playoffs", basePrice: 0.48 }],
  },
  {
    ticker: "DEMO-NVDADC",
    title: "Will Nvidia's next quarterly data-center revenue beat consensus?",
    category: "Tech",
    subcategoryPath: ["Tech", "AI"],
    tags: ["ai", "nvidia", "earnings", "data center"],
    description: "Resolves YES if Nvidia's reported data-center segment revenue for its next fiscal quarter exceeds the consensus estimate published the day before earnings. [DEMO MARKET]",
    type: "binary",
    expiresInDays: 40,
    liquidityUsd: 61000,
    volumeUsd: 180000,
    contracts: [{ key: "YES", label: "Nvidia data-center revenue beats consensus", basePrice: 0.71 }],
  },
  {
    ticker: "DEMO-AICAPEX",
    title: "Will a top-4 hyperscaler raise AI capex guidance at its next earnings call?",
    category: "Tech",
    subcategoryPath: ["Tech", "AI"],
    tags: ["ai", "ai infrastructure", "capex", "microsoft", "google", "amazon", "meta"],
    description: "Resolves YES if Microsoft, Alphabet, Amazon or Meta raises its full-year capital expenditure guidance on its next scheduled earnings call. [DEMO MARKET]",
    type: "binary",
    expiresInDays: 25,
    liquidityUsd: 23000,
    volumeUsd: 64000,
    contracts: [{ key: "YES", label: "A hyperscaler raises AI capex guidance", basePrice: 0.62 }],
  },
  {
    ticker: "DEMO-FEDDEC",
    title: "Fed decision at the December FOMC meeting",
    category: "Economics",
    subcategoryPath: ["Economics", "Fed"],
    tags: ["fed", "fomc", "rates"],
    description: "Resolves based on the change to the upper bound of the federal funds target range announced at the December FOMC meeting. [DEMO MARKET]",
    type: "categorical",
    expiresInDays: 60,
    liquidityUsd: 140000,
    volumeUsd: 950000,
    contracts: [
      { key: "CUT25", label: "Cut 25 bps", basePrice: 0.55 },
      { key: "HOLD", label: "No change", basePrice: 0.41 },
      { key: "HIKE", label: "Hike", basePrice: 0.03, spread: 0.02 },
    ],
  },
  {
    ticker: "DEMO-RECESSION",
    title: "Will the US enter a recession that begins this year?",
    category: "Economics",
    subcategoryPath: ["Economics", "Growth"],
    tags: ["recession", "economy", "gdp"],
    description: "Resolves YES if the NBER Business Cycle Dating Committee announces a US business-cycle peak dated within this calendar year. [DEMO MARKET]",
    type: "binary",
    expiresInDays: 80,
    liquidityUsd: 47000,
    volumeUsd: 300000,
    contracts: [{ key: "YES", label: "US recession begins this year", basePrice: 0.18 }],
  },
  {
    ticker: "DEMO-BTC150",
    title: "Bitcoin above $150,000 on December 31?",
    category: "Crypto",
    subcategoryPath: ["Crypto", "Bitcoin"],
    tags: ["bitcoin", "btc", "crypto"],
    description: "Resolves YES if the BTC/USD reference price is above $150,000 at 23:59 ET on December 31. [DEMO MARKET]",
    type: "binary",
    expiresInDays: 81,
    liquidityUsd: 210000,
    volumeUsd: 1800000,
    contracts: [{ key: "YES", label: "BTC above $150k on Dec 31", basePrice: 0.27 }],
  },
  {
    ticker: "DEMO-NYCTEMP",
    title: "NYC high temperature above 60°F next Tuesday?",
    category: "Weather",
    subcategoryPath: ["Weather", "Temperature"],
    tags: ["weather", "temperature", "nyc"],
    description: "Resolves YES if the official Central Park high temperature reported by the National Weather Service exceeds 60°F on the specified date. [DEMO MARKET]",
    type: "binary",
    expiresInDays: 8,
    liquidityUsd: 9000,
    volumeUsd: 21000,
    contracts: [{ key: "YES", label: "NYC high above 60°F", basePrice: 0.64 }],
  },
  {
    ticker: "DEMO-HOUSE26",
    title: "Which party wins the House in the midterm elections?",
    category: "Politics",
    subcategoryPath: ["Politics", "US Elections"],
    tags: ["politics", "election", "midterms", "congress"],
    description: "Resolves to the party holding a majority of seats in the House of Representatives after the midterm elections are certified. [DEMO MARKET]",
    type: "categorical",
    expiresInDays: 30,
    liquidityUsd: 320000,
    volumeUsd: 4100000,
    contracts: [
      { key: "DEM", label: "Democrats win the House", basePrice: 0.6 },
      { key: "GOP", label: "Republicans win the House", basePrice: 0.39 },
    ],
  },
  {
    ticker: "DEMO-BOXOFFICE",
    title: "Top film at the box office over Thanksgiving weekend",
    category: "Entertainment",
    subcategoryPath: ["Entertainment", "Movies"],
    tags: ["movies", "box office"],
    description: "Resolves to the film with the highest domestic gross for the five-day Thanksgiving weekend as reported by Box Office Mojo. [DEMO MARKET]",
    type: "categorical",
    expiresInDays: 48,
    liquidityUsd: 6000,
    volumeUsd: 15000,
    contracts: [
      { key: "A", label: "Animated sequel wins the weekend", basePrice: 0.52, spread: 0.06 },
      { key: "B", label: "Superhero film wins the weekend", basePrice: 0.37, spread: 0.06 },
    ],
  },
];

const store = globalThis as unknown as { __mayflowerDemoShifts?: Map<string, number>; __mayflowerDemoEpoch?: number };

function shifts(): Map<string, number> {
  store.__mayflowerDemoShifts ??= new Map();
  return store.__mayflowerDemoShifts;
}

/** Move a demo contract's price (used by the "simulate market move" dev tool and tests). */
export function shiftDemoPrice(symbol: string, delta: number): void {
  const m = shifts();
  m.set(symbol, round((m.get(symbol) ?? 0) + delta, 4));
}

export function resetDemoPrices(): void {
  shifts().clear();
}

function epoch(): number {
  // Anchor expiries to the first time the catalog is used in this process so they don't drift during a session.
  store.__mayflowerDemoEpoch ??= Date.now();
  return store.__mayflowerDemoEpoch;
}

export function demoSymbol(eventTicker: string, key: string): string {
  return `${eventTicker}-${key}`;
}

function demoQuote(price: number, spread: number): Quote {
  const p = Math.min(0.97, Math.max(0.03, price));
  const half = spread / 2;
  const bid = round(Math.max(0.01, p - half), 2);
  const ask = round(Math.min(0.99, p + half), 2);
  return {
    buyYes: ask,
    sellYes: bid,
    buyNo: round(1 - bid, 2),
    sellNo: round(1 - ask, 2),
    bestBid: bid,
    bestAsk: ask,
    lastTrade: round(p, 2),
    ts: new Date().toISOString(),
  };
}

export function demoContracts(env: GeminiEnv): MarketContract[] {
  const start = epoch();
  const out: MarketContract[] = [];
  for (const ev of DEMO_EVENTS) {
    const expiry = new Date(start + ev.expiresInDays * 86_400_000).toISOString();
    for (const c of ev.contracts) {
      const symbol = demoSymbol(ev.ticker, c.key);
      const price = c.basePrice + (shifts().get(symbol) ?? 0);
      out.push({
        symbol,
        contractId: symbol,
        eventTicker: ev.ticker,
        eventTitle: ev.title,
        label: c.label,
        category: ev.category,
        subcategoryPath: ev.subcategoryPath,
        tags: ev.tags,
        description: ev.description,
        rulesUrl: null,
        eventType: ev.type,
        status: "active",
        marketState: "open",
        expiry,
        quote: demoQuote(price, c.spread ?? 0.02),
        liquidityUsd: ev.liquidityUsd,
        volumeUsd: ev.volumeUsd,
        increments: { quantityIncrement: 1, quantityMinimum: 1, priceIncrement: 0.01, priceMinimum: 0.01 },
        priceHistory: [],
        resolutionSide: null,
        source: "demo",
        env,
      });
    }
  }
  return out;
}
