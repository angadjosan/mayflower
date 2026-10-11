import { describe, it, expect } from "vitest";
import { sameQuestion, venueOf } from "./exchange";
import type { Market } from "./types";

const mk = (id: string, eventTitle: string, title = eventTitle, expiresAt = "2026-12-31T00:00:00Z", source: Market["source"] = "gemini"): Market =>
  ({ id, eventTitle, title, expiresAt, status: "open", source });

describe("sameQuestion (cross-venue dedupe)", () => {
  it("matches the same question worded slightly differently", () => {
    expect(sameQuestion(
      mk("g", "Will the Fed cut rates at the December 2026 FOMC meeting?", undefined, "2026-12-16T19:00:00Z"),
      mk("PM-1", "Fed cuts rates at December 2026 FOMC meeting?", undefined, "2026-12-16T00:00:00Z", "polymarket"),
    )).toBe(true);
  });
  it("never matches different strikes or years", () => {
    expect(sameQuestion(mk("g", "Bitcoin above $150,000 before 2027?"), mk("PM-1", "Bitcoin above $120,000 before 2027?", undefined, undefined, "polymarket"))).toBe(false);
  });
  it("keeps sibling outcomes of one event apart", () => {
    expect(sameQuestion(mk("a", "2027 NBA Finals", "2027 NBA Finals — Lakers"), mk("PM-1", "2027 NBA Finals", "2027 NBA Finals — Celtics", undefined, "polymarket"))).toBe(false);
  });
  it("rejects expiries more than a week apart", () => {
    expect(sameQuestion(mk("a", "Will it snow in NYC?", undefined, "2026-12-01T00:00:00Z"), mk("b", "Will it snow in NYC?", undefined, "2027-02-01T00:00:00Z"))).toBe(false);
  });
});

describe("venueOf", () => {
  it("routes by id prefix", () => {
    expect(venueOf({ id: "PM-0xabc", source: "gemini" })).toBe("polymarket");
    expect(venueOf({ id: "HL-T-12", source: "gemini" })).toBe("hyperliquid");
    expect(venueOf({ id: "GEMI-BTC2610112000-HI84000", source: "gemini" })).toBe("gemini");
  });
});
