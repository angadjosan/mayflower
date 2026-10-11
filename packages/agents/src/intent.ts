import { z } from "zod";
import type { Intent, IntentResult } from "@mayflower/shared";
import { withFallback, type LLM } from "./llm";
import { looksLikeProfileInfo } from "./profile";

const INTENTS = [
  "onboarding",
  "profile_update",
  "find_opportunities",
  "ask_why",
  "approve",
  "reject",
  "portfolio",
  "what_changed",
  "riskiest",
  "change_position",
  "hedge_question",
  "link_gemini",
  "dashboard_link",
  "pause",
  "resume",
  "help",
  "research",
  "general",
] as const satisfies readonly Intent[];

const IntentSchema = z.object({
  intent: z.enum(INTENTS),
  topic: z.string().nullable().describe("Topic to search or research, if any (e.g. 'crypto', 'Seahawks')"),
  excludeTopics: z.array(z.string()).describe("Topics to exclude for this request, e.g. ['sports'] for 'outside sports'"),
  fraction: z.number().min(0).max(1).nullable().describe("For change_position: fraction to sell. 'half' = 0.5, 'all' = 1"),
  reference: z.string().nullable().describe("Words identifying which market/position/proposal the user means, if any"),
});

const SYSTEM = `Classify a message sent to Mayflower, a prediction-market copilot that the user texts over iMessage.
Intents:
- profile_update: shares interests, beliefs, budget, risk limits, or exclusions ("I'm less confident about that now", "stop looking for political markets")
- find_opportunities: wants trade ideas ("find opportunities outside sports", "anything good in crypto?")
- ask_why: questions about a recommendation ("why only $8?", "why do you think the market is wrong?", "what would change your mind?")
- approve: wants to approve/place a proposed trade ("approve the $8 trade", "do it")
- reject: declines a proposal ("pass", "reject that")
- portfolio: asks about positions, balance, P&L
- what_changed: asks for updates/news since last time ("what changed overnight?")
- riskiest: asks about risk, exposure or concentration
- change_position: wants to sell/close/reduce a position ("sell half")
- hedge_question: asks about hedging
- link_gemini: wants to connect their Gemini account
- dashboard_link: wants a link to the web dashboard / to log in
- pause / resume: stop or restart all trading activity
- help: what can you do
- research: asks Mayflower to research or give an opinion on a topic
- general: anything else
Never treat a vague message as approval.`;

function fractionFrom(text: string): number | null {
  const t = text.toLowerCase();
  if (/\b(all|everything|entire|whole|close (?:it|out|the position)|exit)\b/.test(t)) return 1;
  if (/\bhalf\b/.test(t)) return 0.5;
  if (/\b(a )?third\b/.test(t)) return 1 / 3;
  if (/\b(a )?quarter\b/.test(t)) return 0.25;
  const pct = /(\d{1,3})\s*%/.exec(t);
  if (pct) return Math.min(1, Number(pct[1]) / 100);
  return null;
}

function topicFrom(text: string): { topic: string | null; exclude: string[] } {
  const exclude: string[] = [];
  const outside = /(?:outside(?: of)?|other than|besides|except|not in|beyond|excluding)\s+([a-z][a-z &'-]{1,30}?)(?=[.,!?]|$|\s+(?:please|markets?|for))/i.exec(text);
  if (outside) exclude.push(outside[1].trim().toLowerCase());
  const inTopic = /(?:\bin|\bon|\babout|\bfor|related to|around)\s+([a-z][a-z0-9 &'$-]{1,30}?)(?=[.,!?]|$|\s+(?:please|markets?|right now|today|this week))/i.exec(text.replace(/outside(?: of)?\s+[a-z &'-]+/i, ""));
  let topic = inTopic ? inTopic[1].trim() : null;
  if (topic && /^(me|it|that|this|the market|my portfolio|now)$/i.test(topic)) topic = null;
  return { topic, exclude };
}

export function heuristicIntent(text: string, ctx: { onboardingComplete: boolean }): IntentResult {
  const t = text.trim();
  const lower = t.toLowerCase();
  const { topic, exclude } = topicFrom(t);
  const result = (intent: Intent, extra: Partial<IntentResult> = {}): IntentResult => ({
    intent,
    topic: null,
    excludeTopics: [],
    fraction: null,
    reference: null,
    method: "heuristic",
    ...extra,
  });

  if (/^(help|\?)$|what can you do|how does (this|mayflower) work|commands/.test(lower)) return result("help");
  if (/\b(pause|halt|kill switch|stop (all )?trading|freeze)\b/.test(lower)) return result("pause");
  if (/\b(resume|unpause|start trading again|turn trading back on)\b/.test(lower)) return result("resume");
  if (/\b(link|connect)\b.*\bgemini\b|\bgemini account\b/.test(lower)) return result("link_gemini");
  if (/\b(dashboard|log ?in|sign ?in|web ?app|website)\b/.test(lower)) return result("dashboard_link");
  if (/\bhedg/.test(lower)) return result("hedge_question", { reference: t });
  if (/\bwhy\b|\bexplain\b|what would change your mind|how (confident|sure)|what('s| is) the (evidence|catch|risk)|\bsources?\b|what could go wrong|reasoning/.test(lower)) {
    return result("ask_why", { reference: t });
  }
  if (/^\s*(no|nah|pass|skip)\b|\b(reject|pass on|no thanks|decline|not interested|don't (buy|do) (it|that))\b/.test(lower) && !/\bno more\b|\bstop\b/.test(lower)) {
    return result("reject", { reference: t });
  }
  if (/\b(approve|place (the|that|it)|go ahead|do it|buy it|confirm|let'?s do it|i'?m in)\b/.test(lower)) return result("approve", { reference: t });
  if (/\b(sell|close|exit|reduce|trim|cash out|take profits?|get out)\b/.test(lower)) {
    return result("change_position", { fraction: fractionFrom(lower) ?? (/\b(reduce|trim)\b/.test(lower) ? 0.5 : 1), reference: t });
  }
  if (/what('?s| has)? changed|overnight|any (news|updates?)|what'?s new|update me|catch me up/.test(lower)) return result("what_changed");
  if (/riski|most risk|exposure|concentrat|downside|how much (could|can) i lose/.test(lower)) return result("riskiest");
  if (/\b(find|opportunit|ideas?|recommend|suggest|scan|look for|anything (good|interesting)|what should i (buy|bet|trade))\b/.test(lower)) {
    return result("find_opportunities", { topic, excludeTopics: exclude });
  }
  if (/\bportfolio|positions?|how am i doing|p&l|pnl|profit|balance|my money|what do i (own|have)|holdings\b/.test(lower)) return result("portfolio");
  if (looksLikeProfileInfo(t)) return result(ctx.onboardingComplete ? "profile_update" : "onboarding");
  if (/\b(research|look into|what do you think (about|of)|tell me about|thoughts on|opinion on)\b/.test(lower)) {
    const rt = /(?:research|look into|think (?:about|of)|tell me about|thoughts on|opinion on)\s+(.+?)[?.!]*$/i.exec(t);
    return result("research", { topic: rt ? rt[1] : topic });
  }
  if (!ctx.onboardingComplete) return result("onboarding");
  return result("general");
}

export async function classifyIntent(
  text: string,
  ctx: { onboardingComplete: boolean; recentAssistantMessage?: string | null },
  llm?: LLM | null,
  onError?: (e: unknown) => void,
): Promise<IntentResult> {
  // Safety-critical intents are decided deterministically first: pause/resume and approval wording never depend on the model.
  const h = heuristicIntent(text, ctx);
  if (h.intent === "pause" || h.intent === "resume" || h.intent === "help") return h;
  return withFallback(
    llm,
    async (m) => {
      const out = await m.json({
        system: SYSTEM,
        schema: IntentSchema,
        prompt: `${ctx.recentAssistantMessage ? `Mayflower's last message: """${ctx.recentAssistantMessage}"""\n` : ""}User has finished onboarding: ${ctx.onboardingComplete}\nUser message: """${text}"""`,
      });
      let intent = out.intent;
      if (!ctx.onboardingComplete && (intent === "profile_update" || intent === "general")) intent = "onboarding";
      return { ...out, intent, method: "llm" as const };
    },
    () => h,
    onError,
  );
}
