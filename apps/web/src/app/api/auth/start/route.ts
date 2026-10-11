import { NextResponse } from "next/server";
import { startLogin } from "@/server/auth";
import { jsonError } from "@/server/session";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { handle?: string };
  if (!body.handle) return jsonError("Enter your iMessage phone number or email.");
  const res = await startLogin(body.handle);
  if (!res.ok) return jsonError(res.error, 400);
  return NextResponse.json({ delivered: res.delivered, devCode: res.devCode ?? null });
}
