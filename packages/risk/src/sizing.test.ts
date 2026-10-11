import { describe, it, expect } from "vitest";
import { sizePosition, fullKelly } from "./sizing.js";
import { DEFAULT_RISK_LIMITS } from "@mayflower/shared";

const limits = { ...DEFAULT_RISK_LIMITS, totalBudget: 200, maxPerPosition: 20, kellyFraction: 0.25, minEdge: 0.05 };
const base = { side: "YES" as const, estimatedYesProbability: 0.51, uncertainty: 0.08, yesAsk: 0.42, yesBid: 0.4, limits, currentExposure: 0, themeExposure: 0, availableBalance: 1000 };

describe("sizePosition", () => {
  it("computes full Kelly", () => {
    expect(fullKelly(0.6, 0.5)).toBeCloseTo(0.2);
    expect(fullKelly(0.4, 0.5)).toBe(0);
  });
  it("produces a capped fractional-Kelly stake with explanation", () => {
    const r = sizePosition(base);
    expect(r.tradeable).toBe(true);
    expect(r.snapshot.stake).toBeGreaterThan(0);
    expect(r.snapshot.stake).toBeLessThanOrEqual(20);
    expect(r.snapshot.maxLoss).toBe(r.snapshot.stake);
    expect(r.snapshot.explanation).toMatch(/lose \$/);
  });
  it("refuses when edge is below minimum", () => {
    const r = sizePosition({ ...base, estimatedYesProbability: 0.44 });
    expect(r.tradeable).toBe(false);
    expect(r.reason).toMatch(/below the minimum/);
  });
  it("refuses when paused", () => {
    expect(sizePosition({ ...base, limits: { ...limits, paused: true } }).tradeable).toBe(false);
  });
  it("never exceeds remaining budget", () => {
    const r = sizePosition({ ...base, currentExposure: 195 });
    expect(r.snapshot.stake).toBeLessThanOrEqual(5);
  });
  it("respects theme concentration", () => {
    const r = sizePosition({ ...base, themeExposure: 79, estimatedYesProbability: 0.9, uncertainty: 0 });
    expect(r.snapshot.stake).toBeLessThanOrEqual(1);
    expect(r.snapshot.constraints.find((c) => c.name === "theme_concentration")?.bound).toBe(true);
  });
  it("handles NO side via complement", () => {
    const r = sizePosition({ ...base, side: "NO", estimatedYesProbability: 0.3 });
    expect(r.tradeable).toBe(true);
    expect(r.snapshot.limitPrice).toBeCloseTo(0.6, 2);
  });
});
