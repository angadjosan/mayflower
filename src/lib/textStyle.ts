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

/** Split a reply into separate texts: one per non-empty line, capped so a reply never floods the thread. */
export function toBubbles(text: string): string[] {
  const lines = deDash(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^[\s.,;:!?-]*$/.test(l));
  if (lines.length <= MAX_BUBBLES) return lines;
  return [...lines.slice(0, MAX_BUBBLES - 1), lines.slice(MAX_BUBBLES - 1).join("\n")];
}

/** Gap between bubbles: long enough to read as separate texts, short enough to feel snappy. */
export const BUBBLE_GAP_MS = 700;
