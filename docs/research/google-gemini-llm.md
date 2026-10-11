# Google Gemini API (LLM) integration reference — Mayflower
Researched 2026-10-11. Base: https://ai.google.dev/gemini-api/docs. Unsourced = UNVERIFIED. Live calls NOT tested (no API key on this box).

## 0. Big change: Interactions API is now the recommended interface
- Interactions API is GA (June 2026), "recommended for all new projects"; `generateContent` is "legacy" but "remains fully supported", not deprecated, new features land on Interactions. https://ai.google.dev/gemini-api/docs/interactions
- All current doc examples use `client.interactions.create(...)` (snake_case params: `input`, `response_format`, `generation_config`, `previous_interaction_id`, `store`). Read text via `interaction.output_text`. Needs `@google/genai` >= 2.3.0 (same page).
- Your stale memory of `ai.models.generateContent({config:{responseSchema}})` still exists in the SDK (types confirmed in 2.28.0 d.ts) but is not what docs teach. Pick ONE path; this doc uses Interactions.

## 1. Model IDs (https://ai.google.dev/gemini-api/docs/models, pricing: .../pricing, changelog: .../changelog)
| Role | ID | Status | Free tier? |
|---|---|---|---|
| Best general (recommended) | `gemini-3.8-flash` | Stable (GA Sep 2) | YES (free in/out) |
| Previous gen flash | `gemini-3.6-flash` | Stable | YES |
| Fast/cheap | `gemini-3.5-flash-lite` | Stable | YES |
| Fast/cheap alt | `gemini-3.1-flash-lite` | Stable | YES |
| Max reasoning | `gemini-3.1-pro-preview` | Preview | NO (paid only) |
- Dead/redirected: `gemini-3.7-flash` and `gemini-3.5-flash` deprecated Oct 8 (routed to 3.8 / 3.6); `gemini-2.0-flash*`, `gemini-3-pro-preview`, `gemini-3.1-flash-lite-preview` shut down. 2.5 models only for past users. Do not use old IDs from memory.
- No separate "thinking" text model IDs: thinking is a per-request level on the same model (sec 6). ("live-extended-thinking" IDs are voice-only.)
- Paid $/1M tokens (through Dec 31 2026): 3.8-flash $0.75 in / $3.75 out; 3.5-flash-lite $0.30 / $2.50; 3.1-pro-preview $2 / $12 (<=200k). Output includes thinking tokens. (pricing page)
- Plan: `gemini-3.8-flash` for extract/forecast/critique/explain; `gemini-3.5-flash-lite` for cheap high-volume (chat belief extraction). Pro only if justified (paid, preview).

## 2. SDK (npm, checked 2026-10-11)
- `npm i @google/genai` -> latest **2.28.0** (published 2026-10-07; `npm view @google/genai version`). Official, production-ready. https://ai.google.dev/gemini-api/docs/libraries
- Legacy `@google/generative-ai`: listed "Not actively maintained", legacy libs deprecated as of Nov 30 2025 (libraries page). npm `deprecated` field returned empty, i.e. not npm-flagged; last version 0.24.1. Do not use.
- Key env: `GEMINI_API_KEY` or `GOOGLE_API_KEY` (latter wins if both) auto-read by `new GoogleGenAI({})`. https://ai.google.dev/gemini-api/docs/api-key
- Zod: `zod@4.6.6` current on npm.

## 3. Structured output (https://ai.google.dev/gemini-api/docs/structured-output)
Interactions form: `response_format: {type:'text', mime_type:'application/json', schema}` (docs also show array form in migration guide; both appear in docs). Output is a JSON string in `output_text`.
Zod: docs show NO native Zod passing and validate with `z.fromJSONSchema`. I verified locally that Zod 4's built-in `z.toJSONSchema` emits clean JSON Schema (anyOf for nullable, min/max, additionalProperties:false). No `zod-to-json-schema` needed with Zod 4. Whether Gemini accepts that exact output (esp. `$schema`, `additionalProperties:false`) is UNVERIFIED live; strip `$schema` to be safe.
```ts
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
const client = new GoogleGenAI({});
const Belief = z.object({
  claim: z.string(),
  probability: z.number().min(0).max(1),
  ci_low: z.number().min(0).max(1),
  ci_high: z.number().min(0).max(1),
  rationale: z.string(),
});
const Out = z.object({ beliefs: z.array(Belief) });
const { $schema, ...schema } = z.toJSONSchema(Out, { target: "draft-7" }) as any;
const it = await client.interactions.create({
  model: "gemini-3.8-flash",
  input: "Extract beliefs from: ...",
  response_format: { type: "text", mime_type: "application/json", schema },
});
const data = Out.parse(JSON.parse(it.output_text));  // always re-validate
```
Supported schema keywords: string/number/integer/boolean/object/array/null (type arrays e.g. `["string","null"]`); properties, required, additionalProperties; enum, format; minimum, maximum; items, prefixItems, minItems, maxItems; `$ref` recursion. Only a subset; large/deeply nested schemas may be rejected. Output is valid JSON but may be semantically wrong -> validate.
Legacy generateContent equivalent (SDK d.ts 2.28.0): `config:{responseMimeType:'application/json', responseJsonSchema: schema}` (`responseJsonSchema` accepts full JSON Schema; `responseSchema` is the older OpenAPI-subset).
Streaming: partial JSON string chunks concatenate to final object (`event.event_type==="step.delta"`, `event.delta.type==="text"`). Don't JSON.parse until done.

## 4. Function calling (https://ai.google.dev/gemini-api/docs/function-calling)
```ts
const tools = [{ type: "function", name: "get_market_price", description: "Latest price",
  parameters: { type: "object", properties: { market_id: { type: "string" } }, required: ["market_id"] } }];
let it = await client.interactions.create({ model: "gemini-3.8-flash", input: "Price of X?", tools });
const call = it.steps.find((s: any) => s.type === "function_call");
if (call) {
  const result = await getMarketPrice(call.arguments);   // field name for args: UNVERIFIED, inspect `call`
  it = await client.interactions.create({
    model: "gemini-3.8-flash", tools, previous_interaction_id: it.id,
    input: [{ type: "function_result", name: call.name, call_id: call.id, text: JSON.stringify(result) }],
  });
}
console.log(it.output_text);
```
(Result step shape `name`, `call_id`, `text` per docs; call id field name `id` and args field UNVERIFIED.) Modes via `generation_config.tool_choice`: auto (default), any, none, validated. Parallel calls supported. SDK auto-handles thought signatures; in stateless mode pass back all steps (incl. `thought`) exactly as received.

## 5. Grounding: Google Search + URL context
- Enable: `tools:[{type:"google_search"}]` and/or `{type:"url_context"}` (together OK). https://ai.google.dev/gemini-api/docs/google-search , .../url-context
- Citations (Interactions): `model_output` text blocks carry `annotations` of type `url_citation` {url, title, start_index, end_index}; `google_search_call` step = queries run; `google_search_result` step has `search_suggestions` (HTML snippet to display; ToS display requirements not summarized -> check ToS). url_context adds `url_context_result` step (status; "unsafe" = blocked), up to 20 URLs/req, 34MB each, public only, no paywall/YouTube/Workspace.
- Legacy generateContent shape: `candidates[0].groundingMetadata` {groundingChunks, groundingSupports, webSearchQueries, searchEntryPoint} (SDK d.ts; migration page .../migrate-to-interactions).
- Pricing: Gemini 3+: first 5,000 search requests/month free (shared), then $14/1,000 queries.
- **Grounded + JSON in one call: YES, documented**: structured output "can be combined with Google Search, URL Context, Code Execution, File Search, and Function Calling", Gemini 3 series only, **preview**. Doc example uses `gemini-3.1-pro-preview` with `tools:[{type:"google_search"},{type:"url_context"}]` + `response_format`. Works on 3.8-flash: UNVERIFIED (not shown for it). Fallback: 2-step (grounded free text, then JSON-extract call).
- Built-in tools + custom function calling together: Gemini 3 preview; must use `validated` tool mode (`auto` unsupported). https://ai.google.dev/gemini-api/docs/tool-combination

## 6. Thinking (https://ai.google.dev/gemini-api/docs/thinking)
- Use `generation_config:{thinking_level:"low"|"medium"|"high", thinking_summaries:"auto"}`. Levels: 3.8-flash low/medium/high (default medium); 3.6-flash adds minimal; 3.5-flash-lite minimal..high (default minimal); 3.1-pro-preview low/medium/high (default high).
- `thinkingBudget` is NOT in the thinking doc; SDK d.ts note says from 3.5 models the old thinking_budget "will result in a user error". Use levels only.
- `max_output_tokens` includes thought tokens (hard cap); too small = truncated/empty JSON. Lower level to save cost instead.
- No documented way to fully disable thinking on 3.x.
```ts
generation_config: { thinking_level: "low" }
```

## 7. Rate limits and key
- Tiers: Free; Tier 1 = link billing (instant); Tier 2 = $100 paid + 3 days; Tier 3 = $1000 + 30 days. Limits per PROJECT not key; RPD resets midnight Pacific. https://ai.google.dev/gemini-api/docs/rate-limits
- Per-model free numbers are NOT in docs (shown only in AI Studio). Forum report: gemini-3.8-flash free = **20 RPD**; flash-lite 500 RPD (https://discuss.ai.google.dev/t/gemini-3-8-flash-free-tier-20-rpd-is-too-limited-for-practical-evaluation/180609) — UNVERIFIED single post. Implication: demo on free 3.8-flash will exhaust fast; use 3.5-flash-lite for volume or enable billing (Tier 1, $10/10min spend cap).
- Key: https://aistudio.google.com/apikey -> Create key (import GCP project if none shown). Never commit.

## 8. Gotchas
- Interactions are stored by default (`store=true`); set `store:false` for stateless. `output_text` skips earlier text blocks split by non-text content — iterate `steps` for interleaved output. (migrate page)
- Docs reference "Interactions breaking changes (May 2026)" but the page URL I guessed 404'd; check the libraries page link. Pin `@google/genai` exact version.
- Combos (search+JSON, search+functions) are Preview and Gemini-3-only; expect churn.
- Schema subset only; no guarantee semantic correctness; keep schemas flat, add `required`, validate with Zod, retry once on parse failure.
- Don't parse streamed JSON until complete.
- Safety blocks: Interactions accept safety settings (d.ts); block/finish-reason field names UNVERIFIED — handle empty `output_text` defensively.
- Grounding bills per search query after 5k free/mo; display `search_suggestions` per ToS if you show grounded answers.
- Free tier data may be used to improve Google products: UNVERIFIED (not checked this run).
- Old IDs (2.0-flash, 3.7-flash, 3.5-flash) are dead or redirected; 3.1-pro is preview and paid-only.
