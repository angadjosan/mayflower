import type { CriticOutput as CriticOutputT, ForecastOutput, Market } from "@mayflower/shared";
import { CriticOutput } from "@mayflower/shared";
import type { LLM } from "../llm/llm.js";
import { CRITIC_SYSTEM } from "../prompts.js";

/** Critic: challenges the forecast; can block or adjust. */
export async function critique(llm: LLM, market: Market, fc: ForecastOutput, evidenceDigest: string): Promise<CriticOutputT> {
  return llm.structured<CriticOutputT>({
    system: CRITIC_SYSTEM,
    tier: "fast",
    schema: CriticOutput,
    prompt: `MARKET: ${market.title}\nRESOLUTION RULES: ${market.resolutionRules ?? "(none)"}\nEXPIRES: ${market.expiresAt ?? "unknown"}\n\nFORECAST:\n${JSON.stringify(fc, null, 1)}\n\nEVIDENCE:\n${evidenceDigest}`,
  });
}
