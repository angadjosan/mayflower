import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/server/auth";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
