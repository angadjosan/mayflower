import { z } from 'zod';
import type { Brain, Llm, Research } from '../core/ports.js';
import type {
  Critique, Forecast, Market, MarketCandidate, MatchResult, ProfilePatch, ResearchBundle, Source, UserProfile,
} from '../core/types.js';

const prompts = {
  extractProfile: {
    system:
      'You extract a trading-profile update from a text message. Only include fields the user actually stated. ' +
      'riskBudget is the total USD they can afford to risk; perTradeCap is the max USD per single trade. ' +
      'interests are topics they like (sports teams, politics, crypto, ...). excludedTopics are topics they refuse to bet on. ' +
      'Use null or empty values for anything not stated.',
  },
  classify: {
    system:
      'Classify an iMessage from a user of a prediction-market assistant. Labels: ' +
      '"onboarding" = the user is giving profile info (name, budget, limits, interests, exclusions) or greeting before setup; ' +
      '"belief" = an opinion or prediction about a future outcome ("Chiefs win Sunday", "Fed cuts in December"); ' +
      '"question" = asks about their positions, trades, why something happened, or what changed; ' +
      '"other" = anything else.',
  },
  match: {
    system:
      'You match a user belief to ONE real prediction-market contract. Pick a candidate only if the contract resolves YES or NO ' +
      'on exactly what the user believes (same event, same threshold, same timeframe). If the contract resolves on something ' +
      'different, even if topically close, answer index -1. beliefSide is "yes" if the belief means the contract resolves YES, ' +
      '"no" if the belief means it resolves NO. confidence is 0..1 for how exactly the contract expresses the belief.',
  },
  queries: {
    system:
      'Write 3 web search queries to research whether a prediction-market contract will resolve YES. ' +
      'Query 1: latest news and facts supporting YES. Query 2: latest news and facts supporting NO. ' +
      'Query 3 must explicitly look for counter-evidence to the user belief (injuries, delays, denials, base rates, official sources). ' +
      'Keep each under 12 words, no operators.',
  },
  stance: {
    system:
      'You are given a prediction-market contract and web sources. For each source, set stance: "for" if it supports the contract ' +
      'resolving YES, "against" if it supports NO, "neutral" if irrelevant or inconclusive. Then write forPoints (evidence for YES) ' +
      'and againstPoints (evidence for NO): each a short factual sentence ending with the source URL in parentheses. ' +
      'Use only what the sources say. Do not invent facts.',
  },
  forecast: {
    system:
      'You are a calibrated forecaster. Estimate the probability that this contract resolves YES, using ONLY the resolution rules ' +
      'and the evidence provided. Estimate independently. You are not shown any market price and must not guess or anchor on one. ' +
      'Weigh source quality and recency, consider base rates, and stay humble: avoid values below 0.03 or above 0.97 unless certain. ' +
      'Return pYes in [0,1] and brief reasoning.',
  },
  critique: {
    system:
      'You are an adversarial reviewer of a forecast for a prediction-market contract. Attack it: weak or single sources, ' +
      'evidence that does not match the contract resolution rules (resolutionMismatch), stale evidence (staleEvidence), ' +
      'ignored counter-evidence, overconfidence. severity: "none" if sound, "minor" if small concerns, "major" if the forecast ' +
      'should not be trusted. notes: short bullet strings.',
  },
  answer: {
    system:
      'You reply to a user over iMessage about their prediction-market positions. Plain text only, no markdown, max 300 characters, ' +
      'short, friendly, honest. Use only the provided context; if it does not answer the question, say so. Never promise profit. ' +
      'Remind them this is not financial advice only if they ask for a recommendation.',
  },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const profileSchema = z.object({
  name: z.string().nullable(),
  riskBudget: z.number().nullable(),
  perTradeCap: z.number().nullable(),
  interests: z.array(z.string()),
  excludedTopics: z.array(z.string()),
});
const classifySchema = z.object({ label: z.enum(['onboarding', 'belief', 'question', 'other']) });
const matchSchema = z.object({
  index: z.number().int(),
  beliefSide: z.enum(['yes', 'no']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
const queriesSchema = z.object({ queries: z.array(z.string()).min(1).max(4) });
const stanceSchema = z.object({
  stances: z.array(z.object({ index: z.number().int(), stance: z.enum(['for', 'against', 'neutral']) })),
  forPoints: z.array(z.string()),
  againstPoints: z.array(z.string()),
});
const forecastSchema = z.object({ pYes: z.number().min(0).max(1), reasoning: z.string() });
const critiqueSchema = z.object({
  severity: z.enum(['none', 'minor', 'major']),
  resolutionMismatch: z.boolean(),
  staleEvidence: z.boolean(),
  notes: z.array(z.string()),
});

const marketBlock = (m: Market) =>
  `Contract: ${m.title}\nCategory: ${m.category}\nExpiry: ${m.expiry ?? 'unknown'}\nResolution rules: ${m.rules ?? 'not provided'}`;

const bundleBlock = (b: ResearchBundle) =>
  `Evidence for YES:\n${b.forPoints.map((p) => `- ${p}`).join('\n') || '(none)'}\n\n` +
  `Evidence for NO:\n${b.againstPoints.map((p) => `- ${p}`).join('\n') || '(none)'}\n\n` +
  `Sources:\n${b.sources.map((s) => `- [${s.stance}] ${s.title} (${s.url}) retrieved ${s.retrievedAt}${s.publishedAt ? ` published ${s.publishedAt}` : ''}`).join('\n') || '(none)'}`;

function fakeExtractProfile(text: string, current: UserProfile): ProfilePatch {
  const patch: ProfilePatch = {};
  const money = text.match(/\$\s?(\d[\d,]*(?:\.\d+)?)/);
  if (money) {
    const budget = Number(money[1].replace(/,/g, ''));
    patch.riskBudget = budget;
    patch.perTradeCap = Math.min(20, budget * 0.1);
  } else if (!current.onboarded) {
    patch.perTradeCap = current.perTradeCap;
  }
  const name = text.match(/\b(?:i'?m|i am|my name is|call me)\s+([A-Za-z]+)/i);
  if (name && !/^(a|an|the|going|ready|not)$/i.test(name[1])) patch.name = name[1];
  return patch;
}

function fakeClassify(text: string, user: UserProfile): 'onboarding' | 'belief' | 'question' | 'other' {
  const t = text.toLowerCase();
  if (/\?\s*$|^(why|what|how|which|when|did|do|are|is)\b|position|portfolio|balance|what changed/.test(t) && !/\bwill\b.*\b(win|rise|fall|hit)\b/.test(t)) return 'question';
  if (!user.onboarded && /\$\s?\d|risk|budget|my name|i'?m |call me|hi\b|hello|hey\b/.test(t)) return 'onboarding';
  if (/\b(win|wins|beat|beats|cut|cuts|rise|rises|fall|falls|above|below|over|under|hit|hits|pass|passes|will|going to|gonna|by)\b/.test(t)) return 'belief';
  if (!user.onboarded) return 'onboarding';
  return 'other';
}

export function createBrain(llm: Llm, research: Research): Brain {
  const fake = llm.mode === 'fake';

  return {
    async extractProfile(text, current) {
      if (fake) return fakeExtractProfile(text, current);
      const r = await llm.json({
        system: prompts.extractProfile.system,
        prompt: `Current profile: ${JSON.stringify({ name: current.name, riskBudget: current.riskBudget, perTradeCap: current.perTradeCap })}\nMessage: ${text}`,
        schema: profileSchema,
        fast: true,
      });
      const patch: ProfilePatch = {};
      if (r.name) patch.name = r.name;
      if (r.riskBudget != null && r.riskBudget > 0) {
        patch.riskBudget = r.riskBudget;
        patch.perTradeCap = r.perTradeCap != null && r.perTradeCap > 0 ? r.perTradeCap : Math.min(20, r.riskBudget * 0.1);
      } else if (r.perTradeCap != null && r.perTradeCap > 0) {
        patch.perTradeCap = r.perTradeCap;
      }
      if (r.interests.length) patch.interests = r.interests;
      if (r.excludedTopics.length) patch.excludedTopics = r.excludedTopics;
      return patch;
    },

    async classify(text, user) {
      if (fake) return fakeClassify(text, user);
      const r = await llm.json({
        system: prompts.classify.system,
        prompt: `User onboarded: ${user.onboarded}\nMessage: ${text}`,
        schema: classifySchema,
        fast: true,
      });
      return r.label;
    },

    async match(belief, candidates: MarketCandidate[]): Promise<MatchResult | null> {
      if (!candidates.length) return null;
      if (fake) {
        const top = candidates[0];
        if (top.score < 0.3) return null;
        return { market: top.market, beliefSide: 'yes', confidence: clamp(top.score, 0, 1), reasoning: 'fake mode: top keyword candidate' };
      }
      const list = candidates
        .slice(0, 12)
        .map((c, i) => `[${i}] ${c.market.title} | expiry ${c.market.expiry ?? '?'} | rules: ${(c.market.rules ?? 'n/a').slice(0, 300)}`)
        .join('\n');
      const r = await llm.json({
        system: prompts.match.system,
        prompt: `User belief: "${belief}"\n\nCandidates:\n${list}\n\nReturn index of the matching candidate, or -1 for none.`,
        schema: matchSchema,
      });
      const picked = candidates[r.index];
      if (r.index < 0 || !picked) return null;
      return { market: picked.market, beliefSide: r.beliefSide, confidence: r.confidence, reasoning: r.reasoning };
    },

    async research(belief, market): Promise<ResearchBundle> {
      const empty: ResearchBundle = { queries: [], sources: [], forPoints: [], againstPoints: [] };
      if (fake || research.mode === 'none') return empty;
      const q = await llm.json({
        system: prompts.queries.system,
        prompt: `${marketBlock(market)}\nUser belief: "${belief}"`,
        schema: queriesSchema,
        fast: true,
      });
      const queries = q.queries.slice(0, 3);
      const seen = new Map<string, Source>();
      for (const query of queries) {
        try {
          for (const s of await research.search(query, { freshness: 'week', limit: 5 })) {
            if (!seen.has(s.url)) seen.set(s.url, s);
          }
        } catch {
          continue;
        }
      }
      const sources = [...seen.values()].slice(0, 12);
      if (!sources.length) return { ...empty, queries };
      const listing = sources.map((s, i) => `[${i}] ${s.title} (${s.url})\n${s.snippet}`).join('\n\n');
      const r = await llm.json({
        system: prompts.stance.system,
        prompt: `${marketBlock(market)}\n\nSources:\n${listing}`,
        schema: stanceSchema,
      });
      for (const st of r.stances) if (sources[st.index]) sources[st.index] = { ...sources[st.index], stance: st.stance };
      return { queries, sources, forPoints: r.forPoints, againstPoints: r.againstPoints };
    },

    // Fake mode returns pYes NaN on purpose: the pipeline substitutes the live market price plus the
    // FAKE_FORECAST_DELTA env var (dev-only knob) so the full loop can be exercised without an LLM.
    async forecast(market, bundle): Promise<Forecast> {
      if (fake) return { pYes: NaN, reasoning: 'fake' };
      const r = await llm.json({
        system: prompts.forecast.system,
        prompt: `${marketBlock(market)}\n\n${bundleBlock(bundle)}`,
        schema: forecastSchema,
      });
      return { pYes: clamp(r.pYes, 0.01, 0.99), reasoning: r.reasoning };
    },

    async critique(market, belief, bundle, forecast): Promise<Critique> {
      if (fake) return { severity: 'none', resolutionMismatch: false, staleEvidence: false, notes: [] };
      return llm.json({
        system: prompts.critique.system,
        prompt: `${marketBlock(market)}\nUser belief: "${belief}"\n\n${bundleBlock(bundle)}\n\nForecast: P(YES)=${forecast.pYes}\nReasoning: ${forecast.reasoning}`,
        schema: critiqueSchema,
      });
    },

    async answer(question, context) {
      if (fake) return `[dev mode, no LLM] ${context}`.slice(0, 320);
      const r = await llm.json({
        system: prompts.answer.system,
        prompt: `Context:\n${context}\n\nQuestion: ${question}`,
        schema: z.object({ reply: z.string() }),
        fast: true,
      });
      const text = r.reply.replace(/[*_#`]/g, '').trim();
      return text.length > 320 ? text.slice(0, 317) + '...' : text;
    },
  };
}
