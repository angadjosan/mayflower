import { NextResponse } from "next/server";
import { load } from "@/lib/db";
import { userIdFromCallToken } from "@/lib/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A texted call link: check who it's for, then open the ElevenLabs talk page with that context. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const userId = userIdFromCallToken(token);
  if (!agentId || !userId) return new NextResponse("this call link expired. text mayflower \"call me\" for a new one.", { status: 410 });

  if (!(await load()).users.some((u) => u.id === userId)) {
    return new NextResponse("this call link expired. text mayflower \"call me\" for a new one.", { status: 410 });
  }
  // Only the signed token and an idea id go to the talk page; what the agent says comes from our briefing tool.
  const url = new URL("https://elevenlabs.io/app/talk-to");
  url.searchParams.set("agent_id", agentId);
  url.searchParams.set("var_call_token", token);
  url.searchParams.set("var_proposal_id", new URL(req.url).searchParams.get("p") || "none");
  // The agent drops a session missing any tool variable, so fill the settlement ones too ("none" = not a settlement call).
  for (const v of ["call_reason", "call_opener", "result_summary"]) url.searchParams.set(`var_${v}`, "none");
  return NextResponse.redirect(url.toString(), 302);
}
