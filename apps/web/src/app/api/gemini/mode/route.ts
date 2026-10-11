import { NextResponse } from "next/server";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { chooseFallbackMode } from "@/server/gemini-link";
import { executeAwaitingLink } from "@/server/execution";
import { sendToUser } from "@/server/notify";

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  if (body.mode !== "shared_sandbox" && body.mode !== "simulated") return jsonError("Unknown mode.");
  try {
    await chooseFallbackMode(user.id, body.mode);
  } catch (err) {
    return jsonError((err as Error).message);
  }
  const results = await executeAwaitingLink(user.id);
  for (const r of results) await sendToUser(user, r.message);
  return NextResponse.json({ ok: true, submitted: results.map((r) => r.message) });
}
