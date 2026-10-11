import { describe, expect, it } from "vitest";
import { decodeAttributedBody, finalize, scrub, usable, batches } from "./index.mjs";

const typedstream = (s) => {
  const b = Buffer.from(s, "utf8");
  const len = b.length < 0x80 ? Buffer.from([b.length]) : Buffer.concat([Buffer.from([0x81]), Buffer.from([b.length & 0xff, b.length >> 8])]);
  return Buffer.concat([Buffer.from("\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+", "latin1"), len, b, Buffer.from([0x86])]);
};

describe("local texts reader", () => {
  it("decodes attributedBody blobs (short and long strings, unicode)", () => {
    expect(decodeAttributedBody(typedstream("warriors are cooked"))).toBe("warriors are cooked");
    const long = "the fed is going to cut again ".repeat(10) + "📉";
    expect(decodeAttributedBody(typedstream(long))).toBe(long.trim());
    expect(decodeAttributedBody(Buffer.from("garbage"))).toBe("");
  });
  it("scrubs numbers, emails and links and drops reactions/short replies", () => {
    expect(scrub("call 415-555-1234 or a@b.co https://x.y/z")).toBe("call [number] or [email] [link]");
    expect(usable(["lol", "Liked “see you at 8”", "i think btc hits 150k by june", "I think BTC hits 150k by June"])).toEqual(["i think btc hits 150k by june"]);
  });
  it("filters sensitive items locally before upload", () => {
    const out = finalize([
      { kind: "belief", text: "Thinks the Fed cuts", topic: "Fed", excerpt: "fed cuts" },
      { kind: "fact", text: "Sees a therapist weekly" },
      { kind: "belief", text: "thinks the fed cuts" },
      { kind: "event", text: "Went to a game" },
    ]);
    expect(out).toEqual([{ kind: "belief", text: "Thinks the Fed cuts", topic: "Fed", excerpt: "fed cuts" }]);
  });
  it("batches by size", () => {
    expect(batches(["a".repeat(10), "b".repeat(10), "c".repeat(10)], 15, 5)).toHaveLength(3);
    expect(batches(["a".repeat(10), "b".repeat(10), "c".repeat(10)], 15, 2)).toHaveLength(2);
  });
});
