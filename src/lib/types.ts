// Shared domain types for Mayflower. All modules import from here.

export type Side = "YES" | "NO";

export interface RiskLimits {
  budgetUsd: number; // total amount the user is willing to risk (a limit, not a deposit)
  maxPerTradeUsd: number; // max loss per position
  maxTotalExposureUsd: number; // max total at-risk
  riskStyle: "conservative" | "balanced" | "aggressive";
  excludedTopics: string[];
}

export interface User {
  id: string;
  name?: string;
  handle?: string; // iMessage phone / Apple ID (BlueBubbles chat address)
  createdAt: string;
  onboarded: boolean;
  paused: boolean; // kill switch: no orders while paused
  limits: RiskLimits;
  geminiLinked: boolean; // MVP: shared sandbox account; true once user "links"
  lastAlphaAt?: string; // last unsolicited alpha-scan text (throttle)
  alphaMarketIds?: string[]; // markets already pitched by the alpha scan (never repeat), most recent last
}

export interface UserThesis {
  id: string;
  userId: string;
  topic: string; // e.g. "Seahawks", "AI infrastructure"
  belief: string; // e.g. "AI capex keeps growing"
  confidence: number; // 0..1
  source: "chat" | "imessage" | "manual" | "notion" | "slack" | "gmail" | "discord";
  sourceId?: string; // ConnectedSource that produced this thesis (so users can see and revoke it)
  updatedAt: string;
}

export interface Market {
  id: string; // exchange instrument / contract symbol
  eventId?: string;
  eventTitle: string;
  title: string; // contract question / outcome label
  category?: string;
  rules?: string; // resolution rules
  expiresAt?: string;
  status: "open" | "closed" | "settled" | "unknown";
  yesBid?: number; // 0..1 dollars per contract
  yesAsk?: number;
  noBid?: number;
  noAsk?: number;
  lastPrice?: number;
  volume?: number;
  source: "gemini" | "polymarket" | "hyperliquid" | "mock"; // venue the market trades on (honest labeling)
  paperOnly?: boolean; // real production market not listed in sandbox: discovery only, orders are always simulated
  polymarket?: PolymarketRef; // set when source === "polymarket"
  hyperliquid?: HyperliquidRef; // set when source === "hyperliquid"
}

/** A Hyperliquid HIP-4 outcome (YES = side 0, NO = side 1). */
export interface HyperliquidRef {
  network: "testnet" | "mainnet";
  outcome: number;
  quoteToken: string;
}

/** What the Polymarket CLOB needs to place an order on a market (from the Gamma API). */
export interface PolymarketRef {
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  negRisk: boolean;
  tickSize: number;
  minSize: number; // minimum order size in contracts
}

export type Venue = "gemini" | "polymarket" | "hyperliquid";
/** sandbox = Gemini sandbox, testnet = Hyperliquid testnet, live = real funds (Polymarket or Hyperliquid mainnet). */
export type OrderMode = "sandbox" | "testnet" | "live" | "simulated";

export interface Citation {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
}

export interface ResearchReport {
  id: string;
  marketId: string;
  createdAt: string;
  summary: string;
  evidenceFor: { point: string; citation?: Citation }[];
  evidenceAgainst: { point: string; citation?: Citation }[];
  citations: Citation[];
  estimatedProbability: number; // Mayflower's P(YES), 0..1
  uncertainty: "low" | "medium" | "high";
  criticNotes?: string; // critic's challenges / resolution risks
  whatWouldChangeMind?: string;
  source: "context.dev" | "mock";
  pagesRead?: number; // full pages read (not just search snippets)
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "expired" | "executed" | "failed";

export interface TradeProposal {
  id: string;
  userId: string;
  marketId: string;
  market: Market; // snapshot at proposal time
  researchId: string;
  kind: "open" | "close" | "reduce" | "hedge";
  hedgeForPositionId?: string; // set when kind === "hedge"
  discovery: "personalized" | "general" | "monitor" | "group";
  groupId?: string; // set for group-chat trades (contest entry or group pick)
  contestId?: string;
  side: Side;
  quantity: number; // contracts
  limitPrice: number; // 0..1 per contract
  costUsd: number; // quantity * limitPrice = max loss for a buy
  marketProbability: number; // implied by executable price for chosen side's YES-equivalent
  estimatedProbability: number; // P(chosen side wins)
  edge: number; // estimatedProbability - limitPrice
  thesis: string;
  sizingExplanation: string;
  riskNotes: string;
  status: ProposalStatus;
  approvalToken: string; // random token bound to this proposal (used in iMessage approval links)
  createdAt: string;
  expiresAt: string;
  version: number;
  loop?: "alpha" | "pending" | "thesis"; // research loop that created this proposal
  lastResearchedAt?: string; // pending-proposal loop: last re-research
  statusReason?: string; // why it was expired/withdrawn/superseded
  supersedesId?: string; // previous version of this idea
  supersededById?: string; // newer version that replaced this one
}

export interface Order {
  id: string;
  userId: string;
  proposalId: string;
  exchangeOrderId?: string;
  marketId: string;
  side: Side;
  action: "buy" | "sell";
  quantity: number;
  limitPrice: number;
  status: "submitted" | "open" | "filled" | "partially_filled" | "cancelled" | "rejected" | "error";
  filledQuantity: number;
  avgFillPrice?: number;
  error?: string;
  mode: OrderMode; // simulated when no exchange credentials; live = real funds
  venue?: Venue; // missing on orders placed before Polymarket support (= gemini)
  createdAt: string;
  updatedAt: string;
}

export interface Position {
  id: string;
  userId: string;
  marketId: string;
  market: Market;
  side: Side;
  quantity: number;
  avgEntryPrice: number;
  currentPrice?: number; // current bid for this side
  costBasisUsd: number;
  realizedPnlUsd: number;
  status: "open" | "closed";
  proposalId: string; // originating proposal (original thesis)
  latestAssessment?: string;
  watchConditions?: string; // exit / stop watch triggers
  stopPrice?: number; // alert (not a guaranteed stop) when side price falls to this
  takeProfitPrice?: number; // alert when side price rises to this
  openedAt: string;
  updatedAt: string;
  thesisCheckedAt?: string; // thesis-watch loop: last news check
  thesisStatus?: "intact" | "weakened" | "broken"; // last judged status vs the original thesis
}

export interface ChatMessage {
  id: string;
  userId: string;
  role: "user" | "agent";
  text: string;
  channel: "imessage" | "web";
  groupId?: string; // set when the message was posted in a group chat (userId = sender)
  createdAt: string;
}

export interface MonitorEvent {
  id: string;
  userId: string;
  positionId: string;
  trigger: string;
  recommendation: "hold" | "reduce" | "close" | "hedge";
  explanation: string;
  proposalId?: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  userId?: string;
  actor: "user" | "agent" | "system";
  action: string;
  ref?: string;
  detail?: unknown;
  createdAt: string;
}

export interface PortfolioSnapshot {
  userId: string;
  at: string;
  valueUsd: number;
}

// ---------- Group chats ----------

export interface Group {
  id: string;
  chatGuid: string; // BlueBubbles chat guid, e.g. "iMessage;+;chat123"
  memberUserIds: string[];
  createdAt: string;
  msgsSinceSuggestion: number; // always-listening throttle
  lastSuggestionAt?: string;
}

/** Friends each pitch a trade with an equal stake; best % return wins the group-defined reward. */
export interface Contest {
  id: string;
  groupId: string;
  stakeUsd: number; // equal stake per member
  reward: string; // free-text IOU, e.g. "loser buys dinner" — Mayflower never holds the pot
  endsAt?: string; // optional; positions stay open after the contest is scored
  status: "active" | "ended";
  winnerUserId?: string;
  createdByUserId: string;
  createdAt: string;
}

export interface ContestEntry {
  id: string;
  contestId: string;
  userId: string;
  pitch: string; // the member's idea in their own words
  proposalId: string;
  createdAt: string;
}

/** One market the agent suggested to the whole group; each member opts in with their own trade. */
export interface GroupPick {
  id: string;
  groupId: string;
  market: Market;
  researchId: string;
  side: Side;
  price: number;
  stakeUsd: number;
  rationale: string;
  joinedUserIds: string[];
  createdAt: string;
  expiresAt: string;
}

// ---------- Personal context connectors & account linking ----------

export type ConnectorProvider = "notion" | "slack" | "gmail" | "gemini";

export interface ConnectedSource {
  id: string;
  userId: string;
  provider: ConnectorProvider;
  status: "connected" | "revoked" | "error";
  scopes: string[];
  tokenEnc: string; // AES-GCM encrypted JSON token blob (see src/lib/crypto.ts)
  accountLabel?: string; // e.g. workspace name / email
  lastSyncedAt?: string;
  lastError?: string;
  connectedAt: string;
  revokedAt?: string;
}

/** A piece of personal context that influenced the profile — shown to the user, never treated as a trade instruction. */
export interface ContextItem {
  id: string;
  userId: string;
  sourceId: string;
  provider: ConnectorProvider | "discord";
  title: string;
  excerpt: string; // short, never the full private message
  url?: string;
  createdAt: string;
}

// ---------- Trust, scoring, auth ----------

/** YZi: hash of an approval or policy committed to BNB Smart Chain testnet. No private data onchain. */
export interface AuditReceipt {
  id: string;
  userId: string;
  kind: "policy" | "approval";
  ref?: string; // proposal id for approvals
  hash: string; // sha256 of the canonical record
  chain: "bsc-testnet";
  txHash?: string;
  status: "pending" | "committed" | "failed" | "disabled";
  error?: string;
  createdAt: string;
}

/** Forecast calibration once a market settles. */
export interface ForecastScore {
  id: string;
  userId?: string;
  marketId: string;
  proposalId?: string;
  estimatedProbability: number; // Mayflower P(YES)
  marketProbability: number; // market-implied P(YES) at proposal time
  outcome: 0 | 1;
  brier: number;
  marketBrier: number;
  scoredAt: string;
}

/** One-time magic login link token (sent over iMessage/Discord DM). */
export interface LoginToken {
  id: string;
  userId: string;
  tokenHash: string;
  next?: string;
  expiresAt: string;
  usedAt?: string;
}

// ---------- Background research loops ----------

export interface LoopState {
  lastRunAt?: string; // last completed run
  startedAt?: string; // start of the current/last run
  running?: boolean;
  lastError?: string;
  lastResult?: unknown; // small summary of the last run
}
