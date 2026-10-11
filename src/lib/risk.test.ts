// Deterministic risk engine: limits are enforced here, not by the LLM.
import { describe, expect, it } from "vitest";
import { sizePosition, MIN_EDGE } from "./risk";
import type { Position, RiskLimits, User } from "./types";

const limits: RiskLimits = { budgetUsd: 200, maxPerTradeUsd: 20, maxTotalExposureUsd: 100, riskStyle: "conservative", excludedTopics: [] };
const user = (l: Partial<RiskLimits> = {}): User =>
  ({ id: "u", createdAt: "", onboarded: true, paused: false, geminiLinked: false, limits: { ...limits, ...l } }) as User;
const open = (costBasisUsd: number): Position =>
  ({ status: "open", costBasisUsd, quantity: costBasisUsd, avgEntryPrice: 1 }) as Position;

const base = { uncertainty: "low" as const, openPositions: [] as Position[], availableUsd: 1000 };

describe("sizePosition", () => {
  it("refuses to trade without enough edge", () => {
    const r = sizePosition({ ...base, estimatedProbability: 0.5 + MIN_EDGE / 2, price: 0.5, user: user() });
    expect(r.quantity).toBe(0);
    expect(r.blockedReason).toMatch(/No trade/);
  });

  it("rejects an invalid price", () => {
    expect(sizePosition({ ...base, estimatedProbability: 0.9, price: 1, user: user() }).blockedReason).toBeTruthy();
  });

  it("never exceeds the user's max per trade", () => {
    const r = sizePosition({ ...base, estimatedProbability: 0.95, price: 0.3, user: user({ riskStyle: "aggressive" }) });
    expect(r.costUsd).toBeLessThanOrEqual(20);
    expect(r.quantity).toBeGreaterThan(0);
    expect(r.explanation).toMatch(/max per trade/);
  });

  it("respects remaining total exposure", () => {
    const r = sizePosition({ ...base, estimatedProbability: 0.95, price: 0.3, user: user(), openPositions: [open(95)] });
    expect(r.costUsd).toBeLessThanOrEqual(5);
  });

  it("blocks when exposure is used up", () => {
    const r = sizePosition({ ...base, estimatedProbability: 0.95, price: 0.3, user: user(), openPositions: [open(100)] });
    expect(r.quantity).toBe(0);
    expect(r.blockedReason).toBeTruthy();
  });

  it("caps by the available exchange balance", () => {
    const r = sizePosition({ ...base, estimatedProbability: 0.95, price: 0.3, user: user(), availableUsd: 3 });
    expect(r.costUsd).toBeLessThanOrEqual(3);
  });

  it("halves size for correlated exposure", () => {
    const a = sizePosition({ ...base, estimatedProbability: 0.95, price: 0.3, user: user() });
    const b = sizePosition({ ...base, estimatedProbability: 0.95, price: 0.3, user: user(), relatedExposureUsd: 10 });
    expect(b.costUsd).toBeLessThan(a.costUsd);
    expect(b.explanation).toMatch(/Halved/);
  });

  it("sizes smaller under higher uncertainty", () => {
    const u = user({ maxPerTradeUsd: 100 });
    const low = sizePosition({ ...base, estimatedProbability: 0.6, price: 0.5, user: u, uncertainty: "low" });
    const high = sizePosition({ ...base, estimatedProbability: 0.6, price: 0.5, user: u, uncertainty: "high" });
    expect(high.costUsd).toBeLessThan(low.costUsd);
  });
});
