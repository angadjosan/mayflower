// Small helpers shared by the background research loops (alpha scan, pending refresh, thesis watch).
import { audit } from "../db";
import { sendToUser } from "../notify";
import { generateJSON, type LLMOptions } from "../llm";
import type { Freshness } from "../research";
import type { Market, User } from "../types";

export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const label = (m: Market) => {
  const t = (m.title ?? "").trim(), e = (m.eventTitle ?? "").trim();
  if (!t || t === e) return e;
  // Gemini titles often repeat the event ("Gold price on October 16? — $4,200 or above").
  return t.toLowerCase().startsWith(e.toLowerCase()) ? t : `${e}: ${t}`;
};
export const firstSentence = (s: string, max = 220) => {
  const one = (s || "").split(/(?<=[.!?])\s/)[0] ?? "";
  return one.length > max ? one.slice(0, max - 1).trimEnd() + "…" : one;
};

/** Users the loops may text: onboarded and not paused (pause is the kill switch). */
export const textable = (u?: User) => !!u && u.onboarded && !u.paused;

/** Best-effort delivery; a failed text never breaks a loop. */
export async function notify(userId: string, text: string): Promise<boolean> {
  try {
    await sendToUser(userId, text);
    return true;
  } catch (e) {
    console.warn("[loops] sendToUser failed", userId, (e as Error).message);
    return false;
  }
}

/** Context.dev freshness window that covers everything since `since`. */
export function freshnessSince(since?: string): Freshness {
  const age = since ? Date.now() - Date.parse(since) : Infinity;
  if (age <= 24 * 3600e3) return "last_24_hours";
  if (age <= 7 * 24 * 3600e3) return "last_week";
  return "last_month";
}

/** Audit a loop run. Empty no-op runs are skipped so the single-document store doesn't fill with noise. */
export async function auditLoop(name: string, summary: Record<string, unknown>, worked: boolean) {
  if (!worked && !summary.error) return;
  await audit({ actor: "system", action: `loop.${name}`, detail: summary }).catch(() => undefined);
}

/** Run `fn` over items with at most `n` in flight. */
export async function mapLimit<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/** generateJSON with one retry when the model returns malformed JSON (the fast model occasionally does). */
export async function llmJSON<T>(prompt: string, system: string, opts?: LLMOptions): Promise<T> {
  try {
    return await generateJSON<T>(prompt, system, opts);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    return generateJSON<T>(`${prompt}\n\nYour previous reply was not valid JSON. Reply with strictly valid JSON only (escape quotes inside strings).`, system, opts);
  }
}
