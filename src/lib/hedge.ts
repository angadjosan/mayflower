// Hedge finder: genuinely offsetting contracts for an open position, with cost and worst-case math.
// Deterministic (no LLM). Every hedge is labeled a partial hedge, never a guaranteed one, and needs its own approval.
import crypto from "crypto";
import { tx, load, id, now, audit } from "./db";
import { listMarkets } from "./exchange";
import { approvalUrl } from "./execution";
import { atRiskUsd } from "./risk";
import type { Market, Position, Side, TradeProposal } from "./types";

export const HEDGE_LABEL = "Partial hedge, not guaranteed";
const COVER_TARGET = 0.5; // aim to offset ~half of the position's max loss
const MAX_COST_SHARE = 0.5; // never spend more than half the position's cost basis on protection
const MAX_HEDGE_PRICE = 0.95;

export interface HedgeIdea {
  positionId: string;
  marketId: string;
  market: Market;
  side: Side;
  quantity: number;
  price: number; // ask for the hedge side
  costUsd: number;
  relation: "same-event" | "same-underlying";
  worstCaseBeforeUsd: number; // P&L in the worst outcome, position alone (negative = loss)
  worstCaseAfterUsd: number; // P&L in the worst outcome, position + hedge
  lossReducedUsd: number; // how much the worst-case loss shrinks
  costIfPositionWinsUsd: number; // what the hedge costs you when the original bet pays off
  label: typeof HEDGE_LABEL;
  explanation: string;
}

// ---------- contract modelling ----------

type Strike = { value: number; dir: "above" | "below" };

/** "$84,000 or above", "Above $3.5k", "< $100" → strike. Undefined for anything else (ranges, names...). */
export function parseStrike(m: Market): Strike | undefined {
  const label = (m.title.includes(" — ") ? m.title.split(" — ").pop()! : m.title).toLowerCase();
  if (/between|\bto\b|–|-\s*\$/.test(label)) return undefined; // range buckets are not one-sided strikes
  const num = label.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([kmb])?/) ?? label.match(/([\d,]+(?:\.\d+)?)\s*([kmb])?/);
  if (!num) return undefined;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[num[2] as "k" | "m" | "b"] ?? 1;
  const value = Number(num[1].replace(/,/g, "")) * mult;
  if (!Number.isFinite(value)) return undefined;
  if (/above|or more|or higher|over|greater|≥|>|\+/.test(label)) return { value, dir: "above" };
  if (/below|under|or less|or lower|less than|≤|</.test(label)) return { value, dir: "below" };
  return undefined;
}

/** Underlying + settlement key from a Gemini symbol, e.g. GEMI-BTC2610112000-HI84000 → BTC. */
function underlyingOf(m: Market): string | undefined {
  const s = m.id.match(/^GEMI-([A-Z0-9]+?)(\d{10})-/);
  return s ? s[1].replace(/\d+M$/, "") : undefined;
}

type Leg = { market: Market; side: Side; qty: number; price: number };
type Scenario = { label: string; wins: (m: Market) => boolean };

function legPnl(l: Leg, sc: Scenario) {
  const yesWins = sc.wins(l.market);
  const won = l.side === "YES" ? yesWins : !yesWins;
  return l.qty * ((won ? 1 : 0) - l.price);
}

const fmtNum = (n: number) => (n >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${+n.toFixed(4)}`);

/** Settlement-price scenarios around every strike (strike contracts on one underlying, same settlement time). */
function strikeScenarios(markets: Market[]): Scenario[] | undefined {
  const strikes = new Map<string, Strike>();
  for (const m of markets) {
    const s = parseStrike(m);
    if (!s) return undefined;
    strikes.set(m.id, s);
  }
  const vals = [...new Set([...strikes.values()].map((s) => s.value))].sort((a, b) => a - b);
  const pts = new Set<number>([vals[0] * 0.5, vals[vals.length - 1] * 1.5]);
  for (const v of vals) {
    const d = Math.max(Math.abs(v) * 1e-6, 1e-6);
    pts.add(v - d); pts.add(v); pts.add(v + d);
  }
  return [...pts].sort((a, b) => a - b).map((x) => ({
    label: `the price settles around ${fmtNum(x)}`,
    wins: (m) => {
      const s = strikes.get(m.id)!;
      return s.dir === "above" ? x >= s.value : x < s.value;
    },
  }));
}

/** Mutually exclusive outcomes in one categorical event (exactly one contract, or none listed, resolves YES). */
function categoricalScenarios(markets: Market[]): Scenario[] {
  return [
    ...markets.map((w) => ({ label: `"${w.title}" is the outcome`, wins: (m: Market) => m.id === w.id })),
    { label: "some other outcome happens", wins: () => false },
  ];
}

const askFor = (m: Market, side: Side) =>
  side === "YES" ? m.yesAsk ?? (m.noBid != null ? 1 - m.noBid : undefined) : m.noAsk ?? (m.yesBid != null ? 1 - m.yesBid : undefined);
const usd = (n: number) => `$${Math.abs(n).toFixed(2)}`;
const signed = (n: number) => (n < 0 ? `-${usd(n)}` : `+${usd(n)}`);

// ---------- public API ----------

/** Find offsetting contracts for one open position. Returns up to 3 ideas, best protection-per-dollar first. */
export async function findHedges(positionId: string): Promise<HedgeIdea[]> {
  const db = await load();
  const pos = db.positions.find((p) => p.id === positionId && p.status === "open");
  if (!pos || pos.quantity <= 0) return [];
  const user = db.users.find((u) => u.id === pos.userId);
  const all = await listMarkets();
  const self = all.find((m) => m.id === pos.marketId) ?? pos.market;

  const sameEvent = all.filter((m) => m.id !== self.id && self.eventId && m.eventId === self.eventId);
  const und = underlyingOf(self);
  const sameUnderlying = und
    ? all.filter((m) =>
        m.id !== self.id && m.eventId !== self.eventId && underlyingOf(m) === und &&
        m.expiresAt && self.expiresAt && Math.abs(Date.parse(m.expiresAt) - Date.parse(self.expiresAt)) < 60_000)
    : [];

  const openRisk = atRiskUsd(db.positions.filter((p) => p.userId === pos.userId && p.status === "open"));
  const room = user ? Math.min(user.limits.maxPerTradeUsd, user.limits.maxTotalExposureUsd - openRisk) : 0;
  const costCap = Math.min(room, pos.costBasisUsd * MAX_COST_SHARE);
  const posLeg: Leg = { market: self, side: pos.side, qty: pos.quantity, price: pos.avgEntryPrice };

  const ideas: HedgeIdea[] = [];
  const groups: { relation: HedgeIdea["relation"]; markets: Market[] }[] = [
    { relation: "same-event", markets: sameEvent },
    { relation: "same-underlying", markets: sameUnderlying },
  ];
  for (const g of groups) {
    for (const cand of g.markets) {
      // Strike model when both contracts are one-sided strikes; categorical only for one event's contracts.
      const scen = strikeScenarios([self, cand]) ?? (g.relation === "same-event" && !parseStrike(self) && !parseStrike(cand)
        ? categoricalScenarios(sameEvent.concat(self))
        : undefined);
      if (!scen) continue;
      for (const side of ["YES", "NO"] as Side[]) {
        const price = askFor(cand, side);
        if (price == null || price <= 0 || price >= MAX_HEDGE_PRICE) continue;
        let qty = Math.ceil((COVER_TARGET * pos.costBasisUsd) / (1 - price));
        if (qty * price > costCap) qty = Math.floor(costCap / price);
        if (qty < 1) continue;
        const hedgeLeg: Leg = { market: cand, side, qty, price };
        let before = Infinity, after = Infinity, worstLabel = "";
        let costIfWins = 0;
        for (const sc of scen) {
          const a = legPnl(posLeg, sc);
          const b = a + legPnl(hedgeLeg, sc);
          before = Math.min(before, a);
          if (b < after) { after = b; worstLabel = sc.label; }
          // Hedge drag in scenarios where the original position wins.
          if (a > 0) costIfWins = Math.max(costIfWins, a - b);
        }
        const reduced = after - before;
        if (reduced <= 0.005) continue;
        const cost = +(qty * price).toFixed(2);
        const name = (m: Market) => (m.title && m.title !== m.eventTitle ? m.title : m.eventTitle);
        const explanation = [
          `Buy ${qty} ${side} on "${name(cand)}" at $${price.toFixed(2)} (${usd(cost)}).`,
          `It pays out in outcomes where your ${pos.side} on "${name(self)}" loses, so your worst case goes from ${signed(before)} to ${signed(after)} (${usd(reduced)} less at risk).`,
          costIfWins > 0 ? `If your original bet wins, the hedge costs you up to ${usd(costIfWins)} of that profit.` : "",
          `${HEDGE_LABEL}: the worst case is still ${signed(after)} if ${worstLabel}.`,
          g.relation === "same-underlying" ? "It's a different event on the same underlying with the same settlement time; check both contracts' resolution rules match." : "",
          "Hedge quotes can move or not fill in thin markets.",
        ].filter(Boolean).join(" ");
        ideas.push({
          positionId: pos.id, marketId: cand.id, market: cand, side, quantity: qty, price, costUsd: cost,
          relation: g.relation, worstCaseBeforeUsd: +before.toFixed(2), worstCaseAfterUsd: +after.toFixed(2),
          lossReducedUsd: +reduced.toFixed(2), costIfPositionWinsUsd: +costIfWins.toFixed(2), label: HEDGE_LABEL, explanation,
        });
      }
    }
  }
  return ideas.sort((a, b) => b.lossReducedUsd / b.costUsd - a.lossReducedUsd / a.costUsd).slice(0, 3);
}

/** Plain-English summary for chat when no hedge exists. */
export function noHedgeExplanation(pos: Position): string {
  return `I couldn't find a genuinely offsetting contract for "${pos.market.title}" on Gemini right now (I only count contracts in the same event, or the same underlying settling at the same time, that pay out when your position loses). The honest options are to hold, or to reduce/close it.`;
}

/**
 * Create a pending kind:"hedge" proposal (separate approval). Uses the best idea, or the one matching
 * `marketId`/`side`. Reuses an existing pending hedge for the same position + market.
 */
export async function proposeHedge(
  positionId: string,
  opts: { marketId?: string; side?: Side } = {},
): Promise<{ proposal: TradeProposal; idea: HedgeIdea; message: string } | { error: string }> {
  const pos = (await load()).positions.find((p) => p.id === positionId);
  if (!pos || pos.status !== "open") return { error: "That position isn't open." };
  const ideas = await findHedges(positionId);
  const idea = ideas.find((i) => (!opts.marketId || i.marketId === opts.marketId) && (!opts.side || i.side === opts.side));
  if (!idea) return { error: noHedgeExplanation(pos) };

  const existing = (await load()).proposals.find((p) =>
    p.kind === "hedge" && p.status === "pending" && p.hedgeForPositionId === positionId && p.marketId === idea.marketId &&
    Date.parse(p.expiresAt) > Date.now());
  if (existing) return { proposal: existing, idea, message: formatHedgeProposal(existing, idea) };

  const origin = (await load()).proposals.find((p) => p.id === pos.proposalId);
  const proposal: TradeProposal = {
    id: id("prop_"), userId: pos.userId, marketId: idea.marketId, market: idea.market,
    researchId: origin?.researchId ?? "", kind: "hedge", hedgeForPositionId: positionId, discovery: "monitor",
    side: idea.side, quantity: idea.quantity, limitPrice: idea.price, costUsd: idea.costUsd,
    marketProbability: idea.price, estimatedProbability: idea.price, edge: 0,
    thesis: idea.explanation,
    sizingExplanation: `${idea.quantity} contracts x $${idea.price.toFixed(2)} = $${idea.costUsd.toFixed(2)}, sized to offset about half of this position's max loss and capped at half its cost and your per-trade limit. Worst case ${signed(idea.worstCaseBeforeUsd)} → ${signed(idea.worstCaseAfterUsd)}.`,
    riskNotes: `${HEDGE_LABEL}. This is insurance, not a bet with edge: it costs money if your original position wins, and some outcomes still lose on both. It counts toward your exposure limits.${idea.market.source === "mock" ? " Mock market data." : ""}`,
    status: "pending", approvalToken: crypto.randomBytes(16).toString("hex"),
    createdAt: now(), expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(), version: 1,
  };
  await tx((db) => {
    db.proposals.push(proposal);
    db.monitorEvents.push({
      id: id("mon_"), userId: pos.userId, positionId, trigger: "hedge requested", recommendation: "hedge",
      explanation: idea.explanation, proposalId: proposal.id, createdAt: now(),
    });
  });
  await audit({ userId: pos.userId, actor: "agent", action: "hedge.propose", ref: proposal.id, detail: { positionId, marketId: idea.marketId, side: idea.side, lossReducedUsd: idea.lossReducedUsd } });
  return { proposal, idea, message: formatHedgeProposal(proposal, idea) };
}

export function formatHedgeProposal(p: TradeProposal, idea?: HedgeIdea): string {
  return [
    `Hedge idea (${HEDGE_LABEL.toLowerCase()}): ${p.market.eventTitle}${p.market.title !== p.market.eventTitle ? ` — ${p.market.title}` : ""}`,
    `Buy ${p.quantity} ${p.side} @ $${p.limitPrice.toFixed(2)} = $${p.costUsd.toFixed(2)} (the most this hedge can lose).`,
    idea ? `Worst case for that position: ${signed(idea.worstCaseBeforeUsd)} → ${signed(idea.worstCaseAfterUsd)}.` : "",
    `Why: ${p.thesis}`,
    `Review & approve: ${approvalUrl(p)}`,
  ].filter(Boolean).join("\n");
}
