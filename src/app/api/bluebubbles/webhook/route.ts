import crypto from "crypto";
import { NextResponse, after } from "next/server";
import { getOrCreateUser } from "@/lib/db";
import { storeMessage, sendToUser } from "@/lib/notify";
import { handleMessage } from "@/lib/agent/chat";
import { handleGroupMessage } from "@/lib/agent/group";
import { bbEnabled } from "@/lib/bluebubbles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BBPayload {
  type?: string;
  data?: { guid?: string; text?: string; isFromMe?: boolean; handle?: { address?: string }; chats?: { guid?: string }[] };
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
  const text = body.data?.text?.trim();
  const address = body.data?.handle?.address;
  if (body.type !== "new-message" || body.data?.isFromMe || !text || !address || !firstTime(body.data?.guid)) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const chatGuid = body.data?.chats?.[0]?.guid;
  const isGroup = Boolean(chatGuid?.includes(";+;"));
  if (isGroup && process.env.ALLOW_GROUP_CHATS !== "1") {
    console.log("[bluebubbles] ignored group message (ALLOW_GROUP_CHATS != 1)");
    return NextResponse.json({ ok: true, ignored: true });
  }
  // Research can take a while; acknowledge the webhook now and reply over iMessage when done.
  after(async () => {
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
    let reply: string;
    try {
      reply = await handleMessage(user.id, text, "imessage");
    } catch (e) {
      console.error(e);
      reply = "ah something broke on my end\ngive me a sec and send that again";
    }
    await sendToUser(user.id, reply);
  });
  return NextResponse.json({ ok: true });
}
