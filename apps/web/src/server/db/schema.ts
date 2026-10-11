// Drizzle mirror of supabase/migrations/*.sql (the SQL files are the source of truth).
import { bigserial, boolean, doublePrecision, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Citation, ContractIncrements, CriticReview, Forecast, SizingResult, WatchCondition } from "@mayflower/shared";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name"),
  imessageHandle: text("imessage_handle").unique(),
  email: text("email").unique(),
  onboardingState: text("onboarding_state").notNull().default("new"),
  riskBudget: doublePrecision("risk_budget"),
  maxPerPosition: doublePrecision("max_per_position"),
  maxTotalExposure: doublePrecision("max_total_exposure"),
  riskStyle: text("risk_style").notNull().default("conservative"),
  interests: text("interests").array().notNull().default([]),
  excludedTopics: text("excluded_topics").array().notNull().default([]),
  tradingPaused: boolean("trading_paused").notNull().default(false),
  notifyLevel: text("notify_level").notNull().default("important"),
  lastDiscoveryAt: ts("last_discovery_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const userTheses = pgTable("user_theses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  topic: text("topic").notNull(),
  belief: text("belief").notNull(),
  stance: text("stance").notNull().default("neutral"),
  confidence: doublePrecision("confidence").notNull().default(0.6),
  source: text("source").notNull().default("chat"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const connectedSources = pgTable("connected_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  provider: text("provider").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  status: text("status").notNull().default("not_connected"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const authCodes = pgTable("auth_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const oneTimeTokens = pgTable("one_time_tokens", {
  jti: text("jti").primaryKey(),
  userId: uuid("user_id").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const geminiConnections = pgTable("gemini_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  mode: text("mode").notNull(),
  env: text("env").notNull(),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: ts("token_expires_at"),
  scopes: text("scopes"),
  status: text("status").notNull().default("active"),
  termsAcceptedAt: ts("terms_accepted_at"),
  lastError: text("last_error"),
  linkedAt: ts("linked_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const oauthTransactions = pgTable("oauth_transactions", {
  state: text("state").primaryKey(),
  userId: uuid("user_id").notNull(),
  verifierEnc: text("verifier_enc"),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
});

export const markets = pgTable("markets", {
  symbol: text("symbol").primaryKey(),
  eventTicker: text("event_ticker").notNull(),
  eventTitle: text("event_title").notNull(),
  label: text("label").notNull(),
  category: text("category").notNull().default("other"),
  correlationGroup: text("correlation_group"),
  description: text("description"),
  rulesUrl: text("rules_url"),
  eventType: text("event_type").notNull().default("binary"),
  status: text("status").notNull(),
  marketState: text("market_state"),
  expiry: ts("expiry"),
  increments: jsonb("increments").$type<ContractIncrements>().notNull(),
  resolutionSide: text("resolution_side"),
  source: text("source").notNull(),
  env: text("env").notNull(),
  tags: text("tags").array().notNull().default([]),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const marketQuotes = pgTable("market_quotes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  symbol: text("symbol").notNull(),
  ts: ts("ts").notNull().defaultNow(),
  buyYes: doublePrecision("buy_yes"),
  buyNo: doublePrecision("buy_no"),
  sellYes: doublePrecision("sell_yes"),
  sellNo: doublePrecision("sell_no"),
  bestBid: doublePrecision("best_bid"),
  bestAsk: doublePrecision("best_ask"),
  lastTrade: doublePrecision("last_trade"),
  liquidityUsd: doublePrecision("liquidity_usd"),
  volumeUsd: doublePrecision("volume_usd"),
});

export const researchReports = pgTable("research_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  symbol: text("symbol").notNull(),
  provider: text("provider").notNull(),
  queries: jsonb("queries").$type<{ query: string; freshness?: string; purpose: string }[]>().notNull(),
  citations: jsonb("citations").$type<Citation[]>().notNull(),
  forecast: jsonb("forecast").$type<Forecast>().notNull(),
  critic: jsonb("critic").$type<CriticReview>().notNull(),
  marketProbability: doublePrecision("market_probability"),
  errors: jsonb("errors").$type<string[]>().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export interface ProposalRationale {
  title: string;
  whatHasToHappen: string;
  whyNow: string;
  thesis: string;
  discoveryReason: string;
  sizingSummary: string;
  noTradeReason: string | null;
  risks: string[];
  resolutionRisks: string[];
  whatWouldChangeMind: string[];
  watchConditions: string[];
  hedgeNote: string | null;
  criticIssues: string[];
  uncertainty?: "low" | "medium" | "high";
  method: { forecast: "llm" | "heuristic"; critic: "llm" | "heuristic"; research: string; marketData: string };
  monitor?: { reasons: string[]; action: string } | null;
}

export const tradeProposals = pgTable("trade_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  symbol: text("symbol").notNull(),
  kind: text("kind").notNull().default("open"),
  discovery: text("discovery").notNull(),
  decision: text("decision").notNull(),
  side: text("side"),
  outcome: text("outcome"),
  quantity: doublePrecision("quantity").notNull().default(0),
  limitPrice: doublePrecision("limit_price"),
  maxCost: doublePrecision("max_cost").notNull().default(0),
  estProbability: doublePrecision("est_probability"),
  marketProbability: doublePrecision("market_probability"),
  edge: doublePrecision("edge"),
  expectedValue: doublePrecision("expected_value"),
  sizing: jsonb("sizing").$type<SizingResult | Record<string, unknown>>().notNull(),
  rationale: jsonb("rationale").$type<ProposalRationale>().notNull(),
  researchReportId: uuid("research_report_id"),
  relatedPositionId: uuid("related_position_id"),
  version: integer("version").notNull().default(1),
  termsHash: text("terms_hash"),
  approvalCodeHash: text("approval_code_hash"),
  approvalCodeExpiresAt: ts("approval_code_expires_at"),
  executionMode: text("execution_mode"),
  status: text("status").notNull(),
  expiresAt: ts("expires_at"),
  decidedAt: ts("decided_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull(),
  userId: uuid("user_id").notNull(),
  proposalVersion: integer("proposal_version").notNull(),
  termsHash: text("terms_hash").notNull(),
  decision: text("decision").notNull(),
  channel: text("channel").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  proposalId: uuid("proposal_id").notNull().unique(),
  approvalId: uuid("approval_id").notNull().unique(),
  mode: text("mode").notNull(),
  env: text("env").notNull(),
  simulated: boolean("simulated").notNull(),
  exchangeOrderId: text("exchange_order_id"),
  symbol: text("symbol").notNull(),
  eventTicker: text("event_ticker").notNull(),
  side: text("side").notNull(),
  outcome: text("outcome").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  limitPrice: doublePrecision("limit_price").notNull(),
  status: text("status").notNull(),
  filledQuantity: doublePrecision("filled_quantity").notNull().default(0),
  avgFillPrice: doublePrecision("avg_fill_price"),
  error: text("error"),
  raw: jsonb("raw"),
  submittedAt: ts("submitted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const fills = pgTable("fills", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  price: doublePrecision("price").notNull(),
  fee: doublePrecision("fee").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export interface PositionAssessment {
  at: string;
  heldProbability: number | null;
  exitPrice: number | null;
  action: string;
  reasons: string[];
  summary: string;
  citations: Citation[];
}

export const positions = pgTable("positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  symbol: text("symbol").notNull(),
  eventTicker: text("event_ticker").notNull(),
  outcome: text("outcome").notNull(),
  mode: text("mode").notNull(),
  quantity: doublePrecision("quantity").notNull().default(0),
  avgPrice: doublePrecision("avg_price").notNull().default(0),
  costBasis: doublePrecision("cost_basis").notNull().default(0),
  realizedPnl: doublePrecision("realized_pnl").notNull().default(0),
  status: text("status").notNull().default("open"),
  correlationGroup: text("correlation_group"),
  originProposalId: uuid("origin_proposal_id"),
  thesis: jsonb("thesis").$type<{ text: string; probability: number | null; sizingSummary: string } | null>(),
  latestAssessment: jsonb("latest_assessment").$type<PositionAssessment | null>(),
  watchConditions: jsonb("watch_conditions").$type<WatchCondition[]>().notNull().default([]),
  openedAt: ts("opened_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
  lastMonitoredAt: ts("last_monitored_at"),
  lastNotifiedAt: ts("last_notified_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  mode: text("mode").notNull(),
  kind: text("kind").notNull(),
  amount: doublePrecision("amount").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  memo: text("memo"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const monitorEvents = pgTable("monitor_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  positionId: uuid("position_id"),
  trigger: text("trigger").notNull(),
  severity: text("severity").notNull(),
  summary: text("summary").notNull(),
  recommendation: text("recommendation").notNull(),
  evidence: jsonb("evidence").$type<Citation[]>().notNull().default([]),
  details: jsonb("details").$type<Record<string, unknown> | null>(),
  proposalId: uuid("proposal_id"),
  notifiedAt: ts("notified_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  channel: text("channel").notNull(),
  text: text("text").notNull(),
  externalGuid: text("external_guid").unique(),
  delivery: text("delivery").notNull().default("n/a"),
  meta: jsonb("meta").$type<Record<string, unknown> | null>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  details: jsonb("details").$type<Record<string, unknown> | null>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").notNull(),
  ts: ts("ts").notNull().defaultNow(),
  totalValue: doublePrecision("total_value").notNull(),
  cash: doublePrecision("cash").notNull(),
  atRisk: doublePrecision("at_risk").notNull(),
  unrealizedPnl: doublePrecision("unrealized_pnl").notNull(),
  realizedPnl: doublePrecision("realized_pnl").notNull(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Thesis = typeof userTheses.$inferSelect;
export type MarketRow = typeof markets.$inferSelect;
export type QuoteRow = typeof marketQuotes.$inferSelect;
export type ResearchReport = typeof researchReports.$inferSelect;
export type Proposal = typeof tradeProposals.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type MonitorEvent = typeof monitorEvents.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type GeminiConnection = typeof geminiConnections.$inferSelect;
