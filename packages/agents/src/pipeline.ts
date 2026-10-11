/**
 * The typed agent workflow (spec §8):
 *   discovery → validation → research → forecast → critic → deterministic risk → proposal
 * Approval and execution are deliberately NOT here; they live in the
 * execution service behind the approval gate.
 */
import type { Market, MarketQuote, Position, ResearchReport, RiskLimits, RiskSnapshot, Side, UserThesis } from "@mayflower/shared";
import { impliedProbability, newId } from "@mayflower/shared";
import { sizePosition, themeExposure, positionAtRisk } from "@mayflower/risk";
import type { ExchangeClient } from "@mayflower/gemini-markets";
import type { ResearchProvider } from "@mayflower/context";
import type { LLM } from "./llm/llm.js";
import { discoverMarkets, type DiscoveredMarket } from "./agents/discovery.js";
import { gatherEvidence } from "./agents/research.js";
import { forecast } from "./agents/forecast.js";
import { critique } from "./agents/critic.js";

export interface PipelineDeps {
  llm: LLM;
  exchange: ExchangeClient;
  research: ResearchProvider;
  log?: (stage: string, detail: unknown) => void;
}

export interface PipelineUser {
  id: string;
  theses: UserThesis[];
  limits: RiskLimits;
  positions: Position[];
  availableBalance: number | null;
}

export type PipelineStage = "discovery" | "validation" | "research" | "forecast" | "critic" | "risk" | "proposal" | "no_trade";

export interface Opportunity {
  market: Market;
  quote: MarketQuote;
  report: ResearchReport;
  discovery: DiscoveredMarket;
  /** Null when the pipeline decided not to trade. */
  recommendation: { side: Side; risk: RiskSnapshot; summary: string } | null;
  noTradeReason: string | null;
  stagesCompleted: PipelineStage[];
}

/** Validate a market is actually tradable right now (spec §6). */
export function validateMarket(m: Market, q: MarketQuote): string | null {
  if (m.status !== "open") return `Market status is ${m.status}.`;
  if (q.yesAsk == null && q.yesBid == null) return "No executable quote.";
  if (m.expiresAt && new Date(m.expiresAt).getTime() < Date.now()) return "Market has expired.";
  if (q.liquidity != null && q.liquidity <= 0) return "No liquidity.";
  return null;
}

export async function evaluateMarket(deps: PipelineDeps, user: PipelineUser, discovery: DiscoveredMarket): Promise<Opportunity> {
  const log = deps.log ?? (() => {});
  const stages: PipelineStage[] = ["discovery"];
  const market = discovery.market;
  const quote = await deps.exchange.getQuote(market.id);
  const invalid = validateMarket(market, quote);
  stages.push("validation");
  const now = new Date().toISOString();
  const baseReport = (over: Partial<ResearchReport>): ResearchReport => ({
    id: newId(), marketId: market.id, userId: user.id, createdAt: now, whatMustHappen: "", whyNow: discovery.reason, thesis: "", evidenceFor: [], evidenceAgainst: [], risks: [], citations: [],
    estimatedProbability: impliedProbability(quote) ?? 0.5, uncertainty: 0.5, marketProbability: impliedProbability(quote), critique: [], watchConditions: [], ...over,
  });
  if (invalid) {
    return { market, quote, discovery, report: baseReport({ thesis: invalid, risks: [invalid] }), recommendation: null, noTradeReason: invalid, stagesCompleted: [...stages, "no_trade"] };
  }

  const evidence = await gatherEvidence(deps.research, market);
  stages.push("research");
  log("research", { marketId: market.id, citations: evidence.citations.length });

  const fc = await forecast(deps.llm, market, quote, evidence);
  stages.push("forecast");
  const cr = await critique(deps.llm, market, fc, evidence.digest);
  stages.push("critic");

  const p = cr.adjustedProbability ?? fc.estimatedProbability;
  const u = cr.adjustedUncertainty ?? fc.uncertainty;
  const citations = evidence.citations.map((c, i) => ({ ...c, stance: fc.citationStances.find((s) => s.index === i)?.stance ?? c.stance }));
  const report = baseReport({
    whatMustHappen: fc.whatMustHappen, whyNow: fc.whyNow, thesis: fc.thesis, evidenceFor: fc.evidenceFor, evidenceAgainst: fc.evidenceAgainst,
    risks: fc.risks, citations, estimatedProbability: p, uncertainty: u, critique: [...cr.blockers.map((b) => `BLOCKER: ${b}`), ...cr.concerns], watchConditions: fc.watchConditions,
  });

  if (!fc.recommendTrade || cr.blockers.length || cr.resolutionMismatch) {
    const reason = cr.resolutionMismatch ? "Thesis does not match the contract's resolution rules." : cr.blockers[0] ?? fc.noTradeReason ?? "Evidence and price are not compelling enough.";
    return { market, quote, discovery, report, recommendation: null, noTradeReason: reason, stagesCompleted: [...stages, "no_trade"] };
  }

  // Which side has edge? Compare estimate against each executable price.
  const marketP = impliedProbability(quote) ?? 0.5;
  const side: Side = p > marketP ? "YES" : "NO";
  const currentExposure = user.positions.filter((x) => x.status === "open").reduce((s, x) => s + positionAtRisk(x), 0);
  const sizing = sizePosition({
    side, estimatedYesProbability: p, uncertainty: u, yesAsk: quote.yesAsk, yesBid: quote.yesBid, limits: user.limits,
    currentExposure, themeExposure: themeExposure(user.positions, market.tags), availableBalance: user.availableBalance,
  });
  stages.push("risk");
  if (!sizing.tradeable) {
    return { market, quote, discovery, report, recommendation: null, noTradeReason: sizing.reason, stagesCompleted: [...stages, "no_trade"] };
  }
  const summary = `${market.title} — market implies ${(marketP * 100).toFixed(0)}%, I estimate ${(p * 100).toFixed(0)}% (±${(u * 100).toFixed(0)}). Suggest ${side} with $${sizing.snapshot.stake} of your $${user.limits.totalBudget} budget. Max loss $${sizing.snapshot.maxLoss}.`;
  stages.push("proposal");
  return { market, quote, discovery, report, recommendation: { side, risk: sizing.snapshot, summary }, noTradeReason: null, stagesCompleted: stages };
}

/** Full run: discover then evaluate each candidate. */
export async function runDiscoveryPipeline(deps: PipelineDeps, user: PipelineUser, opts: { max?: number } = {}): Promise<Opportunity[]> {
  if (user.limits.paused) return [];
  const openIds = new Set(user.positions.filter((p) => p.status === "open").map((p) => p.marketId));
  const found = await discoverMarkets({ exchange: deps.exchange, llm: deps.llm }, { theses: user.theses, limits: user.limits, max: opts.max, openMarketIds: openIds });
  const out: Opportunity[] = [];
  for (const d of found) {
    try { out.push(await evaluateMarket(deps, user, d)); } catch (e) { (deps.log ?? console.warn)("evaluate_failed", { marketId: d.market.id, error: (e as Error).message }); }
  }
  return out;
}
