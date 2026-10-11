// Settlement: when a market a user holds resolves, pay the position out ($1/contract if their side won, else $0),
// close it, then text the result and (outside quiet hours) phone them about it: a playful roast on a loss, uwu on a win.
// Outcomes come from calibration.resolveMarket: the venue's own result when it reports one, else a final price pinned
// at >=0.99 / <=0.01 after expiry. Unknown outcome => leave the position open and retry next run (never guess).
import { tx, load, audit, now, type DB } from "./db";
import { resolveMarket, type Resolution } from "./calibration";
import { venueOf } from "./exchange";
import { adjustTestUsdc } from "./testWallet";
import { sendToUser } from "./notify";
import { canRing, claimCall, ringUserAbout, type CallAbout } from "./calls";
import { generateText } from "./llm";
import type { MonitorEvent, Position, Side } from "./types";

export const QUIET_START_HOUR = 22; // no settlement calls from 10pm...
export const QUIET_END_HOUR = 8; // ...until 8am (texts still go out)
const DEFAULT_TZ = "America/Los_Angeles";
const MAX_OPENER_WORDS = 25;

export interface SettledPosition {
  positionId: string;
  userId: string;
  marketId: string;
  label: string; // market name for texts/calls
  side: Side;
  quantity: number;
  avgEntryPrice: number;
  settledOutcome: Side;
  outcome: "won" | "lost";
  payoutUsd: number;
  pnlUsd: number; // P&L on the contracts that settled (payout - remaining cost basis)
  inferred: boolean;
  source: string;
}

// ---------------------------------------------------------------- pure helpers (unit-tested)

/** Payout and P&L for an open position given the market's YES outcome (1 = YES won, 0 = NO won). */
export function settlementFor(p: Pick<Position, "side" | "quantity" | "costBasisUsd">, yesOutcome: 0 | 1) {
  const settledOutcome: Side = yesOutcome === 1 ? "YES" : "NO";
  const won = p.side === settledOutcome;
  const payoutUsd = +(won ? p.quantity : 0).toFixed(2);
  return { settledOutcome, outcome: (won ? "won" : "lost") as "won" | "lost", payoutUsd, pnlUsd: +(payoutUsd - p.costBasisUsd).toFixed(2) };
}

/** Hour of day (0-23) at `t` in the given IANA zone (bad zone => Los Angeles). */
export function localHour(t: number, tz?: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz || DEFAULT_TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(t))) % 24;
  } catch {
    return localHour(t, DEFAULT_TZ);
  }
}

/** 10pm to 8am local (America/Los_Angeles unless the user set a zone): text only, no calls. */
export function inQuietHours(t: number, tz?: string): boolean {
  const h = localHour(t, tz);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

export const marketLabel = (m: Position["market"]) =>
  m.title && m.title !== m.eventTitle ? `${m.eventTitle}: ${m.title}` : m.eventTitle;

const money = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2).replace(/\.00$/, "")}`;
const cents = (p: number) => `${Math.round(p * 100)}¢`;

/** The result text, in the usual casual voice. One line per settled position. */
export function settlementText(items: SettledPosition[]): string {
  const line = (s: SettledPosition) =>
    s.outcome === "won"
      ? `${s.label} settled ${s.settledOutcome}. your ${s.side} hit, ${money(s.pnlUsd)} (${s.quantity} contracts paid out $1 each)`
      : `${s.label} settled ${s.settledOutcome}. your ${s.side} at ${cents(s.avgEntryPrice)} didn't make it, ${money(s.pnlUsd)}`;
  if (items.length === 1) return `${line(items[0])} ${items[0].outcome === "won" ? "🎉" : "rip"}`;
  const net = items.reduce((a, s) => a + s.pnlUsd, 0);
  return `results are in:\n${items.map((s) => `• ${line(s)}`).join("\n")}\nnet ${money(net)}`;
}

/** Win if the batch made money overall, else loss. */
export const batchKind = (items: SettledPosition[]): CallAbout["kind"] =>
  items.reduce((a, s) => a + s.pnlUsd, 0) >= 0 ? "win" : "loss";

/** One line for the call agent: market, side, P&L per position. */
export function resultSummary(items: SettledPosition[]): string {
  return items
    .map((s) => `${s.label}: bet ${s.quantity} ${s.side} at ${Math.round(s.avgEntryPrice * 100)} cents, market settled ${s.settledOutcome}, they ${s.outcome} (${money(s.pnlUsd)})`)
    .join("; ");
}

const shortName = (label: string) => label.split(/[:?]/)[0].split(/\s+/).slice(0, 6).join(" ");

export function fallbackOpener(kind: CallAbout["kind"], items: SettledPosition[]): string {
  const s = items[0];
  if (kind === "win") return `uwu... you WON. ${shortName(s.label)} came in ${s.settledOutcome}. look at you.`;
  return `BRO. WHAT WAS THAT. ${shortName(s.label)}?? you had ${s.side} at ${Math.round(s.avgEntryPrice * 100)} cents!`;
}

const EMOJI = /\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*/gu;

/** Make a model line speakable: one line, no quotes/emoji/stage directions, at most 25 words. Empty => unusable. */
export function cleanOpener(raw: string): string {
  const line = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line
    .replace(EMOJI, "")
    .replace(/\*[^*]*\*|\[[^\]]*\]/g, "") // *yells* / [laughs]
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .split(" ").slice(0, MAX_OPENER_WORDS).join(" ");
}

const OPENER_SYSTEM = `You write the very first line Mayflower says when it phones a friend whose prediction-market bet just settled.
It is spoken by a text-to-speech voice on a phone call: no emoji, no hashtags, no stage directions, no quotes. One line, ${MAX_OPENER_WORDS} words max. PG-13.
Mention the actual market (short name) so they know what it's about. Output only the line.`;

/** The call's first line, from the fast model; a fixed fun line if the model is off or says something unusable. */
export async function generateOpener(kind: CallAbout["kind"], items: SettledPosition[]): Promise<string> {
  const vibe = kind === "loss"
    ? `They LOST. Playful, dramatic yelling roast, like a friend losing it over their pick. Caps for yelling are good. Example energy: "BRO. WHAT WAS THAT. the 49ers?? i told you the market had it at 50!" Loud and funny, never cruel: no slurs, no swearing at them, nothing about their looks, identity or intelligence.`
    : `They WON. Over-the-top cute celebration, uwu energy, said the way a person would say it out loud. Example energy: "uwu... you WON. look at you. so proud of you."`;
  const facts = items.map((s) => `- ${s.label}: they bet ${s.side} at ${Math.round(s.avgEntryPrice * 100)} cents (the market's odds for their side), it settled ${s.settledOutcome}, they ${s.outcome} ${money(s.pnlUsd)}`).join("\n");
  try {
    const line = cleanOpener(await generateText(`${vibe}\n\nWhat settled:\n${facts}`, OPENER_SYSTEM, { fast: true }));
    if (line && !line.startsWith("(LLM not configured")) return line;
  } catch (e) {
    console.warn("[settlement] opener generation failed", (e as Error).message);
  }
  return fallbackOpener(kind, items);
}

// ---------------------------------------------------------------- settle

/**
 * Inside a tx: settle every still-open position on `marketId` at the resolved outcome. Idempotent: positions that are
 * already closed are skipped, so a retried or concurrent run never pays twice. Pure state change, no I/O.
 */
export function applySettlement(db: DB, marketId: string, r: Resolution, at = now()): SettledPosition[] {
  const out: SettledPosition[] = [];
  for (const p of db.positions) {
    if (p.marketId !== marketId || p.status !== "open" || p.quantity <= 0) continue;
    const s = settlementFor(p, r.outcome);
    if (venueOf(p.market) === "hyperliquid") adjustTestUsdc(db, p.userId, s.payoutUsd); // fills debited testUSDC; payout credits it back
    const settled: SettledPosition = {
      positionId: p.id, userId: p.userId, marketId, label: marketLabel(p.market), side: p.side, quantity: p.quantity,
      avgEntryPrice: p.avgEntryPrice, settledOutcome: s.settledOutcome, outcome: s.outcome, payoutUsd: s.payoutUsd, pnlUsd: s.pnlUsd,
      inferred: r.inferred, source: r.source,
    };
    p.realizedPnlUsd = +(p.realizedPnlUsd + s.pnlUsd).toFixed(2);
    p.currentPrice = s.outcome === "won" ? 1 : 0;
    p.quantity = 0;
    p.costBasisUsd = 0;
    p.status = "closed";
    p.settledAt = at;
    p.settledOutcome = s.settledOutcome;
    p.outcome = s.outcome;
    p.settlementPayoutUsd = s.payoutUsd;
    p.settlementSource = r.source;
    p.updatedAt = at;
    const ev: MonitorEvent = {
      id: `mon_settle_${p.id}`, userId: p.userId, positionId: p.id,
      trigger: `market settled ${s.settledOutcome}${r.inferred ? " (inferred from final price)" : ""}`,
      recommendation: "close",
      explanation: `Settled: ${settled.quantity} ${p.side} ${s.outcome}, paid $${s.payoutUsd.toFixed(2)} (${money(s.pnlUsd)}). Source: ${r.source}.`,
      createdAt: at,
    };
    if (!db.monitorEvents.some((e) => e.id === ev.id)) db.monitorEvents.push(ev);
    out.push(settled);
  }
  if (out.length) {
    // Nothing left to approve or fill on a resolved market.
    for (const prop of db.proposals) {
      if (prop.marketId === marketId && prop.status === "pending") { prop.status = "expired"; prop.statusReason = "Market settled."; }
    }
    for (const o of db.orders) {
      // Simulated working orders can't fill anymore; real venue orders are left to the venue (it cancels them).
      if (o.marketId === marketId && ["submitted", "open", "partially_filled"].includes(o.status) && (o.mode === "simulated" || o.exchangeOrderId?.startsWith("sim-"))) {
        o.status = "cancelled";
        o.updatedAt = at;
      }
    }
  }
  return out;
}

export interface SettleDeps {
  /** Place the call (default ringUserAbout). Tests pass a stub so nothing dials. */
  ring?: (userId: string, about: CallAbout) => Promise<boolean>;
  now?: () => number;
}

export interface SettleResult {
  settled: SettledPosition[];
  notified: { userId: string; texted: boolean; called: boolean; kind: CallAbout["kind"]; opener?: string; skippedCall?: string }[];
}

/** Settle every open position whose market has a known outcome, then text and (maybe) call each affected user once. */
export async function settlePositions(deps: SettleDeps = {}): Promise<SettleResult> {
  const db0 = await load();
  const open = db0.positions.filter((p) => p.status === "open" && p.quantity > 0);
  const byMarket = new Map<string, Position[]>();
  for (const p of open) byMarket.set(p.marketId, [...(byMarket.get(p.marketId) ?? []), p]);

  const settled: SettledPosition[] = [];
  for (const [marketId, ps] of byMarket) {
    const freshest = [...ps].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
    let r: Resolution | undefined;
    try {
      r = await resolveMarket(marketId, freshest.market);
    } catch (e) {
      console.warn("[settlement] resolve failed", marketId, (e as Error).message);
      continue;
    }
    if (!r) continue; // still open, or expired with no known result yet: retry next run
    const res = r;
    const done = await tx((db) => applySettlement(db, marketId, res));
    for (const s of done) {
      await audit({
        userId: s.userId, actor: "system", action: "position.settled", ref: s.positionId,
        detail: { marketId, side: s.side, quantity: s.quantity, settledOutcome: s.settledOutcome, outcome: s.outcome, payoutUsd: s.payoutUsd, pnlUsd: s.pnlUsd, inferred: s.inferred, source: s.source },
      });
    }
    settled.push(...done);
  }

  const byUser = new Map<string, SettledPosition[]>();
  for (const s of settled) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
  const notified: SettleResult["notified"] = [];
  for (const [userId, items] of byUser) {
    try {
      notified.push({ userId, ...(await notifySettlement(userId, items, deps)) });
    } catch (e) {
      console.error("[settlement] notify failed", userId, e);
    }
  }
  return { settled, notified };
}

/** Text the result, then one call for the whole batch unless paused, quiet hours, can't ring, or called recently. */
async function notifySettlement(userId: string, items: SettledPosition[], deps: SettleDeps) {
  const kind = batchKind(items);
  let texted = false;
  try {
    await sendToUser(userId, settlementText(items));
    texted = true;
  } catch (e) {
    console.error("[settlement] text failed", userId, e);
  }
  const user = (await load()).users.find((u) => u.id === userId);
  const t = deps.now?.() ?? Date.now();
  const skippedCall = !user ? "unknown user"
    : user.paused ? "paused"
    : inQuietHours(t, user.timezone) ? "quiet hours"
    : !deps.ring && !(await canRing(userId)) ? "calls not available"
    : !(await claimCall(userId, t)) ? "called recently"
    : undefined;
  if (skippedCall) {
    await audit({ userId, actor: "system", action: "settlement.notified", detail: { kind, positions: items.map((s) => s.positionId), texted, called: false, skippedCall } });
    return { texted, called: false, kind, skippedCall };
  }
  const opener = await generateOpener(kind, items);
  const about: CallAbout = { kind, summary: resultSummary(items), opener };
  const called = await (deps.ring ?? ringUserAbout)(userId, about);
  await audit({ userId, actor: "agent", action: "settlement.notified", detail: { kind, positions: items.map((s) => s.positionId), texted, called, opener } });
  return { texted, called, kind, opener };
}
