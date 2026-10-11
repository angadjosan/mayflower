/**
 * Scripted LLM for tests / offline demo. Responses are matched by schema
 * identity so each agent can be given a canned answer.
 */
import type { ZodType } from "zod";
import type { LLM, StructuredRequest } from "./llm.js";

export class MockLLM implements LLM {
  readonly name = "mock";
  private canned = new Map<ZodType<unknown>, (prompt: string) => unknown>();
  on<T>(schema: ZodType<T>, fn: (prompt: string) => T) { this.canned.set(schema as ZodType<unknown>, fn as (p: string) => unknown); return this; }
  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const fn = this.canned.get(req.schema as ZodType<unknown>);
    if (!fn) throw new Error(`MockLLM: no canned response for schema in prompt: ${req.prompt.slice(0, 60)}`);
    return req.schema.parse(fn(req.prompt));
  }
  async text(_system: string, prompt: string) { return `[mock reply to: ${prompt.slice(0, 80)}]`; }
}
