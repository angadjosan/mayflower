// DEMO DATA ONLY. Placeholder "evidence" for the offline demo catalog so the
// research → forecast → sizing loop can run without network access. Each item
// is marked "[Demo evidence]" and points at a general topic page rather than a
// specific article, so nothing here can be mistaken for a real citation.
import type { Citation, MarketContract } from "@mayflower/shared";
import type { ResearchQuery } from "./research";

interface DemoItem {
  title: string;
  url: string;
  snippet: string;
  purpose: "context" | "contrary";
}

const DEMO: Record<string, DemoItem[]> = {
  "DEMO-NFLSEASF": [
    { title: "Seahawks injury report and depth chart", url: "https://www.seahawks.com/team/injury-report/", snippet: "[Demo evidence] Seattle's starting offensive line returns to full health this week, which supports a stronger rushing attack and a higher chance of a Seahawks win.", purpose: "context" },
    { title: "NFL power rankings", url: "https://www.nfl.com/news/power-rankings", snippet: "[Demo evidence] Analysts note the Seahawks' defense has improved sharply over the last three games, boosting their outlook against division rivals.", purpose: "context" },
    { title: "Seattle weather and home field", url: "https://www.lumenfield.com/", snippet: "[Demo evidence] The game is at home in Seattle, where crowd noise has historically given the Seahawks a strong edge; home teams in this rivalry are favored more often than the spread implies.", purpose: "context" },
    { title: "49ers team news", url: "https://www.49ers.com/news/", snippet: "[Demo evidence] San Francisco has the deeper roster and most models back the 49ers; they have won four of the last five meetings — a real risk to a Seahawks upset, and late injuries could still hurt Seattle.", purpose: "contrary" },
  ],
  "DEMO-NFLSEAPLAYOFF": [
    { title: "NFL standings", url: "https://www.nfl.com/standings/", snippet: "[Demo evidence] Seattle sits one game out of a wild-card spot with a softer remaining schedule than most rivals, which supports its playoff chances.", purpose: "context" },
    { title: "Playoff picture", url: "https://www.espn.com/nfl/playoff-machine", snippet: "[Demo evidence] Several NFC teams with better records are ahead of Seattle; a tough December stretch is a risk to the Seahawks' playoff hopes.", purpose: "contrary" },
  ],
  "DEMO-NVDADC": [
    { title: "Nvidia investor relations", url: "https://investor.nvidia.com/", snippet: "[Demo evidence] Hyperscaler orders for next-generation accelerators remain strong and supply constraints are easing, supporting a beat on data-center revenue.", purpose: "context" },
    { title: "Semiconductor sector outlook", url: "https://www.semiconductors.org/", snippet: "[Demo evidence] Consensus estimates have risen sharply, raising the bar; export restrictions remain a risk to the quarter.", purpose: "contrary" },
  ],
  "DEMO-AICAPEX": [
    { title: "Cloud capex tracker", url: "https://www.datacenterdynamics.com/en/", snippet: "[Demo evidence] Every major cloud provider reported capacity constraints last quarter and signaled continued growth in AI infrastructure spending, which supports another guidance raise.", purpose: "context" },
    { title: "Data center power constraints", url: "https://www.iea.org/topics/data-centres", snippet: "[Demo evidence] Power and grid bottlenecks may cap how fast new capacity can be built, a reason companies could hold guidance steady rather than raise it.", purpose: "contrary" },
  ],
  "DEMO-FEDDEC": [
    { title: "FOMC calendar and statements", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", snippet: "[Demo evidence] Recent FOMC communications point to a gradual easing path, with several officials supporting another cut this year.", purpose: "context" },
    { title: "Inflation data", url: "https://www.bls.gov/cpi/", snippet: "[Demo evidence] Core inflation has been sticky for two months, a risk that could lead the committee to hold rates rather than cut.", purpose: "contrary" },
  ],
  "DEMO-RECESSION": [
    { title: "NBER business cycle dating", url: "https://www.nber.org/research/business-cycle-dating", snippet: "[Demo evidence] The NBER typically announces peaks many months after they occur, so a declaration within the contract window is unlikely even if a downturn starts.", purpose: "contrary" },
    { title: "Employment situation", url: "https://www.bls.gov/news.release/empsit.toc.htm", snippet: "[Demo evidence] Hiring has slowed and unemployment has ticked up for three straight months, which supports rising recession risk.", purpose: "context" },
  ],
  "DEMO-BTC150": [
    { title: "Bitcoin market data", url: "https://www.coingecko.com/en/coins/bitcoin", snippet: "[Demo evidence] Bitcoin would need a large rally from current levels in under three months; historical volatility makes it possible but unlikely.", purpose: "contrary" },
    { title: "ETF flows", url: "https://www.blackrock.com/us/individual/products/333011/", snippet: "[Demo evidence] Spot ETF inflows have accelerated, which supports further upside in the price.", purpose: "context" },
  ],
  "DEMO-NYCTEMP": [
    { title: "NWS New York forecast", url: "https://forecast.weather.gov/MapClick.php?lat=40.7829&lon=-73.9654", snippet: "[Demo evidence] The extended forecast shows a warm front arriving early next week with highs in the low 60s, supporting a YES outcome.", purpose: "context" },
    { title: "Climate normals", url: "https://www.weather.gov/okx/CentralParkHistorical", snippet: "[Demo evidence] Normal highs for the date are around 62°F, but a cold front could arrive a day early, a risk for the forecast.", purpose: "contrary" },
  ],
  "DEMO-HOUSE26": [
    { title: "Midterm election overview", url: "https://ballotpedia.org/United_States_House_of_Representatives_elections", snippet: "[Demo evidence] The president's party has historically lost House seats in most midterms, which supports the opposition party.", purpose: "context" },
    { title: "Generic ballot polling", url: "https://www.270towin.com/", snippet: "[Demo evidence] Generic ballot polling is within the margin of error, and redistricting could limit gains — uncertainty remains high.", purpose: "contrary" },
  ],
  "DEMO-BOXOFFICE": [
    { title: "Box office calendar", url: "https://www.boxofficemojo.com/calendar/", snippet: "[Demo evidence] Family films have won most recent Thanksgiving weekends, supporting the animated sequel.", purpose: "context" },
    { title: "Release schedule", url: "https://www.the-numbers.com/movies/release-schedule", snippet: "[Demo evidence] Strong presales for the superhero film are a risk to the animated sequel's chances.", purpose: "contrary" },
  ],
};

interface DemoNews {
  title: string;
  url: string;
  snippet: string;
  at: string;
}

const g = globalThis as unknown as { __mayflowerDemoNews?: Map<string, DemoNews[]> };

/** Inject a demo "news update" for an event (dev tool / tests). */
export function pushDemoNews(eventTicker: string, news: Omit<DemoNews, "at">): void {
  g.__mayflowerDemoNews ??= new Map();
  const list = g.__mayflowerDemoNews.get(eventTicker) ?? [];
  list.push({ ...news, at: new Date().toISOString() });
  g.__mayflowerDemoNews.set(eventTicker, list);
}

export function clearDemoNews(): void {
  g.__mayflowerDemoNews?.clear();
}

function idFor(url: string, title: string): string {
  let h = 0;
  for (const ch of url + title) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `d${(h >>> 0).toString(36)}`;
}

export function demoEvidenceFor(market: MarketContract, queries: ResearchQuery[]): Citation[] {
  const retrievedAt = new Date().toISOString();
  const wantsUpdate = queries.some((q) => q.purpose === "update");
  const items: Citation[] = [];
  const news = g.__mayflowerDemoNews?.get(market.eventTicker) ?? [];
  for (const n of news) {
    items.push({ id: idFor(n.url, n.title + n.at), title: n.title, url: n.url, snippet: `[Demo evidence] ${n.snippet}`, query: queries[0]?.query ?? "", relevance: "high", retrievedAt, publishedAt: n.at, provider: "demo" });
  }
  if (wantsUpdate) return items;
  for (const d of DEMO[market.eventTicker] ?? []) {
    const q = queries.find((x) => x.purpose === d.purpose) ?? queries[0];
    items.push({ id: idFor(d.url, d.title), title: d.title, url: d.url, snippet: d.snippet, query: q?.query ?? "", relevance: "high", retrievedAt, publishedAt: null, provider: "demo" });
  }
  return items;
}
