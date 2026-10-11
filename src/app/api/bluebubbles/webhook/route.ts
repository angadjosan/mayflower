import crypto from "crypto";
import { NextResponse, after } from "next/server";
import { getOrCreateUser } from "@/lib/db";
import { storeMessage, sendToUser } from "@/lib/notify";
import { handleMessage } from "@/lib/agent/chat";
import { handleGroupMessage } from "@/lib/agent/group";
import { bbEnabled, downloadAttachment, isVoiceMemo, sendAttachment, type BBAttachment } from "@/lib/bluebubbles";
import { ElevenLabsError, elevenEnabled, transcribe } from "@/lib/elevenlabs";
import { wantsVoice } from "@/lib/voiceNotes";
import { callsEnabled, callUrl, claimCall, ringUser, wantsCall } from "@/lib/calls";
import { load, tx } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The agent may research several markets before replying (runs in after()).
export const maxDuration = 300;

interface BBPayload {
  type?: string;
  data?: {
    guid?: string; text?: string | null; isFromMe?: boolean; isAudioMessage?: boolean;
    handle?: { address?: string }; chats?: { guid?: string }[]; attachments?: BBAttachment[];
  };
}

function secretOk(given: string | null): boolean {
  const secret = process.env.BLUEBUBBLES_WEBHOOK_SECRET;
  // With the bridge configured, the webhook is public via the tunnel, so a secret is mandatory.
  if (!secret) return !bbEnabled;
  const a = Buffer.from(given ?? ""), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// BlueBubbles retries webhooks it thinks failed; skip message guids we've already taken.
const seen = new Set<string>();
function firstTime(guid?: string): boolean {
  if (!guid) return true;
  if (seen.has(guid)) return false;
  seen.add(guid);
  if (seen.size > 2000) seen.delete(seen.values().next().value!);
  return true;
}

export async function POST(req: Request) {
  if (!secretOk(new URL(req.url).searchParams.get("secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as BBPayload;
  // An attachment-only message carries U+FFFC (or nothing) as its text.
  const typed = body.data?.text?.replace(/\uFFFC/g, "").trim() ?? "";
  const address = body.data?.handle?.address;
  const chatGuid = body.data?.chats?.[0]?.guid;
  const isGroup = Boolean(chatGuid?.includes(";+;"));
  // A 1:1 voice memo is transcribed and handled like a text. Group voice memos are between friends,
  // not addressed to us, so they are never transcribed.
  const memo = isGroup ? undefined : body.data?.attachments?.find(isVoiceMemo);
  const voiceIn = Boolean(memo?.guid) && (Boolean(body.data?.isAudioMessage) || !typed);
  if (body.type !== "new-message" || body.data?.isFromMe || (!typed && !voiceIn) || !address || !firstTime(body.data?.guid)) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (isGroup && process.env.ALLOW_GROUP_CHATS !== "1") {
    console.log("[bluebubbles] ignored group message (ALLOW_GROUP_CHATS != 1)");
    return NextResponse.json({ ok: true, ignored: true });
  }
  // Research can take a while; acknowledge the webhook now and reply over iMessage when done.
  after(async () => {
    let text = typed;
    if (voiceIn) {
      const heard = await hear(memo!.guid!);
      if (typeof heard !== "string") {
        await sendToUser((await getOrCreateUser({ handle: address })).id, MEMO_SORRY[heard.error]);
        return;
      }
      text = heard;
    }
    // Group chats have a ";+;" chat guid; replies go back into the group.
    if (chatGuid?.includes(";+;")) {
      try {
        await handleGroupMessage(chatGuid, address, text);
      } catch (e) {
        console.error("[group]", e);
      }
      return;
    }
    const user = await getOrCreateUser({ handle: address });
    await storeMessage(user.id, "user", text, "imessage");
    // "call me": ring their phone, or text a link that opens a call in the browser.
    if (callsEnabled() && wantsCall(text)) {
      if (!(await claimCall(user.id))) return sendToUser(user.id, "one sec, we just tried you");
      await sendToUser(user.id, (await ringUser(user.id)) ? "calling you now" : `tap to talk: ${callUrl(user.id)}`);
      return;
    }
    const startedAt = Date.now();
    let reply: string;
    try {
      reply = await handleMessage(user.id, text, "imessage");
    } catch (e) {
      console.error(e);
      reply = "ah something broke on my end\ngive me a sec and send that again";
    }
    // A good bet (a new pending trade idea) gets a call; anything else is just a text.
    const goodBet = callsEnabled()
      ? (await load()).proposals
          .filter((p) => p.userId === user.id && p.status === "pending" && Date.parse(p.createdAt) >= startedAt)
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
      : undefined;
    if (goodBet && (await claimCall(user.id))) {
      const rang = await ringUser(user.id, goodBet.id);
      await sendToUser(user.id, `${reply}\n${rang ? "this one looks good, calling you now" : `this one looks good. tap to talk it through: ${callUrl(user.id, goodBet.id)}`}`);
      await sendContactCardOnce(user.id, address);
      return;
    }
    await sendToUser(user.id, reply, { voiceIn, askedForVoice: wantsVoice(text) });
    await sendContactCardOnce(user.id, address);
  });
  return NextResponse.json({ ok: true });
}

// ~6 MB of iMessage AAC is several minutes of talking; longer memos cost STT time and money for no demo value.
const MAX_MEMO_BYTES = 6 * 1024 * 1024;

const MEMO_SORRY = {
  off: "i can't listen to voice memos yet\nmind typing that one?",
  failed: "couldn't quite catch that voice memo\nmind sending it again or typing it?",
  too_long: "that one's a bit long for me\nmind sending a shorter one?",
  down: "my ears are down for a sec\nmind typing that one?",
} as const;

/** Transcribe a voice memo, or say why we couldn't. */
async function hear(attachmentGuid: string): Promise<string | { error: keyof typeof MEMO_SORRY }> {
  if (!elevenEnabled()) return { error: "off" };
  const file = await downloadAttachment(attachmentGuid, MAX_MEMO_BYTES);
  if (file === "too_big") return { error: "too_long" };
  if (!file) return { error: "failed" };
  try {
    return (await transcribe(file.data, file.filename, file.mime)) || { error: "failed" };
  } catch (e) {
    console.error("[voice memo]", e);
    // A bad key, unpaid plan or used-up quota won't fix itself on a re-record.
    return { error: e instanceof ElevenLabsError && [401, 402, 429].includes(e.status) ? "down" : "failed" };
  }
}

/** First conversation: share Mayflower's contact card (name + logo) so the chat shows as "Mayflower". */
async function sendContactCardOnce(userId: string, handle: string) {
  const claimed = await tx((db) => {
    const u = db.users.find((x) => x.id === userId) as ({ contactCardSentAt?: string } & object) | undefined;
    if (!u || u.contactCardSentAt) return false;
    u.contactCardSentAt = new Date().toISOString();
    return true;
  });
  if (!claimed) return;
  try {
    const base = (process.env.APP_URL || "https://mayflower-lac.vercel.app").replace(/\/$/, "");
    const card = await fetch(`${base}/Mayflower.vcf`).then((r) => (r.ok ? r.arrayBuffer() : null));
    if (card) await sendAttachment(handle, "Mayflower.vcf", card, "text/vcard");
  } catch (e) {
    console.error("[contact card]", e);
  }
}
