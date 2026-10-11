import { NextResponse } from "next/server";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";
import { disconnect, getSource, isContextProvider } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Disconnect a personal-context source: revoke, delete token, remove derived theses and excerpts. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const src = await getSource(id);
  if (!src || src.userId !== userId || !isContextProvider(src.provider)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await disconnect(id);
  return NextResponse.json({ ok: true });
}
