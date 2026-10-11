import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, evidenceWeight, type RiskInput } from './risk.js';

const params = { safetyMargin: 0.05, kellyFraction: 0.25, wMin: 0.2, wMax: 0.6 };
const strong = { sourceCount: 5, distinctDomains: 4, recentCount: 5, criticSeverity: 'none' as const, staleEvidence: false };

function input(over: Partial<RiskInput> = {}): RiskInput {
  return {
    pModelYes: 0.5,
    quote: { symbol: 'X', yesBid: 0.3, yesAsk: 0.31, noBid: 0.69, noAsk: 0.7, ts: '' },
    beliefSide: 'yes', evidence: strong, riskBudget: 200, perTradeCap: 20, openExposure: 0,
    correlatedOpen: false, balance: null, priceIncrement: 0.01, quantityMinimum: 1, quantityIncrement: 1,
    ...over,
  };
}

test('weight is 0.2 with no evidence and 0.6 with strong evidence', () => {
  assert.equal(evidenceWeight({ ...strong, sourceCount: 0 }, params), 0.2);
  assert.equal(evidenceWeight(strong, params), 0.6);
  assert.equal(evidenceWeight({ ...strong, criticSeverity: 'major' }, params), 0.2);
});

test('priced in when the estimate sits inside the threshold (Chiefs example)', () => {
  const d = decide(input({ pModelYes: 0.76, quote: { symbol: 'X', yesBid: 0.77, yesAsk: 0.79, noBid: 0.21, noAsk: 0.23, ts: '' } }), params);
  assert.equal(d.verdict, 'priced_in');
  assert.equal(d.side, null);
  assert.equal(d.stake, 0);
});

test('edge sizes quarter-Kelly and respects the per-trade cap', () => {
  const d = decide(input({ pModelYes: 0.75, perTradeCap: 10 }), params);
  // pFinal = 0.6*0.75 + 0.4*0.305 = 0.572; edge 0.262 > 0.06; raw quarter-Kelly ≈ $18.98
  assert.equal(d.verdict, 'edge');
  assert.equal(d.side, 'yes');
  assert.ok(d.rawStake > 10);
  assert.ok(d.stake <= 10);
  assert.ok(d.capsApplied.includes('per_trade_cap'));
  assert.equal(d.maxLoss, d.stake);
  assert.equal(d.qty, Math.floor(10 / 0.31));
});

test('LLM cannot push past the remaining budget or the balance', () => {
  const d = decide(input({ pModelYes: 0.99, perTradeCap: 1000, openExposure: 195, balance: 3 }), params);
  assert.ok(d.stake <= 3);
  assert.ok(d.capsApplied.includes('balance'));
});

test('against you, with the other side traded only if it clears the bar', () => {
  const d = decide(input({ pModelYes: 0.02, quote: { symbol: 'X', yesBid: 0.6, yesAsk: 0.61, noBid: 0.39, noAsk: 0.4, ts: '' } }), params);
  assert.equal(d.verdict, 'against');
  assert.equal(d.side, 'no');
  const weak = decide(input({ pModelYes: 0.4, evidence: { ...strong, sourceCount: 0 }, quote: { symbol: 'X', yesBid: 0.6, yesAsk: 0.61, noBid: 0.39, noAsk: 0.4, ts: '' } }), params);
  assert.notEqual(weak.side, 'no');
});

test('correlated open position halves the stake', () => {
  const a = decide(input({ pModelYes: 0.6, perTradeCap: 1000 }), params);
  const b = decide(input({ pModelYes: 0.6, perTradeCap: 1000, correlatedOpen: true }), params);
  assert.ok(b.stake <= a.stake / 2 + 0.31);
});

test('missing model forecast falls back to the market price, so no edge', () => {
  const d = decide(input({ pModelYes: NaN }), params);
  assert.equal(d.verdict, 'priced_in');
});

test('a zero ask is treated as no price, never an infinite order', () => {
  const d = decide(input({ pModelYes: 0.9, quote: { symbol: 'X', yesBid: 0, yesAsk: 0, noBid: 0.99, noAsk: 1, ts: '' } }), params);
  assert.equal(d.side, null);
  assert.ok(Number.isFinite(d.qty) && Number.isFinite(d.stake));
});
