import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { audit } from "@/lib/db";
import { authorizeUrl, geminiOAuthConfigured, makeState, STATE_COOKIE } from "@/lib/gemini-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts Gemini OAuth (trade-only scopes). Without client credentials, falls back to the Plan B link flow.
export async function GET(req: Request) {
  if (!geminiOAuthConfigured) {
    return NextResponse.redirect(new URL("/?connect_error=Gemini+OAuth+is+not+configured%3B+using+the+shared+sandbox+account", req.url));
  }
  const userId = await currentUserId();
  const { state, nonce } = makeState(userId);
  audit({ userId, actor: "user", action: "gemini_oauth.start" });
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/gemini-oauth", maxAge: 15 * 60,
  });
  return res;
}
