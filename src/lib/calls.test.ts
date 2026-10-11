import { describe, expect, it } from "vitest";
import { wantsCall } from "./calls";

describe("wantsCall", () => {
  it.each(["call me", "Call me!", "can we talk?", "yo call me now", "hop on a call", "ring me"])("yes: %s", (t) => expect(wantsCall(t)).toBe(true));
  it.each(["call me crazy but trump wins", "let's talk bitcoin", "can you call the race for me", "the chiefs win sunday"])("no: %s", (t) =>
    expect(wantsCall(t)).toBe(false));
});
