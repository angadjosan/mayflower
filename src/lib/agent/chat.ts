// Conversational router for iMessage + web chat. Never executes trades from text.
import { tx, load, audit } from "../db";
import { generateJSON, generateText, llmEnabled } from "../llm";
import { approvalUrl } from "../execution";
import { getPortfolioSummary } from "../risk";
import { updateProfileFromMessage } from "./profile";
import { discover, formatProposal } from "./discover";
import { createLoginLink } from "../auth";
import type { TradeProposal, UserThesis } from "../types";

type Intent = "profile" | "discover" | "question" | "approve" | "reject" | "portfolio" | "pause" | "resume" | "smalltalk";

const SYSTEM = `You are Mayflower, a friendly AI copilot for prediction markets, chatting over iMessage. Keep replies short (2-5 sentences, plain text, no markdown).
Never promise profit or certainty; be honest about uncertainty and that any trade can lose its full cost. You never place trades from chat — every trade needs the user to confirm the exact order on the approval page.
Ground answers ONLY in the JSON context provided; if something isn't there, say you don't know.`;

const ONBOARDING = `Hi, I'm Mayflower — I find prediction-market trades that fit what you know and size them so you never risk more than you choose.
To get started, tell me:
1) Topics you follow (sports teams, AI, crypto, economy...) and any beliefs you hold
2) How much total you're willing to risk (e.g. $200)
3) Max per trade (e.g. $20)
4) Conservative, balanced, or aggressive?
I'll never trade without your explicit approval.`;

function heuristicIntent(t: string): Intent {
  const s = t.toLowerCase();
  if (/^\s*(pause|stop trading|kill switch|halt)\b/.test(s)) return "pause";
  if (/^\s*(resume|unpause|start again|restart)\b/.test(s)) return "resume";
  if (/\b(approve|confirm|go ahead|do it|place (the|it)|buy it|execute)\b/.test(s)) return "approve";
  if (/^\s*(reject|skip|pass|no thanks|nah|decline)\b/.test(s)) return "reject";
  if (/\b(find|discover|search|look for|any|new|more)\b.*\b(opportunit\w*|ideas?|markets?|trades?|bets?)\b/.test(s)) return "discover";
  if (/\b(portfolio|positions?|riskiest|what changed|overnight|p&l|pnl|balance|exposure|how am i doing)\b/.test(s)) return "portfolio";
  if (/\b(why|what would|how come|explain|change your mind|evidence|sources?)\b|\?$/.test(s)) return "question";
  if (/\$\s?\d|\b(follow|interested|i think|i believe|conservative|aggressive|balanced|budget|exclude|stop looking|avoid|my name)\b/.test(s)) return "profile";
  return "smalltalk";
}

/** Account/meta intents handled deterministically before LLM classification (they mint links, so never guess). */
type MetaIntent =
  | { kind: "connect"; provider: "notion" | "slack" | "gmail" }
  | { kind: "gemini" }
  | { kind: "hedge" }
  | { kind: "sources" }
  | { kind: "dashboard" };

function metaIntent(t: string): MetaIntent | undefined {
  const s = t.toLowerCase();
  const conn = s.match(/\b(?:connect|link|hook up|add)\s+(?:my\s+)?(notion|slack|gmail)\b/);
  if (conn) return { kind: "connect", provider: conn[1] as "notion" | "slack" | "gmail" };
  if (/\b(?:connect|link)\s+(?:my\s+)?gemini\b/.test(s)) return { kind: "gemini" };
  if (/\bhedge\b/.test(s)) return { kind: "hedge" };
  if (/\bwhat do you know about me\b|\bmy (?:data )?sources\b|\bwhere did you (?:get|learn)\b/.test(s)) return { kind: "sources" };
  if (/\b(dashboard|log ?in|sign ?in)\b/.test(s)) return { kind: "dashboard" };
  return undefined;
}

const SOURCE_LABEL: Record<UserThesis["source"], string> = {
  chat: "From our chats", imessage: "From our chats", manual: "Added on the dashboard",
  notion: "From Notion", slack: "From Slack", gmail: "From Gmail", discord: "From Discord",
};

function sourcesText(userId: string): string {
  const db = load();
  const theses = db.theses.filter((t) => t.userId === userId);
  if (!theses.length) return "I don't know much about you yet — tell me topics you follow or beliefs you hold and I'll remember them.";
  const groups = new Map<string, UserThesis[]>();
  for (const t of theses) {
    const label = SOURCE_LABEL[t.source] ?? t.source;
    groups.set(label, [...(groups.get(label) ?? []), t]);
  }
  const lines = ["Here's what I know about you:"];
  for (const [label, ts] of groups) {
    lines.push(`${label}:`);
    for (const t of ts.slice(0, 8)) lines.push(`• ${t.topic}${t.belief ? `: ${t.belief}` : ""}`);
    if (ts.length > 8) lines.push(`• ...and ${ts.length - 8} more`);
  }
  const connected = db.connectedSources.filter((c) => c.userId === userId && c.status === "connected");
  if (connected.length) lines.push(`Connected sources: ${connected.map((c) => c.provider + (c.accountLabel ? ` (${c.accountLabel})` : "")).join(", ")}.`);
  lines.push(`You can disconnect any source (and drop what it taught me) on your dashboard: ${createLoginLink(userId)}`);
  return lines.join("\n");
}

function metaReply(userId: string, m: MetaIntent): string {
  switch (m.kind) {
    case "dashboard":
      return `Here's your private dashboard link (expires in 15 min, works once): ${createLoginLink(userId)}`;
    case "connect": {
      const name = m.provider === "gmail" ? "Gmail" : m.provider[0].toUpperCase() + m.provider.slice(1);
      return `Connecting ${name} is optional — I only read it as context for your interests (never as trade instructions), and you can revoke it anytime from the dashboard.\nConnect here (expires in 15 min): ${createLoginLink(userId, `/api/connect/${m.provider}/start`)}`;
    }
    case "gemini":
      return `Link your Gemini account here (expires in 15 min). I'll still ask you to approve every order: ${createLoginLink(userId, "/api/gemini-oauth/start")}`;
    case "hedge":
      return `Hedge ideas for your open positions are on the Risk panel of your dashboard (expires in 15 min): ${createLoginLink(userId)}\nNothing is placed without your approval.`;
    case "sources":
      return sourcesText(userId);
  }
}

async function classify(text: string): Promise<Intent> {
  try {
    const r = await generateJSON<{ intent: Intent }>(
      `Message: """${text}"""
Classify into one intent:
profile (sharing interests, beliefs, budget, risk limits, topics to exclude, name),
discover (asking for new trade ideas/opportunities),
question (asking about a recommendation, sizing, evidence, or position),
approve (wants to approve/place a trade), reject (rejects/skips a proposal),
portfolio (asks about portfolio, positions, P&L, risk, what changed),
pause (stop all trading), resume (re-enable trading), smalltalk.
Return JSON {"intent": "..."}.`,
      "You classify chat messages for a prediction-market assistant. Return ONLY JSON.",
    );
    const ok: Intent[] = ["profile", "discover", "question", "approve", "reject", "portfolio", "pause", "resume", "smalltalk"];
    if (ok.includes(r?.intent)) return r.intent;
  } catch { /* fallback */ }
  return heuristicIntent(text);
}

function pendingFor(userId: string): TradeProposal[] {
  const t = Date.now();
  return load().proposals
    .filter((p) => p.userId === userId && p.status === "pending" && Date.parse(p.expiresAt) > t)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Pick the pending proposal the user is most likely referring to (amount or keyword match, else most recent). */
function matchProposal(userId: string, text: string): TradeProposal | undefined {
  const pend = pendingFor(userId);
  const s = text.toLowerCase();
  const amt = s.match(/\$\s?(\d+(?:\.\d+)?)/);
  if (amt) {
    const a = parseFloat(amt[1]);
    const hit = pend.find((p) => Math.abs(p.costUsd - a) < 1);
    if (hit) return hit;
  }
  const words = s.split(/\W+/).filter((w) => w.length > 3 && !["approve", "trade", "that", "this", "reject", "skip", "please"].includes(w));
  const kw = pend.find((p) => words.some((w) => `${p.market.eventTitle} ${p.market.title}`.toLowerCase().includes(w)));
  return kw ?? pend[0];
}

async function proposalsText(userId: string, focus?: string): Promise<string> {
  const props = await discover(userId, focus ? { focus } : undefined);
  if (!props.length) return "I looked, but didn't find a trade with enough edge to beat fees and uncertainty right now. No trade is a valid answer — I'll keep watching.";
  const db = load();
  return props.map((p) => formatProposal(p, db.research.find((r) => r.id === p.researchId))).join("\n\n");
}

function portfolioText(userId: string, text: string): string {
  const s = getPortfolioSummary(userId);
  const db = load();
  const open = db.positions.filter((p) => p.userId === userId && p.status === "open");
  const lines = [
    `Portfolio${s.mode === "simulated" ? " (simulated)" : " (sandbox)"}: $${s.atRiskUsd.toFixed(2)} at risk of your $${s.riskBudgetUsd} budget, $${s.availableUsd.toFixed(2)} room left. P&L: ${s.unrealizedPnlUsd >= 0 ? "+" : ""}$${s.unrealizedPnlUsd.toFixed(2)} unrealized, ${s.realizedPnlUsd >= 0 ? "+" : ""}$${s.realizedPnlUsd.toFixed(2)} realized.`,
  ];
  if (!open.length) lines.push("No open positions yet.");
  else {
    const risky = /risk/i.test(text);
    const sorted = [...open].sort((a, b) => b.costBasisUsd - a.costBasisUsd).slice(0, risky ? 3 : 5);
    if (risky) lines.push(s.exposureExplanation);
    for (const p of sorted) {
      const cur = p.currentPrice ?? p.avgEntryPrice;
      lines.push(`• ${p.market.title || p.market.eventTitle}: ${p.quantity} ${p.side} @ $${p.avgEntryPrice.toFixed(2)} → $${cur.toFixed(2)} (max loss $${p.costBasisUsd.toFixed(2)})`);
    }
  }
  const since = Date.now() - 24 * 3600 * 1000;
  const events = db.monitorEvents.filter((e) => e.userId === userId && Date.parse(e.createdAt) > since).slice(-3);
  if (events.length) lines.push("Recent updates:", ...events.map((e) => `• ${e.recommendation.toUpperCase()}: ${e.explanation}`));
  else if (/changed|overnight|new/i.test(text)) lines.push("Nothing notable changed in the last 24h.");
  return lines.join("\n");
}

async function answerQuestion(userId: string, text: string): Promise<string> {
  const db = load();
  const pend = pendingFor(userId).slice(0, 3);
  const target = matchProposal(userId, text);
  const positions = db.positions.filter((p) => p.userId === userId && p.status === "open");
  const ctx = {
    limits: db.users.find((u) => u.id === userId)?.limits,
    pendingProposals: pend.map((p) => ({
      market: `${p.market.eventTitle} — ${p.market.title}`, side: p.side, costUsd: p.costUsd, quantity: p.quantity,
      price: p.limitPrice, estimatedProbability: p.estimatedProbability, thesis: p.thesis,
      sizingExplanation: p.sizingExplanation, riskNotes: p.riskNotes,
      research: (() => {
        const r = db.research.find((x) => x.id === p.researchId);
        return r && { summary: r.summary, evidenceFor: r.evidenceFor.map((e) => e.point), evidenceAgainst: r.evidenceAgainst.map((e) => e.point), uncertainty: r.uncertainty, critic: r.criticNotes, whatWouldChangeMind: r.whatWouldChangeMind, sources: r.citations.slice(0, 4).map((c) => c.url) };
      })(),
    })),
    openPositions: positions.map((p) => ({ market: p.market.title, side: p.side, quantity: p.quantity, entry: p.avgEntryPrice, current: p.currentPrice, latestAssessment: p.latestAssessment, watchConditions: p.watchConditions })),
    portfolio: getPortfolioSummary(userId),
  };
  try {
    if (!llmEnabled) throw new Error("LLM_DISABLED");
    return (await generateText(`Context JSON:\n${JSON.stringify(ctx)}\n\nUser asks: "${text}"\nAnswer briefly.`, SYSTEM)).trim();
  } catch {
    if (!target) return positions.length ? `Your open positions: ${positions.map((p) => p.market.title).join("; ")}. Ask about one specifically, or say "portfolio".` : "I don't have any pending ideas right now. Say \"find opportunities\" and I'll look.";
    const r = db.research.find((x) => x.id === target.researchId);
    if (/change.*mind|what would/i.test(text) && r?.whatWouldChangeMind) return r.whatWouldChangeMind;
    if (/\$|size|only|why so (small|little|much)|how much/i.test(text)) return target.sizingExplanation;
    return `${target.thesis}\n${target.riskNotes}`;
  }
}

export async function handleMessage(userId: string, text: string, channel: "imessage" | "web"): Promise<string> {
  const db = load();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return "Sorry, I couldn't find your account.";
  const priorUserMsgs = db.messages.filter((m) => m.userId === userId && m.role === "user").length;
  audit({ userId, actor: "user", action: "chat.message", detail: { channel, text } });

  const meta = metaIntent(text);
  if (meta) {
    audit({ userId, actor: "agent", action: `chat.${meta.kind}`, detail: meta });
    return metaReply(userId, meta);
  }

  const intent = await classify(text);

  // First contact from an un-onboarded user with no profile info: ask onboarding questions.
  if (!user.onboarded && intent !== "profile" && priorUserMsgs <= 1) return ONBOARDING;

  switch (intent) {
    case "profile": {
      const wasOnboarded = user.onboarded;
      const res = await updateProfileFromMessage(userId, text);
      const after = load().users.find((u) => u.id === userId)!;
      if (!wasOnboarded && after.onboarded) {
        const L = after.limits;
        const ideas = await proposalsText(userId);
        return `Got it — risking up to $${L.budgetUsd} total, $${L.maxPerTradeUsd} max per trade, ${L.riskStyle} style. Here's what I found:\n\n${ideas}`;
      }
      if (!after.onboarded) {
        const hasInterest = load().theses.some((t) => t.userId === userId);
        const missing = hasInterest ? "how much total you're willing to risk (e.g. $200)" : "a few topics you follow or have opinions on";
        return `${res.changed ? res.summary + " " : ""}Next, tell me ${missing}.`;
      }
      return res.changed ? `${res.summary} I'll use this for future ideas.` : "Noted. Anything you'd like me to change about your interests or risk limits?";
    }
    case "discover": {
      if (user.paused) return "Trading is paused, so I'm not proposing new trades. Say \"resume\" to turn it back on.";
      const m = text.match(/\b(?:outside(?: of)?|other than|besides|except)\s+(.+)/i);
      const inside = text.match(/\b(?:about|in|on|for|related to)\s+(.+)/i);
      const focus = m ? `outside ${m[1]}` : inside ? inside[1] : undefined;
      return proposalsText(userId, focus);
    }
    case "question":
      return answerQuestion(userId, text);
    case "approve": {
      const p = matchProposal(userId, text);
      if (!p) return "There's no pending proposal to approve. Say \"find opportunities\" and I'll look for one.";
      audit({ userId, actor: "agent", action: "chat.approval_link", ref: p.id });
      return `I can't place trades from a text — please confirm the exact order:\n${p.kind === "open" ? "Buy" : "Sell"} ${p.quantity} ${p.side} contracts of "${p.market.title || p.market.eventTitle}" at up to $${p.limitPrice.toFixed(2)} each (max $${p.costUsd.toFixed(2)}).\nConfirm here: ${approvalUrl(p)}${user.paused ? "\n(Note: trading is paused — resume first.)" : ""}`;
    }
    case "reject": {
      const p = matchProposal(userId, text);
      if (!p) return "No pending proposals to reject.";
      tx((d) => { const x = d.proposals.find((y) => y.id === p.id); if (x && x.status === "pending") x.status = "rejected"; });
      audit({ userId, actor: "user", action: "proposal.reject", ref: p.id, detail: { channel } });
      return `Skipped "${p.market.title || p.market.eventTitle}". Want me to look for something else?`;
    }
    case "portfolio":
      return portfolioText(userId, text);
    case "pause":
      tx((d) => { const u = d.users.find((x) => x.id === userId); if (u) u.paused = true; });
      audit({ userId, actor: "user", action: "user.pause", detail: { channel } });
      return "Paused. I won't submit any orders until you say \"resume\". I'll still watch your positions.";
    case "resume":
      tx((d) => { const u = d.users.find((x) => x.id === userId); if (u) u.paused = false; });
      audit({ userId, actor: "user", action: "user.resume", detail: { channel } });
      return "Resumed. Approved trades can be submitted again — I'll still ask before every order.";
    default: {
      if (!user.onboarded) return ONBOARDING;
      try {
        if (!llmEnabled) throw new Error("LLM_DISABLED");
        return (await generateText(`User: "${text}"\nReply briefly. You can help with: finding opportunities, explaining ideas, portfolio updates, updating interests/limits, pause/resume.`, SYSTEM)).trim();
      } catch {
        return "I can find opportunities, explain my ideas, summarize your portfolio, or update your interests and limits. What would you like?";
      }
    }
  }
}
