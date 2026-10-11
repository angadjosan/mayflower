import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { parseInboundText, normalizeHandle } from "@mayflower/messaging";
import { handleUserMessage } from "@mayflower/core";
import { DEFAULT_RISK_LIMITS, newId } from "@mayflower/shared";
import { getContainer } from "@/lib/container";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * BlueBubbles webhook receiver. BlueBubbles does not sign webhooks, so the URL
 * carries a secret segment: /api/webhooks/bluebubbles/<BLUEBUBBLES_WEBHOOK_SECRET>.
 * Replies are sent back through the BlueBubbles REST API.
 */
export async function POST(req: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  const expected = process.env.BLUEBUBBLES_WEBHOOK_SECRET ?? "";
  if (!expected || expected.length !== secret.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(secret))) {
    return new NextResponse("not found", { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const inbound = parseInboundText(body);
  if (!inbound) return NextResponse.json({ ignored: true });

  const c = getContainer();
  if (await c.repo.hasMessage(inbound.externalId)) return NextResponse.json({ duplicate: true });

  const handle = normalizeHandle(inbound.fromHandle);
  let user = await c.repo.getUserByHandle(handle);
  if (!user) {
    user = await c.repo.upsertUser({ id: newId(), imessageHandle: handle, displayName: handle, riskLimits: DEFAULT_RISK_LIMITS });
    await c.repo.linkHandle(user.id, handle, inbound.chatGuid);
    await c.repo.audit({ userId: user.id, actor: "system", action: "user.created_from_imessage" });
  } else if (!(await c.repo.getChatGuid(user.id))) {
    await c.repo.linkHandle(user.id, handle, inbound.chatGuid);
  }

  // Respond quickly to BlueBubbles; do the agent work, then send the reply.
  const result = await handleUserMessage(c, user, inbound.text, "imessage", inbound.externalId);
  if (c.imessage) {
    try { await c.imessage.send({ userId: user.id, chatGuid: inbound.chatGuid, handle }, result.reply); }
    catch (e) { console.error("[bluebubbles] reply failed:", (e as Error).message); }
  }
  return NextResponse.json({ ok: true, actions: result.actions });
}
