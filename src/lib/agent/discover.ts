// Discovery -> research -> forecast + critic -> deterministic sizing -> pending proposal.
import crypto from "crypto";
import { tx, load, id, now, audit } from "../db";
import { generateJSON } from "../llm";
import { listMarkets, getBalance, exchangeMode } from "../exchange";
import { searchEvidence } from "../research";
import { approvalUrl } from "../execution";
import { sizePosition } from "../risk";
import { KNOWN_TOPICS } from "./profile";
import type { Market, ResearchReport, TradeProposal, UserThesis, Citation, Side } from "../types";

const mid = (m: Market) => {
  if (m.yesBid != null && m.yesAsk != null) return (m.yesBid + m.yesAsk) / 2;
  return m.lastPrice ?? m.yesAsk ?? 0.5;
};
const yesAsk = (m: Market) => m.yesAsk ?? m.lastPrice ?? 0.5;
const noAsk = (m: Market) => m.noAsk ?? (m.yesBid != null ? 1 - m.yesBid : 1 - (m.lastPrice ?? 0.5));
const pct = (n: number) => `${Math.round(n * 100)}%`;
const marketText = (m: Market) => `${m.eventTitle} ${m.title} ${m.category ?? ""}`.toLowerCase();

function keywordsFor(raw: string): string[] {
  const topic = raw.replace(/[^\w\s]/g, " ").trim();
  const known = Object.entries(KNOWN_TOPICS).find(([t]) => t.toLowerCase() === topic.toLowerCase());
  const words = topic.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  return [...new Set([...(known ? known[1] : []), ...words])];
}
export function matchesTopic(m: Market, topic: string) {
  const txt = marketText(m);
  return keywordsFor(topic).some((k) => txt.includes(k));
}

function hashTweak(s: string) {
  const h = crypto.createHash("md5").update(s).digest();
  return ((h[0] / 255) - 0.5) * 0.24; // -12..+12 points
}

const FORECAST_SYSTEM = `You are Mayflower's forecasting agent for binary prediction markets. Estimate the probability the market resolves YES independently of the market price, using only the cited evidence and general knowledge. Be calibrated and honest about uncertainty. Never promise profit. Return ONLY JSON.`;

interface ForecastJSON {
  summary: string;
  evidenceFor: { point: string; citationIndex?: number }[];
  evidenceAgainst: { point: string; citationIndex?: number }[];
  estimatedProbability: number;
  uncertainty: "low" | "medium" | "high";
  whatWouldChangeMind: string;
}

/** Research + forecast + critic for one market; saves the ResearchReport. */
export async function researchAndForecast(market: Market, userId?: string): Promise<ResearchReport> {
  // Search for supporting and contradicting coverage in parallel so the forecaster sees both sides.
  const q = `${market.eventTitle} ${market.title}`.slice(0, 180);
  const [general, counter] = await Promise.all([
    searchEvidence(q, 4).catch(() => null),
    searchEvidence(`${q} risks OR doubts OR unlikely`, 3).catch(() => null),
  ]);
  const seenUrls = new Set<string>();
  const citations: Citation[] = [...(general?.citations ?? []), ...(counter?.citations ?? [])]
    .filter((c) => !seenUrls.has(c.url) && seenUrls.add(c.url))
    .slice(0, 6);
  const source: ResearchReport["source"] = general?.source === "context.dev" || counter?.source === "context.dev" ? "context.dev" : "mock";

  const m = mid(market);
  let report: Omit<ResearchReport, "id" | "createdAt">;
  try {
    const f = await generateJSON<ForecastJSON>(
      `Market: ${market.eventTitle} — ${market.title}
Rules: ${market.rules ?? "n/a"}
Expires: ${market.expiresAt ?? "unknown"}
Current YES price (for reference only): ${m.toFixed(2)}
Evidence (index: title — snippet — date):
${citations.map((c, i) => `${i}: ${c.title} — ${c.snippet ?? ""} — ${c.publishedAt ?? ""}`).join("\n") || "(none found)"}

Return JSON {summary (2 sentences), evidenceFor:[{point,citationIndex}], evidenceAgainst:[{point,citationIndex}], estimatedProbability (P(YES) 0..1), uncertainty ("low"|"medium"|"high"), whatWouldChangeMind}.`,
      FORECAST_SYSTEM,
    );
    let p = clamp(Number(f.estimatedProbability));
    let uncertainty = (["low", "medium", "high"].includes(f.uncertainty) ? f.uncertainty : "medium") as ResearchReport["uncertainty"];
    let criticNotes: string | undefined;
    try {
      const c = await generateJSON<{ notes: string; adjustedProbability: number; uncertainty?: string }>(
        `Market: ${market.eventTitle} — ${market.title}
Rules: ${market.rules ?? "n/a"}
Market YES price: ${m.toFixed(2)}
Forecast: P(YES)=${p.toFixed(2)}, uncertainty ${uncertainty}. Summary: ${f.summary}
Evidence for: ${JSON.stringify(f.evidenceFor)}
Evidence against: ${JSON.stringify(f.evidenceAgainst)}
Number of sources: ${citations.length}

As a critic, challenge this: resolution-rule ambiguity or mismatch, weak/stale/missing evidence, overconfidence. If warranted, shrink the probability toward the market price. Return JSON {notes (<=2 sentences), adjustedProbability, uncertainty}.`,
        "You are a skeptical critic reviewing a prediction-market forecast. Return ONLY JSON.",
        { fast: true },
      );
      if (c?.notes) criticNotes = c.notes;
      if (isFinite(Number(c?.adjustedProbability))) p = clamp(Number(c.adjustedProbability));
      if (c?.uncertainty && ["low", "medium", "high"].includes(c.uncertainty)) uncertainty = c.uncertainty as ResearchReport["uncertainty"];
    } catch { /* critic optional */ }
    const cite = (i?: number) => (i != null && citations[i] ? citations[i] : undefined);
    report = {
      marketId: market.id, summary: f.summary ?? "",
      evidenceFor: (f.evidenceFor ?? []).map((e) => ({ point: e.point, citation: cite(e.citationIndex) })),
      evidenceAgainst: (f.evidenceAgainst ?? []).map((e) => ({ point: e.point, citation: cite(e.citationIndex) })),
      citations, estimatedProbability: p, uncertainty, criticNotes,
      whatWouldChangeMind: f.whatWouldChangeMind, source,
    };
  } catch {
    // Heuristic fallback: no LLM. Stay close to the market with a small deterministic tweak.
    const p = clamp(m + hashTweak(market.id + new Date().toISOString().slice(0, 10)));
    const half = Math.ceil(citations.length / 2);
    report = {
      marketId: market.id,
      summary: `Heuristic estimate (no AI forecaster configured): starting from the market's ${pct(m)} and adjusting slightly. Treat as low-confidence.`,
      evidenceFor: citations.slice(0, half).map((c) => ({ point: c.title, citation: c })),
      evidenceAgainst: citations.slice(half).map((c) => ({ point: c.title, citation: c })),
      citations, estimatedProbability: p, uncertainty: "high",
      criticNotes: "No AI critic available; evidence was not weighed. Check the resolution rules yourself.",
      whatWouldChangeMind: "Fresh news directly affecting the outcome, or a sharp price move.",
      source,
    };
  }
  const saved: ResearchReport = { ...report, id: id("res_"), createdAt: now() };
  tx((db) => { db.research.push(saved); });
  audit({ userId, actor: "agent", action: "research.create", ref: saved.id, detail: { marketId: market.id, p: saved.estimatedProbability, source } });
  return saved;
}

function clamp(p: number) {
  if (!isFinite(p)) return 0.5;
  return Math.min(0.99, Math.max(0.01, p));
}

async function rankPersonalized(markets: Market[], theses: UserThesis[]): Promise<Market[]> {
  if (!theses.length) return [];
  const candidates = markets.slice(0, 60);
  try {
    const r = await generateJSON<{ ids: string[] }>(
      `User interests/beliefs:\n${theses.map((t) => `- ${t.topic}: ${t.belief || "(interested)"}`).join("\n")}
Markets:\n${candidates.map((m) => `${m.id} | ${m.eventTitle} — ${m.title}`).join("\n")}
Return JSON {ids: [up to 4 market ids most relevant to the user's interests, best first]}. Only include genuinely related markets.`,
      "You match users to relevant prediction markets. Return ONLY JSON.",
      { fast: true },
    );
    const out = (r.ids ?? []).map((i) => candidates.find((m) => m.id === i)).filter(Boolean) as Market[];
    if (out.length) return out;
  } catch { /* fall through */ }
  const scored = candidates
    .map((m) => ({ m, s: theses.reduce((s, t) => s + (matchesTopic(m, t.topic) ? 1 + t.confidence : 0), 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.m.volume ?? 0) - (a.m.volume ?? 0));
  return scored.map((x) => x.m);
}

export async function discover(userId: string, opts?: { focus?: string; max?: number }): Promise<TradeProposal[]> {
  const max = opts?.max ?? 3;
  const db0 = load();
  const user = db0.users.find((u) => u.id === userId);
  if (!user) return [];
  const theses = db0.theses.filter((t) => t.userId === userId);

  let markets = (await listMarkets()).filter((m) => m.status === "open" || m.status === "unknown");
  markets = markets.filter((m) => !user.limits.excludedTopics.some((t) => matchesTopic(m, t)));
  // Skip markets with a pending proposal or open position already.
  const busy = new Set([
    ...db0.proposals.filter((p) => p.userId === userId && p.status === "pending").map((p) => p.marketId),
    ...db0.positions.filter((p) => p.userId === userId && p.status === "open").map((p) => p.marketId),
  ]);
  markets = markets.filter((m) => !busy.has(m.id));

  const picks: { market: Market; discovery: "personalized" | "general" }[] = [];
  if (opts?.focus) {
    const focus = opts.focus.toLowerCase();
    const outside = focus.match(/(?:outside|other than|besides|not|except)\s+(.+)/)?.[1];
    let pool = markets;
    if (outside) pool = markets.filter((m) => !matchesTopic(m, outside));
    else {
      const f = pool.filter((m) => matchesTopic(m, focus));
      if (f.length) pool = f;
    }
    pool = [...pool].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    for (const m of pool.slice(0, max)) picks.push({ market: m, discovery: outside ? "general" : "personalized" });
  } else {
    const personal = (await rankPersonalized(markets, theses)).slice(0, Math.min(2, max));
    for (const m of personal) picks.push({ market: m, discovery: "personalized" });
    const general = markets
      .filter((m) => !personal.includes(m))
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, Math.max(1, max - personal.length));
    for (const m of general) picks.push({ market: m, discovery: "general" });
  }

  let availableUsd = Infinity;
  try { availableUsd = (await getBalance()).availableUsd; } catch { /* unknown balance: rely on Mayflower limits */ }

  // Research every pick in parallel (the slow part); sizing below stays sequential so pending exposure adds up.
  const chosen = picks.slice(0, max);
  const reports = await Promise.all(chosen.map(({ market }) => researchAndForecast(market, userId)));

  const created: TradeProposal[] = [];
  for (const [i, { market, discovery }] of chosen.entries()) {
    const r = reports[i];
    const pYes = r.estimatedProbability;
    const ya = yesAsk(market), na = noAsk(market);
    const side: Side = pYes - ya >= (1 - pYes) - na ? "YES" : "NO";
    const price = side === "YES" ? ya : na;
    const pSide = side === "YES" ? pYes : 1 - pYes;

    const db = load();
    const openPositions = db.positions.filter((p) => p.userId === userId && p.status === "open");
    const topics = theses.filter((t) => matchesTopic(market, t.topic)).map((t) => t.topic);
    const relatedExposureUsd = openPositions
      .filter((p) => topics.some((t) => matchesTopic(p.market, t)) || (market.eventId && p.market.eventId === market.eventId))
      .reduce((s, p) => s + p.costBasisUsd, 0);
    const pendingUsd = db.proposals.filter((p) => p.userId === userId && p.status === "pending").reduce((s, p) => s + p.costUsd, 0)
      + created.reduce((s, p) => s + p.costUsd, 0);

    const size = sizePosition({
      estimatedProbability: pSide, price, uncertainty: r.uncertainty, user,
      openPositions, availableUsd: Math.max(0, availableUsd - pendingUsd), relatedExposureUsd,
    });

    if (size.blockedReason) {
      audit({ userId, actor: "agent", action: "discover.no_trade", ref: r.id, detail: { marketId: market.id, reason: size.blockedReason } });
      continue;
    }

    const thesisTopic = topics[0];
    const proposal: TradeProposal = {
      id: id("prop_"), userId, marketId: market.id, market, researchId: r.id,
      kind: "open", discovery, side, quantity: size.quantity, limitPrice: price, costUsd: size.costUsd,
      marketProbability: price, estimatedProbability: pSide, edge: +(pSide - price).toFixed(4),
      thesis: (thesisTopic ? `Related to your interest in ${thesisTopic}. ` : "") + r.summary,
      sizingExplanation: size.explanation,
      riskNotes: [r.criticNotes, `Max loss $${size.costUsd.toFixed(2)} if ${side} loses.`, market.source === "mock" ? "Mock market data." : ""].filter(Boolean).join(" "),
      status: "pending", approvalToken: crypto.randomBytes(16).toString("hex"),
      createdAt: now(), expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), version: 1,
    };
    tx((d) => { d.proposals.push(proposal); });
    audit({ userId, actor: "agent", action: "proposal.create", ref: proposal.id, detail: { marketId: market.id, side, quantity: proposal.quantity, costUsd: proposal.costUsd, discovery } });
    created.push(proposal);
  }
  return created;
}

export function formatProposal(p: TradeProposal, r?: ResearchReport): string {
  const m = p.market;
  const buying = p.kind === "open" || p.kind === "hedge";
  const label = p.kind === "open" ? "Idea" : p.kind === "hedge" ? "Hedge idea (partial, not guaranteed)" : p.kind === "close" ? "Suggest closing" : "Suggest reducing";
  const tag = p.discovery === "personalized" ? " (matches your interests)" : p.discovery === "general" ? " (broader market)" : "";
  const mock = (m.source === "mock" ? " (mock data)" : "") + (String(exchangeMode) === "simulated" ? " (simulated)" : "");
  const why = (r?.summary || p.thesis).split(/(?<=\.)\s/).slice(0, 2).join(" ");
  const lines = [
    `${label}${tag}${mock}: ${m.eventTitle}${m.title && m.title !== m.eventTitle ? ` — ${m.title}` : ""}`,
    `${buying ? "Buy" : "Sell"} ${p.side} @ $${p.limitPrice.toFixed(2)}: market implies ${pct(p.marketProbability)} for ${p.side}, my estimate ${pct(p.estimatedProbability)}${r ? ` (${r.uncertainty} uncertainty)` : ""}.`,
    buying
      ? `Suggested risk: $${p.costUsd.toFixed(2)} (${p.quantity} contracts) — that's the max you'd lose.`
      : `${p.quantity} contracts, about $${p.costUsd.toFixed(2)} at current price.`,
    `Why: ${why}`,
    `Review & approve: ${approvalUrl(p)}`,
  ];
  return lines.join("\n");
}
