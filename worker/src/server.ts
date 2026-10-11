// HTTP surface: BlueBubbles webhook, dev message endpoint, read-only dashboard API.
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import type { App } from './app.js';
import type { CaseResponse, OverviewResponse, PositionRow, ProposalRow, VerdictRow } from './core/api.js';
import type { VerdictType } from './core/types.js';
import { parseBlueBubblesWebhook } from './messaging/bluebubbles.js';
import { ConsoleMessenger } from './messaging/console.js';
import { enqueueInbound } from './pipeline/handle.js';
import { maskPhone } from './pipeline/repo.js';

const secretOk = (given: string | undefined) => {
  const a = Buffer.from(given ?? ''); const b = Buffer.from(config.bluebubbles.webhookSecret);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createServer(app: App): Hono {
  const http = new Hono();

  http.get('/health', async (c) => c.json(await app.modes()));

  http.post('/webhooks/bluebubbles/:secret', async (c) => {
    if (!secretOk(c.req.param('secret'))) return c.text('not found', 404);
    const body = await c.req.json().catch(() => null);
    const bb = { url: config.bluebubbles.url ?? '', password: config.bluebubbles.password ?? '' };
    // answer fast; BlueBubbles does not retry, and the pipeline can take a while
    void parseBlueBubblesWebhook(body, bb)
      .then((msg) => msg && enqueueInbound(app, msg))
      .catch((e) => console.error('[webhook]', e));
    return c.json({ ok: true });
  });

  // Dev/test entry: simulate an inbound text. Open in console mode; needs the secret once real iMessage is wired.
  http.post('/dev/message', async (c) => {
    if (app.messenger.mode !== 'console' && !secretOk(c.req.header('x-dev-secret'))) return c.text('forbidden', 403);
    const { from, text } = await c.req.json<{ from: string; text: string }>();
    if (!from || !text) return c.json({ error: 'from and text required' }, 400);
    await enqueueInbound(app, { from, text, channel: 'dev', externalId: null });
    const replies = app.messenger instanceof ConsoleMessenger ? app.messenger.drain(from).map((m) => m.text) : [];
    return c.json({ replies });
  });

  http.get('/api/overview', async (c) => c.json(await overview(app)));
  http.get('/api/cases/:id', async (c) => {
    const data = await caseFor(app, c.req.param('id'));
    return data ? c.json(data) : c.json({ error: 'not found' }, 404);
  });

  return http;
}

const VERDICT_SQL = `
  select v.id, v.user_phone, v.type, v.instrument_symbol, v.reasoning, v.created_at, v.numbers,
         b.text as belief, m.title, r.p_market, r.p_final
  from verdicts v left join beliefs b on b.id = v.belief_id
  left join markets m on m.instrument_symbol = v.instrument_symbol
  left join research r on r.id = v.research_id`;

type VerdictSqlRow = { id: string; user_phone: string; type: VerdictType; instrument_symbol: string | null; reasoning: string; created_at: string; numbers: Record<string, unknown> | null; belief: string | null; title: string | null; p_market: number | null; p_final: number | null };

const toVerdictRow = (r: VerdictSqlRow): VerdictRow => ({
  id: r.id, user: maskPhone(r.user_phone), belief: r.belief ?? '', type: r.type, symbol: r.instrument_symbol, title: r.title,
  reasoning: r.reasoning, createdAt: new Date(r.created_at).toISOString(), pMarket: r.p_market, pFinal: r.p_final,
  stake: typeof r.numbers?.stake === 'number' ? (r.numbers.stake as number) : null,
});

type ProposalSqlRow = { id: string; user_phone: string; instrument_symbol: string; title: string | null; side: 'yes' | 'no'; qty: number; limit_price: number; stake: number; max_loss: number; status: string; expires_at: string };
const toProposalRow = (r: ProposalSqlRow): ProposalRow => ({
  id: r.id, user: maskPhone(r.user_phone), symbol: r.instrument_symbol, title: r.title ?? r.instrument_symbol, side: r.side,
  qty: r.qty, limitPrice: r.limit_price, stake: r.stake, maxLoss: r.max_loss, status: r.status, expiresAt: new Date(r.expires_at).toISOString(),
});

async function overview(app: App): Promise<OverviewResponse> {
  const positions = (await app.db.query<{ id: string; user_phone: string; instrument_symbol: string; title: string | null; side: 'yes' | 'no'; qty: number; cost_basis: number; mark: number | null; unrealized_pnl: number; realized_pnl: number; sim_flag: boolean; status: string; verdict_id: string | null }>(
    `select p.*, m.title, (select pr.verdict_id from proposals pr where pr.user_phone = p.user_phone and pr.instrument_symbol = p.instrument_symbol and pr.status = 'executed' order by pr.created_at desc limit 1) as verdict_id
     from positions p left join markets m on m.instrument_symbol = p.instrument_symbol order by p.created_at desc limit 100`))
    .map((r): PositionRow => ({
      id: r.id, user: maskPhone(r.user_phone), symbol: r.instrument_symbol, title: r.title ?? r.instrument_symbol, side: r.side, qty: r.qty,
      costBasis: r.cost_basis, mark: r.mark, unrealizedPnl: r.unrealized_pnl, realizedPnl: r.realized_pnl, simulated: r.sim_flag, status: r.status, verdictId: r.verdict_id,
    }));
  const verdicts = (await app.db.query<VerdictSqlRow>(`${VERDICT_SQL} order by v.created_at desc limit 50`)).map(toVerdictRow);
  const proposals = (await app.db.query<ProposalSqlRow>(
    `select pr.*, m.title from proposals pr left join markets m on m.instrument_symbol = pr.instrument_symbol
     where pr.status = 'pending' and pr.expires_at > now() order by pr.created_at desc`)).map(toProposalRow);
  const counts = await app.db.query<{ type: VerdictType; n: number }>('select type, count(*)::int as n from verdicts group by type');
  const verdictCounts = { no_market: 0, priced_in: 0, against: 0, edge: 0 } as Record<VerdictType, number>;
  for (const r of counts) verdictCounts[r.type] = r.n;
  const open = positions.filter((p) => p.status === 'open');
  return {
    modes: await app.modes(),
    totals: {
      invested: open.reduce((s, p) => s + p.costBasis, 0),
      unrealizedPnl: open.reduce((s, p) => s + p.unrealizedPnl, 0),
      realizedPnl: positions.reduce((s, p) => s + p.realizedPnl, 0),
      openPositions: open.length,
      riskBudget: null,
    },
    positions, verdicts, proposals, verdictCounts,
  };
}

async function caseFor(app: App, id: string): Promise<CaseResponse | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [v] = await app.db.query<VerdictSqlRow & { research_id: string | null }>(`${VERDICT_SQL.replace('select v.id', 'select v.research_id, v.id')} where v.id = $1`, [id]);
  if (!v) return null;
  const [m] = v.instrument_symbol
    ? await app.db.query<{ instrument_symbol: string; title: string; category: string | null; rules: string | null; expiry: string | null; sandbox_listed: boolean }>('select * from markets where instrument_symbol = $1', [v.instrument_symbol])
    : [];
  const [r] = v.research_id
    ? await app.db.query<{ queries: string[]; sources: CaseResponse['research'] extends infer R ? R extends { sources: infer S } ? S : never : never; for_points: string[]; against_points: string[]; p_model: number | null; p_market: number | null; p_final: number | null; w: number | null; critic: { severity: string; notes: string[]; resolutionMismatch: boolean; staleEvidence: boolean } | null }>('select * from research where id = $1', [v.research_id])
    : [];
  const [p] = await app.db.query<ProposalSqlRow>(
    `select pr.*, m.title from proposals pr left join markets m on m.instrument_symbol = pr.instrument_symbol where pr.verdict_id = $1 order by pr.created_at desc limit 1`, [id]);
  const [o] = p
    ? await app.db.query<{ status: string; exchange_order_id: string | null; filled_qty: number; avg_price: number | null; sim_flag: boolean; error: string | null }>('select * from orders where proposal_id = $1', [p.id])
    : [];
  const ticks = v.instrument_symbol
    ? await app.db.query<{ ts: string; bid: number | null; ask: number | null; last: number | null }>(
      `select ts, bid, ask, last from ticks where instrument_symbol = $1 order by ts desc limit 500`, [v.instrument_symbol])
    : [];
  return {
    verdict: toVerdictRow(v),
    market: m ? { symbol: m.instrument_symbol, title: m.title, category: m.category, rules: m.rules, expiry: m.expiry ? new Date(m.expiry).toISOString() : null, sandboxListed: m.sandbox_listed } : null,
    research: r ? {
      queries: r.queries ?? [], sources: r.sources ?? [], forPoints: r.for_points ?? [], againstPoints: r.against_points ?? [],
      pModel: r.p_model, pMarket: r.p_market, pFinal: r.p_final, w: r.w, critic: r.critic,
    } : null,
    numbers: v.numbers ?? {},
    proposal: p ? toProposalRow(p) : null,
    order: o ? { status: o.status, exchangeOrderId: o.exchange_order_id, filledQty: o.filled_qty, avgPrice: o.avg_price, simulated: o.sim_flag, error: o.error } : null,
    ticks: ticks.reverse().map((t) => ({ ts: new Date(t.ts).toISOString(), bid: t.bid, ask: t.ask, last: t.last })),
  };
}
