import { NextResponse } from "next/server";
import { load, getOrCreateUser } from "@/lib/db";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";
import { approvalUrl } from "@/lib/execution";
import { getPortfolioSummary } from "@/lib/risk";
import { llmEnabled } from "@/lib/llm";
import { exchangeMode, polymarketMode, polymarketEnabled, hyperliquidMode, hyperliquidEnabled, getBalance, venueOf } from "@/lib/exchange";
import { ensureTestWallet, walletOf } from "@/lib/testWallet";
import { researchMode } from "@/lib/research";
import { bbEnabled } from "@/lib/bluebubbles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gemini balance is a signed exchange call; the dashboard polls every few seconds, so cache it briefly per user.
const balanceCache = new Map<string, { at: number; value: { availableUsd: number; mode: string } }>();
async function geminiBalance(userId: string) {
  const hit = balanceCache.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const value = await getBalance("gemini", userId);
  balanceCache.set(userId, { at: Date.now(), value });
  return value;
}

/** Read-only buying power: Gemini sandbox USD and the Hyperliquid test wallet's testUSDC. Never returns keys. */
async function balancesFor(userId: string, db: Awaited<ReturnType<typeof load>>) {
  let gemini: { availableUsd: number; mode: string } | null = null;
  try { gemini = await geminiBalance(userId); } catch (e) { console.error(e); }
  let wallet = walletOf(db, userId);
  if (!wallet) {
    try { wallet = await ensureTestWallet(userId); } catch (e) { console.error(e); }
  }
  return {
    gemini,
    testWallet: wallet ? { address: wallet.address, usdc: wallet.usdc, createdAt: wallet.createdAt } : null,
  };
}

export async function GET() {
  // Identity comes only from the signed session cookie (demo user when signed out); no ?userId= override.
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  const user = await getOrCreateUser({ id: userId });
  const db = await load();
  const mine = <T extends { userId?: string }>(xs: T[]) => xs.filter((x) => x.userId === userId);
  const researchById = new Map(db.research.map((r) => [r.id, r]));
  const proposals = mine(db.proposals)
    .slice()
    .sort((a, b) =>
      (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.createdAt.localeCompare(a.createdAt),
    )
    .map((p) => ({ ...p, venue: venueOf(p.market), research: researchById.get(p.researchId), approvalUrl: approvalUrl(p) }));
  const proposalById = new Map(db.proposals.map((p) => [p.id, p]));
  const positions = mine(db.positions).map((pos) => {
    const p = proposalById.get(pos.proposalId);
    const r = p ? researchById.get(p.researchId) : undefined;
    return {
      ...pos,
      venue: venueOf(pos.market),
      evidenceFor: r?.evidenceFor ?? [],
      evidenceAgainst: r?.evidenceAgainst ?? [],
      researchSummary: r?.summary,
      originalThesis: p?.thesis,
      thesis: p?.thesis,
      estimatedProbability: p?.estimatedProbability,
      sizingExplanation: p?.sizingExplanation,
      citations: r?.citations ?? [],
    };
  });
  let portfolio: unknown = null;
  try { portfolio = await getPortfolioSummary(userId); } catch (e) { console.error(e); }
  const balances = await balancesFor(userId, db);
  return NextResponse.json({
    user,
    theses: mine(db.theses),
    proposals,
    positions,
    orders: mine(db.orders).slice().reverse().map((o) => ({ ...o, venue: o.venue ?? "gemini", marketTitle: proposalById.get(o.proposalId)?.market.title })),
    messages: mine(db.messages).filter((m) => !m.groupId).slice(-100),
    groups: db.groups.filter((g) => g.memberUserIds.includes(userId)),
    contests: db.contests.filter((c) => db.groups.some((g) => g.id === c.groupId && g.memberUserIds.includes(userId))),
    monitorEvents: mine(db.monitorEvents).slice().reverse(),
    audit: mine(db.audit).slice(-50).reverse(),
    portfolio,
    balances,
    modes: { llm: llmEnabled, exchange: exchangeMode, polymarket: polymarketEnabled ? polymarketMode : "off", hyperliquid: hyperliquidEnabled ? hyperliquidMode : "off", research: researchMode, imessage: bbEnabled },
  });
}
