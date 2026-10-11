// A small topic dictionary used for heuristic interest extraction, discovery
// keyword expansion and correlation grouping. The LLM path can go beyond it,
// but the deterministic parts of the system (correlation caps) rely on it.

export interface TopicDef {
  key: string;
  label: string;
  /** Correlation group: positions in the same group are treated as related exposure. */
  group: string;
  /** Lowercase words/phrases that indicate this topic in user text or market titles. */
  keywords: string[];
  /** Search terms to use against the Gemini events `search` filter. */
  searchTerms: string[];
  /** Gemini categories (lowercase) that map to this topic. */
  categories: string[];
}

const NFL_TEAMS = [
  "seahawks", "49ers", "niners", "rams", "cardinals", "cowboys", "eagles", "giants", "commanders",
  "packers", "bears", "lions", "vikings", "saints", "falcons", "panthers", "buccaneers", "bucs",
  "chiefs", "raiders", "chargers", "broncos", "bills", "dolphins", "patriots", "jets", "ravens",
  "steelers", "browns", "bengals", "texans", "colts", "jaguars", "titans",
];

const NBA_TEAMS = [
  "lakers", "celtics", "warriors", "knicks", "nets", "bulls", "heat", "bucks", "nuggets", "suns",
  "mavericks", "mavs", "clippers", "76ers", "sixers", "thunder", "timberwolves", "cavaliers", "cavs",
  "spurs", "rockets", "grizzlies", "pelicans", "kings", "jazz", "blazers", "hawks", "hornets",
  "magic", "pistons", "pacers", "raptors", "wizards",
];

export const TOPICS: TopicDef[] = [
  {
    key: "nfl",
    label: "NFL football",
    group: "sports-football",
    keywords: ["nfl", "football", "super bowl", "touchdown", "quarterback", ...NFL_TEAMS],
    searchTerms: ["NFL", "Super Bowl"],
    categories: ["sports", "american_football", "football", "nfl"],
  },
  {
    key: "nba",
    label: "NBA basketball",
    group: "sports-basketball",
    keywords: ["nba", "basketball", ...NBA_TEAMS],
    searchTerms: ["NBA"],
    categories: ["basketball", "nba"],
  },
  {
    key: "soccer",
    label: "Soccer",
    group: "sports-soccer",
    keywords: ["soccer", "premier league", "champions league", "world cup", "mls", "la liga"],
    searchTerms: ["Premier League", "Champions League", "World Cup"],
    categories: ["soccer"],
  },
  {
    key: "baseball",
    label: "Baseball",
    group: "sports-baseball",
    keywords: ["mlb", "baseball", "world series", "mariners", "yankees", "dodgers"],
    searchTerms: ["MLB", "World Series"],
    categories: ["baseball", "mlb"],
  },
  {
    key: "ai",
    label: "AI & tech",
    group: "tech-ai",
    keywords: ["ai", "artificial intelligence", "openai", "nvidia", "gpu", "llm", "data center", "datacenter", "ai infrastructure", "chips", "semiconductor", "anthropic", "google", "microsoft", "apple", "tech"],
    searchTerms: ["AI", "OpenAI", "Nvidia", "tech"],
    categories: ["tech", "technology", "ai", "science"],
  },
  {
    key: "fed",
    label: "Fed & interest rates",
    group: "macro-rates",
    keywords: ["fed", "federal reserve", "rate cut", "rate hike", "interest rate", "fomc", "powell", "rates"],
    searchTerms: ["Fed", "rate cut", "FOMC"],
    categories: ["economics", "economy", "finance", "fed"],
  },
  {
    key: "recession",
    label: "Economy & recession",
    group: "macro-growth",
    keywords: ["recession", "gdp", "unemployment", "jobs report", "economy", "layoffs", "inflation", "cpi"],
    searchTerms: ["recession", "GDP", "CPI", "unemployment", "inflation"],
    categories: ["economics", "economy"],
  },
  {
    key: "crypto",
    label: "Crypto",
    group: "crypto",
    keywords: ["crypto", "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "dogecoin", "stablecoin"],
    searchTerms: ["Bitcoin", "Ethereum", "Solana"],
    categories: ["crypto"],
  },
  {
    key: "politics",
    label: "Politics",
    group: "politics",
    keywords: ["politics", "political", "election", "senate", "congress", "president", "governor", "midterm", "vote", "white house", "supreme court"],
    searchTerms: ["election", "Senate", "Congress"],
    categories: ["politics", "elections"],
  },
  {
    key: "weather",
    label: "Weather & climate",
    group: "weather",
    keywords: ["weather", "hurricane", "temperature", "snow", "rain", "climate", "heat wave"],
    searchTerms: ["temperature", "hurricane", "weather"],
    categories: ["weather", "climate"],
  },
  {
    key: "entertainment",
    label: "Entertainment",
    group: "culture",
    keywords: ["movie", "box office", "oscars", "grammys", "emmys", "music", "album", "netflix", "tv show"],
    searchTerms: ["box office", "Oscars", "Grammys"],
    categories: ["entertainment", "culture", "pop culture"],
  },
  {
    key: "stocks",
    label: "Stocks & markets",
    group: "markets-equities",
    keywords: ["stock", "stocks", "s&p", "nasdaq", "dow", "earnings", "ipo", "tesla", "market cap"],
    searchTerms: ["S&P 500", "Nasdaq", "earnings"],
    categories: ["financials", "stocks", "markets", "finance"],
  },
];

function containsWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

/** Topics mentioned in free text. */
export function detectTopics(text: string): TopicDef[] {
  const lower = text.toLowerCase();
  return TOPICS.filter((t) => t.keywords.some((k) => containsWord(lower, k)));
}

/** Specific named entities (e.g. a team) mentioned in text, for sharper market search. */
export function detectEntities(text: string): string[] {
  const lower = text.toLowerCase();
  const all = [...NFL_TEAMS, ...NBA_TEAMS, "bitcoin", "ethereum", "solana", "nvidia", "openai", "tesla", "apple"];
  return all.filter((k) => containsWord(lower, k));
}

export function topicByKey(key: string): TopicDef | undefined {
  return TOPICS.find((t) => t.key === key);
}

/** Find the best topic for a market from its category and title. */
export function topicForMarket(input: { category: string; title: string; label?: string; tags?: string[] }): TopicDef | null {
  const text = `${input.title} ${input.label ?? ""} ${(input.tags ?? []).join(" ")}`.toLowerCase();
  const byKeyword = TOPICS.find((t) => t.keywords.some((k) => containsWord(text, k)));
  if (byKeyword) return byKeyword;
  const cat = input.category.toLowerCase();
  return TOPICS.find((t) => t.categories.includes(cat)) ?? null;
}

/** Correlation group for a market. Falls back to the category so unknown topics still cluster. */
export function correlationGroupFor(input: { category: string; title: string; label?: string; tags?: string[] }): string {
  return topicForMarket(input)?.group ?? `category-${(input.category || "other").toLowerCase()}`;
}

/** Does a topic exclusion (e.g. "politics", "sports") match a market? */
export function matchesExclusion(exclusion: string, market: { category: string; title: string; label?: string; tags?: string[] }): boolean {
  const ex = exclusion.toLowerCase().trim();
  if (!ex) return false;
  const text = `${market.title} ${market.label ?? ""} ${market.category} ${(market.tags ?? []).join(" ")}`.toLowerCase();
  if (containsWord(text, ex)) return true;
  if (ex === "sports" || ex === "sport") {
    const topic = topicForMarket(market);
    return Boolean(topic?.group.startsWith("sports-")) || market.category.toLowerCase() === "sports";
  }
  const exTopics = detectTopics(ex);
  const marketTopic = topicForMarket(market);
  return Boolean(marketTopic && exTopics.some((t) => t.key === marketTopic.key));
}
