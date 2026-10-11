import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/db";
import { storeMessage, sendToUser } from "@/lib/notify";
import { handleMessage } from "@/lib/agent/chat";
import { handleGroupMessage } from "@/lib/agent/group";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BBPayload {
  type?: string;
  data?: { text?: string; isFromMe?: boolean; handle?: { address?: string }; chats?: { guid?: string }[] };
}

export async function POST(req: Request) {
  const secret = process.env.BLUEBUBBLES_WEBHOOK_SECRET;
  if (secret && new URL(req.url).searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as BBPayload;
  const text = body.data?.text?.trim();
  const address = body.data?.handle?.address;
  if (body.type !== "new-message" || body.data?.isFromMe || !text || !address) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  // Group chats have a ";+;" chat guid; replies go back into the group.
  const chatGuid = body.data?.chats?.[0]?.guid;
  if (chatGuid?.includes(";+;")) {
    try {
      await handleGroupMessage(chatGuid, address, text);
    } catch (e) {
      console.error("[group]", e);
    }
    return NextResponse.json({ ok: true, group: true });
  }
  const user = getOrCreateUser({ handle: address });
  storeMessage(user.id, "user", text, "imessage");
  let reply: string;
  try {
    reply = await handleMessage(user.id, text, "imessage");
  } catch (e) {
    console.error(e);
    reply = "Sorry — something went wrong on my end. Try again in a moment.";
  }
  await sendToUser(user.id, reply);
  return NextResponse.json({ ok: true });
}
