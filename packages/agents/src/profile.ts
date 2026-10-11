import { z } from "zod";
import { detectEntities, detectTopics, type ProfileUpdate, type RiskStyle } from "@mayflower/shared";
import { withFallback, type LLM } from "./llm";

export interface ProfileContext {
  interests: string[];
  beliefs: { topic: string; belief: string }[];
  riskBudget: number | null;
  maxPerPosition: number | null;
  maxTotalExposure: number | null;
  riskStyle: RiskStyle | null;
  excludedTopics: string[];
}

const ProfileSchema = z.object({
  interests: z.array(z.string()).describe("Topics, teams, companies or areas the user follows. Short noun phrases, e.g. 'Seahawks', 'AI infrastructure'."),
  beliefs: z
    .array(
      z.object({
        topic: z.string().describe("Short topic, e.g. 'AI infrastructure spending'"),
        belief: z.string().describe("The user's opinion in their own words, concise"),
        stance: z.enum(["bullish", "bearish", "neutral"]).describe("bullish = expects it to rise/happen/win; bearish = expects it to fall/not happen/lose"),
        confidence: z.number().min(0).max(1).describe("How strongly the user holds it, 0-1. Default 0.6 if unclear."),
      }),
    )
    .describe("Opinions the user stated about future outcomes. Do not invent beliefs."),
  riskBudget: z.number().nullable().describe("Total dollars the user said they can afford to risk, or null"),
  maxPerPosition: z.number().nullable().describe("Maximum loss per single position in dollars, or null"),
  maxTotalExposure: z.number().nullable().describe("Maximum total dollars at risk at once, or null"),
  riskStyle: z.enum(["conservative", "balanced", "aggressive"]).nullable().describe("Only if the user expressed a sizing preference"),
  excludedTopics: z.array(z.string()).describe("Topics the user wants Mayflower to stop looking at, e.g. 'politics'"),
  removeInterests: z.array(z.string()).describe("Interests the user said they no longer care about"),
  lowerConfidenceTopics: z.array(z.string()).describe("Topics the user said they are now less confident about. Use 'LAST' if they said 'that' without naming it."),
  displayName: z.string().nullable().describe("The user's name if they explicitly introduced themselves"),
});

const SYSTEM = `You extract a prediction-market user's profile from their message for Mayflower, a consumer AI trading copilot.
Only extract what the user actually said. Never invent interests, beliefs or numbers. Dollar amounts: "$200 I can risk" is riskBudget=200.
"no more than $20 on any one bet" is maxPerPosition=20. "keep total exposure under $100" is maxTotalExposure=100.
Stating an interest or belief is context, not permission to trade.`;

function money(text: string): { value: number; before: string; after: string }[] {
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?|(\d+(?:\.\d+)?)\s*(k)?\s*(?:dollars|bucks|usd)\b/gi;
  const found: { value: number; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let value = Number.parseFloat((m[1] ?? m[3] ?? "0").replace(/,/g, ""));
    if (m[2] || m[4]) value *= 1000;
    found.push({ value, start: m.index, end: m.index + m[0].length });
  }
  // Classify each amount by the words right around it, stopping at neighbouring amounts.
  return found.map((f, i) => {
    const prevEnd = i > 0 ? found[i - 1].end : 0;
    const nextStart = i < found.length - 1 ? found[i + 1].start : text.length;
    return {
      value: f.value,
      before: text.slice(Math.max(prevEnd, f.start - 40), f.start).toLowerCase(),
      after: text.slice(f.end, Math.min(nextStart, f.end + 40)).toLowerCase(),
    };
  });
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|,\s*(?:and\s+)?(?=(?:i|i'm|think|believe|expect|feel|worried|bet)\b)|\s+and\s+(?=(?:i|i'm|think|believe|expect)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

const BULLISH = /\b(grow|growing|rise|rising|increase|keep (?:growing|going|rising)|win|winning|beat|bullish|boom|up|higher|strong|will happen|make the playoffs)\b/i;
const BEARISH = /\b(worried|worry|fear|recession|fall|falling|decline|drop|lose|losing|bearish|crash|down|lower|weak|won't|will not|unlikely|slow)\b/i;

export function heuristicProfile(text: string): ProfileUpdate {
  const lower = text.toLowerCase();
  const update: ProfileUpdate = {
    interests: [],
    beliefs: [],
    riskBudget: null,
    maxPerPosition: null,
    maxTotalExposure: null,
    riskStyle: null,
    excludedTopics: [],
    removeInterests: [],
    lowerConfidenceTopics: [],
    displayName: null,
  };

  const PER = /per (?:position|trade|bet|market|idea)|any (?:one|single) (?:bet|trade|position)|each (?:bet|trade|position)|max(?:imum)? loss/;
  const TOTAL = /total|overall|at once|exposure|across/;
  for (const m of money(text)) {
    // Words after the amount ("$10 per position") are the strongest signal; then words before it.
    const kind = PER.test(m.after) ? "per" : TOTAL.test(m.after) && !/afford/.test(m.after) ? "total" : PER.test(m.before) ? "per" : TOTAL.test(m.before) && !/risk budget|afford/.test(m.before) ? "total" : "budget";
    if (kind === "per") update.maxPerPosition = m.value;
    else if (kind === "total") update.maxTotalExposure = m.value;
    else if (update.riskBudget === null) update.riskBudget = m.value;
  }

  if (/\b(conservative|cautious|careful|safe|small bets|low risk)\b/.test(lower)) update.riskStyle = "conservative";
  else if (/\b(aggressive|yolo|high risk|big bets|go big)\b/.test(lower)) update.riskStyle = "aggressive";
  else if (/\b(balanced|moderate|medium risk)\b/.test(lower)) update.riskStyle = "balanced";

  const exclusionRe = /(?:stop (?:looking (?:for|at)|showing(?: me)?|sending(?: me)?)|no more|exclude|avoid|not interested in|don't (?:show|send|want)(?: me)?|skip)\s+(?:any\s+)?([a-z][a-z &'-]{1,40}?)(?:\s+(?:markets?|bets?|trades?|stuff|ideas?|contracts?))?(?=[.,!?]|$|\s+(?:and|please|anymore|for now))/gi;
  let em: RegExpExecArray | null;
  while ((em = exclusionRe.exec(text))) {
    const topic = em[1].trim().replace(/^(?:the|any)\s+/i, "");
    if (topic && !/^(that|this|it|trading)$/i.test(topic)) update.excludedTopics.push(topic.toLowerCase());
  }

  const lessConf = /less (?:confident|sure|certain) (?:about|in|on)\s+([a-z][a-z &'-]{1,40})/i.exec(text);
  if (lessConf) {
    const t = lessConf[1].trim();
    update.lowerConfidenceTopics.push(/^(that|this|it)\b/i.test(t) ? "LAST" : t);
  } else if (/less (?:confident|sure|certain)\b/i.test(text)) {
    update.lowerConfidenceTopics.push("LAST");
  }

  const nameMatch = /\b(?:my name is|call me)\s+([A-Z][a-z]{1,20})/i.exec(text);
  if (nameMatch) update.displayName = nameMatch[1][0].toUpperCase() + nameMatch[1].slice(1);

  const excluded = new Set(update.excludedTopics);
  const entities = detectEntities(text).map((e) => e[0].toUpperCase() + e.slice(1));
  const topics = detectTopics(text).filter((t) => !update.excludedTopics.some((x) => t.keywords.includes(x) || t.key === x || t.label.toLowerCase().includes(x)));
  const interestSet = new Set<string>();
  for (const e of entities) if (!excluded.has(e.toLowerCase())) interestSet.add(e);
  for (const t of topics) interestSet.add(t.label);
  if (/\bfollow|into|love|care about|interested in|fan of|watch\b/i.test(text) || interestSet.size > 0) {
    update.interests = [...interestSet];
  }

  for (const s of sentences(text)) {
    if (!/\b(think|believe|expect|bet|worried|worry|confident|sure|feel|predict|bullish|bearish|will|won't)\b/i.test(s)) continue;
    if (/less (?:confident|sure)/i.test(s)) continue;
    const sTopics = detectTopics(s);
    const sEntities = detectEntities(s);
    if (sTopics.length === 0 && sEntities.length === 0) continue;
    const topicName = sEntities[0] ? sEntities[0][0].toUpperCase() + sEntities[0].slice(1) : sTopics[0].label;
    const bull = BULLISH.test(s);
    const bear = BEARISH.test(s);
    const stance = bull && !bear ? "bullish" : bear && !bull ? "bearish" : bear && bull ? (/worried|worry|fear/i.test(s) ? "bearish" : "bullish") : "neutral";
    const confidence = /\b(very|really|strongly|definitely|sure)\b/i.test(s) ? 0.8 : /\b(maybe|might|kind of|somewhat|slightly)\b/i.test(s) ? 0.4 : 0.6;
    const belief = s.replace(/^(and|also|but)\s+/i, "").replace(/[.!]+$/, "");
    update.beliefs.push({ topic: topicName, belief, stance, confidence });
  }
  return update;
}

export async function extractProfile(text: string, current: ProfileContext, llm?: LLM | null, onError?: (e: unknown) => void): Promise<ProfileUpdate & { method: "llm" | "heuristic" }> {
  return withFallback<ProfileUpdate & { method: "llm" | "heuristic" }>(
    llm,
    async (m) => {
      const out = await m.json({
        system: SYSTEM,
        schema: ProfileSchema,
        prompt: `Current profile (for reference; only return NEW or CHANGED information):\n${JSON.stringify(current)}\n\nUser message:\n"""${text}"""`,
      });
      return { ...out, method: "llm" as const };
    },
    () => ({ ...heuristicProfile(text), method: "heuristic" as const }),
    onError,
  );
}

/** Does this message look like it is telling us about the user's interests/beliefs/limits? */
export function looksLikeProfileInfo(text: string): boolean {
  const p = heuristicProfile(text);
  return (
    p.riskBudget !== null ||
    p.maxPerPosition !== null ||
    p.maxTotalExposure !== null ||
    p.riskStyle !== null ||
    p.excludedTopics.length > 0 ||
    p.lowerConfidenceTopics.length > 0 ||
    p.beliefs.length > 0 ||
    (p.interests.length > 0 && /\b(follow|into|love|care about|interested in|fan of|i like)\b/i.test(text))
  );
}
