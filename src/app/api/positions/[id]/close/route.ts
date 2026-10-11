// Request an exit for one of the signed-in user's positions. Creates (or reuses) a pending close/reduce proposal;
// nothing is sold until the owner confirms it (approval link, or /close/confirm from the dashboard).
import { NextResponse } from "next/server";
import { proposeClose } from "@/lib/execution";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const { id } = await params;
  const { fraction } = (await req.json().catch(() => ({}))) as { fraction?: number };
  const res = await proposeClose(userId, id, fraction == null ? 1 : Number(fraction));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  const { approvalToken, ...proposal } = res.proposal;
  return NextResponse.json({ proposal, approvalUrl: res.approvalUrl, token: approvalToken, reused: res.reused });
}
