// Hyperliquid HIP-4 outcome markets (binary YES/NO, fully collateralized, priced 0..1) with a simulated fallback.
// Encoding (SDK types + Hyperliquid asset-id docs): enc = 10 * outcome + side (0 = YES, 1 = NO);
// book coin "#enc", balance coin "+enc", order asset id 100_000_000 + enc.
// Order signing (msgpack L1 action + EIP-712 agent) goes through @nktkas/hyperliquid.
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { Market, Order, Side } from "./types";

// Like the Gemini sandbox, testnet is the default; mainnet orders also need an explicit opt-in.
const NETWORK: "testnet" | "mainnet" = process.env.HYPERLIQUID_NETWORK === "mainnet" ? "mainnet" : "testnet";
const PRIVATE_KEY = process.env.HYPERLIQUID_PRIVATE_KEY;
const LIVE_OPT_IN = process.env.HYPERLIQUID_LIVE_TRADING === "1";
// Address whose balance/orders we read; an API (agent) wallet key signs for this master account.
const ACCOUNT_ADDRESS = process.env.HYPERLIQUID_ACCOUNT_ADDRESS as Hex | undefined;
// On testnet, also list mainnet outcomes (public data) as paper-only, mirroring GEMINI_DISCOVERY_INCLUDE_PRODUCTION.
const INCLUDE_MAINNET = NETWORK === "testnet" && process.env.HYPERLIQUID_DISCOVERY_INCLUDE_MAINNET === "1";
const MAX_OUTCOMES = Number(process.env.HYPERLIQUID_MAX_OUTCOMES || 40);

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
  const m = desc.match(/expiry[:=]\s*(\d{4})(\d{2})(\d{2})(?:[-T ]?(\d{2})(\d{2}))?/i);
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

async function mapOutcomes(net: "testnet" | "mainnet", meta: Meta, paperOnly: boolean): Promise<Market[]> {
  const questionOf = new Map<number, Meta["questions"][number]>();
  for (const q of meta.questions ?? []) for (const o of [...q.namedOutcomes, q.fallbackOutcome]) questionOf.set(o, q);
  const settled = new Set((meta.questions ?? []).flatMap((q) => q.settledNamedOutcomes));
  const cutoff = Date.now() + MIN_TIME_TO_EXPIRY_MS;

  const candidates = (meta.outcomes ?? [])
    .filter((o) => !settled.has(o.outcome))
    .map((o) => ({ o, expiresAt: expiryFrom(o.description ?? "") ?? expiryFrom(questionOf.get(o.outcome)?.description ?? "") }))
    .filter((x) => !x.expiresAt || Date.parse(x.expiresAt) >= cutoff)
    .slice(0, MAX_OUTCOMES);

  // Two books per outcome (YES and NO are separate tokens); fetched in small batches to respect rate limits.
  const out: Market[] = [];
  for (let i = 0; i < candidates.length; i += 10) {
    const batch = candidates.slice(i, i + 10);
    const books = await Promise.all(batch.map(({ o }) => Promise.all([book(net, 10 * o.outcome), book(net, 10 * o.outcome + 1)])));
    batch.forEach(({ o, expiresAt }, j) => {
      const [yes, no] = books[j];
      if (yes.bid === undefined && yes.ask === undefined && no.bid === undefined && no.ask === undefined) return; // no quotes
      const q = questionOf.get(o.outcome);
      const eventTitle = q?.name ?? o.name;
      out.push({
        id: makeId(net, o.outcome),
        eventId: q ? `hl-${net[0]}-q${q.question}` : undefined,
        eventTitle,
        title: q ? `${q.name} — ${o.name}` : o.name,
        category: (o.description ?? "").match(/underlying[:=]\s*([A-Za-z0-9]+)/i)?.[1] ? "Crypto" : undefined,
        rules: [o.description, q?.description].filter(Boolean).join(" ") || undefined,
        expiresAt,
        status: "open",
        // Prefer each side's own book; fill gaps from the complementary side.
        yesBid: yes.bid ?? (no.ask !== undefined ? +(1 - no.ask).toFixed(4) : undefined),
        yesAsk: yes.ask ?? (no.bid !== undefined ? +(1 - no.bid).toFixed(4) : undefined),
        noBid: no.bid ?? (yes.ask !== undefined ? +(1 - yes.ask).toFixed(4) : undefined),
        noAsk: no.ask ?? (yes.bid !== undefined ? +(1 - yes.bid).toFixed(4) : undefined),
        source: "hyperliquid",
        hyperliquid: { network: net, outcome: o.outcome, quoteToken: o.quoteToken },
        ...(paperOnly ? { paperOnly: true } : {}),
      });
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
  if (hyperliquidMode === "simulated" || !u) return { availableUsd: 1000, mode: "simulated" };
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
