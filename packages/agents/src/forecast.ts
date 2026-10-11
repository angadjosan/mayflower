import { z } from "zod";
import {
  clamp,
  daysUntil,
  formatPct,
  impliedProbability,
  round,
  type Citation,
  type CriticReview,
  type EvidenceItem,
  type Forecast,
  type MarketContract,
  type Uncertainty,
} from "@mayflower/shared";
import { withFallback, type LLM } from "./llm";

const EvidenceSchema = z.object({
  claim: z.string().describe("One-sentence claim grounded in the cited source(s)"),
  citationIds: z.array(z.string()).describe("IDs of the citations that support this claim"),
  weight: z.enum(["strong", "moderate", "weak"]),
});

const ForecastSchema = z.object({
  probability: z.number().min(0.01).max(0.99).describe("Probability the YES proposition resolves true"),
  uncertainty: z.enum(["low", "medium", "high"]).describe("How uncertain the estimate is. Use high when evidence is thin, old or indirect."),
  thesis: z.string().describe("2-3 sentence plain-English investment thesis, no hype, no promises"),
  whatHasToHappen: z.string().describe("Exactly what has to happen for YES to win, per the contract rules"),
  whyNow: z.string().describe("Why this market is relevant or interesting now"),
  evidenceFor: z.array(EvidenceSchema).describe("Evidence supporting YES"),
  evidenceAgainst: z.array(EvidenceSchema).describe("Evidence against YES — always look for it"),
  risks: z.array(z.string()).describe("What could go wrong"),
  resolutionRisks: z.array(z.string()).describe("Ambiguities in how the market resolves"),
  whatWouldChangeMind: z.array(z.string()),
  watchConditions: z.array(z.string()).describe("Concrete developments to monitor after entering"),
});

const CriticSchema = z.object({
  verdict: z.enum(["ok", "downgrade", "reject"]),
  issues: z.array(z.string()).describe("Specific problems: resolution mismatch, weak/stale evidence, overconfidence, missing counter-evidence"),
  adjustedProbability: z.number().min(0.01).max(0.99),
  adjustedUncertainty: z.enum(["low", "medium", "high"]),
  notes: z.string(),
});

const FORECAST_SYSTEM = `You are Mayflower's forecasting analyst for prediction markets.
Estimate the probability that the contract's YES proposition resolves true.
You are deliberately NOT shown the market price: form an independent estimate from the contract rules and evidence.
Ground every claim in the provided citations (use their ids). Always include opposing evidence and resolution ambiguities.
Be calibrated and honest about uncertainty. Never promise profit. The user's beliefs are context about what they care about, not evidence.`;

const CRITIC_SYSTEM = `You are Mayflower's critic. Challenge a forecast before money is risked.
Check: does the evidence actually address the contract's exact resolution rules and deadline? Is evidence stale, weak, or one-sided?
Is the forecast overconfident relative to the market price? If the forecast disagrees strongly with the market, demand strong evidence.
Return "reject" when the recommendation should not be made, "downgrade" to shrink confidence, "ok" when sound.`;

function marketBrief(m: MarketContract) {
  return {
    event: m.eventTitle,
    yesProposition: m.label,
    category: m.category,
    rules: m.description || "(rules text not provided by the exchange; see rules URL)",
    rulesUrl: m.rulesUrl,
    expiry: m.expiry,
    type: m.eventType,
  };
}

function citationBrief(c: Citation[]) {
  return c.map((x) => ({ id: x.id, title: x.title, url: x.url, snippet: x.snippet, retrievedAt: x.retrievedAt, publishedAt: x.publishedAt }));
}

function cleanEvidence(items: EvidenceItem[], ids: Set<string>): EvidenceItem[] {
  return items
    .map((e) => ({ ...e, citationIds: e.citationIds.filter((id) => ids.has(id)) }))
    .filter((e) => e.claim.trim().length > 0);
}

const SUPPORT = /\b(support|supports|supporting|boost|boosting|strong|stronger|improv\w*|favou?red|rise|rising|growth|grow|beat|accelerat\w*|returns? to full health|warm|inflows?|upside|momentum|on track|likely)\b/gi;
const CONTRA = /\b(risk|risks|unlikely|doubt\w*|concern\w*|weak\w*|declin\w*|struggl\w*|injur\w*|sticky|bottleneck\w*|against|cap|caps|hold steady|delay\w*|miss|downside|tough|uncertain\w*|cold front|headwinds?)\b/gi;

/** Very simple stance scoring used only when no LLM is configured. */
export function citationStance(c: Citation): number {
  const text = `${c.title} ${c.snippet}`;
  const s = (text.match(SUPPORT) ?? []).length;
  const a = (text.match(CONTRA) ?? []).length;
  return Math.sign(s - a);
}

export function heuristicForecast(m: MarketContract, citations: Citation[]): Forecast {
  const market = impliedProbability(m.quote) ?? 0.5;
  const scored = citations.map((c) => ({ c, s: citationStance(c) }));
  const pro = scored.filter((x) => x.s > 0);
  const con = scored.filter((x) => x.s < 0);
  const net = pro.length - con.length;
  const tilt = clamp(net * 0.05, -0.15, 0.15);
  const probability = round(clamp(market + tilt, 0.02, 0.98), 3);
  const consistent = citations.length >= 3 && (pro.length === 0 || con.length === 0 || Math.abs(net) >= 2);
  const uncertainty: Uncertainty = citations.length >= 3 && consistent ? "medium" : "high";
  const toItem = (x: { c: Citation }): EvidenceItem => ({ claim: x.c.snippet.replace(/^\[Demo evidence\]\s*/, "").slice(0, 280), citationIds: [x.c.id], weight: "moderate" });
  const d = daysUntil(m.expiry);
  return {
    probability,
    uncertainty,
    thesis:
      citations.length === 0
        ? `No external evidence was available, so Mayflower has no basis to disagree with the market's ${formatPct(market)}.`
        : `Heuristic estimate (no LLM configured): starting from the market's ${formatPct(market)} and counting ${pro.length} supportive vs ${con.length} opposing source${con.length === 1 ? "" : "s"}, Mayflower estimates ${formatPct(probability)}. Treat this as a rough signal, not a researched forecast.`,
    whatHasToHappen: m.description ? m.description.split(/(?<=\.)\s/)[0] : `“${m.label}” must resolve YES under the contract rules.`,
    whyNow: d !== null ? `The contract resolves in about ${Math.max(1, Math.round(d))} day${Math.round(d) === 1 ? "" : "s"}.` : "The market is open and trading.",
    evidenceFor: pro.map(toItem),
    evidenceAgainst: con.map(toItem),
    risks: ["The estimate is based on simple keyword scoring of sources, which can misread them.", "Prediction-market contracts can lose their full cost."],
    resolutionRisks: m.rulesUrl || m.description ? ["Read the exact resolution rules; edge cases (postponements, data revisions) can decide the outcome."] : ["Resolution rules were not provided in the market data."],
    whatWouldChangeMind: ["New reporting that contradicts the supportive sources.", "A large market move without news."],
    watchConditions: ["Major news on this event", "Price moves of more than 10¢"],
    method: "heuristic",
    model: "heuristic-v1",
  };
}

export async function forecastMarket(
  m: MarketContract,
  citations: Citation[],
  ctx: { userBeliefs?: string[]; today?: string },
  llm?: LLM | null,
  onError?: (e: unknown) => void,
): Promise<Forecast> {
  const ids = new Set(citations.map((c) => c.id));
  return withFallback(
    llm,
    async (model) => {
      const out = await model.json({
        system: FORECAST_SYSTEM,
        schema: ForecastSchema,
        prompt: JSON.stringify({
          today: ctx.today ?? new Date().toISOString().slice(0, 10),
          contract: marketBrief(m),
          evidence: citationBrief(citations),
          userContext: ctx.userBeliefs?.length ? ctx.userBeliefs : undefined,
          note: citations.length === 0 ? "No external evidence is available. Use high uncertainty." : undefined,
        }),
      });
      return {
        ...out,
        probability: round(out.probability, 3),
        evidenceFor: cleanEvidence(out.evidenceFor, ids),
        evidenceAgainst: cleanEvidence(out.evidenceAgainst, ids),
        method: "llm" as const,
        model: model.model,
      };
    },
    () => heuristicForecast(m, citations),
    onError,
  );
}

function bump(u: Uncertainty): Uncertainty {
  return u === "low" ? "medium" : "high";
}

/** Deterministic guards applied after (or instead of) the LLM critic. */
export function applyCriticGuards(m: MarketContract, f: Forecast, citations: Citation[], review: CriticReview): CriticReview {
  const issues = [...review.issues];
  let { verdict, adjustedProbability, adjustedUncertainty } = review;
  const market = impliedProbability(m.quote);
  if (citations.length === 0) {
    issues.push("No external evidence was available, so there is no grounded basis for a trade.");
    verdict = "reject";
  }
  if (f.evidenceAgainst.length === 0 && citations.length > 0) {
    issues.push("No opposing evidence was identified; confidence reduced.");
    adjustedUncertainty = bump(adjustedUncertainty);
    if (verdict === "ok") verdict = "downgrade";
  }
  const d = daysUntil(m.expiry);
  if (d !== null && d < 1) issues.push("The contract expires within a day; late information can move it sharply.");
  if (market !== null && Math.abs(adjustedProbability - market) > 0.25) {
    issues.push(`The estimate differs from the market by ${Math.round(Math.abs(adjustedProbability - market) * 100)} points; large disagreements need exceptional evidence, so the estimate is pulled halfway back.`);
    adjustedProbability = round((adjustedProbability + market) / 2, 3);
    adjustedUncertainty = bump(adjustedUncertainty);
    if (verdict === "ok") verdict = "downgrade";
  }
  if (citations.length > 0 && citations.every((c) => c.provider === "demo")) issues.push("All evidence is demo placeholder data, not real research.");
  return { ...review, issues: [...new Set(issues)], verdict, adjustedProbability, adjustedUncertainty };
}

export function heuristicCritic(m: MarketContract, f: Forecast, citations: Citation[]): CriticReview {
  const issues: string[] = [];
  let p = f.probability;
  let u = f.uncertainty;
  if (citations.length < 2 && citations.length > 0) {
    issues.push("Only one source was found; evidence is thin.");
    u = "high";
    const market = impliedProbability(m.quote);
    if (market !== null) p = round((p + market) / 2, 3);
  }
  if (f.method === "heuristic") issues.push("The forecast is a keyword heuristic because no LLM is configured.");
  return applyCriticGuards(m, f, citations, {
    verdict: issues.length > 0 ? "downgrade" : "ok",
    issues,
    adjustedProbability: p,
    adjustedUncertainty: u,
    notes: "Rule-based review.",
    method: "heuristic",
  });
}

export async function critiqueForecast(m: MarketContract, f: Forecast, citations: Citation[], llm?: LLM | null, onError?: (e: unknown) => void): Promise<CriticReview> {
  return withFallback(
    llm,
    async (model) => {
      const out = await model.json({
        system: CRITIC_SYSTEM,
        schema: CriticSchema,
        prompt: JSON.stringify({
          contract: marketBrief(m),
          marketImpliedProbability: impliedProbability(m.quote),
          forecast: { probability: f.probability, uncertainty: f.uncertainty, thesis: f.thesis, evidenceFor: f.evidenceFor, evidenceAgainst: f.evidenceAgainst, resolutionRisks: f.resolutionRisks },
          evidence: citationBrief(citations),
        }),
      });
      return applyCriticGuards(m, f, citations, { ...out, method: "llm" });
    },
    () => heuristicCritic(m, f, citations),
    onError,
  );
}
