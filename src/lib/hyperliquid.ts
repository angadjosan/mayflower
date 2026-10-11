// Hyperliquid HIP-4 outcome markets (binary YES/NO, fully collateralized, priced 0..1) with a simulated fallback.
// Encoding (SDK types + Hyperliquid asset-id docs): enc = 10 * outcome + side (0 = YES, 1 = NO);
// book coin "#enc", balance coin "+enc", order asset id 100_000_000 + enc.
// Order signing (msgpack L1 action + EIP-712 agent) goes through @nktkas/hyperliquid.
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { Market, Order, Side } from "./types";
import { SIMULATED_BALANCE_USD } from "./simulated";

// Like the Gemini sandbox, testnet is the default; mainnet orders also need an explicit opt-in.
const NETWORK: "testnet" | "mainnet" = process.env.HYPERLIQUID_NETWORK === "mainnet" ? "mainnet" : "testnet";
const PRIVATE_KEY = process.env.HYPERLIQUID_PRIVATE_KEY;
const LIVE_OPT_IN = process.env.HYPERLIQUID_LIVE_TRADING === "1";
// Address whose balance/orders we read; an API (agent) wallet key signs for this master account.
const ACCOUNT_ADDRESS = process.env.HYPERLIQUID_ACCOUNT_ADDRESS as Hex | undefined;
// On testnet, also list mainnet outcomes (public data) as paper-only, mirroring GEMINI_DISCOVERY_INCLUDE_PRODUCTION.
// On by default: mainnet has the real sports/macro catalog; on testnet those trade as paper against test money.
const INCLUDE_MAINNET = NETWORK === "testnet" && process.env.HYPERLIQUID_DISCOVERY_INCLUDE_MAINNET !== "0";
const MAX_OUTCOMES = Number(process.env.HYPERLIQUID_MAX_OUTCOMES || 2000);

export const hyperliquidEnabled = process.env.HYPERLIQUID_ENABLED !== "0";
export const hyperliquidMode: "testnet" | "live" | "simulated" =
  !hyperliquidEnabled || !PRIVATE_KEY ? "simulated" : NETWORK === "testnet" ? "testnet" : LIVE_OPT_IN ? "live" : "simulated";

export const HL_PREFIX = "HL-";
export const isHyperliquidId = (id: string) => id.startsWith(HL_PREFIX);
const ASSET_OFFSET = 100_000_000;
const MIN_TIME_TO_EXPIRY_MS = 10 * 60 * 1000;

const info = { testnet: new InfoClient({ transport: new HttpTransport({ isTestnet: true }) }), mainnet: new InfoClient({ transport: new HttpTransport() }) };
const account = PRIVATE_KEY ? privateKeyToAccount((PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`) as Hex) : undefined;
const exchange = account ? new ExchangeClient({ wallet: account, transport: new HttpTransport({ isTestnet: NETWORK === "testnet" }) }) : undefined;
const user = () => ACCOUNT_ADDRESS ?? account?.address;

const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** "HL-T-12" / "HL-M-12" -> network + outcome id. Ids carry the network because outcome ids differ per chain. */
function parseId(id: string): { net: "testnet" | "mainnet"; outcome: number } | undefined {
  const m = id.match(/^HL-([TM])-(\d+)$/);
  return m ? { net: m[1] === "T" ? "testnet" : "mainnet", outcome: Number(m[2]) } : undefined;
}
const makeId = (net: "testnet" | "mainnet", outcome: number) => `${HL_PREFIX}${net === "testnet" ? "T" : "M"}-${outcome}`;

/**
 * Best-effort expiry from an outcome description such as "class:priceBinary|underlying:BTC|expiry:20260510-0600|...".
 * The description format is not formally documented, so a missing expiry just means "unknown".
 */
function expiryFrom(desc: string): string | undefined {
  const m = desc.match(/(?:expiry|time|resolutionDeadline|decisionDeadline|dateTime|listingDeadline)[:=]\s*(\d{4})(\d{2})(\d{2})(?:[-T ]?(\d{2})(\d{2}))?/i);
  if (!m) return undefined;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)));
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

type Book = { bid?: number; ask?: number };
async function book(net: "testnet" | "mainnet", enc: number): Promise<Book> {
  try {
    const b = await info[net].l2Book({ coin: `#${enc}` });
    return { bid: num(b?.levels[0][0]?.px), ask: num(b?.levels[1][0]?.px) };
  } catch {
    return {};
  }
}

type Meta = Awaited<ReturnType<InfoClient["outcomeMeta"]>>;

/** "k:v|k:v" template descriptions -> object. */
function kv(desc?: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const part of (desc ?? "").split("|")) {
    const i = part.indexOf(":");
    if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return o;
}
const when = (t?: string) => {
  const m = t?.match(/^(\d{4})(\d{2})(\d{2})(?:-(\d{2})(\d{2}))?/);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)));
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
};
const asset = (a: Record<string, string>) => (a.shortName || a.perp || a.underlying || a.instrument || "").replace(/^xyz:/, "");
const words = (t: string) => t.replace(/^template:?\s*/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim();

/** Plain-English question for a HIP-4 outcome (titles are what the agent searches). */
function humanize(oName: string, oDesc: string, qName?: string, qDesc?: string): { event: string; title: string; category?: string } {
  const a = kv(oDesc), q = kv(qDesc);
  // Template names may carry a version suffix ("sportsContestWinner7").
  const t = oName.replace(/^template:/, "").replace(/\d+$/, ""), qt = (qName ?? "").replace(/^template:/, "").replace(/\d+$/, "");
  const vs = a.participantA && a.participantB ? `${a.participantA} vs ${a.participantB}` : "";
  const qEvent =
    qt === "sportsTournamentWinner" ? `${q.competition ?? "Tournament"} ${q.season ?? ""} winner`.trim()
    : qt === "awardWinner" ? `${q.award ?? "Award"} ${q.period ?? ""} winner`.trim()
    : qt === "policyRateDecision" ? `${q.institution ?? "Central bank"} rate decision (${q.decisionLabel ?? when(q.decisionDeadline)})`
    : qt === "sportsContestResult" ? `${q.competition ?? "Match"}: ${q.participantA ?? ""} vs ${q.participantB ?? ""}`.trim()
    : qName && !qName.startsWith("template") ? qName : words(qt || t);
  switch (t) {
    case "binaryPrice": case "binaryPriceExternal":
      return { event: `${asset(a)} price`, title: `${asset(a)} above ${a.threshold} at ${when(a.time)}?`, category: "Markets" };
    case "priceTouch":
      return { event: `${asset(a)} price`, title: `${asset(a)} touches ${a.target} by ${when(a.time)}?`, category: "Markets" };
    case "Recurring":
      return { event: `${a.underlying} price`, title: `${a.underlying} above ${a.targetPrice} at ${when(a.expiry)}?`, category: "Crypto" };
    case "sportsContestWinner":
      return { event: vs, title: `${a.competition ? a.competition + ": " : ""}${a.participantA} beat ${a.participantB}?`, category: "Sports" };
    case "sportsTotal":
      return { event: vs, title: `${vs}: total ${a.measure ?? "points"} over ${a.line}?`, category: "Sports" };
    case "sportsSpread":
      return { event: vs, title: `${vs}: ${a.participantA} covers ${a.line ?? "the spread"}?`, category: "Sports" };
    case "sportsContestParticipant2": case "sportsTournamentParticipant": case "awardCandidate":
      return { event: qEvent, title: `${a.participant ?? a.candidate} — ${qEvent}?`, category: t.startsWith("award") ? "Awards" : "Sports" };
    case "sportsContestDraw2":
      return { event: qEvent, title: `${qEvent}: draw?`, category: "Sports" };
    case "policyRateDecrease": case "policyRateIncrease": case "policyRateNoChange":
      return { event: qEvent, title: `${qEvent}: ${t === "policyRateDecrease" ? "cut" : t === "policyRateIncrease" ? "hike" : "hold"}?`, category: "Economy" };
    case "companyIpoConfirmed":
      return { event: `${a.company} IPO`, title: `${a.company} IPO by ${when(a.dateTime)}?`, category: "Tech" };
    case "companyIpoFirstDayMarketCap":
      return { event: `${a.company} IPO`, title: `${a.company} first-day market cap ≥ $${a.marketCapThresholdB}B?`, category: "Tech" };
  }
  // Unknown template: question + outcome name only (descriptions can be long prose rules).
  const outcome = oName.startsWith("template") ? words(t) : oName;
  return { event: qEvent, title: `${qEvent}${outcome && outcome !== qEvent ? ` — ${outcome}` : ""}`.slice(0, 140) };
}

async function mapOutcomes(net: "testnet" | "mainnet", meta: Meta, paperOnly: boolean): Promise<Market[]> {
  const questionOf = new Map<number, Meta["questions"][number]>();
  for (const q of meta.questions ?? []) for (const o of [...q.namedOutcomes, q.fallbackOutcome]) questionOf.set(o, q);
  const settled = new Set((meta.questions ?? []).flatMap((q) => q.settledNamedOutcomes));
  const fallbacks = new Set((meta.questions ?? []).map((q) => q.fallbackOutcome));
  const cutoff = Date.now() + MIN_TIME_TO_EXPIRY_MS;
  // One call prices every outcome token ("#<10*outcome+side>"); exact books are fetched per market on demand.
  const mids = (await info[net].allMids().catch(() => ({}))) as Record<string, string>;

  const out: Market[] = [];
  for (const o of (meta.outcomes ?? []).slice(0, MAX_OUTCOMES)) {
    if (settled.has(o.outcome) || fallbacks.has(o.outcome) || /fallback|smoke/i.test(`${o.name} ${o.description}`)) continue;
    const q = questionOf.get(o.outcome);
    const expiresAt = expiryFrom(o.description ?? "") ?? expiryFrom(q?.description ?? "");
    if (expiresAt && Date.parse(expiresAt) < cutoff) continue;
    const y = num(mids[`#${10 * o.outcome}`]), n = num(mids[`#${10 * o.outcome + 1}`]);
    const yes = y ?? (n !== undefined ? 1 - n : undefined);
    if (yes === undefined || yes <= 0 || yes >= 1) continue; // unpriced or already decided
    const h = humanize(o.name, o.description ?? "", q?.name, q?.description);
    out.push({
      id: makeId(net, o.outcome),
      eventId: q ? `hl-${net[0]}-q${q.question}` : undefined,
      eventTitle: h.event,
      title: h.title,
      category: h.category,
      rules: [o.description, q?.description].filter(Boolean).join(" ") || undefined,
      expiresAt,
      status: "open",
      yesBid: +yes.toFixed(4), yesAsk: +yes.toFixed(4),
      noBid: +(1 - yes).toFixed(4), noAsk: +(1 - yes).toFixed(4),
      source: "hyperliquid",
      hyperliquid: { network: net, outcome: o.outcome, quoteToken: o.quoteToken },
      ...(paperOnly ? { paperOnly: true } : {}),
    });
  }
  return out;
}

let listCache: { at: number; markets: Market[] } | null = null;

export async function listHyperliquidMarkets(): Promise<Market[]> {
  if (!hyperliquidEnabled) return [];
  if (listCache && Date.now() - listCache.at < 60_000) return listCache.markets;
  const [own, main] = await Promise.allSettled([
    info[NETWORK].outcomeMeta().then((m) => mapOutcomes(NETWORK, m, false)),
    INCLUDE_MAINNET ? info.mainnet.outcomeMeta().then((m) => mapOutcomes("mainnet", m, true)) : Promise.resolve([]),
  ]);
  if (own.status === "rejected") console.warn("[hyperliquid] outcomeMeta failed:", (own.reason as Error).message);
  const markets = [...(own.status === "fulfilled" ? own.value : []), ...(main.status === "fulfilled" ? main.value : [])];
  listCache = { at: Date.now(), markets };
  return markets;
}

/** One outcome by id, including settled ones (status "settled", lastPrice = YES settlement value). */
export async function getHyperliquidMarket(id: string): Promise<Market | undefined> {
  const listed = listCache?.markets.find((m) => m.id === id);
  if (listed?.hyperliquid) {
    // Listing prices are mids; use the real book for anything we size or fill against.
    const enc = 10 * listed.hyperliquid.outcome;
    const [yes, no] = await Promise.all([book(listed.hyperliquid.network, enc), book(listed.hyperliquid.network, enc + 1)]);
    return {
      ...listed,
      yesBid: yes.bid ?? (no.ask !== undefined ? +(1 - no.ask).toFixed(4) : listed.yesBid),
      yesAsk: yes.ask ?? (no.bid !== undefined ? +(1 - no.bid).toFixed(4) : listed.yesAsk),
      noBid: no.bid ?? (yes.ask !== undefined ? +(1 - yes.ask).toFixed(4) : listed.noBid),
      noAsk: no.ask ?? (yes.bid !== undefined ? +(1 - yes.bid).toFixed(4) : listed.noAsk),
    };
  }
  if (listed) return listed;
  const p = parseId(id);
  if (!p) return undefined;
  try {
    const s = await info[p.net].settledOutcome({ outcome: p.outcome });
    const yes = num(s?.settleFraction);
    if (s && yes !== undefined)
      return {
        id, eventTitle: s.question?.name ?? s.spec.name, title: s.spec.name, rules: s.spec.description,
        status: "settled", lastPrice: yes, source: "hyperliquid",
        hyperliquid: { network: p.net, outcome: p.outcome, quoteToken: s.spec.quoteToken },
      };
  } catch { /* not settled (or unknown): fall through */ }
  // Active but outside the cached top-N listing: map just this outcome.
  try {
    const meta = await info[p.net].outcomeMeta();
    const one = { ...meta, outcomes: meta.outcomes.filter((o) => o.outcome === p.outcome) };
    return (await mapOutcomes(p.net, one, p.net !== NETWORK))[0];
  } catch {
    return undefined;
  }
}

// ---------- orders ----------

export type HyperliquidOrderResult = {
  exchangeOrderId?: string;
  status: Order["status"];
  filledQuantity: number;
  avgFillPrice?: number;
  mode: "testnet" | "live";
  error?: string;
};

/** Up to 5 significant figures, as Hyperliquid requires; outcome prices live in (0, 1). */
const fmtPx = (p: number) => String(+p.toPrecision(5));

export async function placeHyperliquidOrder(
  market: Market,
  o: { side: Side; action: "buy" | "sell"; quantity: number; limitPrice: number; clientOrderId: string },
): Promise<HyperliquidOrderResult> {
  const mode = hyperliquidMode === "live" ? "live" : "testnet";
  const hl = market.hyperliquid;
  if (!exchange || !hl || hl.network !== NETWORK)
    return { status: "rejected", filledQuantity: 0, mode, error: "Hyperliquid market is not on the configured network" };
  const enc = 10 * hl.outcome + (o.side === "YES" ? 0 : 1);
  // cloid must be 16 bytes hex; derive it from the proposal id so retries are recognizable.
  const cloid = `0x${Buffer.from(o.clientOrderId).toString("hex").padEnd(32, "0").slice(0, 32)}` as Hex;
  try {
    const resp = await exchange.order({
      orders: [{ a: ASSET_OFFSET + enc, b: o.action === "buy", p: fmtPx(o.limitPrice), s: String(o.quantity), r: false, t: { limit: { tif: "Gtc" } }, c: cloid }],
      grouping: "na",
    });
    const st = resp.response.data.statuses[0];
    if (typeof st === "string") return { status: "submitted", filledQuantity: 0, mode }; // waitingForFill / waitingForTrigger
    if ("filled" in st) {
      const filled = num(st.filled.totalSz) ?? 0;
      return {
        exchangeOrderId: String(st.filled.oid),
        status: filled >= o.quantity ? "filled" : "partially_filled",
        filledQuantity: filled,
        avgFillPrice: num(st.filled.avgPx),
        mode,
      };
    }
    return { exchangeOrderId: String(st.resting.oid), status: "open", filledQuantity: 0, mode };
  } catch (e) {
    return { status: "error", filledQuantity: 0, mode, error: (e as Error).message };
  }
}

export async function getHyperliquidOrderStatus(oid: string): Promise<{ status: Order["status"]; filledQuantity: number; avgFillPrice?: number } | undefined> {
  const u = user();
  if (hyperliquidMode === "simulated" || !u || oid.startsWith("sim-")) return undefined;
  try {
    const r = await info[NETWORK].orderStatus({ user: u, oid: Number(oid) });
    if (r.status !== "order") return undefined;
    const ord = r.order.order;
    const orig = num(ord.origSz) ?? 0;
    const filled = Math.max(0, orig - (num(ord.sz) ?? 0));
    const s = r.order.status;
    const status: Order["status"] =
      s === "filled" ? "filled"
      : s === "open" ? (filled > 0 ? "partially_filled" : "open")
      : s.endsWith("Rejected") || s === "rejected" ? "rejected"
      : filled > 0 ? "partially_filled" : "cancelled";
    // orderStatus reports the limit price; fills at a better price still show the limit.
    return { status, filledQuantity: filled, avgFillPrice: filled > 0 ? num(ord.limitPx) : undefined };
  } catch (e) {
    console.warn("[hyperliquid] orderStatus", (e as Error).message);
    return undefined;
  }
}

/** Free quote-token balance (total - hold) across the stablecoins outcomes settle in. */
export async function getHyperliquidBalance(): Promise<{ availableUsd: number; mode: "testnet" | "live" | "simulated" }> {
  const u = user();
  if (hyperliquidMode === "simulated" || !u) return { availableUsd: SIMULATED_BALANCE_USD, mode: "simulated" };
  try {
    const [state, spot] = await Promise.all([info[NETWORK].spotClearinghouseState({ user: u }), info[NETWORK].spotMeta()]);
    const quotes = new Set((listCache?.markets ?? []).map((m) => m.hyperliquid?.quoteToken).filter(Boolean) as string[]);
    // quoteToken may be a token name or a spot token index.
    const names = new Set([...quotes].map((q) => (/^\d+$/.test(q) ? spot.tokens.find((t) => t.index === Number(q))?.name : q)).filter(Boolean) as string[]);
    if (!names.size) names.add("USDC").add("USDH");
    const free = state.balances
      .filter((b) => names.has(b.coin))
      .reduce((s, b) => s + (num(b.total) ?? 0) - (num(b.hold) ?? 0), 0);
    return { availableUsd: free, mode: hyperliquidMode };
  } catch (e) {
    console.warn("[hyperliquid] getBalance failed:", (e as Error).message);
    return { availableUsd: 0, mode: hyperliquidMode };
  }
}
