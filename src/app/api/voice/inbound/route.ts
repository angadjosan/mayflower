import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/db";
import { callContext, callVars, trackCall } from "@/lib/calls";
import { checkVoiceSecret, findUserByCaller, normalizePhone, VOICE_FIRST_MESSAGE } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ElevenLabs asks this before connecting an inbound Twilio call (conversation initiation webhook). Inbound calls can't
 * carry our dynamic variables otherwise, and the agent drops any call missing one, so fill them here and open with the pitch.
 * Body: { caller_id, agent_id, called_number, call_sid, conversation_id }. Auth: x-mayflower-voice-secret.
 */
export async function POST(req: Request) {
  const auth = checkVoiceSecret(req);
  if (auth !== "ok") return NextResponse.json({ error: auth }, { status: auth === "unconfigured" ? 503 : 401 });

  const body = (await req.json().catch(() => ({}))) as { caller_id?: string; conversation_id?: string };
  const phone = normalizePhone(body.caller_id);
  // Same account the caller's texts use; a stranger gets one keyed to their number, like the tools do.
  const user = (await findUserByCaller(phone)) ?? (phone ? await getOrCreateUser({ handle: phone, attachDemo: false }) : undefined);
  if (!user) {
    // No caller id: the tools refuse politely, but every variable still has to be present or the call drops.
    return NextResponse.json({
      type: "conversation_initiation_client_data",
      dynamic_variables: { call_token: "", proposal_id: "", call_reason: "", call_opener: "", result_summary: "" },
    });
  }
  await trackCall(user.id, body.conversation_id);
  const { greeting } = await callContext(user.id);
  return NextResponse.json({
    type: "conversation_initiation_client_data",
    dynamic_variables: callVars(user.id),
    conversation_config_override: { agent: { first_message: greeting ? `hey, it's mayflower. ${greeting}` : VOICE_FIRST_MESSAGE } },
  });
}
