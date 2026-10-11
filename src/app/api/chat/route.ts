import { NextResponse } from "next/server";
import { load, getOrCreateUser } from "@/lib/db";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";
import { storeMessage } from "@/lib/notify";
import { sendIMessage } from "@/lib/bluebubbles";
import { handleMessage } from "@/lib/agent/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const messages = load().messages.filter((m) => m.userId === userId && !m.groupId).slice(-100);
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const user = getOrCreateUser({ id: userId });
  storeMessage(user.id, "user", text, "web");
  let reply: string;
  try {
    reply = await handleMessage(user.id, text, "web");
  } catch (e) {
    console.error(e);
    reply = "Sorry — something went wrong on my end. Try again in a moment.";
  }
  storeMessage(user.id, "agent", reply, "web");
  if (user.handle) await sendIMessage(user.handle, reply);
  return NextResponse.json({ reply });
}
