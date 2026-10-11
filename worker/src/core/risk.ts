// The deterministic half of Mayflower: the LLM proposes a probability, this
// file decides the verdict, side and size. Nothing here calls a model, so
// limits cannot be argued past.
import type { Quote, Side, VerdictType } from './types.js';

export interface RiskParams {
  safetyMargin: number;   // 0.05 = 5 points on top of the spread
  kellyFraction: number;  // 0.25 = quarter-Kelly
  wMin: number;
  wMax: number;
  feePerContract?: number;
}

export interface EvidenceSummary {
  sourceCount: number;
  distinctDomains: number;
  recentCount: number;     // sources published or retrieved within 48h
  criticSeverity: 'none' | 'minor' | 'major';
  staleEvidence: boolean;
}

export interface RiskInput {
  pModelYes: number;
  quote: Quote;
  beliefSide: Side;
  evidence: EvidenceSummary;
  riskBudget: number;
  perTradeCap: number;
  openExposure: number;     // sum of stakes already at risk
  correlatedOpen: boolean;  // an open position depends on the same event
  balance: number | null;   // real exchange / ledger balance, null = unknown
  priceIncrement: number;
  quantityMinimum: number;
  quantityIncrement: number;
}

export interface RiskDecision {
  verdict: Exclude<VerdictType, 'no_market'>;
  side: Side | null;        // side to trade, null = no trade
  w: number;
  pMarketYes: number;
  pFinalYes: number;
  price: number | null;     // executable ask for the traded side
  spread: number | null;
  edge: number | null;      // p_side - price for the evaluated side
  threshold: number | null;
  kellyF: number | null;
  rawStake: number;
  stake: number;
  qty: number;
  maxLoss: number;
  capsApplied: string[];
  exitRules: { priceFloor: number } | null;
  reasons: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, step: number) => Math.round(x / step) * step;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Shrink weight: 0.2 for thin evidence up to 0.6 for strong, recent, multi-source evidence. */
export function evidenceWeight(e: EvidenceSummary, p: Pick<RiskParams, 'wMin' | 'wMax'>): number {
  if (e.sourceCount === 0 || e.criticSeverity === 'major') return p.wMin;
  const breadth = Math.min(1, (e.distinctDomains - 1) / 3);   // 4+ domains = full credit
  const recency = e.recentCount / e.sourceCount;
  let w = p.wMin + (p.wMax - p.wMin) * (0.5 * breadth + 0.5 * recency);
  if (e.criticSeverity === 'minor') w -= 0.1;
  if (e.staleEvidence) w -= 0.1;
  return r4(clamp(w, p.wMin, p.wMax));
}

export function marketProbYes(q: Quote): number | null {
  if (q.yesBid != null && q.yesAsk != null) return (q.yesBid + q.yesAsk) / 2;
  if (q.yesAsk != null) return q.yesAsk;
  if (q.noAsk != null) return 1 - q.noAsk;
  return null;
}

function sideBook(q: Quote, s: Side) {
  const ask = s === 'yes' ? q.yesAsk : q.noAsk;
  const bid = s === 'yes' ? q.yesBid : q.noBid;
  return { ask, spread: ask != null && bid != null ? Math.max(0, ask - bid) : null };
}

export function decide(input: RiskInput, params: RiskParams): RiskDecision {
  const reasons: string[] = [];
  const pMarketYes = marketProbYes(input.quote);
  if (pMarketYes == null) throw new Error(`no executable price for ${input.quote.symbol}`);

  const w = evidenceWeight(input.evidence, params);
  const pModel = Number.isFinite(input.pModelYes) ? clamp(input.pModelYes, 0.01, 0.99) : pMarketYes;
  const pFinalYes = r4(w * pModel + (1 - w) * pMarketYes);
  const fee = params.feePerContract ?? 0;

  const evalSide = (s: Side) => {
    const { ask, spread } = sideBook(input.quote, s);
    const p = s === 'yes' ? pFinalYes : 1 - pFinalYes;
    if (ask == null) return null;
    // a missing bid means we cannot see the spread; charge the worst case
    const sp = spread ?? Math.max(params.safetyMargin, 0.1);
    return { side: s, p, ask, spread: sp, edge: r4(p - ask), threshold: r4(sp + params.safetyMargin + fee) };
  };

  const belief = evalSide(input.beliefSide);
  const other = evalSide(input.beliefSide === 'yes' ? 'no' : 'yes');
  const base = { w, pMarketYes: r4(pMarketYes), pFinalYes, rawStake: 0, stake: 0, qty: 0, maxLoss: 0, capsApplied: [] as string[], exitRules: null, kellyF: null };

  let verdict: RiskDecision['verdict'];
  let pick: NonNullable<ReturnType<typeof evalSide>> | null = null;
  if (belief && belief.edge > belief.threshold) {
    verdict = 'edge'; pick = belief;
  } else if (belief && belief.edge < -belief.threshold) {
    verdict = 'against';
    if (other && other.edge > other.threshold) { pick = other; reasons.push('evidence favors the other side by more than the bar'); }
  } else {
    verdict = 'priced_in';
  }

  const shown = pick ?? belief;
  if (!pick) {
    return { ...base, verdict, side: null, price: shown?.ask ?? null, spread: shown?.spread ?? null, edge: shown?.edge ?? null, threshold: shown?.threshold ?? null, reasons };
  }

  const kellyF = (pick.p - pick.ask) / (1 - pick.ask);
  const rawStake = params.kellyFraction * kellyF * input.riskBudget;
  const capsApplied: string[] = [];
  let stake = rawStake;
  const remaining = Math.max(0, input.riskBudget - input.openExposure);
  if (stake > input.perTradeCap) { stake = input.perTradeCap; capsApplied.push('per_trade_cap'); }
  if (stake > remaining) { stake = remaining; capsApplied.push('remaining_budget'); }
  if (input.balance != null && stake > input.balance) { stake = input.balance; capsApplied.push('balance'); }
  if (input.correlatedOpen) { stake /= 2; capsApplied.push('correlated_halved'); }

  const limitPrice = r4(Math.min(0.99, round(pick.ask, input.priceIncrement)));
  const step = input.quantityIncrement > 0 ? input.quantityIncrement : 1;
  const qty = r4(Math.floor(stake / limitPrice / step) * step);
  if (qty < input.quantityMinimum || qty <= 0) {
    reasons.push('edge exists but the allowed stake is below the minimum order');
    return { ...base, verdict, side: null, price: limitPrice, spread: pick.spread, edge: pick.edge, threshold: pick.threshold, kellyF: r4(kellyF), rawStake: r4(rawStake), capsApplied, reasons };
  }
  const finalStake = r4(qty * limitPrice);
  return {
    ...base, verdict, side: pick.side, price: limitPrice, spread: pick.spread, edge: pick.edge, threshold: pick.threshold,
    kellyF: r4(kellyF), rawStake: r4(rawStake), stake: finalStake, qty, maxLoss: finalStake, capsApplied,
    exitRules: { priceFloor: r4(Math.max(input.priceIncrement, round(limitPrice * 0.7, input.priceIncrement))) },
    reasons,
  };
}
