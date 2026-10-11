// Claude LLM wrapper (@anthropic-ai/sdk). Falls back gracefully when no key is set.
import Anthropic from "@anthropic-ai/sdk";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const effort = (process.env.ANTHROPIC_EFFORT || "medium") as Effort;
// Routing, extraction, ranking and critique don't need the big model; keep them fast so iMessage replies stay snappy.
const fastModel = process.env.ANTHROPIC_FAST_MODEL || "claude-haiku-5-5";

/** `fast: true` uses the small model at low effort, for classification/extraction/ranking/critique. */
export interface LLMOptions { fast?: boolean }

export const llmEnabled: boolean = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client: Anthropic | null = null;
function ai(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

async function complete(prompt: string, system?: string, opts: LLMOptions = {}): Promise<string> {
  const res = await ai().beta.messages.create({
    model: opts.fast ? fastModel : model,
    max_tokens: opts.fast ? 4000 : 16000,
    output_config: { effort: opts.fast ? "low" : effort },
    // On a safety refusal, the API reroutes to a fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(system ? { system } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("LLM_REFUSED");
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

export async function generateText(prompt: string, system?: string, opts?: LLMOptions): Promise<string> {
  if (!llmEnabled) return "(LLM not configured: set ANTHROPIC_API_KEY to enable AI responses.)";
  return complete(prompt, system, opts);
}

export async function generateJSON<T>(prompt: string, system?: string, opts?: LLMOptions): Promise<T> {
  if (!llmEnabled) throw new Error("LLM_DISABLED");
  const sys = [system, "Respond with a single valid JSON value only. No prose, no code fences."]
    .filter(Boolean)
    .join("\n\n");
  let text = await complete(prompt, sys, opts);
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(text) as T;
}
