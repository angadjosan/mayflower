/**
 * Minimal LLM abstraction: structured output against a zod schema. The agents
 * depend only on this so Google Gemini can be swapped for a mock in tests.
 */
import type { ZodType } from "zod";

export interface StructuredRequest<T> {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  /** Hint for the provider: "fast" for routing/extraction, "deep" for forecasting. */
  tier?: "fast" | "deep";
  temperature?: number;
}

export interface LLM {
  readonly name: string;
  structured<T>(req: StructuredRequest<T>): Promise<T>;
  text(system: string, prompt: string): Promise<string>;
}
