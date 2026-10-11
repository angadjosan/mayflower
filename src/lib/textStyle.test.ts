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
    expect(toBubbles(many)).toEqual(["line 0", "line 1", "line 2"]);
    // links always survive the cap, long lines get cut to one sentence
    const withLink = `a\nb\nc\nd\napprove: https://x.app/A/1?t=Zz\n${"word ".repeat(40)}`;
    expect(toBubbles(withLink)).toEqual(["a", "b", "c", "approve: https://x.app/A/1?t=Zz"]);
    expect(toBubbles(`the market already has this at 80 percent so you are late. ${"more words ".repeat(20)}`)).toEqual(["the market already has this at 80 percent so you are late."]);
  });

  it("lowercases everything but links, and keeps at most one emoji", () => {
    expect(casual("Hey I'm Mayflower 👋 BTC 🚀🚀")).toBe("hey i'm mayflower 👋 btc");
    expect(casual("Confirm here https://x.app/a/AbC123")).toBe("confirm here https://x.app/a/AbC123");
  });
});
