import { describe, it, expect } from "vitest";
import { sharpeRatio } from "./performance";

describe("sharpeRatio", () => {
  it("is N/A with insufficient history", () => {
    expect(sharpeRatio([0.01, 0.02]).value).toBeNull();
  });
  it("computes with enough history", () => {
    const r = sharpeRatio(Array.from({ length: 30 }, (_, i) => (i % 2 ? 0.02 : -0.01)));
    expect(r.value).not.toBeNull();
  });
});
