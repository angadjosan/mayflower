// Core domain types shared by the dashboard, services and integrations.

export type Outcome = "yes" | "no";
export type OrderSide = "buy" | "sell";
export type RiskStyle = "conservative" | "balanced" | "aggressive";
export type Uncertainty = "low" | "medium" | "high";
export type GeminiEnv = "sandbox" | "production";

/**
 * How an order is executed for a given user.
 * - oauth: the user's own Gemini account, linked with trade-only OAuth scopes (Plan A).
 * - shared_sandbox: one team sandbox API key; per-user allocation tracked in our ledger (Plan B).
 * - simulated: no exchange credentials at all; fills are simulated locally against quotes.
 */
export type ExecutionMode = "oauth" | "shared_sandbox" | "simulated";

/** Honest labels for every feature surface. */
export type FeatureLabel = "live" | "sandbox" | "simulated" | "demo" | "not_implemented" | "offline";

export interface Quote {
  /** Price to buy YES (executable ask for YES). */
  buyYes: number | null;
  /** Price to buy NO (executable ask for NO). */
  buyNo: number | null;
  /** Price you would receive selling YES (bid for YES). */
  sellYes: number | null;
  /** Price you would receive selling NO (bid for NO). */
  sellNo: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTrade: number | null;
  ts: string;
}

export interface ContractIncrements {
  quantityIncrement: number;
  quantityMinimum: number;
  priceIncrement: number;
  priceMinimum: number;
}

export interface MarketContract {
  /** Exchange instrument symbol used for orders (e.g. GEMI-FEDJAN26-DN25). */
  symbol: string;
  contractId: string | null;
  eventTicker: string;
  eventTitle: string;
  /** Human label for the YES proposition of this contract. */
  label: string;
  category: string;
  subcategoryPath: string[];
  tags: string[];
  description: string;
  rulesUrl: string | null;
  eventType: "binary" | "categorical";
  status: string;
  marketState: "open" | "closed" | null;
  expiry: string | null;
  quote: Quote;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  increments: ContractIncrements;
  priceHistory: { ts: string; price: number }[];
  resolutionSide: Outcome | null;
  /** Where this record came from. "demo" records are never real markets. */
  source: "live" | "demo";
  env: GeminiEnv;
}

export interface Citation {
  id: string;
  title: string;
  url: string;
  snippet: string;
  query: string;
  relevance: "high" | "medium" | "low" | null;
  retrievedAt: string;
  publishedAt: string | null;
  provider: "context.dev" | "demo";
}

export interface EvidenceItem {
  claim: string;
  citationIds: string[];
  weight: "strong" | "moderate" | "weak";
}

export interface Forecast {
  /** Mayflower's probability that the contract's YES side resolves true. */
  probability: number;
  uncertainty: Uncertainty;
  thesis: string;
  whatHasToHappen: string;
  whyNow: string;
  evidenceFor: EvidenceItem[];
  evidenceAgainst: EvidenceItem[];
  risks: string[];
  resolutionRisks: string[];
  whatWouldChangeMind: string[];
  watchConditions: string[];
  method: "llm" | "heuristic";
  model: string;
}

export interface CriticReview {
  verdict: "ok" | "downgrade" | "reject";
  issues: string[];
  adjustedProbability: number;
  adjustedUncertainty: Uncertainty;
  notes: string;
  method: "llm" | "heuristic";
}

export interface UserRiskLimits {
  /** Total amount the user is willing to risk across Mayflower (a limit, not a deposit). */
  riskBudget: number;
  /** Maximum loss on any single position. */
  maxPerPosition: number;
  /** Maximum total amount at risk across all open positions and pending orders. */
  maxTotalExposure: number;
  riskStyle: RiskStyle;
}

export interface ExposureItem {
  symbol: string;
  eventTicker: string;
  outcome: Outcome;
  quantity: number;
  /** Dollars at risk (cost basis of open position or reserved cost of a pending order). */
  atRisk: number;
  correlationGroup: string | null;
  label?: string;
}

export interface SizingCap {
  name: string;
  limit: number;
  detail: string;
}

export interface SizingResult {
  decision: "trade" | "no_trade";
  side: Outcome | null;
  limitPrice: number | null;
  quantity: number;
  cost: number;
  maxLoss: number;
  maxPayout: number;
  expectedValue: number;
  edge: number;
  marketProbability: number | null;
  rawProbability: number;
  adjustedProbability: number;
  kellyFraction: number;
  fractionalKelly: number;
  stakeBeforeCaps: number;
  capsApplied: SizingCap[];
  bindingCap: string | null;
  steps: string[];
  noTradeReasons: string[];
  correlated: ExposureItem[];
  bankroll: number;
}

export interface WatchCondition {
  kind: "price_below" | "price_above" | "expiry_near" | "thesis";
  /** For price conditions: price of the held outcome. */
  threshold?: number;
  description: string;
}

export type ProposalKind = "open" | "reduce" | "close" | "hedge";
export type DiscoveryKind = "personalized" | "general" | "monitor" | "user_request";
export type ProposalStatus =
  | "pending"
  | "awaiting_link"
  | "approved"
  | "executing"
  | "executed"
  | "failed"
  | "rejected"
  | "expired"
  | "superseded"
  | "informational";

export type OrderStatus =
  | "submitting"
  | "open"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected"
  | "error"
  | "unknown";

export interface ProposalTerms {
  proposalId: string;
  version: number;
  symbol: string;
  side: OrderSide;
  outcome: Outcome;
  quantity: number;
  limitPrice: number;
  maxCost: number;
}

export interface ProfileUpdate {
  interests: string[];
  beliefs: { topic: string; belief: string; stance: "bullish" | "bearish" | "neutral"; confidence: number }[];
  riskBudget: number | null;
  maxPerPosition: number | null;
  maxTotalExposure: number | null;
  riskStyle: RiskStyle | null;
  excludedTopics: string[];
  removeInterests: string[];
  lowerConfidenceTopics: string[];
  displayName: string | null;
}

export type Intent =
  | "onboarding"
  | "profile_update"
  | "find_opportunities"
  | "ask_why"
  | "approve"
  | "reject"
  | "portfolio"
  | "what_changed"
  | "riskiest"
  | "change_position"
  | "hedge_question"
  | "link_gemini"
  | "dashboard_link"
  | "pause"
  | "resume"
  | "help"
  | "research"
  | "general";

export interface IntentResult {
  intent: Intent;
  /** Free-text topic the user mentioned (for discovery or research). */
  topic: string | null;
  /** Topics to exclude from this discovery request (e.g. "outside sports"). */
  excludeTopics: string[];
  /** Fraction of a position to sell for change_position (0-1), if stated. */
  fraction: number | null;
  /** Free text that references a market/position, used for matching. */
  reference: string | null;
  method: "llm" | "heuristic";
}
