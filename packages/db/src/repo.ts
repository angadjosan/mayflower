/**
 * Repository interface — the only persistence surface the app and agents use.
 * Two implementations: Supabase (production) and in-memory (tests / no config).
 */
import type { Approval, AuditEvent, Market, MarketQuote, Message, MonitorEvent, Order, Position, ResearchReport, RiskLimits, TradeProposal, User, UserThesis, ExchangeConnection } from "@mayflower/shared";

export interface Repo {
  // users
  getUser(id: string): Promise<User | null>;
  getUserByHandle(handle: string): Promise<User | null>;
  upsertUser(u: Partial<User> & { id: string }): Promise<User>;
  updateRiskLimits(userId: string, limits: RiskLimits): Promise<void>;
  linkHandle(userId: string, handle: string, chatGuid?: string): Promise<void>;
  getChatGuid(userId: string): Promise<string | null>;
  listUsersWithHandles(): Promise<User[]>;
  // theses
  listTheses(userId: string): Promise<UserThesis[]>;
  upsertThesis(t: UserThesis): Promise<void>;
  // exchange connections
  getExchangeConnection(userId: string): Promise<(ExchangeConnection & { encryptedCredentials?: string | null }) | null>;
  saveExchangeConnection(c: ExchangeConnection & { encryptedCredentials?: string | null }): Promise<void>;
  // markets
  upsertMarket(m: Market): Promise<void>;
  getMarket(id: string): Promise<Market | null>;
  saveQuote(q: MarketQuote): Promise<void>;
  // research
  saveReport(r: ResearchReport): Promise<void>;
  getReport(id: string): Promise<ResearchReport | null>;
  // proposals
  saveProposal(p: TradeProposal): Promise<void>;
  getProposal(id: string): Promise<TradeProposal | null>;
  listProposals(userId: string, status?: TradeProposal["status"][]): Promise<TradeProposal[]>;
  // approvals / orders
  saveApproval(a: Approval): Promise<void>;
  getApprovalForProposal(proposalId: string, version: number): Promise<Approval | null>;
  saveOrder(o: Order): Promise<void>;
  getOrderByApproval(approvalId: string): Promise<Order | null>;
  listOrders(userId: string): Promise<Order[]>;
  // positions
  listPositions(userId: string): Promise<Position[]>;
  upsertPosition(p: Position): Promise<void>;
  getPosition(id: string): Promise<Position | null>;
  // monitoring / audit / messages
  saveMonitorEvent(e: MonitorEvent): Promise<void>;
  listMonitorEvents(userId: string, limit?: number): Promise<MonitorEvent[]>;
  audit(e: Omit<AuditEvent, "id" | "createdAt">): Promise<void>;
  listAudit(userId: string, limit?: number): Promise<AuditEvent[]>;
  saveMessage(m: Message): Promise<void>;
  listMessages(userId: string, limit?: number): Promise<Message[]>;
  hasMessage(externalId: string): Promise<boolean>;
}
