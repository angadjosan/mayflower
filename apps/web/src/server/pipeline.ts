import { and, eq, inArray } from "drizzle-orm";
import {
  critiqueForecast,
  forecastMarket,
  personalizedSearchTerms,
  rankGeneral,
  rankPersonalized,
  validateContract,
  type Candidate,
} from "@mayflower/agents";
import { researchPlan } from "@mayflower/context";
import { riskCapacity, sizePosition } from "@mayflower/risk";
import { formatPct, formatUsd, impliedProbability, type DiscoveryKind, type MarketContract, type SizingResult } from "@mayflower/shared";
import { config } from "./config";
import { getDb, schema } from "./db/client";
import type { Proposal, ProposalRationale, User } from "./db/schema";
import { audit, logError } from "./audit";
import { llm, marketData, research } from "./integrations";
import { groupOf, upsertMarket } from "./markets";
import { balanceInfo } from "./gemini-link";
import { currentExposures } from "./portfolio";
import { createProposal } from "./proposals";
import { activeTheses, effectiveLimits, getUser } from "./users";

export interface AnalyzedMarket {
  proposal: Proposal;
  market: MarketContract;
  sizing: SizingResult;
}

function sizingSummary(s: SizingResult): string {
  if (s.decision === "no_trade") return `No trade: ${s.noTradeReasons[0] ?? "no edge"}`;
  const cap = s.capsApplied[s.capsApplied.length - 1];
  return `${formatUsd(s.cost)} at risk: ${formatPct(s.fractionalKelly, 1)} of your ${formatUsd(s.bankroll)} risk capacity by fractional Kelly${cap ? `, capped by ${cap.detail}` : ""}.`;
}

/** Research, forecast, critique and size one contract, then store a proposal (trade or explicit no-trade). */
export async function analyzeMarket(
  user: User,
  market: MarketContract,
  ctx: { discovery: DiscoveryKind; reason: string; focus?: string | null },
): Promise<AnalyzedMarket> {
  const model = llm();
  await upsertMarket(market);
  const validation = validateContract(market);
  const theses = await activeTheses(user.id);
  const plan = researchPlan(market, ctx.focus ?? undefined);
  const res = await research().search(plan, { market });
  const forecast = await forecastMarket(market, res.citations, { userBeliefs: theses.map((t) => `${t.topic}: ${t.belief}`) }, model, logError("forecast"));
  const critic = await critiqueForecast(market, forecast, res.citations, model, logError("critic"));
  const db = await getDb();
  const marketP = impliedProbability(market.quote);
  const [report] = await db
    .insert(schema.researchReports)
    .values({ userId: user.id, symbol: market.symbol, provider: res.provider, queries: res.queries, citations: res.citations, forecast, critic, marketProbability: marketP, errors: res.errors })
    .returning();

  const limits = effectiveLimits(user);
  const exposures = await currentExposures(user.id);
  const balance = await balanceInfo(user.id);
  let sizing = sizePosition({
    probability: critic.adjustedProbability,
    uncertainty: critic.adjustedUncertainty,
    quote: market.quote,
    increments: market.increments,
    limits,
    availableBalance: balance.available ?? riskCapacity(limits),
    exposures,
    symbol: market.symbol,
    eventTicker: market.eventTicker,
    correlationGroup: groupOf(market),
    feePerContract: config().feePerContract,
  });
  const forcedNoTrade: string[] = [];
  if (critic.verdict === "reject") forcedNoTrade.push(`The critic rejected this idea: ${critic.issues[0] ?? critic.notes}`);
  if (!validation.ok) forcedNoTrade.push(`Contract check failed: ${validation.issues.join("; ")}`);
  if (forcedNoTrade.length && sizing.decision === "trade") {
    sizing = { ...sizing, decision: "no_trade", quantity: 0, cost: 0, maxLoss: 0, maxPayout: 0, expectedValue: 0, noTradeReasons: [...forcedNoTrade, ...sizing.noTradeReasons], steps: [...sizing.steps, "Recommendation: no trade."] };
  } else if (forcedNoTrade.length) {
    sizing = { ...sizing, noTradeReasons: [...forcedNoTrade, ...sizing.noTradeReasons] };
  }

  const correlatedNote =
    sizing.correlated.length > 0
      ? `You already have ${formatUsd(sizing.correlated.reduce((s, e) => s + e.atRisk, 0))} in related outcomes (${sizing.correlated.map((c) => c.label ?? c.symbol).join(", ")}), so this is sized smaller.`
      : null;
  const rationale: ProposalRationale = {
    title: market.eventType === "categorical" && market.label !== market.eventTitle ? `${market.label} — ${market.eventTitle}` : market.eventTitle,
    whatHasToHappen: forecast.whatHasToHappen,
    whyNow: forecast.whyNow,
    thesis: forecast.thesis,
    discoveryReason: ctx.reason,
    sizingSummary: sizingSummary(sizing),
    noTradeReason: sizing.decision === "no_trade" ? sizing.noTradeReasons.join(" ") : null,
    risks: forecast.risks,
    resolutionRisks: [...forecast.resolutionRisks, ...validation.warnings],
    whatWouldChangeMind: forecast.whatWouldChangeMind,
    watchConditions: forecast.watchConditions,
    hedgeNote: correlatedNote,
    criticIssues: critic.issues,
    uncertainty: critic.adjustedUncertainty,
    method: { forecast: forecast.method, critic: critic.method, research: res.provider, marketData: market.source },
  };

  const proposal = await createProposal({
    userId: user.id,
    symbol: market.symbol,
    kind: "open",
    discovery: ctx.discovery,
    decision: sizing.decision,
    side: sizing.side ? "buy" : null,
    outcome: sizing.side,
    quantity: sizing.quantity,
    limitPrice: sizing.limitPrice,
    maxCost: sizing.cost,
    estProbability: critic.adjustedProbability,
    marketProbability: marketP,
    edge: sizing.edge,
    expectedValue: sizing.expectedValue,
    sizing,
    rationale,
    researchReportId: report.id,
    executionMode: balance.mode,
  });
  return { proposal, market, sizing };
}

export interface DiscoveryResult {
  analyzed: AnalyzedMarket[];
  scanned: number;
  errors: string[];
  marketDataLabel: "live" | "demo";
}

/** Personalized + general discovery for one user. */
export async function runDiscovery(
  userId: string,
  opts: { focus?: string | null; excludeTopics?: string[]; maxPersonalized?: number; maxGeneral?: number; trigger: "onboarding" | "user_request" | "scheduled" | "research" } = { trigger: "user_request" },
): Promise<DiscoveryResult> {
  const user = await getUser(userId);
  const theses = await activeTheses(userId);
  const md = marketData();
  const model = llm();
  const errors: string[] = [];
  const profile = {
    interests: user.interests,
    beliefs: theses.map((t) => ({ topic: t.topic, belief: t.belief, stance: t.stance, confidence: t.confidence })),
    excludedTopics: user.excludedTopics,
  };

  const general: MarketContract[] = [];
  const personalizedPool: MarketContract[] = [];
  try {
    general.push(...(await md.listContracts({ limit: 200 })));
  } catch (err) {
    errors.push(`Couldn't load Gemini markets: ${(err as Error).message}`);
  }
  const terms = await personalizedSearchTerms(profile, model, logError("discovery-terms"), opts.focus);
  for (const t of terms.slice(0, 5)) {
    try {
      personalizedPool.push(...(await md.listContracts({ search: t.term, limit: 50 })));
    } catch (err) {
      errors.push(`Search for “${t.term}” failed: ${(err as Error).message}`);
    }
  }

  // Skip contracts the user already holds or has a live proposal for.
  const db = await getDb();
  const held = await db.select({ symbol: schema.positions.symbol }).from(schema.positions).where(and(eq(schema.positions.userId, userId), eq(schema.positions.status, "open")));
  const pending = await db
    .select({ symbol: schema.tradeProposals.symbol })
    .from(schema.tradeProposals)
    .where(and(eq(schema.tradeProposals.userId, userId), inArray(schema.tradeProposals.status, ["pending", "awaiting_link", "approved", "executing"])));
  const skip = new Set([...held, ...pending].map((r) => r.symbol));
  const unique = (list: MarketContract[]) => [...new Map(list.filter((m) => !skip.has(m.symbol)).map((m) => [m.symbol, m])).values()];

  const extraExclusions = opts.excludeTopics ?? [];
  const personalProfile = { ...profile, excludedTopics: [...profile.excludedTopics, ...extraExclusions] };
  const personalized: Candidate[] = rankPersonalized(unique([...personalizedPool, ...general]), personalProfile, terms).slice(0, opts.maxPersonalized ?? 1);
  // General ideas come from different events than the personalized ones.
  const personalEvents = new Set(personalized.map((c) => c.market.eventTicker));
  const generalPicks: Candidate[] = rankGeneral(
    unique(general).filter((m) => !personalEvents.has(m.eventTicker)),
    profile,
    new Set(personalized.map((c) => c.market.symbol)),
    extraExclusions,
  ).slice(0, opts.maxGeneral ?? 1);

  const analyzed: AnalyzedMarket[] = [];
  for (const c of [...personalized, ...generalPicks]) {
    try {
      analyzed.push(await analyzeMarket(user, c.market, { discovery: c.kind, reason: c.reason, focus: opts.focus }));
    } catch (err) {
      errors.push(`Analysis of ${c.market.label} failed: ${(err as Error).message}`);
    }
  }
  await db.update(schema.users).set({ lastDiscoveryAt: new Date() }).where(eq(schema.users.id, userId));
  await audit({
    userId,
    actor: "agent",
    action: "discovery.run",
    details: { trigger: opts.trigger, scanned: unique([...personalizedPool, ...general]).length, analyzed: analyzed.map((a) => ({ symbol: a.market.symbol, decision: a.sizing.decision })), errors },
  });
  return { analyzed, scanned: new Set([...personalizedPool, ...general].map((m) => m.symbol)).size, errors, marketDataLabel: md.label };
}
