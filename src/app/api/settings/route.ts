import { NextResponse } from "next/server";
import { tx, audit, load, getOrCreateUser } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { normalizeHandle } from "@/lib/auth";
import type { RiskLimits } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    limits?: Partial<RiskLimits>; paused?: boolean; name?: string; handle?: string;
  };
  // Identity comes from the session only; body.userId is ignored.
  const userId = await currentUserId();
  if (typeof body.handle === "string" && body.handle.trim()) {
    const want = normalizeHandle(body.handle);
    const taken = load().users.some((u) => u.id !== userId && u.handle && normalizeHandle(u.handle) === want);
    if (taken) return NextResponse.json({ error: "That handle is already linked to another account." }, { status: 409 });
  }
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
