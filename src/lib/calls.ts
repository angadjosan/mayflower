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

/** Undo a claim when nothing actually rang, so a failed attempt doesn't block the next "call me" for 5 minutes. */
export async function releaseCall(userId: string, claimedAt: string): Promise<void> {
  await tx((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (u && u.lastCallAt === claimedAt) u.lastCallAt = undefined;
  });
}

/** The message is a request to talk live ("call me", "can we hop on a call"), not a belief that mentions calling. */
export function wantsCall(text: string): boolean {
  const t = text.trim().replace(/[.!?\s]+$/, "");
  return t.length <= 40 && /^(yo |hey |ok |pls |please |bro |can you )?(call me|give me a call|can (we|you) (talk|call)( me)?|hop on a call|(phone|voice) call|let'?s (talk|call)|ring me)( (now|rn|pls|please|bro|asap))*$/i.test(t);
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
    greeting: `that ${idea.market.eventTitle} idea actually looks decent. want the quick rundown?`,
    opener: `You are calling about a trade that looks good: ${market}, ${idea.side} at up to ${Math.round(idea.limitPrice * 100)} cents, max loss $${idea.costUsd.toFixed(0)}. Our estimate ${Math.round(idea.estimatedProbability * 100)}% vs the market's ${Math.round(idea.marketProbability * 100)}%. Walk them through why, answer questions, and if they want in, send the approval link (proposalId ${idea.id}).`,
  };
}

/** Ring the user through Twilio when we can; returns false when they need a link instead. */
export async function ringUser(userId: string, proposalId?: string): Promise<boolean> {
  const { greeting } = await callContext(userId, proposalId);
  return ringWithOpener(userId, { proposal_id: proposalId ?? "" }, `hey, it's mayflower. ${greeting}`);
}

/** Why we're calling about a settled position: the result, the line to open with, and a one-line summary for the agent. */
export interface CallAbout { kind: "win" | "loss"; summary: string; opener: string }

/** Whether ringing (not just a call link) is possible for this user right now. */
export async function canRing(userId: string): Promise<boolean> {
  const user = (await load()).users.find((u) => u.id === userId);
  return callsEnabled() && Boolean(process.env.ELEVENLABS_PHONE_NUMBER_ID) && Boolean(normalizePhone(user?.handle));
}

/**
 * Ring the user about a settled position. The agent opens with `about.opener` (first-message override) and gets
 * call_reason / result_summary as dynamic variables, which the briefing tool passes back so the agent knows the vibe.
 * If the live agent doesn't allow the first-message override, retry without it: the briefing "say" line carries the opener.
 */
export async function ringUserAbout(userId: string, about: CallAbout): Promise<boolean> {
  const vars = { proposal_id: "", call_reason: `settlement_${about.kind}`, call_opener: about.opener, result_summary: about.summary };
  return ringWithOpener(userId, vars, about.opener);
}

/** Ring opening with `opener` (first-message override); if the agent refuses the override, ring with its default first message. */
async function ringWithOpener(userId: string, vars: Record<string, string>, opener: string): Promise<boolean> {
  const first = await placeCall(userId, vars, opener);
  if (first.ok || !/override/i.test(first.message ?? "")) return first.ok;
  return (await placeCall(userId, vars)).ok;
}

/**
 * Every dynamic variable the agent's tools read, filled for one call. ElevenLabs drops the call on pickup if any is
 * missing (agent placeholders don't apply to real calls), so every call passes all of them; "" means unset.
 */
export function callVars(userId: string, vars: Record<string, string> = {}): Record<string, string> {
  return { proposal_id: "", call_reason: "", call_opener: "", result_summary: "", call_token: callToken(userId), ...vars };
}

/** The exact body POSTed to ElevenLabs' Twilio outbound-call endpoint (exported so tests can show it without dialing). */
export function outboundCallPayload(userId: string, to: string, vars: Record<string, string>, firstMessage?: string) {
  return {
    agent_id: process.env.ELEVENLABS_AGENT_ID,
    agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
    to_number: to,
    conversation_initiation_client_data: {
      dynamic_variables: callVars(userId, vars),
      ...(firstMessage ? { conversation_config_override: { agent: { first_message: firstMessage } } } : {}),
    },
  };
}

async function placeCall(userId: string, vars: Record<string, string>, firstMessage?: string): Promise<{ ok: boolean; message?: string }> {
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  const user = (await load()).users.find((u) => u.id === userId);
  const to = normalizePhone(user?.handle);
  if (!callsEnabled() || !phoneNumberId || !to) return { ok: false };
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify(outboundCallPayload(userId, to, vars, firstMessage)),
      signal: AbortSignal.timeout(20_000),
    });
    // A 200 can still carry success:false (e.g. Twilio refusing the number), so check the body.
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; conversation_id?: string };
    if (res.ok && body.success === true) {
      await trackCall(userId, body.conversation_id);
      return { ok: true };
    }
    // FastAPI-style errors put the reason in `detail`.
    const message = String(body.message ?? JSON.stringify((body as { detail?: unknown }).detail ?? "")).slice(0, 300);
    console.error("[calls] outbound call failed", res.status, message);
    return { ok: false, message };
  } catch (e) {
    console.error("[calls] outbound call error", e);
  }
  return { ok: false };
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
