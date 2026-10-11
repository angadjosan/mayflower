import { daysUntil, formatCents, formatPct, round, type Outcome, type RiskStyle, type WatchCondition } from "@mayflower/shared";

const STOP_DROP: Record<RiskStyle, number> = { conservative: 0.3, balanced: 0.4, aggressive: 0.5 };

/**
 * Watch/exit conditions for a new position. These are alerts that trigger a
 * recommendation — they are NOT stop orders and never execute on their own.
 */
export function watchConditionsFor(input: {
  outcome: Outcome;
  entryPrice: number;
  /** Mayflower's probability for the held outcome at entry. */
  heldProbability: number;
  expiry: string | null;
  riskStyle: RiskStyle;
  thesisWatch?: string[];
}): WatchCondition[] {
  const conditions: WatchCondition[] = [];
  const stop = round(Math.max(0.01, input.entryPrice * (1 - STOP_DROP[input.riskStyle])), 2);
  conditions.push({
    kind: "price_below",
    threshold: stop,
    description: `Price of the held side falls to ${formatCents(stop)} or below (entry ${formatCents(input.entryPrice)}) — reassess and consider reducing. This is an alert, not a guaranteed stop: thin markets can gap past it.`,
  });
  const target = round(Math.min(0.99, Math.max(input.heldProbability, input.entryPrice + 0.05)), 2);
  conditions.push({
    kind: "price_above",
    threshold: target,
    description: `Price of the held side reaches ${formatCents(target)} (about Mayflower's ${formatPct(input.heldProbability)} estimate) — the edge is gone, consider taking profit.`,
  });
  if (input.expiry) {
    conditions.push({ kind: "expiry_near", description: "Contract is within 24 hours of expiry — confirm the resolution details and decide whether to hold to settlement." });
  }
  for (const w of input.thesisWatch ?? []) conditions.push({ kind: "thesis", description: w });
  return conditions;
}

export interface WatchTrigger {
  condition: WatchCondition;
  message: string;
}

export function evaluateWatchConditions(
  conditions: WatchCondition[],
  input: { heldPrice: number | null; expiry: string | null; now?: Date },
): WatchTrigger[] {
  const triggers: WatchTrigger[] = [];
  for (const c of conditions) {
    if (c.kind === "price_below" && c.threshold !== undefined && input.heldPrice !== null && input.heldPrice <= c.threshold) {
      triggers.push({ condition: c, message: `Price fell to ${formatCents(input.heldPrice)}, at or below the ${formatCents(c.threshold)} watch level.` });
    }
    if (c.kind === "price_above" && c.threshold !== undefined && input.heldPrice !== null && input.heldPrice >= c.threshold) {
      triggers.push({ condition: c, message: `Price rose to ${formatCents(input.heldPrice)}, at or above the ${formatCents(c.threshold)} take-profit level.` });
    }
    if (c.kind === "expiry_near") {
      const d = daysUntil(input.expiry, input.now);
      if (d !== null && d <= 1 && d > 0) triggers.push({ condition: c, message: `The contract expires in about ${Math.max(1, Math.round(d * 24))} hours.` });
    }
  }
  return triggers;
}

export type PositionAction = "hold" | "reduce" | "close" | "hedge";

export interface PositionRecommendation {
  action: PositionAction;
  /** Fraction of the position to sell for reduce/close. */
  fraction: number;
  severity: "low" | "medium" | "high";
  reasons: string[];
  holdEdge: number | null;
}

/**
 * Deterministic hold/reduce/close recommendation from the latest estimate and
 * executable exit price. Any resulting sell is only ever a *proposal*.
 */
export function recommendPositionAction(input: {
  /** Latest Mayflower probability for the held outcome (null if no fresh estimate). */
  heldProbability: number | null;
  /** Price we could sell the held outcome at now. */
  exitPrice: number | null;
  entryPrice: number;
  triggers: WatchTrigger[];
  /** Share of risk capacity in this position's correlation group (0-1). */
  groupShare?: number;
  groupCapShare?: number;
}): PositionRecommendation {
  const reasons: string[] = [];
  const holdEdge = input.heldProbability !== null && input.exitPrice !== null ? round(input.heldProbability - input.exitPrice, 4) : null;
  for (const t of input.triggers) reasons.push(t.message);

  if (holdEdge !== null) {
    if (holdEdge < -0.05) {
      reasons.push(`Mayflower now puts the held side at ${formatPct(input.heldProbability)}, well below the ${formatCents(input.exitPrice)} you could sell for — holding has negative expected value.`);
      return { action: "close", fraction: 1, severity: "high", reasons, holdEdge };
    }
    if (holdEdge < 0) {
      reasons.push(`The estimate (${formatPct(input.heldProbability)}) is now slightly below the exit price (${formatCents(input.exitPrice)}).`);
      return { action: "reduce", fraction: 0.5, severity: "medium", reasons, holdEdge };
    }
  }
  const stopHit = input.triggers.some((t) => t.condition.kind === "price_below");
  const targetHit = input.triggers.some((t) => t.condition.kind === "price_above");
  if (targetHit) {
    reasons.push("Most of the expected edge has been realized; locking in part of the gain reduces risk.");
    return { action: "reduce", fraction: 0.5, severity: "medium", reasons, holdEdge };
  }
  if (stopHit && (holdEdge === null || holdEdge < 0.03)) {
    reasons.push("The price drop hit the watch level and the remaining edge is thin.");
    return { action: "reduce", fraction: 0.5, severity: "medium", reasons, holdEdge };
  }
  if (input.groupShare !== undefined && input.groupCapShare !== undefined && input.groupShare > input.groupCapShare) {
    reasons.push(`Related positions make up ${formatPct(input.groupShare)} of your risk capacity, above the ${formatPct(input.groupCapShare)} guideline.`);
    return { action: "hedge", fraction: 0, severity: "medium", reasons, holdEdge };
  }
  if (stopHit) {
    reasons.push("The price fell, but Mayflower's estimate still supports holding.");
    return { action: "hold", fraction: 0, severity: "medium", reasons, holdEdge };
  }
  if (holdEdge !== null) reasons.push(`The estimate still exceeds the exit price by ${formatCents(holdEdge)}.`);
  return { action: "hold", fraction: 0, severity: input.triggers.length > 0 ? "medium" : "low", reasons, holdEdge };
}
