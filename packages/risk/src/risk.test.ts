import { describe, expect, it } from "vitest";
import type { ExposureItem, Quote, UserRiskLimits } from "@mayflower/shared";
import { evaluateWatchConditions, recommendPositionAction, sharpeRatio, sizePosition, summarizePortfolio, watchConditionsFor, findHedges } from "./index";

const quote = (yesAsk: number, yesBid: number): Quote => ({
  buyYes: yesAsk,
  sellYes: yesBid,
  buyNo: Math.round((1 - yesBid) * 100) / 100,
  sellNo: Math.round((1 - yesAsk) * 100) / 100,
  bestBid: yesBid,
  bestAsk: yesAsk,
  lastTrade: yesBid,
  ts: new Date().toISOString(),
});

const limits: UserRiskLimits = { riskBudget: 200, maxPerPosition: 20, maxTotalExposure: 100, riskStyle: "conservative" };
const increments = { quantityIncrement: 1, quantityMinimum: 1, priceIncrement: 0.01, priceMinimum: 0.01 };

const base = {
  quote: quote(0.43, 0.41),
  increments,
  limits,
  availableBalance: 1000,
  exposures: [] as ExposureItem[],
  symbol: "GEMI-SEA-WIN",
  eventTicker: "SEAGAME",
  correlationGroup: "sports-football",
};

describe("sizePosition", () => {
  it("recommends a capped, risk-sized YES trade when there is a real edge", () => {
    const r = sizePosition({ ...base, probability: 0.55, uncertainty: "medium" });
    expect(r.decision).toBe("trade");
    expect(r.side).toBe("yes");
    expect(r.limitPrice).toBe(0.43);
    expect(r.cost).toBeLessThanOrEqual(limits.maxPerPosition);
    expect(r.cost).toBeCloseTo(r.quantity * 0.43, 2);
    expect(r.maxLoss).toBe(r.cost);
    expect(r.maxPayout).toBe(r.quantity);
    expect(r.adjustedProbability).toBeGreaterThan(0.42);
    expect(r.adjustedProbability).toBeLessThan(0.55);
    expect(r.steps.join(" ")).toMatch(/Kelly/);
  });

  it("picks NO when the estimate is below the market", () => {
    const r = sizePosition({ ...base, probability: 0.2, uncertainty: "low" });
    expect(r.decision).toBe("trade");
    expect(r.side).toBe("no");
    expect(r.limitPrice).toBe(0.59);
  });

  it("recommends no trade when the edge is too small", () => {
    const r = sizePosition({ ...base, probability: 0.45, uncertainty: "high" });
    expect(r.decision).toBe("no_trade");
    expect(r.noTradeReasons.join(" ")).toMatch(/edge/i);
    expect(r.quantity).toBe(0);
  });

  it("never exceeds the per-position limit", () => {
    const r = sizePosition({ ...base, probability: 0.9, uncertainty: "low", limits: { ...limits, maxPerPosition: 5, riskStyle: "aggressive" } });
    expect(r.decision).toBe("trade");
    expect(r.cost).toBeLessThanOrEqual(5);
    expect(r.bindingCap).toBe("per_position");
  });

  it("enforces the total exposure limit using existing positions", () => {
    const exposures: ExposureItem[] = [
      { symbol: "X", eventTicker: "E1", outcome: "yes", quantity: 100, atRisk: 98, correlationGroup: "crypto" },
    ];
    const r = sizePosition({ ...base, probability: 0.9, uncertainty: "low", exposures });
    expect(r.cost).toBeLessThanOrEqual(2);
  });

  it("refuses when no room is left under the total limit", () => {
    const exposures: ExposureItem[] = [
      { symbol: "X", eventTicker: "E1", outcome: "yes", quantity: 100, atRisk: 100, correlationGroup: "crypto" },
    ];
    const r = sizePosition({ ...base, probability: 0.9, uncertainty: "low", exposures });
    expect(r.decision).toBe("no_trade");
    expect(r.noTradeReasons.join(" ")).toMatch(/No room/);
  });

  it("caps correlated exposure and explains it", () => {
    const exposures: ExposureItem[] = [
      { symbol: "OTHER-NFL", eventTicker: "NFLGAME2", outcome: "yes", quantity: 40, atRisk: 25, correlationGroup: "sports-football" },
    ];
    const r = sizePosition({ ...base, probability: 0.75, uncertainty: "low", exposures, limits: { ...limits, maxPerPosition: 50 } });
    // conservative group cap = 30% of $100 capacity = $30, $25 already used
    expect(r.cost).toBeLessThanOrEqual(5);
    expect(r.correlated).toHaveLength(1);
    expect(r.steps.join(" ")).toMatch(/related/);
  });

  it("never spends more than the available balance", () => {
    const r = sizePosition({ ...base, probability: 0.9, uncertainty: "low", availableBalance: 3 });
    expect(r.cost).toBeLessThanOrEqual(3);
  });

  it("refuses to buy the opposite side of a held contract", () => {
    const exposures: ExposureItem[] = [
      { symbol: "GEMI-SEA-WIN", eventTicker: "SEAGAME", outcome: "yes", quantity: 10, atRisk: 4.3, correlationGroup: "sports-football" },
    ];
    const r = sizePosition({ ...base, probability: 0.1, uncertainty: "low", exposures });
    expect(r.decision).toBe("no_trade");
  });

  it("refuses wide spreads", () => {
    const r = sizePosition({ ...base, quote: quote(0.6, 0.3), probability: 0.8, uncertainty: "low" });
    expect(r.decision).toBe("no_trade");
    expect(r.noTradeReasons.join(" ")).toMatch(/spread/);
  });

  it("respects quantity increments and minimums", () => {
    const r = sizePosition({ ...base, probability: 0.55, uncertainty: "medium", increments: { ...increments, quantityIncrement: 5, quantityMinimum: 5 } });
    if (r.decision === "trade") expect(r.quantity % 5).toBe(0);
    else expect(r.noTradeReasons.join(" ")).toMatch(/minimum/);
  });
});

describe("exits", () => {
  it("creates watch conditions and evaluates triggers", () => {
    const conds = watchConditionsFor({ outcome: "yes", entryPrice: 0.43, heldProbability: 0.52, expiry: null, riskStyle: "conservative" });
    expect(conds.find((c) => c.kind === "price_below")?.threshold).toBe(0.3);
    const t = evaluateWatchConditions(conds, { heldPrice: 0.28, expiry: null });
    expect(t).toHaveLength(1);
    expect(t[0].condition.kind).toBe("price_below");
  });

  it("recommends closing when the estimate falls well below the exit price", () => {
    const rec = recommendPositionAction({ heldProbability: 0.2, exitPrice: 0.35, entryPrice: 0.43, triggers: [] });
    expect(rec.action).toBe("close");
    expect(rec.fraction).toBe(1);
  });

  it("recommends holding when the edge persists", () => {
    const rec = recommendPositionAction({ heldProbability: 0.6, exitPrice: 0.45, entryPrice: 0.43, triggers: [] });
    expect(rec.action).toBe("hold");
  });
});

describe("portfolio", () => {
  it("summarizes value, P&L and concentration", () => {
    const s = summarizePortfolio({
      positions: [
        { label: "A", costBasis: 8, marketValue: 10, realizedPnl: 0, correlationGroup: "sports-football" },
        { label: "B", costBasis: 4, marketValue: null, realizedPnl: 0, correlationGroup: "tech-ai" },
      ],
      cash: 188,
      reserved: 0,
      realizedFromClosed: 1.5,
      limits,
    });
    expect(s.invested).toBe(12);
    expect(s.unrealizedPnl).toBe(2);
    expect(s.totalValue).toBe(202);
    expect(s.realizedPnl).toBe(1.5);
    expect(s.concentration[0].group).toBe("sports-football");
    expect(s.explanation).toMatch(/football/);
    expect(s.noLiquidityPositions).toBe(1);
  });

  it("returns N/A Sharpe for short histories", () => {
    const snaps = Array.from({ length: 5 }, (_, i) => ({ ts: new Date(Date.UTC(2026, 9, i + 1)).toISOString(), totalValue: 200 + i }));
    const r = sharpeRatio(snaps);
    expect(r.value).toBeNull();
    expect(r.reason).toBe("insufficient history");
  });

  it("computes Sharpe with enough history", () => {
    const snaps = Array.from({ length: 40 }, (_, i) => ({ ts: new Date(Date.UTC(2026, 7, i + 1)).toISOString(), totalValue: 200 * (1 + 0.002 * i + (i % 2 ? 0.003 : -0.003)) }));
    const r = sharpeRatio(snaps);
    expect(r.value).not.toBeNull();
  });

  it("only treats same-event categorical contracts as hedges", () => {
    const mk = (symbol: string, eventTicker: string, label: string, yesAsk: number) => ({
      symbol, contractId: null, eventTicker, eventTitle: "Who wins?", label, category: "sports", subcategoryPath: [], tags: [], description: "",
      rulesUrl: null, eventType: "categorical" as const, status: "active", marketState: "open" as const, expiry: null, quote: quote(yesAsk, yesAsk - 0.02),
      liquidityUsd: 1000, volumeUsd: 1000, increments, priceHistory: [], resolutionSide: null, source: "demo" as const, env: "sandbox" as const,
    });
    const ideas = findHedges(
      { symbol: "A", eventTicker: "E", outcome: "yes", quantity: 20, avgPrice: 0.4, label: "Team A", correlationGroup: "g" },
      [mk("B", "E", "Team B", 0.5), mk("C", "OTHER", "Team C", 0.3)],
      () => "g",
    );
    expect(ideas[0].relationship).toBe("mutually_exclusive");
    expect(ideas[0].scenarios).toHaveLength(3);
    expect(ideas.find((i) => i.symbol === "C")?.relationship).toBe("related");
  });
});
