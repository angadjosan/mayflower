import { NextResponse } from "next/server";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { handleInbound } from "@/server/conversation";
import { recordUserMessage } from "@/server/notify";
import { messagesFor } from "@/server/views";
import { audit } from "@/server/audit";

export const maxDuration = 120;

function serialize(m: Awaited<ReturnType<typeof messagesFor>>[number]) {
  return { id: m.id, role: m.role, channel: m.channel, text: m.text, delivery: m.delivery, createdAt: m.createdAt.toISOString() };
}

export async function GET() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const msgs = await messagesFor(user.id, 200);
  return NextResponse.json({ messages: msgs.map(serialize) });
}

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim().slice(0, 2000);
  if (!text) return jsonError("Empty message");
  await recordUserMessage(user.id, text, "web");
  try {
    const replies = await handleInbound(user.id, text, "web");
    return NextResponse.json({ replies: replies.map(serialize) });
  } catch (err) {
    await audit({ userId: user.id, actor: "system", action: "chat.error", details: { error: (err as Error).message } });
    return jsonError("Mayflower hit an error handling that message. Nothing was traded.", 500);
  }
}
