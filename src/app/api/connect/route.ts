import { NextResponse } from "next/server";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";
import { available, listForUser } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current user's personal-context sources (never tokens), with what Mayflower learned from each. */
export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  return NextResponse.json({ sources: await listForUser(userId), available: available() });
}
