import type { Position, User } from "@mayflower/shared";
import { impliedProbability } from "@mayflower/shared";
import { findHedges, pnlSummary, sharpeRatio, summarizeExposure } from "@mayflower/risk";
import type { Container } from "./container.js";
import { userExchangeAuth } from "./proposals.js";

/** Refresh current prices / unrealized P&L for all open positions. */
export async function refreshPositions(c: Container, user: User): Promise<Position[]> {
  const positions = await c.repo.listPositions(user.id);
  const exchange = c.exchangeFor(await userExchangeAuth(c, user.id));
  for (const p of positions.filter((x) => x.status === "open")) {
    try {
      const q = await exchange.getQuote(p.marketId);
      const yes = impliedProbability(q);
      if (yes == null) continue;
      const price = p.side === "YES" ? yes : 1 - yes;
      p.currentPrice = price;
      p.unrealizedPnl = Math.round((price - p.avgPrice) * p.quantity * 100) / 100;
      p.updatedAt = new Date().toISOString();
      await c.repo.upsertPosition(p);
      await c.repo.saveQuote(q);
    } catch (e) { console.warn(`[portfolio] quote failed for ${p.marketId}:`, (e as Error).message); }
  }
  return positions;
}

export async function portfolioSnapshot(c: Container, user: User) {
  const positions = await refreshPositions(c, user);
  const exposure = summarizeExposure(positions, user.riskLimits.totalBudget);
  const pnl = pnlSummary(positions);
  let availableBalance: number | null = null;
  try { availableBalance = (await c.exchangeFor(await userExchangeAuth(c, user.id)).getBalances()).find((b) => b.currency === "USD")?.available ?? null; } catch { /* unlinked */ }
  const hedges = Object.fromEntries(positions.map((p) => [p.id, findHedges(p, positions)]));
  // Sharpe needs periodic return history; we don't have it yet → N/A by construction.
  const sharpe = sharpeRatio([]);
  return { positions, exposure, pnl, availableBalance, hedges, sharpe, budget: user.riskLimits.totalBudget, atRiskShare: user.riskLimits.totalBudget ? exposure.totalAtRisk / user.riskLimits.totalBudget : 0 };
}
