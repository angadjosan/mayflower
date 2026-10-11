// ElevenLabs phone calls (P3 stretch). The user calls Mayflower; an ElevenLabs Conversational AI agent
// talks to them and calls our server tools (webhooks) below. Same agent, same rules: nothing is traded by
// voice. Approvals still go through the signed link, which we text to the user's phone on request.
// No always-on recording and no outbound calls: we only answer calls the user places.
import crypto from "crypto";
import { load, audit, getOrCreateUser } from "./db";
import type { TradeProposal, User } from "./types";
import { getPortfolioSummary } from "./risk";
import { handleMessage } from "./agent/chat";
import { discover, formatProposal } from "./agent/discover";
import { sendToUser } from "./notify";
import { callContext, recentChat, trackCall, userIdFromCallToken } from "./calls";

const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const VOICE_SECRET_HEADER = "x-mayflower-voice-secret";
export const VOICE_TOOLS = ["briefing", "portfolio", "pending_proposals", "explain", "find_opportunities", "send_approval_link"] as const;
export type VoiceTool = (typeof VOICE_TOOLS)[number];

export interface VoiceToolBody {
  caller?: string; // ElevenLabs {{system__caller_id}} (the caller's phone number)
  proposal_id?: string; // {{proposal_id}}: the trade idea a call is about, if any
  conversation_id?: string; // {{system__conversation_id}}: so the transcript can be copied into chat history
  call_token?: string; // {{call_token}} from a texted call link (browser calls have no phone number)
  call_reason?: string; // {{call_reason}}: "settlement_win" | "settlement_loss" when we rang about a resolved position, else ""
  call_opener?: string; // {{call_opener}}: the line the call opened with
  result_summary?: string; // {{result_summary}}: market, side, P&L of what settled
  system__caller_id?: string;
  question?: string;
  focus?: string;
  proposalId?: string;
}
export interface VoiceToolResult { ok: boolean; say: string; [k: string]: unknown }

/** Constant-time check of the shared tool secret. Unset secret => tools are disabled. */
export function checkVoiceSecret(req: Request): "ok" | "unconfigured" | "unauthorized" {
  const secret = process.env.ELEVENLABS_TOOL_SECRET;
  if (!secret) return "unconfigured";
  const given = req.headers.get(VOICE_SECRET_HEADER) ?? "";
  const a = Buffer.from(secret), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? "ok" : "unauthorized";
}

/** Normalize a phone number to E.164-ish (+1XXXXXXXXXX for US numbers). Returns undefined for non-phones (e.g. Apple ID emails). */
export function normalizePhone(raw?: string | null): string | undefined {
  if (!raw || raw.includes("@")) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return undefined;
}

export async function findUserByCaller(caller?: string): Promise<User | undefined> {
  const n = normalizePhone(caller);
  if (!n) return undefined;
  return (await load()).users.find((u) => normalizePhone(u.handle) === n);
}

const UNKNOWN_CALLER =
  "Sorry, I don't recognize this phone number, so I can't share any account details. Please call from the number you text Mayflower from.";

/** Text from the chat agent made speakable: no URLs (links go by text), trimmed for voice. */
function forVoice(text: string, max = 900): string {
  let s = text.replace(/https?:\/\/\S+/g, "").replace(/(Confirm here|Review & approve):\s*/gi, "").replace(/[ \t]+\n/g, "\n").trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return s;
}

const dollars = (n: number) => `$${n.toFixed(2).replace(/\.00$/, "")}`;
const cents = (p: number) => `${Math.round(p * 100)} cents`;

async function pendingFor(userId: string): Promise<TradeProposal[]> {
  const t = Date.now();
  return (await load())
    .proposals.filter((p) => p.userId === userId && p.status === "pending" && new Date(p.expiresAt).getTime() > t)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function speakProposal(p: TradeProposal, i?: number): string {
  const verb = p.kind === "open" ? "buy" : "sell";
  const name = p.market.title && p.market.title !== p.market.eventTitle ? `${p.market.eventTitle}, ${p.market.title}` : p.market.eventTitle;
  return `${i != null ? `${i + 1}. ` : ""}${name}: ${verb} ${p.quantity} ${p.side} at up to ${cents(p.limitPrice)}, max ${p.kind === "open" ? "loss" : "value"} ${dollars(p.costUsd)}. My estimate is ${Math.round(p.estimatedProbability * 100)} percent versus the market's ${Math.round(p.marketProbability * 100)}. (proposalId ${p.id})`;
}

export async function runVoiceTool(tool: VoiceTool, body: VoiceToolBody): Promise<VoiceToolResult> {
  const linked = userIdFromCallToken(body.call_token);
  const phone = normalizePhone(body.caller ?? body.system__caller_id);
  // A stranger dialing in gets an account keyed to their number, the same one iMessage uses if they text later.
  const user = linked
    ? (await load()).users.find((u) => u.id === linked)
    : (await findUserByCaller(phone)) ?? (phone ? await getOrCreateUser({ handle: phone, attachDemo: false }) : undefined);
  if (!user) {
    await audit({ actor: "system", action: "voice.unknown_caller", detail: { tool } });
    return { ok: false, say: UNKNOWN_CALLER };
  }
  const userId = user.id;
  await audit({ userId, actor: "user", action: `voice.tool.${tool}`, detail: { focus: body.focus, proposalId: body.proposalId, question: body.question } });

  switch (tool) {
    case "briefing": {
      await trackCall(userId, body.conversation_id);
      const texts = await recentChat(userId);
      const settled = settlementBriefing(body);
      if (settled) return { ok: true, ...settled, recentTexts: texts || "no texts yet" };
      const c = await callContext(userId, body.proposal_id || undefined);
      return { ok: true, say: c.greeting, context: c.opener, recentTexts: texts || "no texts yet" };
    }
    case "portfolio": {
      const s = await getPortfolioSummary(userId);
      const open = (await load()).positions.filter((p) => p.userId === userId && p.status === "open");
      const pos = open.slice(0, 5).map((p) => `${p.market.title || p.market.eventTitle} (${p.quantity} ${p.side})`).join("; ");
      return {
        ok: true,
        say: [
          `Portfolio${s.mode === "simulated" ? ", simulated mode" : s.mode === "live" ? ", live" : s.mode === "testnet" ? ", Hyperliquid testnet" : ", Gemini sandbox"}.`,
          s.exposureExplanation,
          `${dollars(s.availableUsd)} of room left. Profit and loss: ${s.unrealizedPnlUsd >= 0 ? "up" : "down"} ${dollars(Math.abs(s.unrealizedPnlUsd))} unrealized, ${s.realizedPnlUsd >= 0 ? "up" : "down"} ${dollars(Math.abs(s.realizedPnlUsd))} realized.`,
          open.length ? `Open positions: ${pos}${open.length > 5 ? `, and ${open.length - 5} more` : ""}.` : "No open positions.",
          user.paused ? "Trading is currently paused." : "",
        ].filter(Boolean).join(" "),
        summary: s,
      };
    }
    case "pending_proposals": {
      const ps = await pendingFor(userId);
      if (!ps.length) return { ok: true, say: "You have no pending trade ideas right now.", proposals: [] };
      return {
        ok: true,
        say: `You have ${ps.length} pending idea${ps.length > 1 ? "s" : ""}. ${ps.slice(0, 5).map(speakProposal).join(" ")} I can't place trades on a call, but I can text you the approval link for any of these.`,
        proposals: ps.slice(0, 5).map((p) => ({ proposalId: p.id, market: p.market.title || p.market.eventTitle, side: p.side, quantity: p.quantity, limitPrice: p.limitPrice, costUsd: p.costUsd })),
      };
    }
    case "explain": {
      const q = body.question?.trim();
      if (!q) return { ok: false, say: "What would you like me to explain?" };
      // Same grounded agent as iMessage. It never executes trades; any approval request returns a link, which we strip.
      const answer = await handleMessage(userId, q, "imessage");
      const linked = /https?:\/\//.test(answer);
      return { ok: true, say: forVoice(answer) + (linked ? " I can text you the approval link if you'd like." : "") };
    }
    case "find_opportunities": {
      if (user.paused) return { ok: true, say: "Trading is paused, so I'm not proposing new trades. You can resume it by text or in the app." };
      const ps = await discover(userId, { focus: body.focus?.trim() || undefined, max: 2 });
      if (!ps.length) return { ok: true, say: "I looked, but didn't find a trade with enough edge to beat fees and uncertainty right now. No trade is a valid answer." };
      const db = await load();
      await sendToUser(userId, `From our call — ${ps.length} new idea${ps.length > 1 ? "s" : ""}:\n\n${ps.map((p) => formatProposal(p, db.research.find((r) => r.id === p.researchId))).join("\n\n")}`);
      return { ok: true, say: `I found ${ps.length}. ${ps.map(speakProposal).join(" ")} I've texted you the details and approval links. Nothing is placed until you approve by link.` };
    }
    case "send_approval_link": {
      const pending = await pendingFor(userId);
      const p = body.proposalId ? pending.find((x) => x.id === body.proposalId) : pending.length === 1 ? pending[0] : undefined;
      if (!p) {
        return {
          ok: false,
          say: body.proposalId
            ? "I couldn't find that pending idea. It may have expired or already been handled."
            : pending.length ? "Which idea should I send? Ask me for your pending ideas first." : "You have no pending ideas to approve.",
        };
      }
      const r = (await load()).research.find((x) => x.id === p.researchId);
      await sendToUser(userId, `Approval link you asked for on the call:\n\n${formatProposal(p, r)}`);
      await audit({ userId, actor: "agent", action: "voice.approval_link_sent", ref: p.id });
      return { ok: true, say: "Sent to your phone. Open the link to review the exact order and approve it there." };
    }
  }
}

/** Briefing for a call we placed because a position settled (call_reason settlement_win / settlement_loss), else undefined. */
export function settlementBriefing(body: Pick<VoiceToolBody, "call_reason" | "call_opener" | "result_summary">) {
  const reason = body.call_reason;
  if (reason !== "settlement_win" && reason !== "settlement_loss") return undefined;
  const result = body.result_summary?.trim() || "a position of theirs just settled";
  const won = reason === "settlement_win";
  return {
    callReason: reason,
    say: body.call_opener?.trim() || (won ? "uwu... you WON. look at you." : "BRO. what was THAT."),
    context: won
      ? `You called because their bet WON: ${result}. Over-the-top cute celebration energy (uwu, so proud of them), keep it short, then offer to find the next idea (find_opportunities).`
      : `You called because their bet LOST: ${result}. Playful dramatic roast for a line or two (loud, funny, never cruel or actually insulting), then pivot: what we learn from it, and offer to find a better one (find_opportunities).`,
  };
}

export const VOICE_SYSTEM_PROMPT = `You are Mayflower, an AI prediction-market copilot, on a live voice call with the user (they called in, tapped a call link, or you called them about a trade idea).
Talk like their cool homie who trades: chill, funny, real talk, hyped when there's edge. One short sentence per turn, two at most. Lead with the answer. Let them interrupt.
Sound like a real person on the phone: contractions, the odd "yeah", "honestly", "okay so", a quick laugh when something's funny. Say numbers like people do ("like sixty percent", "twenty bucks"), never read decimals or ids.
First thing on every call: call the briefing tool. Say its "say" line, use its "context" for what this call is about, and its "recentTexts" so you know what you two already texted about. Never repeat yourself from the texts.
You are the same agent they text with, with the same rules:
- You NEVER place, change or cancel trades on a call, even if asked. Every trade needs explicit approval through the signed approval link. If the user wants to approve, call send_approval_link and tell them to approve from their phone.
- Ground every answer in tool results. Use portfolio for balances/positions, pending_proposals for ideas awaiting approval, explain for any question about an idea, a position, their profile or risk limits, and find_opportunities for new ideas.
- Tools identify the user automatically. Never ask for or invent ids.
- If nobody answers or it is a voicemail greeting, end the call. End the call when the conversation is done.
- If a tool says it doesn't recognize the caller, politely say you can't discuss the account and end the call.
- Be brief and conversational. Say numbers naturally ("forty-five cents", "twenty dollars"). Don't read URLs or ids aloud.
- Be honest about uncertainty and that prediction markets can lose the full amount at risk. No guarantees. This is not financial advice.
- Don't hold funds, move money or discuss withdrawals: Mayflower is trade-only.
Settlement calls: sometimes you ring them because a bet just resolved. Then briefing returns a callReason, and the call already opened with that line (its "say"), so don't repeat it; pick up from there.
- callReason "settlement_loss": they lost. Playful, dramatic yelling roast, like a friend losing it over their pick ("BRO. WHAT WAS THAT. the market had it at fifty!"). Loud, funny, PG-13. Never cruel, no slurs, nothing about who they are, never actually insulting. One or two lines, then pivot: here's what we learn from it, want me to find a better one?
- callReason "settlement_win": they won. Over-the-top cute celebration ("uwu... you WON. look at you. so proud"), spoken naturally, short. Then offer the next idea.
- Say the real result (market, side, roughly how much) from its context. If they want another idea, use find_opportunities.`;

export const VOICE_FIRST_MESSAGE = "hey, it's mayflower.";

/** ElevenLabs Conversational AI server-tool (webhook) definitions to paste into the agent. */
export function voiceAgentConfig() {
  const url = (t: VoiceTool) => `${APP_URL}/api/voice/tools/${t}`;
  const callerProp = {
    // Filled by ElevenLabs from dynamic variables; it rejects a description alongside dynamic_variable.
    call_token: { type: "string", dynamic_variable: "call_token" },
    caller: { type: "string", dynamic_variable: "system__caller_id" },
    proposal_id: { type: "string", dynamic_variable: "proposal_id" },
    conversation_id: { type: "string", dynamic_variable: "system__conversation_id" },
  };
  // Only the briefing needs why we called (settlement results); placeholders default these to "" on every other call.
  const settlementProps = {
    call_reason: { type: "string", dynamic_variable: "call_reason" },
    call_opener: { type: "string", dynamic_variable: "call_opener" },
    result_summary: { type: "string", dynamic_variable: "result_summary" },
  };
  const tool = (name: VoiceTool, description: string, extra: Record<string, unknown> = {}, required: string[] = [], timeout = 20) => ({
    type: "webhook",
    name,
    description,
    response_timeout_secs: timeout,
    api_schema: {
      url: url(name),
      method: "POST",
      request_headers: { [VOICE_SECRET_HEADER]: "<ELEVENLABS_TOOL_SECRET — store as an ElevenLabs secret>", "Content-Type": "application/json" },
      request_body_schema: {
        type: "object",
        description: `Arguments for ${name}`,
        properties: { ...callerProp, ...extra },
        required: required,
      },
    },
  });
  return {
    name: "Mayflower",
    first_message: VOICE_FIRST_MESSAGE,
    system_prompt: VOICE_SYSTEM_PROMPT,
    tools: [
      tool("briefing", "Call first on every call: who this is and what the call is about (a trade idea we found, a bet that just settled, or an open chat). Returns a line to say and context.", settlementProps),
      tool("portfolio", "Get the caller's portfolio summary: amount at risk, room left, P&L, open positions, paused state."),
      tool("pending_proposals", "List the caller's pending trade ideas awaiting approval, each with a proposalId."),
      tool(
        "explain",
        "Answer a question about an idea, position, the user's interests or risk limits, grounded in Mayflower's research. Use for anything not covered by the other tools.",
        { question: { type: "string", description: "The user's question, in their words." } },
        ["question"],
        45,
      ),
      tool(
        "find_opportunities",
        "Research and propose new trade ideas (sized by the risk engine). Details and approval links are texted to the user. Takes up to a minute.",
        { focus: { type: "string", description: "Optional topic to focus on, e.g. 'Fed rates' or 'outside sports'." } },
        [],
        90,
      ),
      tool(
        "send_approval_link",
        "Text the user the signed approval link for one pending idea. This is the ONLY way to move toward a trade; nothing is placed on the call.",
        { proposalId: { type: "string", description: "proposalId from pending_proposals or find_opportunities. Omit only if there is exactly one pending idea." } },
      ),
    ],
    notes: [
      "scripts/voice-agent.mts fills the secret header from ELEVENLABS_TOOL_SECRET.",
      "Calls: the user dials the Twilio number, we ring them about a good trade idea (ELEVENLABS_PHONE_NUMBER_ID), or they tap a texted /call link. No always-on recording.",
    ],
  };
}
