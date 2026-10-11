import { NextResponse } from "next/server";
import { voiceAgentConfig } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tool definitions + system prompt to paste into the ElevenLabs agent. Contains no secrets. */
export async function GET() {
  return NextResponse.json(voiceAgentConfig());
}
