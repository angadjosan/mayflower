import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export interface JsonRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
}

export interface TextRequest {
  system: string;
  prompt: string;
  temperature?: number;
}

/** Minimal LLM interface used by every agent. Agents always have a deterministic fallback when this is absent. */
export interface LLM {
  readonly model: string;
  json<T>(req: JsonRequest<T>): Promise<T>;
  text(req: TextRequest): Promise<string>;
}

export class LLMError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "LLMError";
  }
}

export function toGeminiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new LLMError("Model did not return JSON");
  }
}

/** Google Gemini (the LLM — not Gemini the exchange) with structured JSON output. */
export class GoogleGeminiLLM implements LLM {
  private ai: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string = "gemini-flash-latest",
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.ai.models.generateContent({
          model: this.model,
          contents: attempt === 0 ? req.prompt : `${req.prompt}\n\nYour previous answer did not match the required JSON schema. Return only valid JSON matching the schema.`,
          config: {
            systemInstruction: req.system,
            temperature: req.temperature ?? 0.2,
            responseMimeType: "application/json",
            responseJsonSchema: toGeminiJsonSchema(req.schema),
          },
        });
        const parsed = req.schema.safeParse(extractJson(res.text ?? ""));
        if (parsed.success) return parsed.data;
        lastErr = parsed.error;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new LLMError(`Gemini structured output failed: ${(lastErr as Error)?.message ?? String(lastErr)}`, lastErr);
  }

  async text(req: TextRequest): Promise<string> {
    try {
      const res = await this.ai.models.generateContent({
        model: this.model,
        contents: req.prompt,
        config: { systemInstruction: req.system, temperature: req.temperature ?? 0.4 },
      });
      return (res.text ?? "").trim();
    } catch (err) {
      throw new LLMError(`Gemini text generation failed: ${(err as Error)?.message ?? String(err)}`, err);
    }
  }
}

/** Run an LLM call and fall back to a deterministic function on any failure. */
export async function withFallback<T>(llm: LLM | null | undefined, call: (llm: LLM) => Promise<T>, fallback: () => T | Promise<T>, onError?: (err: unknown) => void): Promise<T> {
  if (!llm) return fallback();
  try {
    return await call(llm);
  } catch (err) {
    onError?.(err);
    return fallback();
  }
}
