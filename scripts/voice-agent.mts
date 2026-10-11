// Create or update the Mayflower ElevenLabs voice agent and its webhook tools. English agents must use a v2 turbo/flash voice model.
// Run: APP_URL=https://<public app> npx tsx scripts/voice-agent.mts   (reads ELEVENLABS_API_KEY, ELEVENLABS_TOOL_SECRET, ELEVENLABS_AGENT_ID)
import { voiceAgentConfig, VOICE_SECRET_HEADER } from "../src/lib/voice.ts";

const API = "https://api.elevenlabs.io/v1/convai";
const key = process.env.ELEVENLABS_API_KEY;
const secret = process.env.ELEVENLABS_TOOL_SECRET;
if (!key || !secret || !process.env.APP_URL) throw new Error("set ELEVENLABS_API_KEY, ELEVENLABS_TOOL_SECRET and APP_URL");

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: { "xi-api-key": key!, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

const cfg = voiceAgentConfig();
const existing = ((await api("GET", "/tools")).tools ?? []) as { id: string; tool_config: { name: string } }[];
const toolIds: string[] = [];
for (const t of cfg.tools) {
  const tool_config = { ...t, api_schema: { ...t.api_schema, request_headers: { [VOICE_SECRET_HEADER]: secret, "Content-Type": "application/json" } } };
  const found = existing.find((e) => e.tool_config?.name === t.name);
  const r = found ? await api("PATCH", `/tools/${found.id}`, { tool_config }) : await api("POST", "/tools", { tool_config });
  toolIds.push(found?.id ?? r.id);
}

const agent = {
  name: "Mayflower",
  conversation_config: {
    agent: {
      first_message: cfg.first_message,
      language: "en",
      dynamic_variables: { dynamic_variable_placeholders: { call_token: "", proposal_id: "" } },
      prompt: {
        prompt: cfg.system_prompt, llm: process.env.ELEVENLABS_AGENT_LLM || "gpt-4.1-mini", temperature: 0.6, tool_ids: toolIds,
        // Hang up when done, and on a voicemail greeting, so unanswered rings don't burn minutes.
        built_in_tools: {
          end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } },
          voicemail_detection: { type: "system", name: "voicemail_detection", description: "", params: { system_tool_type: "voicemail_detection" } },
        },
      },
    },
    tts: { voice_id: process.env.ELEVENLABS_VOICE_ID || "TX3LPaxmHKxFdv7VOQHJ", model_id: "eleven_flash_v2", speed: 1.15 },
    conversation: { max_duration_seconds: 180 },
  },
  // Public so a texted link can open the talk page; tools still need a valid call_token or caller id.
  platform_settings: { auth: { enable_auth: false }, call_limits: { agent_concurrency_limit: 3, daily_limit: 60 } },
};
const id = process.env.ELEVENLABS_AGENT_ID;
const out = id ? (await api("PATCH", `/agents/${id}`, agent), { agent_id: id }) : await api("POST", "/agents/create", agent);
console.log(JSON.stringify({ agent_id: out.agent_id, tools: toolIds.length, app_url: process.env.APP_URL }));
