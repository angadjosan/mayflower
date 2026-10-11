import { NextResponse } from "next/server";
import { load } from "@/lib/db";
import { currentUserId } from "@/lib/session";
import { concentrationReport } from "@/lib/risk";
import { calibrationSummary } from "@/lib/calibration";
import { findHedges, noHedgeExplanation, proposeHedge } from "@/lib/hedge";
import { approvalUrl } from "@/lib/execution";
import { sendToUser } from "@/lib/notify";
import type { Side } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  const open = load().positions.filter((p) => p.userId === userId && p.status === "open");
  const hedges = await Promise.all(
    open.map(async (p) => {
      let ideas: Awaited<ReturnType<typeof findHedges>> = [];
      try { ideas = await findHedges(p.id); } catch { /* market data unavailable */ }
      return {
        positionId: p.id, marketTitle: p.market.title, eventTitle: p.market.eventTitle, side: p.side,
        quantity: p.quantity, costBasisUsd: p.costBasisUsd, stopPrice: p.stopPrice, takeProfitPrice: p.takeProfitPrice,
        watchConditions: p.watchConditions,
        ideas: ideas.map(({ market, ...i }) => ({ ...i, marketTitle: market.title, eventTitle: market.eventTitle })),
        note: ideas.length ? undefined : noHedgeExplanation(p),
      };
    }),
  );
  return NextResponse.json({ concentration: concentrationReport(userId), calibration: calibrationSummary(userId), hedges });
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  const body = (await req.json().catch(() => ({}))) as { action?: string; positionId?: string; marketId?: string; side?: Side };
  if (body.action !== "hedge" || !body.positionId) return NextResponse.json({ error: "Expected {action:'hedge', positionId}" }, { status: 400 });
  const pos = load().positions.find((p) => p.id === body.positionId);
  if (!pos || pos.userId !== userId) return NextResponse.json({ error: "Position not found." }, { status: 404 });
  const side = body.side === "YES" || body.side === "NO" ? body.side : undefined;
  const r = await proposeHedge(pos.id, { marketId: body.marketId, side });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 422 });
  try { await sendToUser(userId, r.message); } catch { /* delivery best-effort */ }
  return NextResponse.json({ proposal: r.proposal, idea: r.idea, approvalUrl: approvalUrl(r.proposal) });
}
