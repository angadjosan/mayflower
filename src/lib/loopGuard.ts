// Stops the bot from talking to itself. Texting our own Apple ID or number comes back as an
// incoming message (measured 2026-10-11: a reply loop at ~1 text/second), so three guards:
// never answer our own handles, never answer an echo of our own text, and a per-user circuit breaker.
import type { ChatMessage } from "./types";

const norm = (h: string) => {
  const s = h.trim().toLowerCase();
  if (s.includes("@")) return s;
  const d = s.replace(/\D/g, "");
  return d.length === 10 ? `1${d}` : d;
};

/** BLUEBUBBLES_SELF_HANDLES: the bridge account's own phone numbers / Apple ID emails. */
export function isSelfHandle(address: string): boolean {
  const self = (process.env.BLUEBUBBLES_SELF_HANDLES ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(norm);
  return self.includes(norm(address));
}

const squash = (t: string) => t.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9$%]+/g, " ").trim();

export const BREAKER_WINDOW_MS = 2 * 60 * 1000;
export const BREAKER_MAX = 10;

/** Why to ignore this inbound text, or null to handle it. `recent` = this user's stored messages. */
export function loopReason(text: string, recent: ChatMessage[], now = Date.now()): string | null {
  const agent = recent.filter((m) => m.role === "agent" && now - Date.parse(m.createdAt) < 10 * 60 * 1000);
  const t = squash(text);
  if (t.length >= 8 && agent.some((m) => m.text.split(/\r?\n/).some((line) => squash(line) === t) || squash(m.text) === t)) return "echo of our own text";
  if (agent.filter((m) => now - Date.parse(m.createdAt) < BREAKER_WINDOW_MS).length >= BREAKER_MAX) return "circuit breaker: too many replies";
  return null;
}
