// Deterministic risk engine. The LLM never decides size or enforces limits; this module does.
import { load, tx, now } from "./db";
import type { User, Position } from "./types";

const KELLY_FRACTION = { conservative: 0.25, balanced: 0.4, aggressive: 0.6 } as const;
const UNCERTAINTY_DISCOUNT = { low: 1, medium: 0.6, high: 0.35 } as const;
export const MIN_EDGE = 0.03;

const usd = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function atRiskUsd(positions: Position[]): number {
  return positions
    .filter((p) => p.status === "open")
    .reduce((s, p) => s + (p.costBasisUsd ?? p.quantity * p.avgEntryPrice), 0);
}

export function sizePosition(a: {
  estimatedProbability: number; // P(side wins)
  price: number; // ask for side
  uncertainty: "low" | "medium" | "high";
  user: User;
  openPositions: Position[];
  availableUsd: number;
  relatedExposureUsd?: number;
}): { quantity: number; costUsd: number; explanation: string; blockedReason?: string } {
  const { estimatedProbability: p, price: c, uncertainty, user } = a;
  const L = user.limits;
  const edge = p - c;

  if (!(c > 0 && c < 1)) {
    return { quantity: 0, costUsd: 0, explanation: "No valid executable price.", blockedReason: "No valid executable price for this contract." };
  }
  if (edge < MIN_EDGE) {
    const msg = `My estimate (${pct(p)}) is not far enough above the price (${pct(c)}) to beat fees, spread and model error (need at least ${pct(MIN_EDGE)} edge). No trade.`;
    return { quantity: 0, costUsd: 0, explanation: msg, blockedReason: msg };
  }

  const atRisk = atRiskUsd(a.openPositions);
  const kelly = (p - c) / (1 - c);
  const frac = KELLY_FRACTION[L.riskStyle] ?? 0.25;
  const disc = UNCERTAINTY_DISCOUNT[uncertainty] ?? 0.6;
  const kellyUsd = L.budgetUsd * kelly * frac * disc;

  const caps: { label: string; usd: number }[] = [
    { label: `your max per trade (${usd(L.maxPerTradeUsd)})`, usd: L.maxPerTradeUsd },
    { label: `remaining total-exposure room (${usd(Math.max(0, L.maxTotalExposureUsd - atRisk))} of ${usd(L.maxTotalExposureUsd)})`, usd: L.maxTotalExposureUsd - atRisk },
    { label: `remaining budget (${usd(Math.max(0, L.budgetUsd - atRisk))} of ${usd(L.budgetUsd)})`, usd: L.budgetUsd - atRisk },
    { label: `available exchange balance (${usd(a.availableUsd)})`, usd: a.availableUsd },
  ];
  let target = kellyUsd;
  let binding = `fractional-Kelly sizing (${pct(kelly)} full Kelly x ${frac} for your ${L.riskStyle} style x ${disc} for ${uncertainty} uncertainty = ${usd(kellyUsd)})`;
  for (const cap of caps) {
    if (cap.usd < target) { target = Math.max(0, cap.usd); binding = cap.label; }
  }
  let halved = false;
  if ((a.relatedExposureUsd ?? 0) > 0) { target = target / 2; halved = true; }

  const quantity = Math.floor(target / c);
  const costUsd = +(quantity * c).toFixed(2);
  const parts = [
    `Estimate ${pct(p)} vs price ${pct(c)} (edge ${pct(edge)}).`,
    `Size limited by ${binding}.`,
  ];
  if (halved) parts.push(`Halved because you already have ${usd(a.relatedExposureUsd!)} in related positions (concentration risk).`);
  if (quantity <= 0) {
    const msg = `${parts.join(" ")} That leaves less than one contract's worth (${usd(c)}), so no trade.`;
    return { quantity: 0, costUsd: 0, explanation: msg, blockedReason: msg };
  }
  parts.push(`${quantity} contracts x ${usd(c)} = ${usd(costUsd)} max loss if it resolves against you, out of your ${usd(L.budgetUsd)} budget.`);
  return { quantity, costUsd, explanation: parts.join(" ") };
}

function positionValue(p: Position) {
  return p.quantity * (p.currentPrice ?? p.avgEntryPrice);
}

export function getPortfolioSummary(userId: string): {
  valueUsd: number; availableUsd: number; investedUsd: number; unrealizedPnlUsd: number;
  realizedPnlUsd: number; atRiskUsd: number; riskBudgetUsd: number; exposureExplanation: string;
  sharpe: number | null; history: { at: string; valueUsd: number }[];
  mode: "sandbox" | "simulated"; topicExposure: { topic: string; usd: number }[];
} {
  const db = load();
  const user = db.users.find((u) => u.id === userId);
  const budget = user?.limits.budgetUsd ?? 0;
  const all = db.positions.filter((p) => p.userId === userId);
  const open = all.filter((p) => p.status === "open");
  const invested = open.reduce((s, p) => s + p.costBasisUsd, 0);
  const marketValue = open.reduce((s, p) => s + positionValue(p), 0);
  const unrealized = marketValue - invested;
  const realized = all.reduce((s, p) => s + (p.realizedPnlUsd ?? 0), 0);
  const atRisk = atRiskUsd(open);
  const available = Math.max(0, budget - atRisk);

  const topics = new Map<string, number>();
  for (const p of open) {
    const t = p.market.category || p.market.eventTitle || "Other";
    topics.set(t, (topics.get(t) ?? 0) + p.costBasisUsd);
  }
  const topicExposure = [...topics.entries()].map(([topic, u]) => ({ topic, usd: +u.toFixed(2) })).sort((a, b) => b.usd - a.usd);

  const history = db.snapshots.filter((s) => s.userId === userId).map((s) => ({ at: s.at, valueUsd: s.valueUsd }));
  let sharpe: number | null = null;
  if (history.length >= 20) {
    const rets: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1].valueUsd;
      if (prev > 0) rets.push(history[i].valueUsd / prev - 1);
    }
    const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
    const sd = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
    sharpe = sd > 0 && rets.length >= 19 ? +(mean / sd * Math.sqrt(rets.length)).toFixed(2) : null;
  }

  const lastOrder = [...db.orders].reverse().find((o) => o.userId === userId);
  const mode = lastOrder?.mode ?? (process.env.GEMINI_API_KEY ? "sandbox" : "simulated");

  const top = topicExposure[0];
  const exposureExplanation = open.length === 0
    ? `Nothing at risk yet. Your risk budget is $${budget}.`
    : `$${atRisk.toFixed(2)} of your $${budget} budget is at risk across ${open.length} position${open.length > 1 ? "s" : ""} (max loss if all resolve against you).` +
      (top && atRisk > 0 ? ` Largest concentration: ${top.topic} ($${top.usd.toFixed(2)}, ${Math.round((top.usd / atRisk) * 100)}%).` : "");

  return {
    valueUsd: +(budget + realized + unrealized).toFixed(2),
    availableUsd: +available.toFixed(2),
    investedUsd: +invested.toFixed(2),
    unrealizedPnlUsd: +unrealized.toFixed(2),
    realizedPnlUsd: +realized.toFixed(2),
    atRiskUsd: +atRisk.toFixed(2),
    riskBudgetUsd: budget,
    exposureExplanation, sharpe, history, mode, topicExposure,
  };
}

export function recordSnapshot(userId: string) {
  const s = getPortfolioSummary(userId);
  tx((db) => { db.snapshots.push({ userId, at: now(), valueUsd: s.valueUsd }); });
}
