// Opt-in gate for a bridge running on someone's personal Apple ID. With MAYFLOWER_OPT_IN_WORD set, a new sender is
// answered only if their text starts with that word ("mayflower, btc to 120k?"); anyone who already has an account
// is answered as usual. Unset = answer every sender.
import { findUserByHandle } from "./auth";

const clean = (s: string) => s.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u, "");

export function startsWithOptIn(text: string, word: string): boolean {
  const w = clean(word);
  if (!w) return true;
  const t = clean(text);
  return t.startsWith(w) && !/[\p{L}\p{N}]/u.test(t.charAt(w.length));
}

/** "word" = this text opts them in (the caller creates the account now, so a quick second text isn't dropped). */
export async function optedIn(address: string, text: string): Promise<"open" | "word" | "known" | false> {
  const word = process.env.MAYFLOWER_OPT_IN_WORD?.trim();
  if (!word) return "open";
  if (await findUserByHandle(address)) return "known";
  return startsWithOptIn(text, word) ? "word" : false;
}
