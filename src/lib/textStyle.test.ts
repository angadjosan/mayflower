import { describe, expect, it } from "vitest";
import { casual, deDash, toBubbles } from "./textStyle";

describe("textStyle", () => {
  it("removes em and en dashes used as punctuation", () => {
    expect(deDash("Hi, I'm Mayflower — I find trades")).toBe("Hi, I'm Mayflower, I find trades");
    expect(deDash("San Francisco vs Seattle – Seattle")).toBe("San Francisco vs Seattle, Seattle");
    expect(deDash("— leading dash")).toBe("leading dash");
    expect(deDash("scores 3–1 tonight")).toBe("scores 3-1 tonight");
    expect(deDash("nothing to change")).toBe("nothing to change");
  });

  it("sends one bubble per non-empty line and caps the count", () => {
    expect(toBubbles("On it 🔎\n\nScanning — now 🎉\n")).toEqual(["on it 🔎", "scanning, now"]);
    const many = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    const b = toBubbles(many);
    expect(b).toHaveLength(8);
    expect(b[7]).toContain("line 11");
  });

  it("lowercases everything but links, and keeps at most one emoji", () => {
    expect(casual("Hey I'm Mayflower 👋 BTC 🚀🚀")).toBe("hey i'm mayflower 👋 btc");
    expect(casual("Confirm here https://x.app/a/AbC123")).toBe("confirm here https://x.app/a/AbC123");
  });
});
