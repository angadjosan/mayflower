// Shared domain types. Every module and the dashboard import from here.
// Probabilities and prices are decimals in [0,1]; money is USD numbers.

export type Side = 'yes' | 'no';
export type VerdictType = 'no_market' | 'priced_in' | 'against' | 'edge';

/** One tradable Gemini contract (an event can hold many contracts). */
export interface Market {
  symbol: string;            // exact instrumentSymbol from Gemini, never constructed by hand
  eventTicker: string;
  eventTitle: string;
  label: string;             // contract label, e.g. "Seattle"
  title: string;             // "<eventTitle> — <label>", used for matching
  category: string;
  rules: string | null;
  expiry: string | null;     // ISO
  status: string;
  priceIncrement: number;
  priceMinimum: number;
  quantityIncrement: number;
  quantityMinimum: number;
  /** true when the contract is listed on the Gemini sandbox, so a real sandbox order is possible */
  sandboxListed: boolean;
}

export interface Quote {
  symbol: string;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  ts: string;
}

export interface MarketCandidate { market: Market; score: number }

export interface MatchResult {
  market: Market;
  /** which side of this contract expresses the user's belief */
  beliefSide: Side;
  confidence: number;        // 0..1, how well the contract expresses the belief
  reasoning: string;
}

export interface Source {
  url: string;
  title: string;
  publishedAt: string | null;
  retrievedAt: string;       // we stamp this ourselves; Context.dev search has no publish date
  snippet: string;
  stance: 'for' | 'against' | 'neutral';
}

export interface ResearchBundle {
  queries: string[];
  sources: Source[];
  forPoints: string[];       // supports YES on the contract
  againstPoints: string[];   // supports NO on the contract
}

export interface Forecast { pYes: number; reasoning: string }

export interface Critique {
  severity: 'none' | 'minor' | 'major';
  resolutionMismatch: boolean; // contract does not actually resolve on the user's belief
  staleEvidence: boolean;
  notes: string[];
}

export interface UserProfile {
  phone: string;
  name: string | null;
  riskBudget: number;
  perTradeCap: number;
  interests: string[];
  excludedTopics: string[];
  onboarded: boolean;
}

export interface ProfilePatch {
  name?: string | null;
  riskBudget?: number;
  perTradeCap?: number;
  interests?: string[];
  excludedTopics?: string[];
}

export type Intent =
  | { kind: 'approve'; code: string }
  | { kind: 'onboarding'; patch: ProfilePatch }
  | { kind: 'belief'; belief: string }
  | { kind: 'question'; text: string }
  | { kind: 'other'; text: string };

export interface OrderRequest {
  proposalId: string;
  symbol: string;
  side: Side;
  qty: number;
  limitPrice: number;
  clientOrderId: string;     // = proposal id; dedupes resubmits
}

/** 'unknown' = we may have reached the exchange but could not confirm; never treat as failed. */
export type OrderStatus = 'filled' | 'partially_filled' | 'open' | 'cancelled' | 'rejected' | 'unknown';

export interface OrderResult {
  status: OrderStatus;
  exchangeOrderId: string | null;
  filledQty: number;
  avgPrice: number | null;
  error: string | null;
  simulated: boolean;        // true = never reached an exchange; must be labeled "simulated" everywhere
  raw: unknown;
}

export interface OutboundMessage {
  to: string;                // phone / Apple ID handle
  text: string;
  audio?: { data: Buffer; mime: string; filename: string };
}

export interface InboundMessage {
  from: string;
  text: string;
  audio?: { data: Buffer; mime: string };
  channel: 'imessage' | 'dev';
  externalId: string | null; // BlueBubbles message guid, for dedupe
}
