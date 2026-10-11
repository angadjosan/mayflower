import { NextResponse, after } from "next/server";
import { config } from "@/server/config";
import { safeEqual } from "@/server/crypto";
import { parseBlueBubblesWebhook } from "@/server/bluebubbles";
import { getOrCreateUserByHandle } from "@/server/users";
import { recordUserMessage, sendToUser } from "@/server/notify";
import { handleInbound } from "@/server/conversation";
import { audit } from "@/server/audit";

export const maxDuration = 120;

/**
 * BlueBubbles webhook. Configure in BlueBubbles Server → API & Webhooks:
 *   https://<app>/api/imessage/webhook?secret=<BLUEBUBBLES_WEBHOOK_SECRET>   (event: New Messages)
 */
export async function POST(req: Request) {
  const expected = config().blueBubblesWebhookSecret;
  const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-mayflower-secret") ?? "";
  if (!expected || !safeEqual(provided, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = await req.json().catch(() => null);
  const msg = parseBlueBubblesWebhook(payload);
  if (!msg || msg.isFromMe || msg.isGroup || !msg.text.trim()) return NextResponse.json({ ok: true, ignored: true });

  const user = await getOrCreateUserByHandle(msg.handle);
  // Deduplicate by BlueBubbles message GUID: webhook retries never produce a second reply.
  const recorded = await recordUserMessage(user.id, msg.text, "imessage", msg.guid);
  if (!recorded) return NextResponse.json({ ok: true, duplicate: true });

  // Reply after responding so BlueBubbles doesn't time out while Mayflower researches.
  after(async () => {
    try {
      await handleInbound(user.id, msg.text, "imessage");
    } catch (err) {
      await audit({ userId: user.id, actor: "system", action: "imessage.error", details: { error: (err as Error).message } });
      await sendToUser(user, "Sorry — I hit an error handling that. Nothing was traded. Try again in a moment.");
    }
  });
  return NextResponse.json({ ok: true });
}
