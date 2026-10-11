import { NextResponse } from "next/server";
import { handleUserMessage } from "@mayflower/core";
import { normalizeHandle } from "@mayflower/messaging";
import { getContainer } from "@/lib/container";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ElevenLabs stretch (P3, NOT YET WIRED): a conversational-agent server tool can
 * POST { callerNumber, text } here and speak the reply. Voice can never approve
 * a trade directly — the handler returns a signed approval link instead.
 */
export async function POST(req: Request) {
  if (!process.env.ELEVENLABS_WEBHOOK_SECRET || req.headers.get("x-mayflower-secret") !== process.env.ELEVENLABS_WEBHOOK_SECRET) return new NextResponse("not configured", { status: 501 });
  const { callerNumber, text } = (await req.json()) as { callerNumber: string; text: string };
  const c = getContainer();
  const user = await c.repo.getUserByHandle(normalizeHandle(callerNumber));
  if (!user) return NextResponse.json({ reply: "I don't recognise this number yet. Text me on iMessage first." });
  const r = await handleUserMessage(c, user, text, "voice");
  return NextResponse.json({ reply: r.reply });
}
