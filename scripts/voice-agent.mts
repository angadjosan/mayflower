// Create or update the Mayflower ElevenLabs voice agent and its webhook tools.
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
      // Placeholders only fill dashboard tests: real calls must pass every one of these (callVars in calls.ts) or ElevenLabs drops them.
      dynamic_variables: { dynamic_variable_placeholders: { call_token: "", proposal_id: "", call_reason: "", call_opener: "", result_summary: "" } },
      prompt: {
        prompt: cfg.system_prompt, llm: process.env.ELEVENLABS_AGENT_LLM || "gpt-4.1", temperature: 0.6, tool_ids: toolIds,
        // Hang up when done, and on a voicemail greeting, so unanswered rings don't burn minutes.
        built_in_tools: {
          end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } },
          voicemail_detection: { type: "system", name: "voicemail_detection", description: "", params: { system_tool_type: "voicemail_detection" } },
        },
      },
    },
    // Most natural-sounding phone voice: v3 conversational, normal speed, a bit of expressive variation.
    tts: { voice_id: process.env.ELEVENLABS_VOICE_ID || "TX3LPaxmHKxFdv7VOQHJ", model_id: "eleven_v3_conversational", speed: 1.0, stability: 0.35, similarity_boost: 0.8, optimize_streaming_latency: 2 },
    conversation: { max_duration_seconds: 180 },
    // Calls happen in loud rooms: filter other people's voices, don't let "okay"/"yeah" cut the agent off,
    // and take the turn sooner instead of waiting for a silence that never comes.
    vad: { background_voice_detection: true },
    turn: {
      turn_eagerness: "eager",
      merge_with_default_ignore_terms: true,
      interruption_ignore_terms: ["okay", "ok", "yeah", "yep", "yup", "mhm", "uh huh", "right", "word", "bet", "cool", "got it", "sure"],
    },
    asr: { quality: "high", keywords: ["Mayflower", "Kalshi", "Polymarket", "Gemini", "parlay", "moneyline", "spread"] },
  },
  // Public so a texted link can open the talk page; tools still need a valid call_token or caller id.
  // first_message override: settlement calls open with their own line (ringUserAbout); every other call keeps first_message.
  platform_settings: {
    auth: { enable_auth: false }, call_limits: { agent_concurrency_limit: 3, daily_limit: 60 },
    overrides: {
      conversation_config_override: { agent: { first_message: true }, conversation: { text_only: true } },
      // Inbound calls fetch their variables and opener from /api/voice/inbound before connecting.
      enable_conversation_initiation_client_data_from_webhook: true,
    },
    workspace_overrides: {
      conversation_initiation_client_data_webhook: { url: `${process.env.APP_URL}/api/voice/inbound`, request_headers: { [VOICE_SECRET_HEADER]: secret } },
    },
  },
};
const id = process.env.ELEVENLABS_AGENT_ID;
const out = id ? (await api("PATCH", `/agents/${id}`, agent), { agent_id: id }) : await api("POST", "/agents/create", agent);
console.log(JSON.stringify({ agent_id: out.agent_id, tools: toolIds.length, app_url: process.env.APP_URL }));
