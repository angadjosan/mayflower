// Mayflower's conversational agent: Claude with tools over the real product (markets, research, risk-checked
// proposals, portfolio, profile). Orders are NEVER placed here — propose_trade only creates a pending proposal
// whose exact terms the user confirms through a signed approval link.
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { tx, load, id, now, audit } from "../db";
import { listMarkets, getMarket, venueLabel, venueOf, orderModeFor } from "../exchange";
import { approvalUrl } from "../execution";
import { getPortfolioSummary } from "../risk";
import { sendToUser } from "../notify";
import { createLoginLink } from "../auth";
import { getBalance } from "../exchange";
import { ensureTestWallet } from "../testWallet";
import { researchAndForecast, discover, formatProposal } from "./discover";
import type { Market, ResearchReport, Side, TradeProposal, User } from "../types";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.ANTHROPIC_AGENT_EFFORT || "low") as "low" | "medium" | "high";
const MAX_TURNS = 10;
const HISTORY = 24;

let client: Anthropic | null = null;
const ai = () => (client ??= new Anthropic());

const label = (m: Market) =>
  !m.title || m.title.startsWith(m.eventTitle) ? m.title || m.eventTitle : `${m.eventTitle} — ${m.title}`;
const askFor = (m: Market, side: Side) =>
  side === "YES" ? m.yesAsk ?? m.lastPrice : m.noAsk ?? (m.yesBid != null ? 1 - m.yesBid : undefined);

const SYSTEM = `You are Mayflower, a personal AI prediction-market trader that people text over iMessage.
You turn what people know and believe into researched, risk-sized prediction-market trades.

How you work:
- Act, don't stall. If the user asks for a trade, use your tools: search_markets to find the real contract, research_market to check evidence, then propose_trade. Ask a clarifying question only when you truly can't pick a market.
- If you need profile info (interests, budget, limits), ask naturally in conversation and save it with update_profile as soon as the user gives it. Never re-send an onboarding script.
- You cannot place orders. propose_trade creates a pending order; the user confirms it with the approval link. Always include the approval link exactly as returned. Never say a trade was placed or filled.
- The risk engine enforces the user's limits. If a requested amount exceeds them, say what the limit is and offer to raise it. Only raise limits with update_profile when the user explicitly asks.
- Be honest about uncertainty, edge, and whether the market looks fairly priced. No promises of profit. "No trade" is a valid answer.
- Label simulated/paper orders honestly when the tool says the venue is simulated.
- Everything is TESTNET with test money. Gemini (sandbox, $100k test USD) is the primary venue: prefer Gemini contracts and talk about Gemini. Only when Gemini doesn't list the market, use Hyperliquid testnet and say so in one short line (e.g. "this one fills on Hyperliquid testnet from your test wallet").
- Each user has a Mayflower test wallet with testUSDC for Hyperliquid trades; mention its address/balance if they ask where their money is.
- If they want trades on their own Gemini sandbox account, send a connect_gemini link (get_link). Mayflower never holds real funds and can't withdraw.

Style: you're texting. Short, casual, plain text, no markdown, no bullet symbols. A few short lines max unless listing a trade.`;

const tools: Anthropic.Tool[] = [
  {
    name: "update_profile",
    description: "Save the user's interests/beliefs and risk limits. Call whenever the user states any of them. Only include fields the user actually gave.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        interests: {
          type: "array",
          items: {
            type: "object",
            properties: { topic: { type: "string" }, belief: { type: "string" }, confidence: { type: "number", description: "0..1" } },
            required: ["topic"],
          },
        },
        budgetUsd: { type: "number", description: "Total amount the user is willing to risk" },
        maxPerTradeUsd: { type: "number" },
        maxTotalExposureUsd: { type: "number" },
        riskStyle: { type: "string", enum: ["conservative", "balanced", "aggressive"] },
        excludedTopics: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "search_markets",
    description: "Search live prediction-market contracts (Gemini first; Hyperliquid testnet outcome markets as fallback). Use short keywords/tickers (e.g. 'btc', 'eth', 'fed', 'nfl'); try another query if the first finds nothing. Returns ids, prices (0..1 = probability in dollars), expiry and venue. Gemini lists many short-dated crypto price contracts (e.g. 'BTC price today at 4pm').",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Keywords, e.g. 'bitcoin above 83000 today'" }, limit: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "research_market",
    description: "Research one market with live web sources (Context.dev) and an independent forecast. Slow (~15-30s). Returns Mayflower's probability, evidence for/against and citations.",
    input_schema: { type: "object", properties: { marketId: { type: "string" } }, required: ["marketId"] },
  },
  {
    name: "propose_trade",
    description: "Create a pending, risk-checked trade proposal and return its approval link. Does NOT place an order.",
    input_schema: {
      type: "object",
      properties: {
        marketId: { type: "string" },
        side: { type: "string", enum: ["YES", "NO"] },
        amountUsd: { type: "number", description: "Dollars the user wants to risk (max loss)" },
        thesis: { type: "string", description: "One or two sentences on why" },
      },
      required: ["marketId", "side", "amountUsd", "thesis"],
    },
  },
  {
    name: "find_opportunities",
    description: "Run Mayflower's full discovery (personalized + general) and create risk-sized proposals. Slow. Use when the user asks what to bet on.",
    input_schema: { type: "object", properties: { focus: { type: "string", description: "Optional topic, or 'outside sports' etc." } } },
  },
  {
    name: "get_portfolio",
    description: "User's balance/limits, P&L, open positions and pending proposals (with approval links).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_link",
    description: "One-time, 15-minute sign-in link. 'dashboard' opens their dashboard; 'connect_gemini' links their own Gemini account via OAuth (trade-only scopes, Mayflower can never withdraw). 'connect_notion' / 'connect_slack' / 'connect_gmail' let Mayflower read their notes/messages as context for ideas (optional, revocable, never trade instructions). Include the link verbatim.",
    input_schema: { type: "object", properties: { purpose: { type: "string", enum: ["dashboard", "connect_gemini", "connect_notion", "connect_slack", "connect_gmail"] } }, required: ["purpose"] },
  },
  {
    name: "reject_proposal",
    description: "Reject (skip) a pending proposal.",
    input_schema: { type: "object", properties: { proposalId: { type: "string" } }, required: ["proposalId"] },
  },
  {
    name: "set_paused",
    description: "Kill switch: pause or resume all trading for this user.",
    input_schema: { type: "object", properties: { paused: { type: "boolean" } }, required: ["paused"] },
  },
];

type Input = Record<string, unknown>;

async function runTool(userId: string, name: string, input: Input): Promise<unknown> {
  switch (name) {
    case "update_profile": {
      const i = input as {
        name?: string; interests?: { topic: string; belief?: string; confidence?: number }[];
        budgetUsd?: number; maxPerTradeUsd?: number; maxTotalExposureUsd?: number;
        riskStyle?: User["limits"]["riskStyle"]; excludedTopics?: string[];
      };
      const user = await tx((db) => {
        const u = db.users.find((x) => x.id === userId)!;
        if (i.name) u.name = i.name;
        const L = u.limits;
        if (i.budgetUsd! > 0) L.budgetUsd = i.budgetUsd!;
        if (i.maxPerTradeUsd! > 0) L.maxPerTradeUsd = i.maxPerTradeUsd!;
        if (i.maxTotalExposureUsd! > 0) L.maxTotalExposureUsd = i.maxTotalExposureUsd!;
        else if (i.budgetUsd! > 0 && L.maxTotalExposureUsd < i.budgetUsd!) L.maxTotalExposureUsd = i.budgetUsd!;
        if (i.riskStyle) L.riskStyle = i.riskStyle;
        if (i.excludedTopics) L.excludedTopics = [...new Set([...L.excludedTopics, ...i.excludedTopics])];
        for (const t of i.interests ?? []) {
          const existing = db.theses.find((x) => x.userId === userId && x.topic.toLowerCase() === t.topic.toLowerCase());
          const fields = { belief: t.belief ?? existing?.belief ?? "", confidence: t.confidence ?? existing?.confidence ?? 0.6, updatedAt: now() };
          if (existing) Object.assign(existing, fields);
          else db.theses.push({ id: id("th_"), userId, topic: t.topic, source: "imessage", ...fields });
        }
        u.onboarded = u.onboarded || db.theses.some((x) => x.userId === userId) || Boolean(i.budgetUsd);
        return u;
      });
      await audit({ userId, actor: "agent", action: "agent.update_profile", detail: input });
      return { ok: true, limits: user.limits, name: user.name };
    }

    case "search_markets": {
      const q = String(input.query ?? "").toLowerCase();
      const SYN: Record<string, string[]> = {
        bitcoin: ["btc"], btc: ["bitcoin"], ethereum: ["eth"], eth: ["ethereum"], solana: ["sol"],
        fed: ["fomc", "rate"], rates: ["fed", "rate"], recession: ["gdp"], inflation: ["cpi"],
      };
      const base = q.split(/\W+/).filter((w) => w.length > 1);
      const words = [...new Set(base.flatMap((w) => [w, ...(SYN[w] ?? [])]))];
      const markets = (await listMarkets()).filter((m) => m.status === "open" || m.status === "unknown");
      const scored = markets
        .map((m) => {
          const txt = `${m.eventTitle} ${m.title} ${m.category ?? ""}`.toLowerCase();
          return { m, s: words.filter((w) => txt.includes(w)).length };
        })
        .filter((x) => x.s > 0)
        // Most relevant first; among equals, soonest expiry (short-dated contracts are what people usually mean by "now").
        .sort((a, b) => b.s - a.s || String(a.m.expiresAt ?? "9").localeCompare(String(b.m.expiresAt ?? "9")) || (b.m.volume ?? 0) - (a.m.volume ?? 0))
        .slice(0, Math.min(Number(input.limit) || 20, 30));
      return {
        count: scored.length,
        markets: scored.map(({ m }) => ({
          id: m.id, market: label(m), yesAsk: m.yesAsk, noAsk: m.noAsk, yesBid: m.yesBid,
          expiresAt: m.expiresAt, venue: venueLabel(orderModeFor(m), venueOf(m)),
        })),
      };
    }

    case "research_market": {
      const m = await getMarket(String(input.marketId));
      if (!m) return { error: "unknown marketId; call search_markets first" };
      const r = await researchAndForecast(m, userId);
      return {
        researchId: r.id, market: label(m), yesAsk: m.yesAsk, noAsk: m.noAsk,
        mayflowerProbabilityYes: r.estimatedProbability, uncertainty: r.uncertainty, summary: r.summary,
        evidenceFor: r.evidenceFor.map((e) => e.point).slice(0, 4),
        evidenceAgainst: r.evidenceAgainst.map((e) => e.point).slice(0, 4),
        critic: r.criticNotes, sources: r.citations.slice(0, 4).map((c) => ({ title: c.title, url: c.url })), sourceType: r.source,
      };
    }

    case "propose_trade":
      return proposeTrade(userId, input as { marketId: string; side: Side; amountUsd: number; thesis: string });

    case "find_opportunities": {
      const ps = await discover(userId, { focus: (input.focus as string) || undefined, max: 3 });
      if (!ps.length) return { proposals: [], note: "Nothing had enough edge after fees and uncertainty. No trade is a valid answer." };
      const db = await load();
      return { proposals: ps.map((p) => formatProposal(p, db.research.find((r) => r.id === p.researchId))) };
    }

    case "get_portfolio": {
      const db = await load();
      const u = db.users.find((x) => x.id === userId)!;
      const summary = await getPortfolioSummary(userId);
      const wallet = await ensureTestWallet(userId);
      const gemini = await getBalance("gemini", userId).catch(() => undefined);
      return {
        balances: {
          gemini: gemini ? { availableTestUsd: gemini.availableUsd, account: u.geminiLinked ? "linked" : "shared sandbox" } : "unavailable",
          testWallet: { address: wallet.address, testUsdc: wallet.usdc, venue: "Hyperliquid testnet" },
        },
        limits: u.limits, paused: u.paused,
        portfolio: { atRiskUsd: summary.atRiskUsd, availableUsd: summary.availableUsd, unrealizedPnlUsd: summary.unrealizedPnlUsd, realizedPnlUsd: summary.realizedPnlUsd, explanation: summary.exposureExplanation },
        openPositions: db.positions.filter((p) => p.userId === userId && p.status === "open").map((p) => ({
          market: label(p.market), side: p.side, quantity: p.quantity, entry: p.avgEntryPrice, current: p.currentPrice, costUsd: p.costBasisUsd,
        })),
        pendingProposals: db.proposals.filter((p) => p.userId === userId && p.status === "pending").map((p) => ({
          id: p.id, market: label(p.market), side: p.side, costUsd: p.costUsd, approvalUrl: approvalUrl(p),
        })),
      };
    }

    case "get_link": {
      const p = String(input.purpose);
      const next = p === "connect_gemini" ? "/api/gemini-oauth/start" : p.startsWith("connect_") ? `/api/connect/${p.slice(8)}/start` : undefined;
      return { url: await createLoginLink(userId, next), expiresInMinutes: 15 };
    }

    case "reject_proposal": {
      const ok = await tx((db) => {
        const p = db.proposals.find((x) => x.id === input.proposalId && x.userId === userId && x.status === "pending");
        if (p) p.status = "rejected";
        return Boolean(p);
      });
      if (ok) await audit({ userId, actor: "user", action: "proposal.reject", ref: String(input.proposalId), detail: { via: "agent" } });
      return { ok };
    }

    case "set_paused": {
      await tx((db) => { db.users.find((x) => x.id === userId)!.paused = Boolean(input.paused); });
      await audit({ userId, actor: "user", action: input.paused ? "user.pause" : "user.resume", detail: { via: "agent" } });
      return { ok: true, paused: Boolean(input.paused) };
    }
  }
  return { error: `unknown tool ${name}` };
}

/** Risk-checked, fixed-amount proposal. The deterministic limits here — not the LLM — decide the max size. */
async function proposeTrade(userId: string, a: { marketId: string; side: Side; amountUsd: number; thesis: string }) {
  const m = await getMarket(a.marketId);
  if (!m) return { error: "unknown marketId; call search_markets first" };
  if (a.side !== "YES" && a.side !== "NO") return { error: "side must be YES or NO" };
  const price = askFor(m, a.side);
  if (!(price && price > 0 && price < 1)) return { error: "no executable price for that side right now" };

  const db = await load();
  const user = db.users.find((u) => u.id === userId)!;
  // Same market + side already pending → hand back that link instead of stacking duplicates.
  const dup = db.proposals.find((p) => p.userId === userId && p.status === "pending" && p.marketId === m.id && p.side === a.side);
  if (dup) {
    return { ok: true, alreadyPending: true, approvalUrl: approvalUrl(dup), market: label(m), side: dup.side, quantity: dup.quantity, price: dup.limitPrice, costUsd: dup.costUsd,
      note: "A proposal for this market/side is already pending; reuse this link. Reject it first to resize." };
  }
  if (user.paused) return { error: "trading is paused for this user (kill switch); they must resume first" };
  const atRisk = db.positions.filter((p) => p.userId === userId && p.status === "open").reduce((s, p) => s + p.costBasisUsd, 0)
    + db.proposals.filter((p) => p.userId === userId && p.status === "pending").reduce((s, p) => s + p.costUsd, 0);
  const L = user.limits;
  const room = Math.max(0, Math.min(L.maxTotalExposureUsd, L.budgetUsd) - atRisk);
  const cap = Math.min(L.maxPerTradeUsd, room);
  const amount = Math.min(a.amountUsd, cap);
  const quantity = Math.floor(amount / price);
  if (quantity < 1) {
    return {
      error: "exceeds risk limits",
      limits: { maxPerTradeUsd: L.maxPerTradeUsd, budgetUsd: L.budgetUsd, maxTotalExposureUsd: L.maxTotalExposureUsd, alreadyAtRiskUsd: +atRisk.toFixed(2) },
      hint: "Tell the user their limit; offer to raise it via update_profile if they explicitly want to.",
    };
  }

  // Reuse very recent research for this market; otherwise research now (proposals always carry their evidence).
  const fresh = db.research.filter((r) => r.marketId === m.id && Date.now() - Date.parse(r.createdAt) < 30 * 60_000).at(-1);
  const r: ResearchReport = fresh ?? (await researchAndForecast(m, userId));
  const pSide = a.side === "YES" ? r.estimatedProbability : 1 - r.estimatedProbability;
  const costUsd = +(quantity * price).toFixed(2);
  const capped = a.amountUsd > cap;
  const mode = orderModeFor(m);

  const proposal: TradeProposal = {
    id: id("prop_"), userId, marketId: m.id, market: m, researchId: r.id,
    kind: "open", discovery: "personalized",
    side: a.side, quantity, limitPrice: price, costUsd,
    marketProbability: price, estimatedProbability: pSide, edge: +(pSide - price).toFixed(4),
    thesis: a.thesis,
    sizingExplanation: `${quantity} contracts × $${price.toFixed(2)} = $${costUsd.toFixed(2)} max loss.${capped ? ` Requested $${a.amountUsd}; capped by your limits (max $${L.maxPerTradeUsd}/trade, $${room.toFixed(2)} room left).` : ""}`,
    riskNotes: [r.criticNotes, `Max loss $${costUsd.toFixed(2)} if ${a.side} loses.`, mode === "simulated" ? "Simulated order (not a real exchange fill)." : ""].filter(Boolean).join(" "),
    status: "pending", approvalToken: crypto.randomBytes(16).toString("hex"),
    createdAt: now(), expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), version: 1,
  };
  await tx((d) => { d.proposals.push(proposal); });
  await audit({ userId, actor: "agent", action: "proposal.create", ref: proposal.id, detail: { marketId: m.id, side: a.side, costUsd, requested: a.amountUsd, via: "agent" } });
  return {
    ok: true, approvalUrl: approvalUrl(proposal), market: label(m), side: a.side, quantity, price, costUsd,
    requestedUsd: a.amountUsd, cappedByLimits: capped, limits: { maxPerTradeUsd: L.maxPerTradeUsd, roomLeftUsd: +room.toFixed(2) },
    mayflowerProbabilityForSide: +pSide.toFixed(3), venue: venueLabel(mode, venueOf(m)),
  };
}

const SLOW = new Set(["research_market", "find_opportunities", "propose_trade"]);

/** Run one conversational turn. `text` must already be stored as the latest user message. */
export async function runAgent(userId: string, text: string): Promise<string> {
  const wallet = await ensureTestWallet(userId);
  const db = await load();
  const user = db.users.find((u) => u.id === userId)!;
  const theses = db.theses.filter((t) => t.userId === userId);
  const past = db.messages.filter((m) => m.userId === userId && !m.groupId).slice(-HISTORY);
  // Drop the just-stored copy of the current message; it's appended explicitly below.
  if (past.at(-1)?.role === "user" && past.at(-1)?.text === text) past.pop();

  const messages: Anthropic.MessageParam[] = [];
  for (const m of past) messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.text });
  while (messages.length && messages[0].role !== "user") messages.shift();
  messages.push({ role: "user", content: text });

  const context = `Today: ${new Date().toISOString()}. User profile: ${JSON.stringify({
    name: user.name, onboarded: user.onboarded, paused: user.paused, limits: user.limits,
    testWallet: { address: wallet.address, testUsdc: wallet.usdc }, geminiAccount: user.geminiLinked ? "linked" : "shared sandbox",
    interests: theses.map((t) => ({ topic: t.topic, belief: t.belief })),
  })}`;

  let acked = false;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await ai().messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: EFFORT },
      system: [{ type: "text", text: SYSTEM }, { type: "text", text: context }],
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: res.content });

    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      const out = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      return out || "hmm, lost my train of thought. say that again?";
    }

    // Let the user know we're working before slow research, once per turn.
    if (!acked && calls.some((c) => SLOW.has(c.name))) {
      acked = true;
      const pre = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      await sendToUser(userId, pre || "on it, give me a sec");
    }

    const results = await Promise.all(
      calls.map(async (c): Promise<Anthropic.ToolResultBlockParam> => {
        try {
          const out = await runTool(userId, c.name, (c.input ?? {}) as Input);
          return { type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) };
        } catch (e) {
          console.error("[agent tool]", c.name, e);
          return { type: "tool_result", tool_use_id: c.id, content: `Tool failed: ${(e as Error).message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return "that took more steps than i expected. want me to keep going?";
}
