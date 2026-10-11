import { NextResponse } from "next/server";
import { checkVoiceSecret, runVoiceTool, VOICE_TOOLS, type VoiceTool, type VoiceToolBody } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** ElevenLabs server-tool webhook. Auth: x-mayflower-voice-secret. Caller identified by phone number. */
export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const auth = checkVoiceSecret(req);
  if (auth === "unconfigured") return NextResponse.json({ ok: false, error: "voice tools not configured" }, { status: 503 });
  if (auth === "unauthorized") return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { tool } = await params;
  if (!(VOICE_TOOLS as readonly string[]).includes(tool)) {
    return NextResponse.json({ ok: false, error: `unknown tool ${tool}` }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as VoiceToolBody;
  try {
    return NextResponse.json(await runVoiceTool(tool as VoiceTool, body));
  } catch (e) {
    console.error("[voice]", tool, e);
    return NextResponse.json({ ok: false, say: "Sorry, something went wrong on my end. Please try again, or text me." });
  }
}
