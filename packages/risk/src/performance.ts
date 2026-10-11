/**
 * Risk-adjusted performance. Sharpe is only reported with enough genuine
 * periodic return history; otherwise it is explicitly N/A (spec §5).
 */
export const MIN_SHARPE_OBSERVATIONS = 20;

export interface SharpeResult {
  value: number | null;
  reason: string;
  observations: number;
}

export function sharpeRatio(periodicReturns: number[], riskFreePerPeriod = 0): SharpeResult {
  const n = periodicReturns.length;
  if (n < MIN_SHARPE_OBSERVATIONS) {
    return { value: null, observations: n, reason: `N/A (insufficient history: ${n}/${MIN_SHARPE_OBSERVATIONS} periods)` };
  }
  const excess = periodicReturns.map((r) => r - riskFreePerPeriod);
  const mean = excess.reduce((a, b) => a + b, 0) / n;
  const variance = excess.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return { value: null, observations: n, reason: "N/A (zero volatility)" };
  return { value: mean / sd, observations: n, reason: "ok" };
}

export function pnlSummary(positions: Array<{ unrealizedPnl: number | null; realizedPnl: number; costBasis: number; status: string }>) {
  const open = positions.filter((p) => p.status === "open");
  const unrealized = open.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
  const realized = positions.reduce((s, p) => s + p.realizedPnl, 0);
  const invested = open.reduce((s, p) => s + p.costBasis, 0);
  return { unrealized, realized, invested, total: unrealized + realized };
}
