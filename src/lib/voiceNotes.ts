// When a reply goes out as a voice note, and what gets said. Pure functions, no I/O.
//
// Rule: someone who talks to Mayflower (sends a voice memo, or asks for voice) gets spoken replies
// when there is something to talk through. Short acks stay as texts, and anything you need to tap or
// copy (links, approval codes) always stays as a text after the voice note.

import { deDash } from "./textStyle";

/** Below this many spoken characters a reply is a quick text ("got it", "paused"), not a voice note. */
export const VOICE_MIN_CHARS = 90;
/** Keep voice notes short enough to listen to on the street (~45 s at a normal pace). */
const VOICE_MAX_CHARS = 700;

const URL_RE = /https?:\/\/\S+/;
const CODE_RE = /\bapprove\s+\d{4}\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*/gu;

/** The user asked to hear the answer instead of reading it. */
export function wantsVoice(text: string): boolean {
  return /\b(voice (memo|note|message)|send (me )?(an? )?(audio|voice)|read it (out|to me)|out loud)\b/i.test(text);
}

/** Lines that only work as text: links and approval codes. */
const mustStayText = (line: string) => URL_RE.test(line) || CODE_RE.test(line);

// Spoken lowercase acronyms come out as words ("nfl" -> "niffle"), so spell them for the voice.
const SPELL: Record<string, string> = {
  nfl: "N F L", nba: "N B A", mlb: "M L B", nhl: "N H L", ufc: "U F C", wnba: "W N B A", ncaa: "N C A A",
  btc: "bitcoin", eth: "ether", sol: "solana", cpi: "C P I", gdp: "G D P", fomc: "F O M C",
  ai: "A I", ev: "E V", pnl: "P and L",
};

/** One line made for the ear: no emoji, no dashes, acronyms spelled out, ends like a sentence. */
function speakLine(line: string): string {
  const l = deDash(line)
    .replace(EMOJI_RE, "")
    .replace(/\b[a-z]{2,5}\b/gi, (w) => (w === w.toLowerCase() && SPELL[w] ? SPELL[w] : w))
    .replace(/\s{2,}/g, " ")
    .trim();
  return !l || /[.!?]$/.test(l) ? l : `${l}.`;
}

/** Text made for the ear: links dropped, one sentence per line. */
export function speakable(text: string): string {
  return text.split(/\r?\n/).filter((l) => !mustStayText(l)).map(speakLine).filter(Boolean).join(" ");
}

export interface ReplyPlan {
  /** What to say in the voice note, or null to send the whole reply as texts. */
  speak: string | null;
  /** What still goes out as texts: everything when not voiced, else links, codes and anything past the length cap. */
  text: string;
}

export function planReply(reply: string, opts: { voiceIn?: boolean; askedForVoice?: boolean } = {}): ReplyPlan {
  if (!opts.voiceIn && !opts.askedForVoice) return { speak: null, text: reply };
  const spoken: string[] = [];
  const rest: string[] = [];
  let full = false;
  for (const line of reply.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const said = mustStayText(line) ? "" : speakLine(line);
    if (!said && !mustStayText(line)) continue;
    // Whole lines only; once the note is full, the rest of the reply follows as text, in order.
    if (said && !full && [...spoken, said].join(" ").length <= VOICE_MAX_CHARS) spoken.push(said);
    else { if (said) full = true; rest.push(line); }
  }
  const speak = spoken.join(" ");
  if (speak.length < VOICE_MIN_CHARS) return { speak: null, text: reply };
  const text = rest.join("\n");
  if (!text) return { speak, text };
  const pointer = rest.some(mustStayText) ? "the link's in the next text." : "i texted you the rest.";
  return { speak: `${speak} ${pointer}`, text };
}
