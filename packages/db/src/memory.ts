import type { Approval, AuditEvent, ExchangeConnection, Market, MarketQuote, Message, MonitorEvent, Order, Position, ResearchReport, RiskLimits, TradeProposal, User, UserThesis } from "@mayflower/shared";
import { DEFAULT_RISK_LIMITS, newId } from "@mayflower/shared";
import type { Repo } from "./repo";

/** In-memory repo. Process-local; fine for tests and a zero-config demo. */
export class MemoryRepo implements Repo {
  users = new Map<string, User>();
  handles = new Map<string, { userId: string; chatGuid?: string }>();
  theses = new Map<string, UserThesis>();
  connections = new Map<string, ExchangeConnection & { encryptedCredentials?: string | null }>();
  markets = new Map<string, Market>();
  quotes: MarketQuote[] = [];
  reports = new Map<string, ResearchReport>();
  proposals = new Map<string, TradeProposal>();
  approvals: Approval[] = [];
  orders = new Map<string, Order>();
  positions = new Map<string, Position>();
  monitorEvents: MonitorEvent[] = [];
  audits: AuditEvent[] = [];
  messages: Message[] = [];

  async getUser(id: string) { return this.users.get(id) ?? null; }
  async getUserByHandle(handle: string) { const h = this.handles.get(handle); return h ? this.users.get(h.userId) ?? null : null; }
  async upsertUser(u: Partial<User> & { id: string }) {
    const cur = this.users.get(u.id) ?? { id: u.id, riskLimits: DEFAULT_RISK_LIMITS, createdAt: new Date().toISOString() };
    const next = { ...cur, ...u } as User; this.users.set(u.id, next); return next;
  }
  async updateRiskLimits(userId: string, limits: RiskLimits) { const u = this.users.get(userId); if (u) u.riskLimits = limits; }
  async linkHandle(userId: string, handle: string, chatGuid?: string) { this.handles.set(handle, { userId, chatGuid }); const u = this.users.get(userId); if (u) u.imessageHandle = handle; }
  async getChatGuid(userId: string) { for (const h of this.handles.values()) if (h.userId === userId) return h.chatGuid ?? null; return null; }
  async listUsersWithHandles() { return [...this.users.values()].filter((u) => u.imessageHandle); }
  async listTheses(userId: string) { return [...this.theses.values()].filter((t) => t.userId === userId && t.active); }
  async upsertThesis(t: UserThesis) { this.theses.set(t.id, t); }
  async getExchangeConnection(userId: string) { return this.connections.get(userId) ?? null; }
  async saveExchangeConnection(c: ExchangeConnection & { encryptedCredentials?: string | null }) { this.connections.set(c.userId, c); }
  async upsertMarket(m: Market) { this.markets.set(m.id, m); }
  async getMarket(id: string) { return this.markets.get(id) ?? null; }
  async saveQuote(q: MarketQuote) { this.quotes.push(q); }
  async saveReport(r: ResearchReport) { this.reports.set(r.id, r); }
  async getReport(id: string) { return this.reports.get(id) ?? null; }
  async saveProposal(p: TradeProposal) { this.proposals.set(p.id, p); }
  async getProposal(id: string) { return this.proposals.get(id) ?? null; }
  async listProposals(userId: string, status?: TradeProposal["status"][]) { return [...this.proposals.values()].filter((p) => p.userId === userId && (!status || status.includes(p.status))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async saveApproval(a: Approval) { this.approvals.push(a); }
  async getApprovalForProposal(proposalId: string, version: number) { return this.approvals.find((a) => a.proposalId === proposalId && a.proposalVersion === version) ?? null; }
  async saveOrder(o: Order) { this.orders.set(o.id, o); }
  async getOrderByApproval(approvalId: string) { return [...this.orders.values()].find((o) => o.approvalId === approvalId) ?? null; }
  async listOrders(userId: string) { return [...this.orders.values()].filter((o) => o.userId === userId); }
  async listPositions(userId: string) { return [...this.positions.values()].filter((p) => p.userId === userId); }
  async upsertPosition(p: Position) { this.positions.set(p.id, p); }
  async getPosition(id: string) { return this.positions.get(id) ?? null; }
  async saveMonitorEvent(e: MonitorEvent) { this.monitorEvents.push(e); }
  async listMonitorEvents(userId: string, limit = 50) { return this.monitorEvents.filter((e) => e.userId === userId).slice(-limit).reverse(); }
  async audit(e: Omit<AuditEvent, "id" | "createdAt">) { this.audits.push({ ...e, id: newId(), createdAt: new Date().toISOString() }); }
  async listAudit(userId: string, limit = 100) { return this.audits.filter((a) => a.userId === userId).slice(-limit).reverse(); }
  async saveMessage(m: Message) { this.messages.push(m); }
  async listMessages(userId: string, limit = 50) { return this.messages.filter((m) => m.userId === userId).slice(-limit); }
  async hasMessage(externalId: string) { return this.messages.some((m) => m.externalId === externalId); }
}
