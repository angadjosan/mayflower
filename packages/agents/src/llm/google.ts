/**
 * Google Gemini (the LLM — NOT Gemini Exchange) via @google/genai.
 * Verified Oct 2026: generateContent with responseMimeType "application/json"
 * + responseJsonSchema (standard JSON Schema). Models: gemini-3.8-flash (fast),
 * gemini-3.1-pro-preview (deep). Override with GOOGLE_FAST_MODEL / GOOGLE_DEEP_MODEL.
 */
import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LLM, StructuredRequest } from "./llm.js";

export interface GoogleLLMOptions {
  apiKey: string;
  fastModel?: string;
  deepModel?: string;
}

export class GoogleLLM implements LLM {
  readonly name = "google-gemini";
  private ai: GoogleGenAI;
  private fast: string;
  private deep: string;

  constructor(opts: GoogleLLMOptions) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey });
    this.fast = opts.fastModel ?? process.env.GOOGLE_FAST_MODEL ?? "gemini-3.8-flash";
    this.deep = opts.deepModel ?? process.env.GOOGLE_DEEP_MODEL ?? "gemini-3.1-pro-preview";
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsonSchema = zodToJsonSchema(req.schema as any, { $refStrategy: "none" }) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const model = req.tier === "deep" ? this.deep : this.fast;
    const res = await this.ai.models.generateContent({
      model,
      contents: req.prompt,
      config: {
        systemInstruction: req.system,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        temperature: req.temperature ?? 0.3,
      },
    });
    const text = res.text ?? "";
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error(`LLM returned non-JSON (${model}): ${text.slice(0, 200)}`); }
    const result = req.schema.safeParse(parsed);
    if (!result.success) throw new Error(`LLM output failed schema validation: ${result.error.message}`);
    return result.data;
  }

  async text(system: string, prompt: string): Promise<string> {
    const res = await this.ai.models.generateContent({ model: this.fast, contents: prompt, config: { systemInstruction: system, temperature: 0.5 } });
    return res.text ?? "";
  }
}
