// Read-only HTTP API the dashboard consumes (worker serves it, web/ renders it).
// Phone numbers are masked before they leave the worker.
import type { Side, Source, VerdictType } from './types.js';

export interface ModesInfo {
  db: 'postgres' | 'pglite';
  executor: 'sandbox' | 'simulated';
  llm: 'google' | 'fake';
  research: 'contextdev' | 'none';
  messenger: 'bluebubbles' | 'console';
  voice: 'elevenlabs' | 'none';
  catalogContracts: number;
  ticksRecorded: number;
}

export interface PositionRow {
  id: string; user: string; symbol: string; title: string; side: Side; qty: number;
  costBasis: number; mark: number | null; unrealizedPnl: number; realizedPnl: number;
  simulated: boolean; status: string; verdictId: string | null;
}

export interface VerdictRow {
  id: string; user: string; belief: string; type: VerdictType; symbol: string | null;
  title: string | null; reasoning: string; createdAt: string;
  pMarket: number | null; pFinal: number | null; stake: number | null;
}

export interface ProposalRow {
  id: string; user: string; symbol: string; title: string; side: Side; qty: number;
  limitPrice: number; stake: number; maxLoss: number; status: string; expiresAt: string;
}

export interface OverviewResponse {
  modes: ModesInfo;
  totals: { invested: number; unrealizedPnl: number; realizedPnl: number; openPositions: number; riskBudget: number | null };
  positions: PositionRow[];
  verdicts: VerdictRow[];
  proposals: ProposalRow[];
  verdictCounts: Record<VerdictType, number>;
}

export interface CaseResponse {
  verdict: VerdictRow;
  market: { symbol: string; title: string; category: string | null; rules: string | null; expiry: string | null; sandboxListed: boolean } | null;
  research: {
    queries: string[]; sources: Source[]; forPoints: string[]; againstPoints: string[];
    pModel: number | null; pMarket: number | null; pFinal: number | null; w: number | null;
    critic: { severity: string; notes: string[]; resolutionMismatch: boolean; staleEvidence: boolean } | null;
  } | null;
  /** full risk-engine output (edge, spread, kelly fraction, caps applied...) */
  numbers: Record<string, unknown>;
  proposal: ProposalRow | null;
  order: { status: string; exchangeOrderId: string | null; filledQty: number; avgPrice: number | null; simulated: boolean; error: string | null } | null;
  ticks: { ts: string; bid: number | null; ask: number | null; last: number | null }[];
}
