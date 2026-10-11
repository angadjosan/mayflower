import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/server/session";
import { setTradingPaused } from "@/server/users";

export async function POST(req: Request) {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { paused?: boolean };
  await setTradingPaused(user.id, Boolean(body.paused));
  return NextResponse.json({ ok: true, paused: Boolean(body.paused) });
}
