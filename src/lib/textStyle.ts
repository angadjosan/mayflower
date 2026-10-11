// How Mayflower sounds in a chat: no em/en dashes, and one thought per text bubble.

const MAX_BUBBLES = 8;

/** Replace em/en dashes used as punctuation with a comma (or nothing at a line start). */
export function deDash(text: string): string {
  return text
    .replace(/^[ \t]*[—–][ \t]*/gm, "")
    .replace(/(\d)[ \t]*[–—][ \t]*(\d)/g, "$1-$2")
    .replace(/[ \t]*[—–][ \t]*/g, ", ")
    .replace(/,\s*,/g, ",");
}

const URL_RE = /(https?:\/\/\S+)/g;
const EMOJI_RE = /\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic}|\ufe0f|\p{Emoji_Modifier})*/gu;

/** Texts like a person: all lowercase (links untouched, they can be case-sensitive) and at most one emoji per reply. */
export function casual(text: string): string {
  let seen = false;
  const noExtraEmoji = text.replace(EMOJI_RE, (e) => (seen ? "" : ((seen = true), e)));
  return noExtraEmoji
    .split(URL_RE)
    .map((part) => (/^https?:\/\//.test(part) ? part : part.toLowerCase()))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "");
}

/** Split a reply into separate texts: one per non-empty line, capped so a reply never floods the thread. */
export function toBubbles(text: string): string[] {
  const lines = casual(deDash(text))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[\s.,;:!?-]*$/.test(l));
  if (lines.length <= MAX_BUBBLES) return lines;
  return [...lines.slice(0, MAX_BUBBLES - 1), lines.slice(MAX_BUBBLES - 1).join("\n")];
}

/** Gap between bubbles: long enough to read as separate texts, short enough to feel snappy. */
export const BUBBLE_GAP_MS = 700;
