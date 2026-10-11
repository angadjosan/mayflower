import { NextResponse } from "next/server";
import { consumeLoginToken, safeNext } from "@/lib/auth";
import { audit } from "@/lib/db";
import { setSessionCookie } from "../cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const res = consumeLoginToken(url.searchParams.get("t") || "");
  if (!res) return NextResponse.redirect(new URL("/login?error=expired", url));
  audit({ userId: res.userId, actor: "user", action: "auth.login" });
  return setSessionCookie(NextResponse.redirect(new URL(safeNext(res.next) || "/", url)), res.userId);
}
