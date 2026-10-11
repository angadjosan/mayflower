// Google Gemini LLM wrapper (@google/genai). Falls back gracefully when no key is set.
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GOOGLE_API_KEY;
const model = process.env.GOOGLE_MODEL || "gemini-2.5-flash";

export const llmEnabled: boolean = !!apiKey;

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: apiKey! });
  return client;
}

export async function generateText(prompt: string, system?: string): Promise<string> {
  if (!llmEnabled) return "(LLM not configured: set GOOGLE_API_KEY to enable AI responses.)";
  const res = await ai().models.generateContent({
    model,
    contents: prompt,
    config: system ? { systemInstruction: system } : undefined,
  });
  return (res.text ?? "").trim();
}

export async function generateJSON<T>(prompt: string, system?: string): Promise<T> {
  if (!llmEnabled) throw new Error("LLM_DISABLED");
  const res = await ai().models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json", ...(system ? { systemInstruction: system } : {}) },
  });
  let text = (res.text ?? "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(text) as T;
}
