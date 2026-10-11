import { NextResponse } from "next/server";
import { tx, audit, getOrCreateUser } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { geminiOAuthConfigured } from "@/lib/gemini-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Plan A: per-user Gemini OAuth (trade-only scopes) when GEMINI_OAUTH_CLIENT_ID/SECRET are set — the client follows `redirect`.
// Plan B (default): all users trade through one shared Gemini sandbox account.
export async function POST() {
  if (geminiOAuthConfigured) return NextResponse.json({ redirect: "/api/gemini-oauth/start" });
  const userId = await currentUserId();
  getOrCreateUser({ id: userId });
  const user = tx((db) => {
    const u = db.users.find((x) => x.id === userId)!;
    u.geminiLinked = true;
    return u;
  });
  audit({ userId, actor: "user", action: "gemini_linked", detail: { account: "Sandbox – shared account" } });
  return NextResponse.json({ user, account: "Sandbox – shared account" });
}
