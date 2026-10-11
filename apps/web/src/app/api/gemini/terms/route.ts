import { NextResponse } from "next/server";
import { apiUser, isResponse, jsonError } from "@/server/session";
import { activeConnection, markTermsAccepted, venueForConnection } from "@/server/gemini-link";
import { executeAwaitingLink } from "@/server/execution";
import { sendToUser } from "@/server/notify";
import { audit } from "@/server/audit";

/** The user explicitly accepts Gemini's prediction-market terms on their own account. */
export async function POST() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const conn = await activeConnection(user.id);
  if (!conn || conn.mode !== "oauth") return jsonError("Link your Gemini account first.");
  try {
    await venueForConnection(user.id, conn).acceptTerms();
  } catch (err) {
    return jsonError((err as Error).message, 502);
  }
  await markTermsAccepted(conn.id);
  await audit({ userId: user.id, actor: "user", action: "gemini.terms_accepted" });
  const results = await executeAwaitingLink(user.id);
  for (const r of results) await sendToUser(user, r.message);
  return NextResponse.json({ ok: true, submitted: results.map((r) => r.message) });
}
