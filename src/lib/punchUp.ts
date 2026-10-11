// Last pass on every chat reply: the main agent reasons well but writes paragraphs, so a fast model
// rewrites it short and sassy. Links and approval codes are kept verbatim and re-attached after.
import { generateText, llmEnabled } from "./llm";

const URL_LINE = /https?:\/\/\S+/;

const SYSTEM = `you rewrite a text from mayflower, the user's cool homie who trades prediction markets.
voice: chill, confident, funny, real talk. talks like a friend ("yo bro", "nah", "lowkey", "lock in") without overdoing slang. looks out for them: calls a bad bet a bad bet, gets hyped when there's real edge.
rules: all lowercase. 1 or 2 short lines, under 20 words total. keep the actual answer and any numbers that matter (prices, percents, dollars). no emojis, no em dashes, no lists, no links, no "want me to" menus (one tiny question max).
reply with only the rewritten text.`;

export async function punchUp(reply: string): Promise<string> {
  const links = reply.split(/\r?\n/).filter((l) => URL_LINE.test(l));
  const words = reply.split(/\r?\n/).filter((l) => l.trim() && !URL_LINE.test(l)).join("\n");
  // Already short, or nothing to rewrite: leave it alone.
  if (!llmEnabled || words.length <= 90) return reply;
  try {
    const short = (await generateText(words, SYSTEM, { fast: true })).trim();
    if (!short || short.length > words.length) return reply;
    return [short, ...links].join("\n");
  } catch (e) {
    console.error("[punchUp]", e);
    return reply;
  }
}
