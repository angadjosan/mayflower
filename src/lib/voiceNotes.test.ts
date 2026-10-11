import { describe, expect, it } from "vitest";
import { planReply, speakable, wantsVoice, VOICE_MIN_CHARS } from "./voiceNotes";
import { isVoiceMemo } from "./bluebubbles";

const LONG = "honestly the chiefs line looks fair to me\nthe market has them at 62 percent and i get about the same\nnot worth a bet at that price";

describe("planReply", () => {
  it("keeps typed conversations in text", () => {
    expect(planReply(LONG)).toEqual({ speak: null, text: LONG });
  });

  it("voices a conversational reply to a voice memo", () => {
    const p = planReply(LONG, { voiceIn: true });
    expect(p.speak).toContain("chiefs line looks fair");
    expect(p.text).toBe("");
  });

  it("sends short acks as text even in a voice conversation", () => {
    expect(planReply("got it\nup to $200 total", { voiceIn: true })).toEqual({ speak: null, text: "got it\nup to $200 total" });
  });

  it("voices when asked even if they typed", () => {
    expect(planReply(LONG, { askedForVoice: true }).speak).not.toBeNull();
  });

  it("keeps links and approval codes as text and never reads them out", () => {
    const reply = `${LONG}\nreview & approve: https://mayflower.app/approve/abc?sig=XyZ\nor text APPROVE 4821`;
    const p = planReply(reply, { voiceIn: true });
    expect(p.speak).not.toMatch(/https?:|4821/);
    expect(p.speak).toMatch(/link's in the next text/);
    expect(p.text).toBe("review & approve: https://mayflower.app/approve/abc?sig=XyZ\nor text APPROVE 4821");
  });
});

describe("long replies", () => {
  it("speaks whole lines up to the cap and texts the rest in order", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line number ${i} of a long answer about the market`);
    const p = planReply(lines.join("\n"), { voiceIn: true });
    expect(p.speak!.length).toBeLessThanOrEqual(700 + 30);
    expect(p.speak).toMatch(/i texted you the rest\.$/);
    const spokenCount = (p.speak!.match(/line number/g) ?? []).length;
    expect(p.text.split("\n")).toEqual(lines.slice(spokenCount));
  });

  it("falls back to text when the first line alone is too long to speak", () => {
    const giant = "word ".repeat(200).trim();
    expect(planReply(giant, { voiceIn: true }).speak).toBeNull();
  });
});

describe("speakable", () => {
  it("spells lowercase acronyms, drops emoji and dashes, ends sentences", () => {
    expect(speakable("nfl sunday 🏈\nbtc above 120k — maybe")).toBe("N F L sunday. bitcoin above 120k, maybe.");
  });

  it("leaves words that only look like acronyms alone when capitalised", () => {
    expect(speakable("NFL odds")).toBe("NFL odds.");
  });


  it("treats the threshold as spoken length", () => {
    expect(VOICE_MIN_CHARS).toBeGreaterThan("got it. up to $200 total.".length);
  });
});

describe("wantsVoice", () => {
  it.each(["send me a voice memo", "can you say that out loud", "read it to me", "voice note pls"])("yes: %s", (t) => {
    expect(wantsVoice(t)).toBe(true);
  });
  it.each(["the chiefs win sunday", "my budget is $200", "what's my portfolio", "talk to me about btc", "what did you say it was"])("no: %s", (t) => {
    expect(wantsVoice(t)).toBe(false);
  });
});

describe("isVoiceMemo", () => {
  it("matches an iMessage voice memo as BlueBubbles serialises it", () => {
    expect(isVoiceMemo({ uti: "com.apple.coreaudio-format", mimeType: "audio/mp3", transferName: "Audio Message.mp3.mp3" })).toBe(true);
  });
  it("ignores a song someone shares", () => {
    expect(isVoiceMemo({ uti: "public.mp3", mimeType: "audio/mpeg", transferName: "song.mp3" })).toBe(false);
  });
  it("ignores photos", () => {
    expect(isVoiceMemo({ uti: "public.jpeg", mimeType: "image/jpeg", transferName: "IMG_1.jpeg" })).toBe(false);
  });
});
