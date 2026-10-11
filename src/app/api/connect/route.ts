import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { available, listForUser } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current user's personal-context sources (never tokens), with what Mayflower learned from each. */
export async function GET() {
  const userId = await currentUserId();
  return NextResponse.json({ sources: listForUser(userId), available: available() });
}
