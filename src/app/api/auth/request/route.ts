import { NextResponse } from "next/server";
import { requestLogin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { handle, next } = (await req.json().catch(() => ({}))) as { handle?: string; next?: string };
  if (!handle?.trim()) return NextResponse.json({ error: "handle required" }, { status: 400 });
  return NextResponse.json(await requestLogin(handle, next));
}
