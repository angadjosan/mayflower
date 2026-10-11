// Extracts interests, beliefs and risk limits from free text and merges them into the user profile.
import { tx, id, now, audit, type DB } from "../db";
import { generateJSON } from "../llm";
import type { RiskLimits } from "../types";

interface Extracted {
  name?: string;
  interests?: string[];
  beliefs?: { topic: string; belief: string; confidence?: number }[];
  budgetUsd?: number;
  maxPerTradeUsd?: number;
  maxTotalExposureUsd?: number;
  riskStyle?: RiskLimits["riskStyle"];
  excludedTopics?: string[];
  removeTopics?: string[];
}

export const KNOWN_TOPICS: Record<string, string[]> = {
  "AI": ["ai", "artificial intelligence", "openai", "nvidia", "llm", "gpt", "anthropic"],
  "Crypto": ["crypto", "bitcoin", "btc", "ethereum", "eth", "solana"],
  "Sports": ["sports", "nfl", "nba", "mlb", "football", "basketball", "baseball", "soccer"],
  "Seahawks": ["seahawks", "seattle"],
  "Politics": ["politic", "election", "president", "congress", "senate", "trump", "democrat", "republican"],
  "Economy": ["economy", "fed", "inflation", "interest rate", "rates", "cpi", "jobs", "recession", "gdp"],
  "Tech": ["tech", "apple", "google", "microsoft", "tesla", "stock"],
  "Weather": ["weather", "hurricane", "temperature", "climate"],
  "Entertainment": ["movie", "oscar", "music", "grammy", "box office", "tv"],
};

const SYSTEM = `You extract a prediction-market user's profile from a chat message. Return ONLY JSON with optional keys:
name (string), interests (string[] short topic names), beliefs ([{topic, belief, confidence 0..1}]),
budgetUsd (number, total amount they're willing to risk), maxPerTradeUsd, maxTotalExposureUsd,
riskStyle ("conservative"|"balanced"|"aggressive"), excludedTopics (topics they want to avoid, e.g. "stop looking for political markets" -> ["Politics"]),
removeTopics (interests to drop). Omit keys not mentioned. Do not invent values.`;

function heuristic(text: string): Extracted {
  const t = text.toLowerCase();
  const out: Extracted = {};
  const money = [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi)].map((m) => parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));
  const perTrade = text.match(/\$\s?(\d[\d,]*)\s*(?:per|a|each|max(?:imum)? per)\s*(?:trade|position|bet)/i)
    || text.match(/(?:max(?:imum)?|at most|no more than)[^$]{0,20}\$\s?(\d[\d,]*)\s*(?:per|a|each)/i);
  if (perTrade) out.maxPerTradeUsd = parseFloat(perTrade[1].replace(/,/g, ""));
  const rest = money.filter((m) => m !== out.maxPerTradeUsd);
  if (rest.length) out.budgetUsd = Math.max(...rest);
  if (/conservative|careful|cautious|low risk/.test(t)) out.riskStyle = "conservative";
  else if (/aggressive|yolo|high risk/.test(t)) out.riskStyle = "aggressive";
  else if (/balanced|moderate|medium risk/.test(t)) out.riskStyle = "balanced";
  const nm = text.match(/(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+)\b/);
  if (nm && !KNOWN_TOPICS[nm[1]]) out.name = nm[1];

  const negative = /(stop|don't|do not|no more|avoid|exclude|not interested|skip|without)\b/.test(t);
  const found: string[] = [];
  for (const [topic, kws] of Object.entries(KNOWN_TOPICS)) if (kws.some((k) => new RegExp(`\\b${k}`).test(t))) found.push(topic);
  if (negative) out.excludedTopics = found;
  else if (found.length) {
    out.interests = found;
    const believes = text.match(/(?:i think|i believe|i expect|bullish on|bearish on|i bet)\s+(.+?)(?:[.!?]|$)/i);
    if (believes) out.beliefs = found.map((topic) => ({ topic, belief: believes[1].trim(), confidence: 0.6 }));
  }
  return out;
}

export async function updateProfileFromMessage(userId: string, text: string): Promise<{ changed: boolean; summary: string }> {
  let ex: Extracted;
  try {
    ex = await generateJSON<Extracted>(`Message: """${text}"""`, SYSTEM, { fast: true });
    if (!ex || typeof ex !== "object") ex = heuristic(text);
  } catch {
    ex = heuristic(text);
  }

  const result = await tx((db) => {
    const changes: string[] = []; // inside: tx callbacks may be retried
    const user = db.users.find((u) => u.id === userId);
    if (!user) return { changed: false, summary: "User not found." };
    const L = user.limits;
    const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? v : undefined);

    if (ex.name && ex.name !== user.name) { user.name = ex.name; changes.push(`name ${ex.name}`); }
    const budget = num(ex.budgetUsd);
    if (budget && budget !== L.budgetUsd) {
      L.budgetUsd = budget;
      // keep dependent limits sane unless explicitly set
      if (!num(ex.maxTotalExposureUsd)) L.maxTotalExposureUsd = Math.min(L.maxTotalExposureUsd, budget) || budget;
      if (L.maxTotalExposureUsd < budget * 0.5 && !num(ex.maxTotalExposureUsd)) L.maxTotalExposureUsd = budget;
      if (!num(ex.maxPerTradeUsd) && L.maxPerTradeUsd > budget) L.maxPerTradeUsd = Math.max(1, Math.round(budget * 0.1));
      changes.push(`budget $${budget}`);
    }
    const mpt = num(ex.maxPerTradeUsd);
    if (mpt && mpt !== L.maxPerTradeUsd) { L.maxPerTradeUsd = Math.min(mpt, L.budgetUsd); changes.push(`max per trade $${L.maxPerTradeUsd}`); }
    const mte = num(ex.maxTotalExposureUsd);
    if (mte && mte !== L.maxTotalExposureUsd) { L.maxTotalExposureUsd = Math.min(mte, L.budgetUsd); changes.push(`max total exposure $${L.maxTotalExposureUsd}`); }
    if (ex.riskStyle && ["conservative", "balanced", "aggressive"].includes(ex.riskStyle) && ex.riskStyle !== L.riskStyle) {
      L.riskStyle = ex.riskStyle; changes.push(`${ex.riskStyle} risk style`);
    }

    const lc = (s: string) => s.trim().toLowerCase();
    for (const topic of ex.excludedTopics ?? []) {
      if (!topic) continue;
      if (!L.excludedTopics.some((x) => lc(x) === lc(topic))) { L.excludedTopics.push(topic); changes.push(`excluding ${topic}`); }
      const before = db.theses.length;
      db.theses = db.theses.filter((th) => !(th.userId === userId && lc(th.topic) === lc(topic)));
      if (db.theses.length !== before) changes.push(`removed interest ${topic}`);
    }
    for (const topic of ex.removeTopics ?? []) {
      const before = db.theses.length;
      db.theses = db.theses.filter((th) => !(th.userId === userId && lc(th.topic) === lc(topic)));
      if (db.theses.length !== before) changes.push(`removed interest ${topic}`);
    }

    const upsert = (topic: string, belief: string, confidence: number) => {
      if (!topic) return;
      L.excludedTopics = L.excludedTopics.filter((x) => lc(x) !== lc(topic));
      const existing = db.theses.find((th) => th.userId === userId && lc(th.topic) === lc(topic));
      if (existing) {
        if (belief && belief !== existing.belief) { existing.belief = belief; existing.confidence = confidence; existing.updatedAt = now(); changes.push(`belief on ${topic}`); }
      } else {
        db.theses.push({ id: id("th_"), userId, topic, belief, confidence, source: "chat", updatedAt: now() });
        changes.push(`interest ${topic}`);
      }
    };
    for (const b of ex.beliefs ?? []) upsert(b.topic, b.belief ?? "", Math.min(1, Math.max(0, b.confidence ?? 0.6)));
    for (const i of ex.interests ?? []) upsert(i, "", 0.5);

    const hasInterest = db.theses.some((th) => th.userId === userId);
    const wasOnboarded = user.onboarded;
    if (!user.onboarded && hasInterest && hasBudgetMention(db, userId, budget)) {
      user.onboarded = true;
      changes.push("onboarding complete");
    }
    return { changed: changes.length > 0, summary: changes.length ? `Updated: ${changes.join(", ")}.` : "No profile changes.", newlyOnboarded: !wasOnboarded && user.onboarded };
  });

  if (result.changed) await audit({ userId, actor: "agent", action: "profile.update", detail: { text, extracted: ex, summary: result.summary } });
  return { changed: result.changed, summary: result.summary };
}

// The default budget exists from signup; require that the user actually stated one at some point.
function hasBudgetMention(db: DB, userId: string, budget?: number): boolean {
  if (budget) return true;
  return db.audit.some((a) => a.userId === userId && a.action === "profile.update" && /budget \$/.test(String((a.detail as { summary?: string })?.summary ?? "")));
}
