import { describe, expect, it } from "vitest";
import { isSelfHandle, loopReason } from "./loopGuard";
import type { ChatMessage } from "./types";

const msg = (role: ChatMessage["role"], text: string, agoMs: number): ChatMessage =>
  ({ id: "m", userId: "u", role, text, channel: "imessage", createdAt: new Date(Date.now() - agoMs).toISOString() }) as ChatMessage;

describe("loop guard", () => {
  it("knows our own handles in any format", () => {
    process.env.BLUEBUBBLES_SELF_HANDLES = "+14153124399, me@icloud.com";
    expect(isSelfHandle("(415) 312-4399")).toBe(true);
    expect(isSelfHandle("ME@iCloud.com")).toBe(true);
    expect(isSelfHandle("+15105551234")).toBe(false);
  });
  it("ignores an echo of a line we just sent", () => {
    const recent = [msg("agent", "nah 50/50 is coin flip, zero edge.\nonly live falcons line is atl vs ravens at 61c", 5_000)];
    expect(loopReason("Nah 50/50 is coin flip, zero edge.", recent)).toMatch(/echo/);
    expect(loopReason("ok check the ravens one", recent)).toBeNull();
  });
  it("trips the breaker after 10 replies in 2 minutes", () => {
    const recent = Array.from({ length: 10 }, (_, i) => msg("agent", `reply ${i}`, i * 1000));
    expect(loopReason("hello?", recent)).toMatch(/circuit breaker/);
    expect(loopReason("hello?", recent.slice(0, 9))).toBeNull();
  });
});
