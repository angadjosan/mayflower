import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { applyLocalTextsUpload, bearer, localSourceId, parseUpload, userIdForUploadToken } from "./ingest";
import type { DB } from "./db";
import type { User } from "./types";

const token = "mfu_" + "a".repeat(43);
const hash = crypto.createHash("sha256").update(token).digest("hex");
const user = (o: Partial<User> = {}) => ({ id: "u1", limits: { excludedTopics: ["Politics"] }, ...o }) as User;

describe("local texts ingest auth", () => {
  it("finds the user only for the exact, unrevoked token", () => {
    const db = { users: [user({ uploadTokenHash: hash }), user({ id: "u2" })] };
    expect(userIdForUploadToken(db, token)).toBe("u1");
    expect(userIdForUploadToken(db, token.slice(0, -1) + "b")).toBeNull();
    expect(userIdForUploadToken(db, "a".repeat(47))).toBeNull(); // wrong prefix
    expect(userIdForUploadToken(db, null)).toBeNull();
    expect(userIdForUploadToken({ users: [user()] }, token)).toBeNull(); // revoked (no hash)
  });
  it("parses the bearer header", () => {
    expect(bearer(`Bearer ${token}`)).toBe(token);
    expect(bearer("Basic abc")).toBeNull();
  });
});

describe("local texts upload", () => {
  it("drops malformed items, events, and anything with phone numbers or emails", () => {
    const r = parseUpload({ items: [
      { kind: "belief", text: "Thinks the Fed cuts", topic: "Fed", excerpt: "fed cuts for sure, text me 415-555-1234" },
      { kind: "fact", text: "Email is a@b.com" },
      { kind: "event", text: "Went to a game" },
      { kind: "nope", text: "x" },
    ] });
    expect(r).toEqual([{ kind: "belief", text: "Thinks the Fed cuts", topic: "Fed" }]);
    expect(parseUpload({ items: Array(61).fill({ kind: "fact", text: "abc" }) })).toMatch(/at most/);
  });
  it("stores a snapshot: replaces the previous upload, never overwrites the user's own theses, skips excluded topics", () => {
    const db = { users: [user()], memories: [], theses: [{ id: "t0", userId: "u1", topic: "Warriors", belief: "mine", confidence: 0.9, source: "chat", updatedAt: "" }], contextItems: [], connectedSources: [] } as unknown as DB;
    let n = 0;
    const nid = (p: string) => `${p}${++n}`;
    const items = parseUpload({ items: [
      { kind: "belief", text: "Thinks the Fed cuts", topic: "Fed", excerpt: "fed cuts" },
      { kind: "belief", text: "Warriors are cooked", topic: "Warriors" },
      { kind: "belief", text: "Dems take the house", topic: "Politics" },
    ] }) as never;
    applyLocalTextsUpload(db, "u1", items, "2026-01-01", nid);
    applyLocalTextsUpload(db, "u1", items, "2026-01-02", nid);
    expect(db.memories.filter((m) => m.source === "imessage_local")).toHaveLength(3);
    expect(db.theses.map((t) => t.topic).sort()).toEqual(["Fed", "Warriors"]);
    expect(db.theses.find((t) => t.topic === "Warriors")!.belief).toBe("mine");
    expect(db.contextItems).toHaveLength(1);
    expect(db.connectedSources[0].id).toBe(localSourceId("u1"));
  });
});
