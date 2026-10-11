import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { Llm } from '../core/ports.js';

export class GoogleLlm implements Llm {
  readonly mode = 'google' as const;
  private client: GoogleGenAI;

  constructor(apiKey: string, private model: string, private fastModel: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async json<T>(args: { system: string; prompt: string; schema: z.ZodType<T>; fast?: boolean }): Promise<T> {
    const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(args.schema, { target: 'draft-7' }) as Record<string, unknown>;
    let prompt = args.prompt;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.call(args.system, prompt, jsonSchema, args.fast ?? false);
      try {
        return args.schema.parse(JSON.parse(text));
      } catch (e) {
        lastErr = e;
        prompt = `${args.prompt}\n\nYour previous reply was not valid for the required JSON schema. Reply with only valid JSON.`;
      }
    }
    throw new Error(`Gemini returned invalid JSON twice: ${(lastErr as Error)?.message ?? lastErr}`);
  }

  private async call(system: string, prompt: string, schema: Record<string, unknown>, fast: boolean): Promise<string> {
    const interactions = (this.client as any).interactions;
    const input = `${system}\n\n---\n\n${prompt}`;
    const model = fast ? this.fastModel : this.model;
    const it = await interactions.create({
      model,
      input,
      store: false,
      response_format: { type: 'text', mime_type: 'application/json', schema },
      generation_config: { thinking_level: 'low', temperature: fast ? 0 : 0.3 },
    });
    const out: string | undefined = it.output_text;
    if (!out) throw new Error('Gemini returned empty output (possibly safety-blocked)');
    return out;
  }
}

export class FakeLlm implements Llm {
  readonly mode = 'fake' as const;
  async json<T>(_args: { system: string; prompt: string; schema: z.ZodType<T>; fast?: boolean }): Promise<T> {
    throw new Error('FakeLlm.json called: the brain handles fake mode itself');
  }
}
