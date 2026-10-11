import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions, verifyLogin } from "@/server/auth";
import { jsonError } from "@/server/session";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { handle?: string; code?: string };
  if (!body.handle || !body.code) return jsonError("Missing code.");
  const res = await verifyLogin(body.handle, body.code);
  if (!res.ok) return jsonError(res.error, 400);
  const response = NextResponse.json({ ok: true, next: res.user.onboardingState === "complete" ? "/dashboard" : "/chat" });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(res.user.id), sessionCookieOptions());
  return response;
}
