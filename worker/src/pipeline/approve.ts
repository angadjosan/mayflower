// APPROVE <code> → atomic claim of the exact proposal → executor → order + position.
// The claim is a single conditional UPDATE, so one code can place at most one order.
import type { App } from '../app.js';
import type { Executor } from '../core/ports.js';
import type { OrderResult, Side } from '../core/types.js';
import { audit } from './repo.js';

export const APPROVE_RE = /^\s*approve\s+(\d{4})\s*[.!]?\s*$/i;

interface ProposalRow { id: string; instrument_symbol: string; side: Side; qty: number; limit_price: number; stake: number; verdict_id: string | null }

export async function approve(app: App, phone: string, code: string): Promise<string> {
  const [p] = await app.db.query<ProposalRow>(
    `update proposals set status = 'approved'
     where user_phone = $1 and code = $2 and status = 'pending' and expires_at > now()
     returning id, instrument_symbol, side, qty, limit_price, stake, verdict_id`,
    [phone, code],
  );
  if (!p) {
    await app.db.query(`update proposals set status = 'expired' where user_phone = $1 and status = 'pending' and expires_at <= now()`, [phone]);
    return `Code ${code} isn't valid or has expired. Ask me again and I'll re-check the price.`;
  }
  await audit(app.db, phone, 'approve', p.id, { code, symbol: p.instrument_symbol, side: p.side, qty: p.qty, limit: p.limit_price });

  const market = await app.catalog.get(p.instrument_symbol);
  if (!market) return fail(app, p.id, 'market no longer listed');
  if (market.status === 'closed') return fail(app, p.id, 'the market has closed');
  // the code is valid for 10 minutes; make sure the approved price is still there before sending
  const q = await app.catalog.quote(market.symbol);
  const ask = q ? (p.side === 'yes' ? q.yesAsk : q.noAsk) : null;
  if (ask == null) return fail(app, p.id, 'no live price right now');
  if (ask > Number(p.limit_price) + 1e-9) return fail(app, p.id, `the price moved from ${pct(p.limit_price)} to ${pct(ask)}; text me again for a fresh look`);
  const executor: Executor = market.sandboxListed && app.executor.mode === 'sandbox' ? app.executor : app.sim;
  const req = { proposalId: p.id, symbol: p.instrument_symbol, side: p.side, qty: Number(p.qty), limitPrice: Number(p.limit_price), clientOrderId: p.id };

  await app.db.query(`insert into orders (proposal_id, submitted_terms, status, sim_flag) values ($1,$2,'submitting',$3)`,
    [p.id, JSON.stringify(req), executor.mode === 'simulated']);

  let result: OrderResult;
  try {
    result = await executor.place(req, market);
  } catch (e) {
    const reason = (e as Error).message;
    await app.db.query(`update orders set status = 'unknown', error = $2, updated_at = now() where proposal_id = $1`, [p.id, reason]);
    await app.db.query(`update proposals set status = 'executed' where id = $1`, [p.id]);
    await audit(app.db, 'executor', 'order_unknown', p.id, { reason });
    return `I sent the order but couldn't confirm what happened (${reason}). Don't re-approve; check the case page for the real status.`;
  }

  await app.db.query(
    `update orders set exchange_order_id = $2, status = $3, filled_qty = $4, avg_price = $5, error = $6, sim_flag = $7, raw = $8, updated_at = now()
     where proposal_id = $1`,
    [p.id, result.exchangeOrderId, result.status, result.filledQty, result.avgPrice, result.error, result.simulated, JSON.stringify(result.raw ?? null)],
  );
  await app.db.query(`update proposals set status = $2 where id = $1`, [p.id, result.status === 'rejected' ? 'failed' : 'executed']);
  await audit(app.db, 'executor', 'order', p.id, { status: result.status, filled: result.filledQty, simulated: result.simulated });

  if (result.filledQty > 0 && result.avgPrice != null) {
    await app.db.query(
      `insert into positions (user_phone, instrument_symbol, side, qty, cost_basis, mark, sim_flag)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (user_phone, instrument_symbol, side, sim_flag) do update set
         qty = positions.qty + excluded.qty, cost_basis = positions.cost_basis + excluded.cost_basis, status = 'open'`,
      [phone, p.instrument_symbol, p.side, result.filledQty, result.filledQty * result.avgPrice, result.avgPrice, result.simulated],
    );
  }

  const label = result.simulated ? ' (SIMULATED, no real order was placed)' : ' (Gemini sandbox)';
  switch (result.status) {
    case 'filled': return `Filled: ${result.filledQty} ${p.side.toUpperCase()} on ${market.title} at ${pct(result.avgPrice)}${label}.`;
    case 'partially_filled': return `Partly filled: ${result.filledQty} of ${p.qty} at ${pct(result.avgPrice)}${label}. The rest is resting at ${pct(p.limit_price)}.`;
    case 'open': return `Order placed and resting at ${pct(p.limit_price)}${label}. Not filled yet; the case page shows its live status.`;
    case 'unknown': return `I sent the order but couldn't confirm its status${label}. Don't re-approve; check the case page.`;
    default: return `Gemini rejected the order: ${result.error ?? result.status}. Nothing was bought.`;
  }
}

const pct = (x: number | null) => (x == null ? '—' : `${Math.round(Number(x) * 100)}%`);

async function fail(app: App, proposalId: string, reason: string): Promise<string> {
  await app.db.query(`update proposals set status = 'failed' where id = $1`, [proposalId]);
  await app.db.query(`update orders set status = 'failed', error = $2, updated_at = now() where proposal_id = $1`, [proposalId, reason]);
  await audit(app.db, 'executor', 'order_failed', proposalId, { reason });
  return `I couldn't place that order (${reason}). Nothing was bought.`;
}
