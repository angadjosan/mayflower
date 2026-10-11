import { NextResponse } from "next/server";
import { load } from "@/lib/db";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";
import { activeMemories } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What Mayflower remembers about the signed-in user (active memories, newest first). */
export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const memories = activeMemories(await load(), userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NextResponse.json({ memories });
}
