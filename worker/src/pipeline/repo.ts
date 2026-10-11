// Small data-access helpers shared by the pipeline steps.
import { createHash, randomInt } from 'node:crypto';
import type { Db } from '../db/index.js';
import type { ProfilePatch, UserProfile } from '../core/types.js';

export const DEFAULT_BUDGET = 200;
export const DEFAULT_CAP = 20;
export const MAX_BUDGET = 1000;
export const MAX_CAP = 100;

interface UserRow {
  phone: string; name: string | null; risk_budget: number; per_trade_cap: number;
  interests: string[]; excluded_topics: string[]; onboarded: boolean;
}

const toProfile = (r: UserRow): UserProfile => ({
  phone: r.phone, name: r.name, riskBudget: Number(r.risk_budget), perTradeCap: Number(r.per_trade_cap),
  interests: r.interests ?? [], excludedTopics: r.excluded_topics ?? [], onboarded: r.onboarded,
});

export async function getOrCreateUser(db: Db, phone: string): Promise<UserProfile> {
  await db.query('insert into users (phone, risk_budget, per_trade_cap) values ($1, $2, $3) on conflict (phone) do nothing', [phone, DEFAULT_BUDGET, DEFAULT_CAP]);
  const [row] = await db.query<UserRow>('select * from users where phone = $1', [phone]);
  return toProfile(row);
}

export async function updateUser(db: Db, phone: string, p: ProfilePatch, onboarded = true): Promise<UserProfile> {
  const [row] = await db.query<UserRow>(
    `update users set
       name = coalesce($2, name),
       risk_budget = coalesce($3, risk_budget),
       per_trade_cap = coalesce($4, per_trade_cap),
       interests = coalesce($5, interests),
       excluded_topics = coalesce($6, excluded_topics),
       onboarded = onboarded or $7
     where phone = $1 returning *`,
    [phone, p.name ?? null, clampMoney(p.riskBudget, MAX_BUDGET), clampMoney(p.perTradeCap, MAX_CAP), p.interests ?? null, p.excludedTopics ?? null, onboarded],
  );
  return toProfile(row);
}

const clampMoney = (x: number | undefined, max: number) => (x == null || !Number.isFinite(x) || x <= 0 ? null : Math.min(x, max));

/** Returns false when this external message id was already processed (webhook retry / duplicate). */
export async function logMessage(db: Db, m: { phone: string; direction: 'in' | 'out'; channel: string; body: string; hasAudio?: boolean; externalId?: string | null }): Promise<boolean> {
  const rows = await db.query(
    `insert into messages (user_phone, direction, channel, body, has_audio, external_id)
     values ($1,$2,$3,$4,$5,$6) on conflict (external_id) do nothing returning id`,
    [m.phone, m.direction, m.channel, m.body, m.hasAudio ?? false, m.externalId ?? null],
  );
  return rows.length > 0;
}

export async function audit(db: Db, actor: string, action: string, refId: string | null, payload: unknown): Promise<void> {
  const json = JSON.stringify(payload ?? null);
  await db.query('insert into audit (actor, action, ref_id, payload, payload_hash) values ($1,$2,$3,$4,$5)',
    [actor, action, refId, json, createHash('sha256').update(json).digest('hex')]);
}

export async function openExposure(db: Db, phone: string, eventTicker: string): Promise<{ total: number; correlated: boolean }> {
  const rows = await db.query<{ cost_basis: number; event_ticker: string | null }>(
    `select p.cost_basis, m.event_ticker from positions p left join markets m on m.instrument_symbol = p.instrument_symbol
     where p.user_phone = $1 and p.status = 'open'`, [phone]);
  const [{ reserved }] = await db.query<{ reserved: number }>(
    `select coalesce(sum(greatest(pr.stake - coalesce(o.filled_qty * o.avg_price, 0), 0)), 0)::float as reserved from proposals pr left join orders o on o.proposal_id = pr.id
     where pr.user_phone = $1 and (pr.status = 'approved' or (pr.status = 'executed' and o.status in ('submitting','open','partially_filled','unknown')))`, [phone]);
  return {
    total: rows.reduce((s, r) => s + Number(r.cost_basis), 0) + Number(reserved),
    correlated: rows.some((r) => r.event_ticker === eventTicker),
  };
}

export function newApprovalCode(): string {
  return String(randomInt(1000, 10000));
}

export function maskPhone(p: string): string {
  return p.length <= 4 ? '••••' : `••• ${p.slice(-4)}`;
}
