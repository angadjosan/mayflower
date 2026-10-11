import { describe, expect, it } from "vitest";
import { addMemories, applyConsolidation, activeMemories, currentSummary, forgetMemories, selectMemories, cleanMemoryInput } from "./memory";
import type { DB } from "./db";
import type { User } from "./types";

const U = "u1";
const user = { id: U, createdAt: "", onboarded: true, paused: false, geminiLinked: false, limits: { budgetUsd: 100, maxPerTradeUsd: 10, maxTotalExposureUsd: 100, riskStyle: "balanced", excludedTopics: [] } } as User;
const mkDb = () => ({ users: [{ ...user }], memories: [], messages: [], theses: [], contextItems: [], connectedSources: [], newsCheckins: [] }) as unknown as DB;
let n = 0;
const nid = () => `m${++n}`;

describe("memory", () => {
  it("dedupes identical memories on add instead of stacking", () => {
    const db = mkDb();
    addMemories(db, U, [{ kind: "belief", text: "Thinks the Fed cuts in December", topic: "Fed" }], "chat", { at: "2026-01-01T00:00:00Z", newId: nid });
    addMemories(db, U, [{ kind: "belief", text: "thinks the fed cuts in december." }], "chat", { at: "2026-01-02T00:00:00Z", newId: nid });
    expect(db.memories).toHaveLength(1);
    expect(db.memories[0].updatedAt).toBe("2026-01-02T00:00:00Z");
  });

  it("consolidation: newer belief wins whatever order the model gives, history kept via supersededBy", () => {
    const db = mkDb();
    const [old] = addMemories(db, U, [{ kind: "belief", text: "Thinks the Fed holds in December", topic: "Fed" }], "chat", { at: "2026-01-01T00:00:00Z", newId: nid });
    const [neu] = addMemories(db, U, [{ kind: "belief", text: "Now thinks the Fed cuts in December", topic: "Fed" }], "news_reply", { at: "2026-02-01T00:00:00Z", newId: nid });
    // Model got the direction backwards: deterministic rule still keeps the newer one.
    const r = applyConsolidation(db, U, { summary: "Follows the Fed closely.", replace: [{ oldId: neu.id, newId: old.id }] }, { at: "2026-02-02T00:00:00Z", newId: nid });
    expect(r.superseded).toBe(1);
    expect(db.memories.find((m) => m.id === old.id)!.supersededBy).toBe(neu.id);
    expect(activeMemories(db, U).filter((m) => m.kind === "belief").map((m) => m.id)).toEqual([neu.id]);
    expect(currentSummary(db, U)!.text).toBe("Follows the Fed closely.");
    expect(db.users[0].lastMemorySummaryAt).toBe("2026-02-02T00:00:00Z");
  });

  it("consolidation collapses exact duplicates and replaces the old summary", () => {
    const db = mkDb();
    db.memories.push(
      { id: "a", userId: U, kind: "fact", text: "Lives in Seattle", source: "chat", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "b", userId: U, kind: "fact", text: "lives in seattle", source: "imessage_local", createdAt: "2026-01-05", updatedAt: "2026-01-05" },
      { id: "s1", userId: U, kind: "summary", text: "old", source: "consolidation", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    );
    applyConsolidation(db, U, { summary: "new summary" }, { newId: nid });
    expect(db.memories.find((m) => m.id === "a")!.supersededBy).toBe("b");
    expect(db.memories.find((m) => m.id === "s1")!.supersededBy).toBeDefined();
    expect(activeMemories(db, U).filter((m) => m.kind === "summary")).toHaveLength(1);
  });

  it("ignores bogus ids and other users' memories in a plan", () => {
    const db = mkDb();
    db.memories.push({ id: "x", userId: "other", kind: "belief", text: "x", source: "chat", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    const [m] = addMemories(db, U, [{ kind: "belief", text: "mine" }], "chat", { newId: nid });
    expect(applyConsolidation(db, U, { replace: [{ oldId: "x", newId: m.id }, { oldId: "nope", newId: m.id }] }).superseded).toBe(0);
  });

  it("forget deletes the memory and the history it replaced", () => {
    const db = mkDb();
    db.memories.push(
      { id: "old", userId: U, kind: "belief", text: "a", source: "chat", createdAt: "1", updatedAt: "1", supersededBy: "new" },
      { id: "new", userId: U, kind: "belief", text: "b", source: "chat", createdAt: "2", updatedAt: "2" },
      { id: "keep", userId: U, kind: "fact", text: "c", source: "chat", createdAt: "2", updatedAt: "2" },
    );
    expect(forgetMemories(db, U, ["new"]).sort()).toEqual(["new", "old"]);
    expect(db.memories.map((m) => m.id)).toEqual(["keep"]);
    expect(forgetMemories(db, "other", ["keep"])).toEqual([]);
  });

  it("selects topical memories first and caps the list", () => {
    const db = mkDb();
    const at = new Date().toISOString();
    for (let i = 0; i < 50; i++) addMemories(db, U, [{ kind: "fact", text: `Random fact number ${i}` }], "chat", { at, newId: nid });
    addMemories(db, U, [{ kind: "belief", text: "Thinks the Warriors miss the playoffs", topic: "Warriors" }], "chat", { at: "2025-01-01T00:00:00Z", newId: nid });
    const sel = selectMemories(db, U, "what about the warriors tonight?", 40);
    expect(sel).toHaveLength(40);
    expect(sel[0].topic).toBe("Warriors");
  });

  it("rejects malformed or summary input", () => {
    expect(cleanMemoryInput({ kind: "summary", text: "hi there" })).toBeNull();
    expect(cleanMemoryInput({ kind: "belief", text: "" })).toBeNull();
    expect(cleanMemoryInput({ kind: "belief", text: "ok take", confidence: 7 })).toEqual({ kind: "belief", text: "ok take", confidence: 1 });
  });
});
