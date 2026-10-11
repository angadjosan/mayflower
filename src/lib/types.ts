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
}

export interface UserThesis {
  id: string;
  userId: string;
  topic: string; // e.g. "Seahawks", "AI infrastructure"
  belief: string; // e.g. "AI capex keeps growing"
  confidence: number; // 0..1
  source: "chat" | "imessage" | "manual";
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
  source: "gemini" | "mock"; // honest labeling
}

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
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "expired" | "executed" | "failed";

export interface TradeProposal {
  id: string;
  userId: string;
  marketId: string;
  market: Market; // snapshot at proposal time
  researchId: string;
  kind: "open" | "close" | "reduce";
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
  mode: "sandbox" | "simulated"; // simulated when no exchange credentials
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
  openedAt: string;
  updatedAt: string;
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
