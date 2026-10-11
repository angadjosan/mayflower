import { NextResponse } from "next/server";
import { consumeSignedLink, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth";
import { audit } from "@/server/audit";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  // Only allow same-site relative redirects.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  const claims = await consumeSignedLink(token, "login");
  if (!claims) return NextResponse.redirect(new URL("/login?expired=1", url));
  await audit({ userId: claims.sub, actor: "user", action: "auth.login", details: { method: "imessage_link" } });
  const res = NextResponse.redirect(new URL(next, url));
  res.cookies.set(SESSION_COOKIE, await createSessionToken(claims.sub), sessionCookieOptions());
  return res;
}
