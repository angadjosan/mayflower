// How Mayflower sounds in a chat: no em/en dashes, and one thought per text bubble.

const MAX_BUBBLES = 3;

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

const MAX_LINE = 140;

/** A long line is cut to its first sentence (or ~140 chars at a word); lines with links are never cut. */
function trimLine(line: string): string {
  if (line.length <= MAX_LINE || /https?:\/\//.test(line)) return line;
  const first = /^.{20,}?[.!?](?=\s|$)/.exec(line)?.[0];
  if (first && first.length <= MAX_LINE) return first;
  return line.slice(0, MAX_LINE).replace(/\s+\S*$/, "");
}

/**
 * Split a reply into separate texts, one per line, and keep it short no matter what the model wrote:
 * at most MAX_BUBBLES lines of words (each trimmed), plus every link line so approvals never get lost.
 */
export function toBubbles(text: string): string[] {
  const lines = casual(deDash(text))
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[\s.,;:!?-]*$/.test(l));
  let words = 0;
  return lines.filter((l) => /https?:\/\//.test(l) || ++words <= MAX_BUBBLES).map(trimLine);
}

/** Gap between bubbles: long enough to read as separate texts, short enough to feel snappy. */
export const BUBBLE_GAP_MS = 700;
