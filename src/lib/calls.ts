// Live voice calls with the ElevenLabs agent. With a Twilio number imported into ElevenLabs
// (ELEVENLABS_PHONE_NUMBER_ID) we ring the user's phone; otherwise we text a signed link that opens a
// browser call. Either way the call carries a token saying who they are, so the agent's tools use their account.
import { load, tx } from "./db";
import { sign, verify } from "./session";
import { normalizePhone } from "./voice";

const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const TTL_MS = 30 * 60 * 1000;
const COOLDOWN_MS = 5 * 60 * 1000; // longer than a call (max 3 min), so a text mid-call never re-rings
const FRESH_MS = 30 * 60 * 1000;

export const callsEnabled = () => Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID && process.env.ELEVENLABS_TOOL_SECRET);

/** `<userId>.<expiresMs>.<sig>`: good for 30 minutes, can't be forged or pointed at another user. */
export function callToken(userId: string, now = Date.now()): string {
  const body = `${userId}.${now + TTL_MS}`;
  return `${body}.${sign(`call:${body}`)}`;
}

export function userIdFromCallToken(token?: string | null, now = Date.now()): string | null {
  const m = /^([^.]+)\.(\d+)\.([\w-]+)$/.exec(token ?? "");
  if (!m) return null;
  const [, userId, exp, sig] = m;
  if (Number(exp) < now || !verify(`call:${userId}.${exp}`, sig)) return null;
  return userId;
}

export function callUrl(userId: string, proposalId?: string): string {
  return `${APP_URL}/call/${callToken(userId)}${proposalId ? `?p=${encodeURIComponent(proposalId)}` : ""}`;
}

/** At most one call (or call link) per user every 5 minutes, claimed atomically so parallel texts can't double-ring. */
export async function claimCall(userId: string, now = Date.now()): Promise<boolean> {
  return tx((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u || (u.lastCallAt && now - Date.parse(u.lastCallAt) < COOLDOWN_MS)) return false;
    u.lastCallAt = new Date(now).toISOString();
    return true;
  });
}

/** The message is a request to talk live ("call me", "can we hop on a call"), not a belief that mentions calling. */
export function wantsCall(text: string): boolean {
  const t = text.trim().replace(/[.!?\s]+$/, "");
  return t.length <= 40 && /^(yo |hey |ok |pls |please )?(call me|give me a call|can (we|you) (talk|call)( me)?|hop on a call|(phone|voice) call|let'?s (talk|call)|ring me)( (now|pls|please))?$/i.test(t);
}

/** What the agent opens with: the given (or freshest) pending trade idea, else an open question. */
export async function callContext(userId: string, proposalId?: string): Promise<{ greeting: string; opener: string }> {
  const pending = (await load()).proposals.filter((p) => p.userId === userId && p.status === "pending");
  const idea = (proposalId && pending.find((p) => p.id === proposalId))
    || pending.filter((p) => Date.now() - Date.parse(p.createdAt) < FRESH_MS).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!idea) {
    return { greeting: "what's good, what you thinking?", opener: "They asked to talk. Find out what they believe about an upcoming event and help them decide if it's worth betting on." };
  }
  const market = idea.market.title && idea.market.title !== idea.market.eventTitle ? `${idea.market.eventTitle}, ${idea.market.title}` : idea.market.eventTitle;
  return {
    greeting: `yo, that ${idea.market.eventTitle} idea actually looks decent. want the quick rundown?`,
    opener: `You are calling about a trade that looks good: ${market}, ${idea.side} at up to ${Math.round(idea.limitPrice * 100)} cents, max loss $${idea.costUsd.toFixed(0)}. Our estimate ${Math.round(idea.estimatedProbability * 100)}% vs the market's ${Math.round(idea.marketProbability * 100)}%. Walk them through why, answer questions, and if they want in, send the approval link (proposalId ${idea.id}).`,
  };
}

/** Ring the user through Twilio when we can; returns false when they need a link instead. */
export async function ringUser(userId: string, proposalId?: string): Promise<boolean> {
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  const user = (await load()).users.find((u) => u.id === userId);
  const to = normalizePhone(user?.handle);
  if (!callsEnabled() || !phoneNumberId || !to) return false;
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: process.env.ELEVENLABS_AGENT_ID,
        agent_phone_number_id: phoneNumberId,
        to_number: to,
        conversation_initiation_client_data: { dynamic_variables: { call_token: callToken(userId), proposal_id: proposalId ?? "" } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    // A 200 can still carry success:false (e.g. Twilio refusing the number), so check the body.
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; conversation_id?: string };
    if (res.ok && body.success === true) {
      await trackCall(userId, body.conversation_id);
      return true;
    }
    console.error("[calls] outbound call failed", res.status, String(body.message ?? "").slice(0, 300));
  } catch (e) {
    console.error("[calls] outbound call error", e);
  }
  return false;
}

/** Remember a call so its transcript lands in the chat history once it ends. */
export async function trackCall(userId: string, conversationId?: string): Promise<void> {
  if (!conversationId || !conversationId.startsWith("conv_")) return;
  await tx((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (u && !(u.unsyncedCalls ?? []).includes(conversationId)) u.unsyncedCalls = [...(u.unsyncedCalls ?? []), conversationId].slice(-5);
  });
}

/**
 * Copy finished call transcripts into the user's chat history, so texts after a call know what was said.
 * Lazy: runs before handling their next text. Calls still in progress stay queued.
 */
export async function syncCallTranscripts(userId: string): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY;
  const ids = (await load()).users.find((u) => u.id === userId)?.unsyncedCalls ?? [];
  if (!key || !ids.length) return;
  const { storeMessage } = await import("./notify");
  for (const conv of ids) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conv}`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const c = (await res.json()) as { status?: string; transcript?: { role: string; message?: string | null }[] };
      if (c.status !== "done" && c.status !== "failed") continue;
      for (const t of (c.transcript ?? []).filter((t) => t.message?.trim()).slice(-24)) {
        await storeMessage(userId, t.role === "user" ? "user" : "agent", `(on the call) ${t.message!.trim()}`, "imessage");
      }
      await tx((db) => {
        const u = db.users.find((x) => x.id === userId);
        if (u) u.unsyncedCalls = (u.unsyncedCalls ?? []).filter((x) => x !== conv);
      });
    } catch (e) {
      console.error("[calls] transcript sync failed", conv, e);
    }
  }
}

/** The last few texts, for the call agent's briefing. */
export async function recentChat(userId: string, n = 8): Promise<string> {
  return (await load()).messages
    .filter((m) => m.userId === userId && !m.groupId)
    .slice(-n)
    .map((m) => `${m.role === "user" ? "them" : "you"}: ${m.text.replace(/https?:\/\/\S+/g, "[link]").slice(0, 200)}`)
    .join("\n");
}
