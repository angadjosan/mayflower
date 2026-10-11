/**
 * Supabase implementation of Repo. Row ↔ domain mapping is explicit per table
 * so schema drift surfaces here, not deep in agents.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Approval, AuditEvent, ExchangeConnection, Market, MarketQuote, Message, MonitorEvent, Order, Position, ResearchReport, RiskLimits, TradeProposal, User, UserThesis } from "@mayflower/shared";
import { DEFAULT_RISK_LIMITS, RiskLimits as RiskLimitsSchema } from "@mayflower/shared";
import type { Repo } from "./repo.js";

type Row = Record<string, unknown>;
const snake = (s: string) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const toRow = (o: object): Row => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [snake(k), v]));
const fromRow = <T>(r: Row): T => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v])) as T;

function must<T>(res: { data: T | null; error: { message: string } | null }, ctx: string): T {
  if (res.error) throw new Error(`[supabase] ${ctx}: ${res.error.message}`);
  return res.data as T;
}

export class SupabaseRepo implements Repo {
  constructor(private db: SupabaseClient) {}

  private userFromRow(r: Row): User {
    return { id: r.id as string, email: (r.email as string | null) ?? null, displayName: (r.display_name as string | null) ?? null, imessageHandle: (r.imessage_handle as string | null) ?? null, riskLimits: RiskLimitsSchema.catch(DEFAULT_RISK_LIMITS).parse(r.risk_limits ?? {}), createdAt: r.created_at as string };
  }
  async getUser(id: string) { const r = must(await this.db.from("profiles").select("*").eq("id", id).maybeSingle(), "getUser"); return r ? this.userFromRow(r) : null; }
  async getUserByHandle(handle: string) {
    const link = must(await this.db.from("imessage_identities").select("user_id").eq("handle", handle).maybeSingle(), "getUserByHandle") as Row | null;
    return link ? this.getUser(link.user_id as string) : null;
  }
  async upsertUser(u: Partial<User> & { id: string }) {
    const row: Row = { id: u.id };
    if (u.email !== undefined) row.email = u.email;
    if (u.displayName !== undefined) row.display_name = u.displayName;
    if (u.imessageHandle !== undefined) row.imessage_handle = u.imessageHandle;
    if (u.riskLimits !== undefined) row.risk_limits = u.riskLimits;
    must(await this.db.from("profiles").upsert(row), "upsertUser");
    return (await this.getUser(u.id))!;
  }
  async updateRiskLimits(userId: string, limits: RiskLimits) { must(await this.db.from("profiles").update({ risk_limits: limits }).eq("id", userId), "updateRiskLimits"); }
  async linkHandle(userId: string, handle: string, chatGuid?: string) {
    must(await this.db.from("imessage_identities").upsert({ handle, user_id: userId, chat_guid: chatGuid ?? null }), "linkHandle");
    must(await this.db.from("profiles").update({ imessage_handle: handle }).eq("id", userId), "linkHandle.profile");
  }
  async getChatGuid(userId: string) { const r = must(await this.db.from("imessage_identities").select("chat_guid").eq("user_id", userId).maybeSingle(), "getChatGuid") as Row | null; return (r?.chat_guid as string | null) ?? null; }
  async listUsersWithHandles() { return must(await this.db.from("profiles").select("*").not("imessage_handle", "is", null), "listUsersWithHandles").map((r: Row) => this.userFromRow(r)); }

  async listTheses(userId: string) { return must(await this.db.from("user_theses").select("*").eq("user_id", userId).eq("active", true), "listTheses").map((r: Row) => fromRow<UserThesis>(r)); }
  async upsertThesis(t: UserThesis) { must(await this.db.from("user_theses").upsert(toRow(t)), "upsertThesis"); }

  async getExchangeConnection(userId: string) {
    const r = must(await this.db.from("exchange_connections").select("*").eq("user_id", userId).eq("status", "active").order("linked_at", { ascending: false }).limit(1).maybeSingle(), "getExchangeConnection");
    return r ? fromRow<ExchangeConnection & { encryptedCredentials?: string | null }>(r) : null;
  }
  async saveExchangeConnection(c: ExchangeConnection & { encryptedCredentials?: string | null }) { must(await this.db.from("exchange_connections").upsert(toRow(c)), "saveExchangeConnection"); }

  async upsertMarket(m: Market) { const { raw, ...rest } = m; must(await this.db.from("markets").upsert({ ...toRow(rest), raw: raw ?? null }), "upsertMarket"); }
  async getMarket(id: string) { const r = must(await this.db.from("markets").select("*").eq("id", id).maybeSingle(), "getMarket"); return r ? fromRow<Market>(r) : null; }
  async saveQuote(q: MarketQuote) { must(await this.db.from("market_quotes").insert({ market_id: q.marketId, ts: q.timestamp, yes_bid: q.yesBid, yes_ask: q.yesAsk, last: q.last ?? null, liquidity: q.liquidity ?? null }), "saveQuote"); }

  async saveReport(r: ResearchReport) { must(await this.db.from("research_reports").upsert(toRow(r)), "saveReport"); }
  async getReport(id: string) { const r = must(await this.db.from("research_reports").select("*").eq("id", id).maybeSingle(), "getReport"); return r ? fromRow<ResearchReport>(r) : null; }

  async saveProposal(p: TradeProposal) { must(await this.db.from("trade_proposals").upsert(toRow(p)), "saveProposal"); }
  async getProposal(id: string) { const r = must(await this.db.from("trade_proposals").select("*").eq("id", id).maybeSingle(), "getProposal"); return r ? fromRow<TradeProposal>(r) : null; }
  async listProposals(userId: string, status?: TradeProposal["status"][]) {
    let q = this.db.from("trade_proposals").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (status) q = q.in("status", status);
    return must(await q, "listProposals").map((r: Row) => fromRow<TradeProposal>(r));
  }

  async saveApproval(a: Approval) { must(await this.db.from("approvals").insert(toRow(a)), "saveApproval"); }
  async getApprovalForProposal(proposalId: string, version: number) { const r = must(await this.db.from("approvals").select("*").eq("proposal_id", proposalId).eq("proposal_version", version).maybeSingle(), "getApprovalForProposal"); return r ? fromRow<Approval>(r) : null; }
  async saveOrder(o: Order) { const { raw, ...rest } = o; must(await this.db.from("orders").upsert({ ...toRow(rest), raw: raw ?? null }), "saveOrder"); }
  async getOrderByApproval(approvalId: string) { const r = must(await this.db.from("orders").select("*").eq("approval_id", approvalId).maybeSingle(), "getOrderByApproval"); return r ? fromRow<Order>(r) : null; }
  async listOrders(userId: string) { return must(await this.db.from("orders").select("*").eq("user_id", userId).order("updated_at", { ascending: false }), "listOrders").map((r: Row) => fromRow<Order>(r)); }

  async listPositions(userId: string) { return must(await this.db.from("positions").select("*").eq("user_id", userId), "listPositions").map((r: Row) => fromRow<Position>(r)); }
  async upsertPosition(p: Position) { must(await this.db.from("positions").upsert(toRow(p)), "upsertPosition"); }
  async getPosition(id: string) { const r = must(await this.db.from("positions").select("*").eq("id", id).maybeSingle(), "getPosition"); return r ? fromRow<Position>(r) : null; }

  async saveMonitorEvent(e: MonitorEvent) { must(await this.db.from("monitor_events").insert(toRow(e)), "saveMonitorEvent"); }
  async listMonitorEvents(userId: string, limit = 50) { return must(await this.db.from("monitor_events").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit), "listMonitorEvents").map((r: Row) => fromRow<MonitorEvent>(r)); }
  async audit(e: Omit<AuditEvent, "id" | "createdAt">) { must(await this.db.from("audit_events").insert(toRow(e)), "audit"); }
  async listAudit(userId: string, limit = 100) { return must(await this.db.from("audit_events").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit), "listAudit").map((r: Row) => fromRow<AuditEvent>(r)); }
  async saveMessage(m: Message) { must(await this.db.from("messages").upsert(toRow(m), { onConflict: "external_id", ignoreDuplicates: true }), "saveMessage"); }
  async listMessages(userId: string, limit = 50) { return must(await this.db.from("messages").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit), "listMessages").map((r: Row) => fromRow<Message>(r)).reverse(); }
  async hasMessage(externalId: string) { const r = must(await this.db.from("messages").select("id").eq("external_id", externalId).maybeSingle(), "hasMessage"); return Boolean(r); }
}
