import { NextResponse } from "next/server";
import { load, DEMO_USER_ID, getOrCreateUser } from "@/lib/db";
import { approvalUrl } from "@/lib/execution";
import { getPortfolioSummary } from "@/lib/risk";
import { llmEnabled } from "@/lib/llm";
import { exchangeMode } from "@/lib/exchange";
import { researchMode } from "@/lib/research";
import { bbEnabled } from "@/lib/bluebubbles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId") || DEMO_USER_ID;
  const user = getOrCreateUser({ id: userId });
  const db = load();
  const mine = <T extends { userId?: string }>(xs: T[]) => xs.filter((x) => x.userId === userId);
  const researchById = new Map(db.research.map((r) => [r.id, r]));
  const proposals = mine(db.proposals)
    .slice()
    .sort((a, b) =>
      (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt),
    )
    .map((p) => ({ ...p, research: researchById.get(p.researchId), approvalUrl: approvalUrl(p) }));
  const proposalById = new Map(db.proposals.map((p) => [p.id, p]));
  const positions = mine(db.positions).map((pos) => {
    const p = proposalById.get(pos.proposalId);
    const r = p ? researchById.get(p.researchId) : undefined;
    return {
      ...pos,
      originalThesis: p?.thesis,
      thesis: p?.thesis,
      estimatedProbability: p?.estimatedProbability,
      sizingExplanation: p?.sizingExplanation,
      citations: r?.citations ?? [],
    };
  });
  let portfolio: unknown = null;
  try { portfolio = await getPortfolioSummary(userId); } catch (e) { console.error(e); }
  return NextResponse.json({
    user,
    theses: mine(db.theses),
    proposals,
    positions,
    orders: mine(db.orders).slice().reverse(),
    messages: mine(db.messages).filter((m) => !m.groupId).slice(-100),
    groups: db.groups.filter((g) => g.memberUserIds.includes(userId)),
    contests: db.contests.filter((c) => db.groups.some((g) => g.id === c.groupId && g.memberUserIds.includes(userId))),
    monitorEvents: mine(db.monitorEvents).slice().reverse(),
    audit: mine(db.audit).slice(-50).reverse(),
    portfolio,
    modes: { llm: llmEnabled, exchange: exchangeMode, research: researchMode, imessage: bbEnabled },
  });
}
