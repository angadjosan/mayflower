import { describe, expect, it } from "vitest";
import { checkinBlockReason, localHour, pendingCheckins } from "./newsCheckin";
import type { DB } from "../db";
import type { ChatMessage, User } from "../types";

// 2026-10-11T19:00Z = 12:00 noon in Los Angeles (PDT).
const NOON_LA = Date.parse("2026-10-11T19:00:00Z");
const base = { id: "u1", createdAt: "", onboarded: true, paused: false, geminiLinked: false, limits: { budgetUsd: 100, maxPerTradeUsd: 10, maxTotalExposureUsd: 100, riskStyle: "balanced", excludedTopics: [] } } as User;
const msg = (minsAgo: number, role: "user" | "agent" = "user"): ChatMessage => ({ id: "m", userId: "u1", role, text: "x", channel: "imessage", createdAt: new Date(NOON_LA - minsAgo * 60e3).toISOString() });
const db = (messages: ChatMessage[] = []) => ({ messages });

describe("news check-in throttles", () => {
  it("allows a quiet, onboarded user at noon LA time", () => {
    expect(localHour(undefined, NOON_LA)).toBe(12);
    expect(checkinBlockReason(base, db([msg(120)]), NOON_LA)).toBeNull();
  });
  it("respects quiet hours in the user's timezone", () => {
    expect(checkinBlockReason(base, db(), Date.parse("2026-10-11T06:00:00Z"))).toMatch(/quiet hours/); // 11pm LA
    expect(checkinBlockReason(base, db(), Date.parse("2026-10-11T16:30:00Z"))).toBeNull(); // 9:30am LA
    expect(checkinBlockReason({ ...base, timezone: "America/New_York" }, db(), Date.parse("2026-10-12T02:00:00Z"))).toMatch(/quiet/); // 10pm NY
  });
  it("never interrupts a live conversation", () => {
    expect(checkinBlockReason(base, db([msg(5)]), NOON_LA)).toMatch(/mid-conversation/);
    expect(checkinBlockReason(base, db([msg(5, "agent")]), NOON_LA)).toBeNull();
  });
  it("one per ~8h, and not right after an alpha text", () => {
    expect(checkinBlockReason({ ...base, lastNewsCheckinAt: new Date(NOON_LA - 3 * 3600e3).toISOString() }, db(), NOON_LA)).toMatch(/recently/);
    expect(checkinBlockReason({ ...base, lastNewsCheckinAt: new Date(NOON_LA - 9 * 3600e3).toISOString() }, db(), NOON_LA)).toBeNull();
    expect(checkinBlockReason({ ...base, lastAlphaAt: new Date(NOON_LA - 3600e3).toISOString() }, db(), NOON_LA)).toMatch(/alpha/);
  });
  it("skips paused or un-onboarded users", () => {
    expect(checkinBlockReason({ ...base, paused: true }, db(), NOON_LA)).toBeTruthy();
    expect(checkinBlockReason({ ...base, onboarded: false }, db(), NOON_LA)).toBeTruthy();
  });
  it("pending check-ins are the user's unanswered ones from the last day", () => {
    const c = (id: string, hoursAgo: number, status: "sent" | "answered" = "sent", userId = "u1") =>
      ({ id, userId, status, createdAt: new Date(NOON_LA - hoursAgo * 3600e3).toISOString() });
    const d = { newsCheckins: [c("a", 2), c("b", 30), c("c", 1, "answered"), c("d", 1, "sent", "u2")] } as unknown as DB;
    expect(pendingCheckins(d, "u1", NOON_LA).map((x) => x.id)).toEqual(["a"]);
  });
});
