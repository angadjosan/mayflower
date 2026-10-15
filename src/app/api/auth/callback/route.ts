import { NextResponse } from "next/server";
import { consumeLoginToken, safeNext } from "@/lib/auth";
import { audit } from "@/lib/db";
import { setSessionCookie } from "../cookie";
import { appUrl } from "@/lib/appUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const res = await consumeLoginToken(url.searchParams.get("t") || "");
  if (!res) return NextResponse.redirect(appUrl("/login?error=expired", req));
  await audit({ userId: res.userId, actor: "user", action: "auth.login" });
  return setSessionCookie(NextResponse.redirect(appUrl(safeNext(res.next) || "/", req)), res.userId);
}
