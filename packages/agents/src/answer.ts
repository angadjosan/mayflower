import { withFallback, type LLM } from "./llm";

export interface AnswerContext {
  /** Structured facts the answer must be grounded in (proposal, sizing steps, positions, research). */
  facts: Record<string, unknown>;
  /** Recent conversation, oldest first. */
  history: { role: "user" | "assistant"; text: string }[];
}

const SYSTEM = `You are Mayflower, a friendly consumer AI copilot for prediction markets, replying over iMessage.
Answer ONLY from the facts provided. If the facts don't cover it, say so plainly. Keep replies short (2-5 sentences), plain English, no markdown tables.
Explain uncertainty honestly. Never promise profit. Prediction-market contracts can lose their full cost.
You cannot place, change or approve trades from this reply — approvals happen only through an exact confirmation code or the secure link.
Cite a source by its title when you rely on it.`;

/** Grounded free-form answer (e.g. "why only $8?"), with a deterministic fallback composer. */
export async function answerQuestion(question: string, ctx: AnswerContext, fallback: () => string, llm?: LLM | null, onError?: (e: unknown) => void): Promise<{ text: string; method: "llm" | "heuristic" }> {
  return withFallback<{ text: string; method: "llm" | "heuristic" }>(
    llm,
    async (m) => {
      const text = await m.text({
        system: SYSTEM,
        prompt: `Facts (JSON):\n${JSON.stringify(ctx.facts).slice(0, 12000)}\n\nRecent conversation:\n${ctx.history
          .slice(-6)
          .map((h) => `${h.role === "user" ? "User" : "Mayflower"}: ${h.text}`)
          .join("\n")}\n\nUser: ${question}\nMayflower:`,
      });
      if (!text) throw new Error("empty answer");
      return { text, method: "llm" as const };
    },
    () => ({ text: fallback(), method: "heuristic" as const }),
    onError,
  );
}
