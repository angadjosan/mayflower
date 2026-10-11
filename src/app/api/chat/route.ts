import { NextResponse } from "next/server";
import { load, getOrCreateUser } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { storeMessage } from "@/lib/notify";
import { sendIMessage } from "@/lib/bluebubbles";
import { handleMessage } from "@/lib/agent/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  const messages = load().messages.filter((m) => m.userId === userId && !m.groupId).slice(-100);
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  const user = getOrCreateUser({ id: await currentUserId() });
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
