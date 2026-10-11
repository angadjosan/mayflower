/**
 * Mayflower domain model — the single source of truth for types shared by the
 * web app, agents, risk engine, integrations and database layer.
 *
 * Mirrors §9 "Data model" of the product spec. Every schema is a zod schema so
 * LLM output, webhook payloads and DB rows are validated at the boundary.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const Side = z.enum(["YES", "NO"]);
export type Side = z.infer<typeof Side>;

export const OrderAction = z.enum(["BUY", "SELL"]);
export type OrderAction = z.infer<typeof OrderAction>;

/** Probability in [0,1]. */
export const Probability = z.number().min(0).max(1);

/** Price of a binary contract in [0,1] (pays 1 if correct). */
export const ContractPrice = z.number().min(0).max(1);

export const Money = z.number().finite();

export const ExecutionMode = z.enum(["live", "sandbox", "simulated"]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const Channel = z.enum(["imessage", "web", "voice"]);
export type Channel = z.infer<typeof Channel>;

// ---------------------------------------------------------------------------
// User, risk limits, theses
// ---------------------------------------------------------------------------

export const RiskLimits = z.object({
  /** Total dollars the user is willing to lose across all positions. "Budget". */
  totalBudget: Money.nonnegative(),
  /** Max dollars at risk in a single position. */
  maxPerPosition: Money.nonnegative(),
  /** Max share of budget in positions that depend on one correlated theme (0..1). */
  maxThemeConcentration: z.number().min(0).max(1).default(0.4),
  /** Fraction of full Kelly to use (0..1). Conservative default. */
  kellyFraction: z.number().min(0).max(1).default(0.25),
  /** Minimum edge (estimated p - price) before a trade is even considered. */
  minEdge: z.number().min(0).max(1).default(0.05),
  /** Topics the user never wants to see. Matched case-insensitively against market tags. */
  excludedTopics: z.array(z.string()).default([]),
  /** Global pause / kill switch. When true nothing is proposed or executed. */
  paused: z.boolean().default(false),
});
export type RiskLimits = z.infer<typeof RiskLimits>;

export const DEFAULT_RISK_LIMITS: RiskLimits = RiskLimits.parse({
  totalBudget: 0,
  maxPerPosition: 0,
});

export const User = z.object({
  id: z.string(),
  email: z.string().email().nullable().optional(),
  /** Phone number or Apple ID that BlueBubbles reports for this user. */
  imessageHandle: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  riskLimits: RiskLimits,
  createdAt: z.string(),
});
export type User = z.infer<typeof User>;

export const ThesisSource = z.enum(["conversation", "connector", "agent"]);

export const UserThesis = z.object({
  id: z.string(),
  userId: z.string(),
  /** Short tag, e.g. "nfl", "ai-infrastructure", "macro". */
  topic: z.string(),
  /** Natural-language belief. */
  belief: z.string(),
  /** User's own confidence 0..1. */
  confidence: Probability,
  /** True when this is an interest (follow) rather than a directional belief. */
  isInterest: z.boolean().default(false),
  source: ThesisSource.default("conversation"),
  active: z.boolean().default(true),
  updatedAt: z.string(),
});
export type UserThesis = z.infer<typeof UserThesis>;

export const ConnectedSource = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.enum(["gmail", "notion", "slack", "discord"]),
  scopes: z.array(z.string()),
  status: z.enum(["pending", "active", "revoked"]),
  connectedAt: z.string().nullable().optional(),
  revokedAt: z.string().nullable().optional(),
});
export type ConnectedSource = z.infer<typeof ConnectedSource>;

export const ExchangeConnection = z.object({
  id: z.string(),
  userId: z.string(),
  provider: z.literal("gemini"),
  /** "oauth" is Plan A; "shared-sandbox" is Plan B from §7. */
  kind: z.enum(["oauth", "api-key", "shared-sandbox"]),
  /** Roles granted. Mayflower must never hold "fund-manager". */
  roles: z.array(z.enum(["trader", "auditor"])),
  status: z.enum(["active", "revoked", "error"]),
  linkedAt: z.string(),
  revokedAt: z.string().nullable().optional(),
});
export type ExchangeConnection = z.infer<typeof ExchangeConnection>;

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

export const MarketStatus = z.enum(["open", "closed", "settled", "suspended", "unknown"]);

export const Market = z.object({
  /** Exchange market / contract identifier (symbol). */
  id: z.string(),
  exchange: z.literal("gemini").default("gemini"),
  /** Human title: "Will the Seahawks win the NFC West?" */
  title: z.string(),
  /** Parent event grouping, if the venue exposes one. */
  eventId: z.string().nullable().optional(),
  /** Exact resolution criteria as published by the venue. */
  resolutionRules: z.string().nullable().optional(),
  /** Topic tags, lowercase: "nfl", "politics", "crypto", "weather". */
  tags: z.array(z.string()).default([]),
  expiresAt: z.string().nullable().optional(),
  status: MarketStatus.default("unknown"),
  url: z.string().nullable().optional(),
  raw: z.unknown().optional(),
});
export type Market = z.infer<typeof Market>;

export const MarketQuote = z.object({
  marketId: z.string(),
  timestamp: z.string(),
  /** Best bid/ask for the YES contract, in contract price units [0,1]. */
  yesBid: ContractPrice.nullable(),
  yesAsk: ContractPrice.nullable(),
  /** Last trade, if any. */
  last: ContractPrice.nullable().optional(),
  /** Rough liquidity measure: contracts available near the top of book. */
  liquidity: z.number().nonnegative().nullable().optional(),
});
export type MarketQuote = z.infer<typeof MarketQuote>;

/** Market-implied YES probability from a quote (mid, falling back to any side). */
export function impliedProbability(q: MarketQuote): number | null {
  if (q.yesBid != null && q.yesAsk != null) return (q.yesBid + q.yesAsk) / 2;
  return q.yesAsk ?? q.yesBid ?? q.last ?? null;
}

// ---------------------------------------------------------------------------
// Research & forecast
// ---------------------------------------------------------------------------

export const Citation = z.object({
  url: z.string(),
  title: z.string(),
  publishedAt: z.string().nullable().optional(),
  snippet: z.string().nullable().optional(),
  /** Which side of the thesis this supports. */
  stance: z.enum(["for", "against", "neutral"]).default("neutral"),
});
export type Citation = z.infer<typeof Citation>;

export const ResearchReport = z.object({
  id: z.string(),
  marketId: z.string(),
  userId: z.string().nullable().optional(),
  createdAt: z.string(),
  /** Plain-English answer to "what has to happen for YES to win?" */
  whatMustHappen: z.string(),
  whyNow: z.string(),
  thesis: z.string(),
  evidenceFor: z.array(z.string()),
  evidenceAgainst: z.array(z.string()),
  /** Ambiguity or resolution-rule risks. */
  risks: z.array(z.string()),
  citations: z.array(Citation),
  /** Mayflower's independent YES probability. */
  estimatedProbability: Probability,
  /** Half-width of a rough credible interval, 0..0.5. */
  uncertainty: z.number().min(0).max(0.5),
  /** Market-implied probability at research time. */
  marketProbability: Probability.nullable(),
  /** Critic's notes — what could invalidate the thesis. */
  critique: z.array(z.string()).default([]),
  /** What the monitor should watch for. */
  watchConditions: z.array(z.string()).default([]),
});
export type ResearchReport = z.infer<typeof ResearchReport>;

// ---------------------------------------------------------------------------
// Proposals, approvals, orders, positions
// ---------------------------------------------------------------------------

export const RiskSnapshot = z.object({
  /** Dollars to commit. */
  stake: Money.nonnegative(),
  /** Number of contracts at the limit price. */
  quantity: z.number().nonnegative(),
  limitPrice: ContractPrice,
  /** Loss if contract expires worthless. */
  maxLoss: Money.nonnegative(),
  /** Gross profit if the contract pays out. */
  maxGain: Money.nonnegative(),
  /** estimated p - price (per contract, before fees). */
  edge: z.number(),
  expectedValue: Money,
  kellyFraction: z.number(),
  fullKelly: z.number(),
  /** Budget used after this trade / total budget. */
  budgetUtilisationAfter: z.number().min(0),
  /** Share of budget in the same theme after this trade. */
  themeConcentrationAfter: z.number().min(0),
  /** Every limit that was applied and whether it bound. */
  constraints: z.array(z.object({ name: z.string(), bound: z.boolean(), detail: z.string() })),
  /** Human explanation of why this size. */
  explanation: z.string(),
});
export type RiskSnapshot = z.infer<typeof RiskSnapshot>;

export const ProposalKind = z.enum(["open", "increase", "reduce", "close", "hedge"]);
export type ProposalKind = z.infer<typeof ProposalKind>;

export const ProposalStatus = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "expired",
  "submitted",
  "filled",
  "partially_filled",
  "failed",
  "cancelled",
]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

export const TradeProposal = z.object({
  id: z.string(),
  /** Increments on every material change; approvals bind to a version. */
  version: z.number().int().positive(),
  userId: z.string(),
  marketId: z.string(),
  researchReportId: z.string().nullable().optional(),
  kind: ProposalKind,
  side: Side,
  action: OrderAction,
  quantity: z.number().positive(),
  limitPrice: ContractPrice,
  risk: RiskSnapshot,
  /** Why this market was surfaced: personalised vs. general scan. */
  discoveryReason: z.enum(["personalized", "general", "monitor"]),
  /** One-paragraph summary suitable for an iMessage. */
  summary: z.string(),
  status: ProposalStatus,
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Hash over the fields an approval must match exactly. */
  bindingHash: z.string(),
});
export type TradeProposal = z.infer<typeof TradeProposal>;

/** The exact fields an approval binds to. Changing any of these requires fresh approval. */
export function proposalBindingFields(p: Pick<TradeProposal, "id" | "version" | "marketId" | "side" | "action" | "quantity" | "limitPrice" | "kind">) {
  return {
    id: p.id,
    version: p.version,
    marketId: p.marketId,
    side: p.side,
    action: p.action,
    quantity: p.quantity,
    limitPrice: p.limitPrice,
    kind: p.kind,
  };
}

export const Approval = z.object({
  id: z.string(),
  userId: z.string(),
  proposalId: z.string(),
  proposalVersion: z.number().int(),
  bindingHash: z.string(),
  decision: z.enum(["approved", "rejected"]),
  channel: Channel,
  decidedAt: z.string(),
  /** Raw user utterance / click id, for audit. */
  evidence: z.string().nullable().optional(),
});
export type Approval = z.infer<typeof Approval>;

export const OrderStatus = z.enum([
  "pending",
  "submitted",
  "open",
  "filled",
  "partially_filled",
  "cancelled",
  "rejected",
  "error",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const Fill = z.object({
  id: z.string(),
  quantity: z.number().positive(),
  price: ContractPrice,
  fee: Money.default(0),
  timestamp: z.string(),
});
export type Fill = z.infer<typeof Fill>;

export const Order = z.object({
  id: z.string(),
  userId: z.string(),
  proposalId: z.string(),
  approvalId: z.string(),
  marketId: z.string(),
  side: Side,
  action: OrderAction,
  quantity: z.number().positive(),
  limitPrice: ContractPrice,
  mode: ExecutionMode,
  /** Idempotency key sent to the exchange. */
  clientOrderId: z.string(),
  exchangeOrderId: z.string().nullable(),
  status: OrderStatus,
  fills: z.array(Fill).default([]),
  error: z.string().nullable().optional(),
  submittedAt: z.string().nullable(),
  updatedAt: z.string(),
  raw: z.unknown().optional(),
});
export type Order = z.infer<typeof Order>;

export const Position = z.object({
  id: z.string(),
  userId: z.string(),
  marketId: z.string(),
  side: Side,
  quantity: z.number().nonnegative(),
  /** Average entry price per contract. */
  avgPrice: ContractPrice,
  costBasis: Money,
  currentPrice: ContractPrice.nullable(),
  unrealizedPnl: Money.nullable(),
  realizedPnl: Money.default(0),
  /** Tags copied from market for concentration analysis. */
  tags: z.array(z.string()).default([]),
  mode: ExecutionMode,
  status: z.enum(["open", "closed", "settled"]),
  openedAt: z.string(),
  updatedAt: z.string(),
  /** Original research that justified the position. */
  originalReportId: z.string().nullable().optional(),
  /** Latest reassessment. */
  latestReportId: z.string().nullable().optional(),
});
export type Position = z.infer<typeof Position>;

export const MonitorRecommendation = z.enum(["hold", "reduce", "close", "hedge", "increase"]);

export const MonitorEvent = z.object({
  id: z.string(),
  userId: z.string(),
  positionId: z.string(),
  marketId: z.string(),
  trigger: z.enum(["price_move", "new_evidence", "watch_condition", "approaching_expiry", "scheduled"]),
  summary: z.string(),
  evidence: z.array(Citation).default([]),
  recommendation: MonitorRecommendation,
  proposalId: z.string().nullable().optional(),
  notified: z.boolean().default(false),
  createdAt: z.string(),
});
export type MonitorEvent = z.infer<typeof MonitorEvent>;

export const AuditEvent = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  actor: z.enum(["user", "agent", "system", "exchange"]),
  action: z.string(),
  refType: z.string().nullable().optional(),
  refId: z.string().nullable().optional(),
  payload: z.unknown().optional(),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export const Message = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  channel: Channel,
  text: z.string(),
  /** External message id (BlueBubbles guid etc.) for dedupe. */
  externalId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof Message>;

// ---------------------------------------------------------------------------
// LLM structured outputs (what the agents ask the model for)
// ---------------------------------------------------------------------------

export const ExtractedProfile = z.object({
  interests: z.array(z.object({ topic: z.string(), note: z.string().optional() })),
  beliefs: z.array(z.object({ topic: z.string(), belief: z.string(), confidence: Probability })),
  totalBudget: Money.nullable(),
  maxPerPosition: Money.nullable(),
  excludedTopics: z.array(z.string()),
  /** True when the user is adjusting existing preferences rather than onboarding. */
  isUpdate: z.boolean(),
});
export type ExtractedProfile = z.infer<typeof ExtractedProfile>;

export const Intent = z.enum([
  "onboard_or_update_profile",
  "ask_why",
  "approve",
  "reject",
  "request_research",
  "portfolio_status",
  "what_changed",
  "find_opportunities",
  "close_or_reduce",
  "pause",
  "resume",
  "smalltalk",
  "unknown",
]);
export type Intent = z.infer<typeof Intent>;

export const ClassifiedIntent = z.object({
  intent: Intent,
  /** Proposal id if the user referenced one (e.g. "approve the $8 trade"). */
  proposalRef: z.string().nullable(),
  /** Dollar amount mentioned, if any. */
  amount: Money.nullable(),
  topic: z.string().nullable(),
  confidence: Probability,
});
export type ClassifiedIntent = z.infer<typeof ClassifiedIntent>;

export const ForecastOutput = z.object({
  whatMustHappen: z.string(),
  whyNow: z.string(),
  thesis: z.string(),
  evidenceFor: z.array(z.string()),
  evidenceAgainst: z.array(z.string()),
  risks: z.array(z.string()),
  estimatedProbability: Probability,
  uncertainty: z.number().min(0).max(0.5),
  /** Indexes into the provided citation list for each claim. */
  citationStances: z.array(z.object({ index: z.number().int().nonnegative(), stance: z.enum(["for", "against", "neutral"]) })),
  watchConditions: z.array(z.string()),
  recommendTrade: z.boolean(),
  noTradeReason: z.string().nullable(),
});
export type ForecastOutput = z.infer<typeof ForecastOutput>;

export const CriticOutput = z.object({
  /** Problems that should block the trade entirely. */
  blockers: z.array(z.string()),
  /** Concerns that lower confidence but don't block. */
  concerns: z.array(z.string()),
  /** Adjusted probability after critique, or null to keep. */
  adjustedProbability: Probability.nullable(),
  adjustedUncertainty: z.number().min(0).max(0.5).nullable(),
  resolutionMismatch: z.boolean(),
});
export type CriticOutput = z.infer<typeof CriticOutput>;

export const DiscoveryRanking = z.object({
  ranked: z.array(z.object({ marketId: z.string(), relevance: Probability, reason: z.string(), matchedTopic: z.string().nullable() })),
});
export type DiscoveryRanking = z.infer<typeof DiscoveryRanking>;
