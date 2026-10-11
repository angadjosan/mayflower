import { NextResponse } from "next/server";
import { load } from "@/lib/db";
import { safeNext } from "@/lib/auth";
import { isLocalRequest } from "@/lib/session";
import { setSessionCookie } from "../cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dev only, and only from this machine (not through a tunnel): sign in as any existing user without a magic link. */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production" || !isLocalRequest(req.headers)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || "";
  if (!(await load()).users.some((u) => u.id === userId)) return NextResponse.json({ error: "unknown userId" }, { status: 404 });
  return setSessionCookie(NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")) || "/", url)), userId);
}
