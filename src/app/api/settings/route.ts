import { NextResponse } from "next/server";
import { tx, audit, DEMO_USER_ID, getOrCreateUser } from "@/lib/db";
import type { RiskLimits } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    userId?: string; limits?: Partial<RiskLimits>; paused?: boolean; name?: string; handle?: string;
  };
  const userId = body.userId || DEMO_USER_ID;
  getOrCreateUser({ id: userId });
  const user = tx((db) => {
    const u = db.users.find((x) => x.id === userId)!;
    if (body.limits) u.limits = { ...u.limits, ...body.limits };
    if (typeof body.paused === "boolean") u.paused = body.paused;
    if (typeof body.name === "string") u.name = body.name;
    if (typeof body.handle === "string") u.handle = body.handle.trim() || undefined;
    return u;
  });
  audit({ userId, actor: "user", action: "settings_update", detail: { limits: body.limits, paused: body.paused, name: body.name, handle: body.handle } });
  return NextResponse.json({ user });
}
