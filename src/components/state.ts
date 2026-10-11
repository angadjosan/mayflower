import type {
  AuditEvent, ChatMessage, Citation, MonitorEvent, Order, OrderMode, Position, ResearchReport, TradeProposal, User, UserThesis,
} from "@/lib/types";

export type ProposalView = TradeProposal & { research?: ResearchReport; approvalUrl: string };
export type PositionView = Position & {
  thesis?: string;
  sizingExplanation?: string;
  citations?: Citation[];
  estimatedProbability?: number;
};
export interface PortfolioView {
  valueUsd: number;
  availableUsd: number;
  investedUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  atRiskUsd: number;
  riskBudgetUsd: number;
  exposureExplanation: string;
  sharpe: number | null;
  history: { at: string; valueUsd: number }[];
  mode: OrderMode;
  topicExposure: { topic: string; usd: number }[];
}
export interface DashState {
  user: User;
  theses: UserThesis[];
  proposals: ProposalView[];
  positions: PositionView[];
  orders: Order[];
  messages: ChatMessage[];
  monitorEvents: MonitorEvent[];
  audit: AuditEvent[];
  portfolio: PortfolioView;
  modes: { llm: boolean; exchange: "sandbox" | "simulated"; polymarket: "live" | "simulated" | "off"; hyperliquid: "testnet" | "live" | "simulated" | "off"; research: "context.dev" | "mock"; imessage: boolean };
}

export async function post<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}
