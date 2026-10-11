/**
 * Watch / exit triggers. These produce RECOMMENDATIONS, never orders.
 */
import type { Position } from "@mayflower/shared";

export interface ExitPolicy {
  /** Recommend reducing when price falls this fraction below entry (e.g. 0.3 = 30%). */
  drawdownFraction: number;
  /** Recommend reviewing when within this many hours of expiry. */
  expiryReviewHours: number;
}

export const DEFAULT_EXIT_POLICY: ExitPolicy = { drawdownFraction: 0.35, expiryReviewHours: 48 };

export interface ExitSignal {
  trigger: "price_move" | "approaching_expiry";
  recommendation: "hold" | "reduce" | "close";
  detail: string;
}

export function evaluateExit(p: Position, expiresAt: string | null | undefined, policy: ExitPolicy = DEFAULT_EXIT_POLICY, now = new Date()): ExitSignal[] {
  const out: ExitSignal[] = [];
  if (p.currentPrice != null && p.avgPrice > 0) {
    const dd = (p.avgPrice - p.currentPrice) / p.avgPrice;
    if (dd >= policy.drawdownFraction) {
      out.push({ trigger: "price_move", recommendation: "reduce", detail: `Price is ${(dd * 100).toFixed(0)}% below your entry (${p.avgPrice.toFixed(2)} → ${p.currentPrice.toFixed(2)}). A reduction is worth considering; an alert is not a guaranteed exit price.` });
    }
  }
  if (expiresAt) {
    const hrs = (new Date(expiresAt).getTime() - now.getTime()) / 36e5;
    if (hrs > 0 && hrs <= policy.expiryReviewHours) {
      out.push({ trigger: "approaching_expiry", recommendation: "hold", detail: `Contract resolves in about ${Math.round(hrs)} hours. Review whether the thesis still holds.` });
    }
  }
  return out;
}
