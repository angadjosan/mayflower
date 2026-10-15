import { describe, expect, it } from "vitest";
import { startsWithOptIn } from "./optIn";

describe("startsWithOptIn", () => {
  it("accepts texts that start with the word", () => {
    expect(startsWithOptIn("mayflower", "mayflower")).toBe(true);
    expect(startsWithOptIn("Mayflower, btc to 120k by friday?", "mayflower")).toBe(true);
    expect(startsWithOptIn("  MAYFLOWER bitcoin rips", "mayflower")).toBe(true);
    expect(startsWithOptIn("\"mayflower\" yo", "mayflower")).toBe(true);
  });

  it("ignores the word anywhere else, or as part of a longer word", () => {
    expect(startsWithOptIn("did you finish mayflower?", "mayflower")).toBe(false);
    expect(startsWithOptIn("mayflowers are pretty", "mayflower")).toBe(false);
    expect(startsWithOptIn("hey whats up", "mayflower")).toBe(false);
    expect(startsWithOptIn("", "mayflower")).toBe(false);
  });

  it("cleans the word the same way as the text", () => {
    expect(startsWithOptIn("mayflower yo", " @Mayflower ")).toBe(true);
  });

  it("is a no-op for an empty word", () => {
    expect(startsWithOptIn("anything", " ")).toBe(true);
  });
});
