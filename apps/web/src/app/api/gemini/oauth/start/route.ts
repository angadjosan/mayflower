import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/session";
import { beginGeminiOAuth } from "@/server/gemini-link";
import { oauthConfigured } from "@/server/config";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  if (!oauthConfigured()) return NextResponse.redirect(new URL("/link?error=" + encodeURIComponent("Gemini OAuth isn't configured on this server."), req.url));
  try {
    return NextResponse.redirect(await beginGeminiOAuth(user.id));
  } catch (err) {
    return NextResponse.redirect(new URL("/link?error=" + encodeURIComponent((err as Error).message), req.url));
  }
}
