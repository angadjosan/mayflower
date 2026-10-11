/**
 * Portfolio-level exposure, concentration and hedge relationships.
 * Correlation here is tag-based (same theme => correlated). A future
 * iteration can replace `areCorrelated` with an LLM- or data-driven model.
 */
import type { Position } from "@mayflower/shared";

export interface ExposureSummary {
  totalAtRisk: number;
  byTheme: Array<{ theme: string; atRisk: number; share: number; positions: number }>;
  /** Plain-English explanation of what drives the risk. */
  explanation: string;
}

export function positionAtRisk(p: Position): number {
  // Max loss on a long binary position is the remaining cost basis.
  return Math.max(0, p.quantity * p.avgPrice);
}

export function areCorrelated(a: Pick<Position, "tags">, b: Pick<Position, "tags">): boolean {
  return a.tags.some((t) => b.tags.includes(t));
}

export function summarizeExposure(positions: Position[], totalBudget: number): ExposureSummary {
  const open = positions.filter((p) => p.status === "open");
  const totalAtRisk = open.reduce((s, p) => s + positionAtRisk(p), 0);
  const themes = new Map<string, { atRisk: number; positions: number }>();
  for (const p of open) {
    const key = p.tags[0] ?? "uncategorised";
    const cur = themes.get(key) ?? { atRisk: 0, positions: 0 };
    cur.atRisk += positionAtRisk(p);
    cur.positions += 1;
    themes.set(key, cur);
  }
  const denom = totalBudget > 0 ? totalBudget : totalAtRisk || 1;
  const byTheme = [...themes.entries()]
    .map(([theme, v]) => ({ theme, atRisk: v.atRisk, share: v.atRisk / denom, positions: v.positions }))
    .sort((a, b) => b.atRisk - a.atRisk);
  const top = byTheme[0];
  const explanation = !open.length
    ? "No open positions, so nothing is at risk."
    : `$${totalAtRisk.toFixed(2)} is at risk across ${open.length} position${open.length === 1 ? "" : "s"}.` +
      (top ? ` The largest driver is ${top.theme} (${(top.share * 100).toFixed(0)}% of your budget).` : "");
  return { totalAtRisk, byTheme, explanation };
}

/** Exposure in the same theme as a candidate market, for sizing. */
export function themeExposure(positions: Position[], tags: string[]): number {
  return positions
    .filter((p) => p.status === "open" && p.tags.some((t) => tags.includes(t)))
    .reduce((s, p) => s + positionAtRisk(p), 0);
}

export interface HedgeCandidate {
  positionId: string;
  rationale: string;
}

/**
 * Minimal hedge detection: a position whose side is opposite on a market
 * sharing all tags is treated as offsetting. Loosely related contracts are
 * deliberately NOT labelled hedges (spec §6).
 */
export function findHedges(target: Position, others: Position[]): HedgeCandidate[] {
  return others
    .filter((o) => o.id !== target.id && o.status === "open" && o.side !== target.side && o.tags.length > 0 && o.tags.every((t) => target.tags.includes(t)))
    .map((o) => ({ positionId: o.id, rationale: `Opposite side on a market with the same theme (${o.tags.join(", ")}) partially offsets this position.` }));
}
