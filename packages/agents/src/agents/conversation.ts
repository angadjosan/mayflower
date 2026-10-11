import type { ClassifiedIntent as ClassifiedIntentT, ExtractedProfile as ExtractedProfileT } from "@mayflower/shared";
import { ClassifiedIntent, ExtractedProfile } from "@mayflower/shared";
import type { LLM } from "../llm/llm.js";
import { INTENT_SYSTEM, PROFILE_EXTRACTION_SYSTEM, REPLY_SYSTEM } from "../prompts.js";

export async function classifyIntent(llm: LLM, message: string, context: { pendingProposals: Array<{ id: string; short: string; stake: number; title: string }> }): Promise<ClassifiedIntentT> {
  return llm.structured<ClassifiedIntentT>({
    system: INTENT_SYSTEM,
    tier: "fast",
    schema: ClassifiedIntent,
    prompt: `PENDING PROPOSALS: ${JSON.stringify(context.pendingProposals)}\n\nUSER MESSAGE: ${message}`,
  });
}

export async function extractProfile(llm: LLM, message: string, existing: { interests: string[]; beliefs: string[]; totalBudget: number } | null): Promise<ExtractedProfileT> {
  return llm.structured<ExtractedProfileT>({
    system: PROFILE_EXTRACTION_SYSTEM,
    tier: "fast",
    schema: ExtractedProfile,
    prompt: `EXISTING PROFILE: ${existing ? JSON.stringify(existing) : "none"}\n\nUSER MESSAGE: ${message}`,
  });
}

export async function composeReply(llm: LLM, facts: string, userMessage: string): Promise<string> {
  return llm.text(REPLY_SYSTEM, `FACTS YOU MAY USE (do not invent others):\n${facts}\n\nUSER SAID: ${userMessage}\n\nReply:`);
}
