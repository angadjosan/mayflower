import { NextResponse } from "next/server";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";
import { load } from "@/lib/db";
import { isContextProvider, syncSource } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-sync the current user's source for this provider. */
export async function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isContextProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const src = (await load()).connectedSources.find((s) => s.userId === userId && s.provider === provider && s.status !== "revoked");
  if (!src) return NextResponse.json({ error: "Not connected" }, { status: 404 });
  const result = await syncSource(src.id);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
