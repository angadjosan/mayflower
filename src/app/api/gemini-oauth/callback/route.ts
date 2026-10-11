import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sessionUserId } from "@/lib/session";
import { audit } from "@/lib/db";
import { exchangeCode, geminiOAuthConfigured, saveGeminiToken, STATE_COOKIE, verifyState } from "@/lib/gemini-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = (q: string) => {
    const res = NextResponse.redirect(new URL(`/?${q}`, req.url));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/gemini-oauth", maxAge: 0 });
    return res;
  };
  if (!geminiOAuthConfigured) return home("connect_error=Gemini+OAuth+is+not+configured");

  const err = url.searchParams.get("error");
  if (err) return home(`connect_error=${encodeURIComponent(`gemini: ${err}`)}`);

  const nonce = (await cookies()).get(STATE_COOKIE)?.value;
  const state = verifyState(url.searchParams.get("state"), nonce);
  const userId = await sessionUserId();
  if (!userId) return NextResponse.redirect(new URL("/login", process.env.APP_URL || "http://localhost:3000"));
  if (!state || state.userId !== userId) return home("connect_error=gemini+link+expired+or+invalid");

  const code = url.searchParams.get("code");
  if (!code) return home("connect_error=gemini+missing+code");

  try {
    const tok = await exchangeCode(code);
    await saveGeminiToken(userId, tok);
  } catch (e) {
    await audit({ userId, actor: "system", action: "gemini_oauth.error", detail: { error: e instanceof Error ? e.message.slice(0, 300) : "unknown" } });
    return home("connect_error=gemini+connection+failed");
  }
  return home("connected=gemini");
}
