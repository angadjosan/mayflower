import { NextResponse } from "next/server";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";
import { forget } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forget one memory (and the older versions it replaced). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const removed = await forget(userId, [(await params).id]);
  return NextResponse.json({ ok: removed.length > 0, removed: removed.length }, { status: removed.length ? 200 : 404 });
}
