// Belief → market match → research → forecast → critic → risk engine → verdict (+ proposal on edge).
import { config } from '../config.js';
import type { App } from '../app.js';
import { decide, marketProbYes, type EvidenceSummary, type RiskDecision } from '../core/risk.js';
import type { Market, ResearchBundle, Side, UserProfile, VerdictType } from '../core/types.js';
import { audit, newApprovalCode, openExposure } from './repo.js';

export interface VerdictOutcome {
  verdictId: string;
  type: VerdictType;
  text: string;          // iMessage reply
  speech: string;        // shorter line for the voice note
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number) => `$${x.toFixed(2).replace(/\.00$/, '')}`;
const MATCH_MIN_CONFIDENCE = 0.5;

export async function runVerdict(app: App, user: UserProfile, belief: string, source: 'text' | 'voice'): Promise<VerdictOutcome> {
  const { db, catalog, brain } = app;
  const [{ id: beliefId }] = await db.query<{ id: string }>(
    'insert into beliefs (user_phone, text, source) values ($1,$2,$3) returning id', [user.phone, belief, source]);

  const excluded = user.excludedTopics.map((t) => t.toLowerCase());
  const candidates = (await catalog.search(belief, 8))
    .filter((c) => !excluded.some((t) => `${c.market.title} ${c.market.category}`.toLowerCase().includes(t)));
  const match = candidates.length ? await brain.match(belief, candidates) : null;

  if (!match || match.confidence < MATCH_MIN_CONFIDENCE) {
    const proxy = candidates[0]?.market;
    const text = proxy
      ? `No Gemini market expresses that exactly. Closest thing listed: "${proxy.title}". Nothing to trade on your exact claim.`
      : `No Gemini market expresses that, so there's nothing to trade. Try sports, crypto, politics or the weather.`;
    const verdictId = await saveVerdict(app, user, beliefId, null, null, 'no_market', text, { candidates: candidates.map((c) => c.market.symbol) });
    return { verdictId, type: 'no_market', text: withLink(text, verdictId), speech: text };
  }

  const market = match.market;
  const quote = await catalog.quote(market.symbol);
  if (!quote || marketProbYes(quote) == null) {
    const text = `"${market.title}" is listed but has no live price right now, so I can't judge it.`;
    const verdictId = await saveVerdict(app, user, beliefId, market, null, 'no_market', text, { reason: 'no_quote' });
    return { verdictId, type: 'no_market', text: withLink(text, verdictId), speech: text };
  }

  const bundle = await brain.research(belief, market);
  const forecast = await brain.forecast(market, bundle);
  const critique = await brain.critique(market, belief, bundle, forecast);

  let pModelYes = forecast.pYes;
  if (!Number.isFinite(pModelYes) && app.llmMode === 'fake') {
    // dev-only knob so the edge path can be exercised without an LLM key
    pModelYes = (marketProbYes(quote) ?? 0.5) + Number(process.env.FAKE_FORECAST_DELTA ?? 0);
  }

  if (critique.resolutionMismatch) {
    const text = `"${market.title}" is the closest market, but it doesn't settle on what you said (${critique.notes[0] ?? 'resolution rules differ'}). No trade.`;
    const researchId = await saveResearch(app, beliefId, market, bundle, pModelYes, null, critique);
    const verdictId = await saveVerdict(app, user, beliefId, market, researchId, 'no_market', text, { reason: 'resolution_mismatch' });
    return { verdictId, type: 'no_market', text: withLink(text, verdictId), speech: text };
  }

  const exposure = await openExposure(db, user.phone, market.eventTicker);
  const decision = decide({
    pModelYes, quote, beliefSide: match.beliefSide, evidence: summarize(bundle, critique),
    riskBudget: user.riskBudget, perTradeCap: user.perTradeCap, openExposure: exposure.total,
    correlatedOpen: exposure.correlated, balance: null,
    priceIncrement: market.priceIncrement || 0.01, quantityMinimum: market.quantityMinimum || 1,
    quantityIncrement: market.quantityIncrement || 1,
  }, config.risk);

  const researchId = await saveResearch(app, beliefId, market, bundle, pModelYes, decision, critique);
  const realOrder = market.sandboxListed && app.executor.mode === 'sandbox';
  const text0 = describe(market, match.beliefSide, decision, user, null, realOrder);
  const verdictId = await saveVerdict(app, user, beliefId, market, researchId, decision.verdict, text0, { ...decision, quote, beliefSide: match.beliefSide, forecastReasoning: forecast.reasoning });

  let code: string | null = null;
  if (decision.side && decision.qty > 0) code = await createProposal(app, user, verdictId, market, decision);
  const text = describe(market, match.beliefSide, decision, user, code, realOrder);
  return { verdictId, type: decision.verdict, text: withLink(text, verdictId), speech: text.split('. ').slice(0, 3).join('. ') };
}

function summarize(bundle: ResearchBundle, critique: { severity: 'none' | 'minor' | 'major'; staleEvidence: boolean }): EvidenceSummary {
  const hosts = new Set<string>();
  let recent = 0;
  for (const s of bundle.sources) {
    try { hosts.add(new URL(s.url).hostname.replace(/^www\./, '')); } catch { /* ignore bad url */ }
    // only a real publish date counts as recent; our own retrievedAt says nothing about freshness
    if (s.publishedAt && Date.now() - Date.parse(s.publishedAt) < 48 * 3600e3) recent++;
  }
  return { sourceCount: bundle.sources.length, distinctDomains: hosts.size, recentCount: recent, criticSeverity: critique.severity, staleEvidence: critique.staleEvidence };
}

function describe(m: Market, beliefSide: Side, d: RiskDecision, user: UserProfile, code: string | null, realOrder: boolean): string {
  const mkt = beliefSide === 'yes' ? d.pMarketYes : 1 - d.pMarketYes;
  const mine = beliefSide === 'yes' ? d.pFinalYes : 1 - d.pFinalYes;
  const venue = realOrder ? ' (Gemini sandbox order)' : ' (SIMULATED: no real order will be placed)';
  if (d.verdict === 'priced_in') {
    const lead = mine >= 0.5 ? 'Probably true, still a bad bet.' : 'Priced in.';
    return `${lead} Gemini has "${m.title}" at ${pct(mkt)}. The evidence puts me at ${pct(mine)}. No edge after the spread, so I'd pass.`;
  }
  if (d.verdict === 'against' && !d.side) {
    return `The evidence points the other way. Gemini has "${m.title}" at ${pct(mkt)}, I'm at ${pct(mine)}. No trade.`;
  }
  if (!d.side || !d.price) {
    return `There's an edge on "${m.title}" (${pct(mkt)} vs my ${pct(mine)}), but your remaining budget is too small to size a trade.`;
  }
  const pSide = d.side === 'yes' ? d.pFinalYes : 1 - d.pFinalYes;
  const lead = d.verdict === 'against'
    ? `You're probably wrong, and the other side is the bet: ${d.side.toUpperCase()} on "${m.title}"`
    : `Edge: ${d.side.toUpperCase()} on "${m.title}"`;
  const exit = d.exitRules ? `, exit if it drops below ${pct(d.exitRules.priceFloor)}` : '';
  const approve = code ? ` Reply APPROVE ${code} to place it (valid ${config.risk.proposalTtlMinutes} min).` : '';
  return `${lead} at ${pct(d.price)}, my estimate ${pct(pSide)}. Risk ${usd(d.stake)} of your ${usd(user.riskBudget)}, max loss ${usd(d.maxLoss)}${exit}.${approve}${venue}`;
}

const withLink = (text: string, verdictId: string) => `${text}\n${config.dashboardUrl}/case/${verdictId}`;

async function saveResearch(app: App, beliefId: string, m: Market, b: ResearchBundle, pModel: number, d: RiskDecision | null, critic: unknown): Promise<string> {
  const [{ id }] = await app.db.query<{ id: string }>(
    `insert into research (instrument_symbol, belief_id, queries, sources, for_points, against_points, p_model, p_market, p_final, w, critic)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [m.symbol, beliefId, b.queries, JSON.stringify(b.sources), JSON.stringify(b.forPoints), JSON.stringify(b.againstPoints),
      Number.isFinite(pModel) ? pModel : null, d?.pMarketYes ?? null, d?.pFinalYes ?? null, d?.w ?? null, JSON.stringify(critic)],
  );
  return id;
}

async function saveVerdict(app: App, user: UserProfile, beliefId: string, m: Market | null, researchId: string | null, type: VerdictType, reasoning: string, numbers: unknown): Promise<string> {
  const [{ id }] = await app.db.query<{ id: string }>(
    `insert into verdicts (user_phone, belief_id, instrument_symbol, research_id, type, reasoning, numbers)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [user.phone, beliefId, m?.symbol ?? null, researchId, type, reasoning, JSON.stringify(numbers)],
  );
  await audit(app.db, 'agent', 'verdict', id, { type, symbol: m?.symbol ?? null });
  return id;
}

async function createProposal(app: App, user: UserProfile, verdictId: string, m: Market, d: RiskDecision): Promise<string> {
  const expires = new Date(Date.now() + config.risk.proposalTtlMinutes * 60e3).toISOString();
  // supersede older pending proposals so only the newest code is live
  await app.db.query(`update proposals set status = 'cancelled' where user_phone = $1 and status = 'pending'`, [user.phone]);
  const recent = new Set((await app.db.query<{ code: string }>(
    `select code from proposals where user_phone = $1 and created_at > now() - interval '24 hours'`, [user.phone])).map((r) => r.code));
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = newApprovalCode();
    for (let i = 0; recent.has(code) && i < 50; i++) code = newApprovalCode();
    if (recent.has(code)) continue;
    try {
      const [{ id }] = await app.db.query<{ id: string }>(
        `insert into proposals (user_phone, verdict_id, instrument_symbol, side, qty, limit_price, stake, max_loss, exit_rules, code, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [user.phone, verdictId, m.symbol, d.side, d.qty, d.price, d.stake, d.maxLoss, JSON.stringify(d.exitRules ?? {}), code, expires],
      );
      await audit(app.db, 'agent', 'proposal', id, { code, symbol: m.symbol, side: d.side, qty: d.qty, limit: d.price });
      return code;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
  throw new Error('unreachable');
}
