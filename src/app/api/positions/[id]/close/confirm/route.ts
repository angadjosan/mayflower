// The signed-in owner's explicit in-dashboard confirmation of an exact close/reduce proposal ("Confirm sell N @ $X").
// Executes through approveAndExecute, the only order path, with that proposal's own approval token.
import { NextResponse } from "next/server";
import { load } from "@/lib/db";
import { approveAndExecute } from "@/lib/execution";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const { id } = await params;
  const { proposalId } = (await req.json().catch(() => ({}))) as { proposalId?: string };
  if (!proposalId) return NextResponse.json({ error: "proposalId required" }, { status: 400 });
  const db = await load();
  const p = db.proposals.find((x) => x.id === proposalId && x.userId === userId);
  const pos = db.positions.find((x) => x.id === id && x.userId === userId);
  if (!p || !pos) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if ((p.kind !== "close" && p.kind !== "reduce") || p.marketId !== pos.marketId || p.side !== pos.side)
    return NextResponse.json({ error: "That proposal isn't an exit for this position." }, { status: 400 });
  const res = await approveAndExecute(p.id, p.approvalToken);
  return NextResponse.json(res, { status: res.ok || res.order ? 200 : 400 });
}
