import { and, desc, eq, inArray } from "drizzle-orm";
import { answerQuestion, classifyIntent, extractProfile } from "@mayflower/agents";
import { findHedges, prettyGroup } from "@mayflower/risk";
import { bidFor, formatCents, formatPct, formatUsd, outcomeLabel, round, type Outcome, type SizingResult } from "@mayflower/shared";
import { config, oauthConfigured } from "./config";
import { getDb, schema } from "./db/client";
import type { Message, Position, Proposal, User } from "./db/schema";
import { audit, logError } from "./audit";
import { createSignedLink } from "./auth";
import { executeApproval, type ExecutionResult } from "./execution";
import { activeConnection, balanceInfo, defaultMode, modeLabel } from "./gemini-link";
import { llm, marketData } from "./integrations";
import { getMarketRow, groupOf, latestQuotes, quoteFromRow, refreshContract } from "./markets";
import { monitorUser, recentMonitorEvents } from "./monitor";
import { runDiscovery, type AnalyzedMarket } from "./pipeline";
import { portfolioOverview } from "./portfolio";
import { approveByCode, createProposal, describeTerms, getProposal, issueApprovalChallenge, pendingProposals, rejectProposal } from "./proposals";
import { sendToUser } from "./notify";
import { activeTheses, applyProfileUpdate, effectiveLimits, getUser, profileSummary, setOnboardingState, setTradingPaused } from "./users";

type Channel = "web" | "imessage";

const AFFIRMATIVE = /^(ok(ay)?|yes|yep|yeah|sure|sounds good|looks good|fine|good|great|perfect|use (the )?defaults?|that works|go|do it|correct|👍)[.! ]*$/i;
const APPROVE_CODE = /^\s*approve\s+([A-HJ-NP-Z2-9]{6})\s*[.!]?\s*$/i;

async function recentHistory(userId: string, limit = 8): Promise<Message[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.messages).where(eq(schema.messages.userId, userId)).orderBy(desc(schema.messages.createdAt)).limit(limit);
  return rows.reverse();
}

function proposalHeadline(p: Proposal): string {
  return p.rationale.title;
}

export function formatRecommendation(a: AnalyzedMarket | { proposal: Proposal; sizing: SizingResult }): string {
  const p = a.proposal;
  const s = a.sizing;
  const kind = p.discovery === "personalized" ? "Idea from your interests" : p.discovery === "general" ? "Broader market idea" : "Idea";
  const demo = p.rationale.method.marketData === "demo" ? " [DEMO market — not real]" : "";
  const critic = s.rawProbability !== p.estProbability ? `the critic adjusted it to ${formatPct(p.estProbability)}, ` : "";
  const est = `The market implies ${formatPct(p.marketProbability)}; Mayflower estimates ${formatPct(s.rawProbability)} (${critic}${p.rationale.uncertainty ?? "unknown"} uncertainty).`;
  if (p.decision === "no_trade") {
    return `${kind}${demo}: “${proposalHeadline(p)}”. ${est} No trade — ${p.rationale.noTradeReason ?? "the edge isn't there"}`;
  }
  return [
    `${kind}${demo}: “${proposalHeadline(p)}”.`,
    est,
    `Suggested: ${describeTerms(p, p.rationale.title)}`,
    `Why: ${p.rationale.thesis}`,
    `Reply “why” for the full reasoning, or “approve” to get the exact order to confirm.`,
  ].join(" ");
}

async function dashboardLink(user: User, next = "/dashboard"): Promise<string> {
  const link = await createSignedLink(user.id, "login", 30);
  return `${link}&next=${encodeURIComponent(next)}`;
}

/** Pick which proposal the user means ("approve the $8 trade", "why the football one?"). */
function matchProposal(pending: Proposal[], reference: string | null): Proposal | null | "ambiguous" {
  if (pending.length === 0) return null;
  if (pending.length === 1) return pending[0];
  const ref = (reference ?? "").toLowerCase();
  const amount = /\$\s?(\d+(?:\.\d+)?)/.exec(ref);
  if (amount) {
    const v = Number(amount[1]);
    const byAmount = pending.filter((p) => Math.abs(p.maxCost - v) <= Math.max(0.6, v * 0.08) || Math.abs(round(p.quantity * (p.limitPrice ?? 0), 2) - v) <= 0.6);
    if (byAmount.length === 1) return byAmount[0];
  }
  const words = ref.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const scored = pending
    .map((p) => ({ p, hits: words.filter((w) => `${p.rationale.title} ${p.symbol}`.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.hits - a.hits);
  if (scored[0].hits > 0 && scored[0].hits > (scored[1]?.hits ?? 0)) return scored[0].p;
  return "ambiguous";
}

function listProposals(pending: Proposal[]): string {
  return pending
    .slice(0, 5)
    .map((p, i) => `${i + 1}) ${p.side === "sell" ? "Sell" : "Buy"} ${outcomeLabel((p.outcome ?? "yes") as Outcome)} “${p.rationale.title}” — ${p.side === "sell" ? `${round(p.quantity, 2)} contracts` : formatUsd(p.maxCost)}`)
    .join("\n");
}

async function lastDiscussedProposal(userId: string): Promise<Proposal | null> {
  const db = await getDb();
  const [p] = await db
    .select()
    .from(schema.tradeProposals)
    .where(and(eq(schema.tradeProposals.userId, userId), inArray(schema.tradeProposals.status, ["pending", "awaiting_link", "approved", "executed", "informational", "executing"])))
    .orderBy(desc(schema.tradeProposals.createdAt))
    .limit(1);
  return p ?? null;
}

function executionReply(r: ExecutionResult, linkUrl?: string): string {
  if (r.status === "needs_link" || r.status === "needs_terms") return `${r.message}${linkUrl ? ` ${linkUrl}` : ""}`;
  return r.message;
}

// ---- Handlers -----------------------------------------------------------------

async function handleApprovalCode(user: User, code: string): Promise<string> {
  const res = await approveByCode(user.id, code);
  if (!res.ok) return res.error;
  const exec = await executeApproval(user.id, res.approvalId);
  const link = exec.status === "needs_link" || exec.status === "needs_terms" ? await dashboardLink(user, "/link") : undefined;
  return `Approved: ${describeTerms(res.proposal, res.proposal.rationale.title)} ${executionReply(exec, link)}`;
}

async function handleApproveIntent(user: User, reference: string | null): Promise<string> {
  const pending = (await pendingProposals(user.id)).filter((p) => p.status === "pending");
  const target = matchProposal(pending, reference);
  if (!target) return "There's nothing waiting for your approval right now. Ask me to find opportunities and I'll research some.";
  if (target === "ambiguous") return `Which one? You have ${pending.length} proposals waiting:\n${listProposals(pending)}\nReply with the name or dollar amount.`;
  return challengeText(user, target);
}

/** Exact-terms confirmation request: a one-time code and a signed link, both bound to this proposal version. */
async function challengeText(user: User, target: Proposal): Promise<string> {
  const challenge = await issueApprovalChallenge(user.id, target);
  const mins = config().approvalLinkMinutes;
  const mode = (await activeConnection(user.id))?.mode ?? defaultMode();
  const modeNote =
    mode === "needs_link"
      ? " You'll link your Gemini account (trade-only) right after approving."
      : mode === "simulated"
        ? " This will be a SIMULATED order (no exchange credentials configured)."
        : mode === "shared_sandbox"
          ? " This will go to Gemini's sandbox on Mayflower's shared test account."
          : config().geminiEnv === "sandbox"
            ? " This goes to your Gemini sandbox account."
            : "";
  const lines = [`To approve exactly this order: ${describeTerms(target, target.rationale.title)}${modeNote}`];
  if (challenge.code) lines.push(`Reply “APPROVE ${challenge.code}” or confirm here: ${challenge.link}`);
  else lines.push(`Confirm here: ${challenge.link}`);
  lines.push(`This expires in ${mins} minutes. A general “yes” won't place anything.`);
  return lines.join("\n");
}

async function handleReject(user: User, reference: string | null): Promise<string> {
  const pending = await pendingProposals(user.id);
  const target = matchProposal(pending, reference);
  if (!target) return "There's nothing pending to reject.";
  if (target === "ambiguous") return `Which one should I drop?\n${listProposals(pending)}`;
  await rejectProposal(user.id, target.id, "chat");
  return `Done — I passed on “${target.rationale.title}”. Nothing was ordered.`;
}

function whyFallback(question: string, p: Proposal): string {
  const q = question.toLowerCase();
  const s = p.sizing as Partial<SizingResult>;
  if (/only|size|so (small|little)|\$|amount|how much/.test(q) && s.steps) {
    const caps = (s.capsApplied ?? []).map((c) => c.detail);
    return `${p.rationale.sizingSummary} ${p.rationale.hedgeNote ?? ""} ${caps.length ? `Limits that applied: ${caps.join("; ")}.` : ""} The estimate isn't certain (it's shrunk toward the market price before sizing), and a bigger bet would concentrate too much of your budget.`.replace(/\s+/g, " ").trim();
  }
  if (/change your mind|wrong|invalidate/.test(q)) return `What would change my mind: ${p.rationale.whatWouldChangeMind.join("; ") || "new evidence against the thesis or a big unexplained price move"}.`;
  if (/risk|go wrong|downside|lose/.test(q)) return `Risks: ${[...p.rationale.risks, ...p.rationale.resolutionRisks].slice(0, 4).join(" ")} The most you can lose is ${formatUsd(p.maxCost)}.`;
  if (/source|evidence|cite/.test(q)) return `I relied on the cited sources listed on the proposal page (${p.rationale.method.research === "demo" ? "demo placeholder evidence" : "Context.dev web research"}). ${p.rationale.criticIssues.length ? `Critic notes: ${p.rationale.criticIssues.join(" ")}` : ""}`;
  return `${p.rationale.thesis} Market implies ${formatPct(p.marketProbability)} vs. Mayflower's ${formatPct(p.estProbability)}. ${p.rationale.whatHasToHappen}`;
}

async function proposalFacts(p: Proposal) {
  const db = await getDb();
  const [report] = p.researchReportId ? await db.select().from(schema.researchReports).where(eq(schema.researchReports.id, p.researchReportId)).limit(1) : [];
  const s = p.sizing as Partial<SizingResult>;
  return {
    proposal: {
      title: p.rationale.title,
      status: p.status,
      decision: p.decision,
      terms: p.decision === "trade" ? describeTerms(p, p.rationale.title) : null,
      marketImpliedProbability: p.marketProbability,
      mayflowerProbability: p.estProbability,
      rawEstimate: s.rawProbability,
      sizedAsIf: s.adjustedProbability,
      edgePerContract: p.edge,
      sizingSteps: s.steps,
      capsApplied: s.capsApplied,
      correlatedPositions: s.correlated,
      noTradeReasons: s.noTradeReasons,
      thesis: p.rationale.thesis,
      whatHasToHappen: p.rationale.whatHasToHappen,
      whyNow: p.rationale.whyNow,
      risks: p.rationale.risks,
      resolutionRisks: p.rationale.resolutionRisks,
      whatWouldChangeMind: p.rationale.whatWouldChangeMind,
      criticIssues: p.rationale.criticIssues,
      hedgeNote: p.rationale.hedgeNote,
      methods: p.rationale.method,
    },
    evidenceFor: report?.forecast.evidenceFor,
    evidenceAgainst: report?.forecast.evidenceAgainst,
    sources: report?.citations.map((c) => ({ id: c.id, title: c.title, url: c.url, snippet: c.snippet.slice(0, 300) })),
  };
}

async function handleAskWhy(user: User, text: string, reference: string | null): Promise<string> {
  const pending = await pendingProposals(user.id);
  let target: Proposal | null | "ambiguous" = matchProposal(pending, reference);
  if (target === "ambiguous" || target === null) target = await lastDiscussedProposal(user.id);
  if (!target) return "I don't have a recommendation to explain yet. Ask me to find opportunities first.";
  const history = (await recentHistory(user.id)).map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
  const facts = await proposalFacts(target);
  const p = target;
  const res = await answerQuestion(text, { facts, history }, () => whyFallback(text, p), llm(), logError("answer"));
  return res.text;
}

async function handlePortfolio(user: User): Promise<string> {
  const o = await portfolioOverview(user, await balanceInfo(user.id));
  const s = o.summary;
  const lines = [
    `${o.balance.label}. Portfolio value ${formatUsd(s.totalValue)} (available ${o.balance.available === null ? "unknown" : formatUsd(o.balance.available)}). Unrealized P&L ${formatUsd(s.unrealizedPnl, { signed: true })}, realized ${formatUsd(s.realizedPnl, { signed: true })}.`,
  ];
  if (o.positions.length === 0) lines.push("No open positions yet.");
  for (const v of o.positions.slice(0, 5)) {
    lines.push(`• ${outcomeLabel(v.position.outcome as Outcome)} “${v.label}”: ${round(v.position.quantity, 2)} @ ${formatCents(v.position.avgPrice)} → ${formatCents(v.currentPrice)} (${v.unrealizedPnl === null ? "no bid" : formatUsd(v.unrealizedPnl, { signed: true })})`);
  }
  lines.push(s.explanation);
  return lines.join("\n");
}

async function handleRiskiest(user: User): Promise<string> {
  const o = await portfolioOverview(user, await balanceInfo(user.id));
  if (o.positions.length === 0) return "You have nothing at risk right now. Your full risk budget is available.";
  const ranked = [...o.positions].sort((a, b) => b.position.costBasis - a.position.costBasis);
  const lines = [o.summary.explanation, "Biggest downside (what you'd lose if each resolves against you):"];
  for (const v of ranked.slice(0, 4)) lines.push(`• “${v.label}” — ${formatUsd(v.position.costBasis)} at risk (${prettyGroup(v.position.correlationGroup ?? "uncategorized")})`);
  const top = o.summary.concentration[0];
  if (top && top.share > 0.3) lines.push(`${prettyGroup(top.group)} is ${formatPct(top.share)} of your risk limit — related outcomes can lose together.`);
  return lines.join("\n");
}

async function handleWhatChanged(user: User): Promise<string> {
  const before = new Date();
  const result = await monitorUser(user.id, { notifyFills: false });
  const events = await recentMonitorEvents(user.id, new Date(before.getTime() - 24 * 3600_000));
  const positions = await (await getDb()).select().from(schema.positions).where(and(eq(schema.positions.userId, user.id), eq(schema.positions.status, "open")));
  if (positions.length === 0 && events.length === 0) return "Nothing to report — you don't have open positions yet. Want me to look for opportunities?";
  if (events.length === 0) return `I re-checked your ${positions.length} open position${positions.length === 1 ? "" : "s"}: no meaningful news or price moves in the last day. Your theses still stand.${result.errors.length ? ` (Some checks failed: ${result.errors[0]})` : ""}`;
  const lines = ["Here's what changed in the last 24 hours:"];
  for (const e of events.slice(0, 5)) lines.push(`• ${e.summary}${e.recommendation !== "hold" ? ` → recommend ${e.recommendation}${e.proposalId ? " (proposal waiting for your approval)" : ""}` : ""}`);
  return lines.join("\n");
}

function matchPosition(positions: { position: Position; label: string }[], reference: string | null) {
  if (positions.length === 1) return positions[0];
  const words = (reference ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !["sell", "half", "close", "reduce", "position", "exit", "that", "this"].includes(w));
  const scored = positions.map((p) => ({ p, hits: words.filter((w) => p.label.toLowerCase().includes(w)).length })).sort((a, b) => b.hits - a.hits);
  return scored[0] && scored[0].hits > 0 && scored[0].hits > (scored[1]?.hits ?? 0) ? scored[0].p : null;
}

async function handleChangePosition(user: User, fraction: number, reference: string | null): Promise<string> {
  const db = await getDb();
  const rows = await db
    .select({ position: schema.positions, market: schema.markets })
    .from(schema.positions)
    .innerJoin(schema.markets, eq(schema.markets.symbol, schema.positions.symbol))
    .where(and(eq(schema.positions.userId, user.id), eq(schema.positions.status, "open")));
  if (rows.length === 0) return "You don't have any open positions to sell.";
  const options = rows.map((r) => ({ position: r.position, label: r.market.label }));
  const target = matchPosition(options, reference);
  if (!target) return `Which position?\n${options.map((o, i) => `${i + 1}) ${outcomeLabel(o.position.outcome as Outcome)} “${o.label}” (${round(o.position.quantity, 2)} contracts)`).join("\n")}`;
  const fresh = await refreshContract(target.position.symbol, target.position.eventTicker);
  const outcome = target.position.outcome as Outcome;
  const bid = fresh.contract ? bidFor(fresh.contract.quote, outcome) : null;
  if (bid === null) return `There's no bid for “${target.label}” right now, so a sell order couldn't fill. I'll keep watching it.`;
  const inc = fresh.contract?.increments.quantityIncrement ?? 1;
  const qty = fraction >= 1 ? target.position.quantity : Math.max(inc, Math.floor((target.position.quantity * fraction) / inc) * inc);
  const p = await createProposal({
    userId: user.id,
    symbol: target.position.symbol,
    kind: fraction >= 1 ? "close" : "reduce",
    discovery: "user_request",
    decision: "trade",
    side: "sell",
    outcome,
    quantity: round(qty, 8),
    limitPrice: bid,
    maxCost: 0,
    estProbability: null,
    marketProbability: null,
    edge: null,
    expectedValue: null,
    sizing: { kind: "exit", fraction, exitPrice: bid, proceeds: round(qty * bid, 2), realizedVsCost: round(qty * (bid - target.position.avgPrice), 2) },
    rationale: {
      title: target.label,
      whatHasToHappen: `Sell ${round(qty, 2)} ${outcomeLabel(outcome)} at ${formatCents(bid)} or better.`,
      whyNow: "You asked to reduce this position.",
      thesis: target.position.latestAssessment?.summary ?? target.position.thesis?.text ?? "",
      discoveryReason: "Your request",
      sizingSummary: `About ${formatUsd(qty * bid)} back (${formatUsd(qty * (bid - target.position.avgPrice), { signed: true })} vs. what you paid for those contracts).`,
      noTradeReason: null,
      risks: ["A limit order may not fill if the bid moves away; thin markets can gap."],
      resolutionRisks: [],
      whatWouldChangeMind: [],
      watchConditions: [],
      hedgeNote: null,
      criticIssues: [],
      method: { forecast: "heuristic", critic: "heuristic", research: "none", marketData: fresh.contract?.source ?? "live" },
    },
    relatedPositionId: target.position.id,
    executionMode: target.position.mode,
  });
  return challengeText(user, p);
}

async function handleHedge(user: User, reference: string | null): Promise<string> {
  const events = (await recentMonitorEvents(user.id, undefined, 20)).filter((e) => e.recommendation === "hedge");
  if (events[0]?.details && (events[0].details as { hedge?: string }).hedge) {
    const d = events[0].details as { hedge?: string; reasons?: string[] };
    return `${d.reasons?.[0] ?? "Your related positions are concentrated."} ${d.hedge}`;
  }
  const db = await getDb();
  const rows = await db
    .select({ position: schema.positions, market: schema.markets })
    .from(schema.positions)
    .innerJoin(schema.markets, eq(schema.markets.symbol, schema.positions.symbol))
    .where(and(eq(schema.positions.userId, user.id), eq(schema.positions.status, "open")));
  if (rows.length === 0) return "You don't hold anything that needs hedging. A hedge is a separate position that pays off when your main bet loses — it reduces risk but costs money and lowers your upside.";
  const target = matchPosition(rows.map((r) => ({ position: r.position, label: r.market.label })), reference) ?? { position: rows[0].position, label: rows[0].market.label };
  const candidates = await marketData().getEventContracts(target.position.eventTicker).catch(() => []);
  const ideas = findHedges(
    { symbol: target.position.symbol, eventTicker: target.position.eventTicker, outcome: target.position.outcome as Outcome, quantity: target.position.quantity, avgPrice: target.position.avgPrice, label: target.label, correlationGroup: target.position.correlationGroup },
    candidates,
    (m) => groupOf(m),
  );
  const real = ideas.find((i) => i.relationship === "mutually_exclusive");
  if (!real) return `I'm not recommending a hedge for “${target.label}”: there's no contract that genuinely offsets it, and loosely related markets can lose at the same time. If you want less risk, reducing the position is cleaner.`;
  return `${real.explanation} Outcomes: ${real.scenarios.map((s) => `${s.name}: ${formatUsd(s.pnl, { signed: true })}`).join("; ")}. ${real.caveat} If you want it, say “find a hedge order” and I'll prepare it for approval.`;
}

const HELP = `I'm Mayflower, your prediction-market copilot. You can:
• Tell me what you follow and believe (“I think AI spending keeps growing”) and your limits (“max $10 per trade”)
• “Find opportunities” (or “…outside sports”)
• Ask “why?” about any idea, “what would change your mind?”
• “Approve” — I'll send the exact order to confirm with a code or secure link
• “How's my portfolio?”, “What changed overnight?”, “What are my riskiest positions?”
• “Sell half” of a position (needs your approval)
• “Pause” to stop all trading, “resume” to restart
• “Dashboard” for a sign-in link
I never place a trade without your explicit approval, and I can't move or withdraw your money.`;

async function sendDiscoveryResults(user: User, channel: Channel, intro: string, result: Awaited<ReturnType<typeof runDiscovery>>): Promise<string[]> {
  const out: string[] = [];
  if (result.analyzed.length === 0) {
    out.push(
      result.errors.length
        ? `I couldn't complete the scan: ${result.errors[0]}`
        : "I didn't find a contract worth recommending right now — no trade is a valid answer. I'll keep looking.",
    );
    return out;
  }
  out.push(intro);
  for (const a of result.analyzed) out.push(formatRecommendation(a));
  return out;
}

async function onboarding(user: User, text: string, channel: Channel): Promise<string[]> {
  const model = llm();
  const theses = await activeTheses(user.id);
  const fresh = user.onboardingState === "new";
  const affirmative = AFFIRMATIVE.test(text.trim());

  if (user.onboardingState === "confirm_limits") {
    if (!affirmative) {
      const upd = await extractProfile(text, { interests: user.interests, beliefs: theses, riskBudget: user.riskBudget, maxPerPosition: user.maxPerPosition, maxTotalExposure: user.maxTotalExposure, riskStyle: user.riskStyle as never, excludedTopics: user.excludedTopics }, model, logError("profile"));
      const changes = await applyProfileUpdate(user.id, upd, channel === "imessage" ? "imessage" : "chat");
      if (changes.length === 0) return ["Reply “OK” to use those limits, or tell me different ones (e.g. “max $5 per position, $50 total, skip politics”)."];
    }
    const u = await getUser(user.id);
    const limits = effectiveLimits(u);
    // Store the defaults explicitly so the profile shows exactly what's enforced.
    await (await getDb()).update(schema.users).set({ maxPerPosition: limits.maxPerPosition, maxTotalExposure: limits.maxTotalExposure, riskBudget: limits.riskBudget }).where(eq(schema.users.id, u.id));
    await setOnboardingState(u.id, "complete");
    await audit({ userId: u.id, actor: "user", action: "onboarding.complete", details: { limits } });
    const result = await runDiscovery(u.id, { trigger: "onboarding", maxPersonalized: 1, maxGeneral: 1 });
    const link = await dashboardLink(u);
    const msgs = await sendDiscoveryResults(u, channel, `You're set: max ${formatUsd(limits.maxPerPosition)} per position, ${formatUsd(limits.maxTotalExposure)} total at risk. I scanned ${result.scanned} ${result.marketDataLabel === "demo" ? "DEMO" : "Gemini"} contracts:`, result);
    msgs.push(`Your dashboard (positions, reasoning, approvals): ${link}`);
    return msgs;
  }

  const upd = await extractProfile(text, { interests: user.interests, beliefs: theses, riskBudget: user.riskBudget, maxPerPosition: user.maxPerPosition, maxTotalExposure: user.maxTotalExposure, riskStyle: user.riskStyle as never, excludedTopics: user.excludedTopics }, model, logError("profile"));
  await applyProfileUpdate(user.id, upd, channel === "imessage" ? "imessage" : "chat");
  const u = await getUser(user.id);
  const t2 = await activeTheses(user.id);
  if (fresh) await setOnboardingState(u.id, "collecting");
  const intro = fresh
    ? "Hi, I'm Mayflower — I turn what you know and believe into researched prediction-market ideas, size the risk, and only trade when you explicitly approve. I can't move or withdraw your money. "
    : "";
  if (u.interests.length === 0 && t2.length === 0) {
    return [`${intro}What do you follow or have opinions about? (e.g. “I follow the Seahawks, think AI spending keeps growing, and I'm worried about a recession.”)`];
  }
  if (u.riskBudget === null) {
    return [`${intro}Got it — ${profileSummary(u, t2).split(" Risk:")[0]} How much are you comfortable risking in total? That's a limit, not a deposit: your money stays in your own Gemini account.`];
  }
  await setOnboardingState(u.id, "confirm_limits");
  const limits = effectiveLimits(u);
  return [
    `${intro}Here's your profile: ${profileSummary(u, t2)}`,
    `I'll cap any single position at ${formatUsd(limits.maxPerPosition)} and total money at risk at ${formatUsd(limits.maxTotalExposure)}, sizing ${limits.riskStyle}ly. Any topics I should skip? Reply “OK” to use these limits, or tell me what to change.`,
  ];
}

/**
 * Main conversational entry point for both iMessage and the web chat.
 * Replies are delivered through sendToUser and also returned.
 */
export async function handleInbound(userId: string, text: string, channel: Channel): Promise<Message[]> {
  const user = await getUser(userId);
  const replies = await route(user, text.trim(), channel);
  const sent: Message[] = [];
  for (const r of replies.filter(Boolean)) sent.push(await sendToUser(user, r, { channel: channel === "web" ? "web" : "auto" }));
  return sent;
}

async function route(user: User, text: string, channel: Channel): Promise<string[]> {
  if (!text) return [];
  const code = APPROVE_CODE.exec(text);
  if (code) return [await handleApprovalCode(user, code[1].toUpperCase())];

  if (user.onboardingState !== "complete") {
    const quick = await classifyIntent(text, { onboardingComplete: false }, null);
    if (quick.intent === "help") return [HELP];
    if (quick.intent === "dashboard_link") return [`Here's your sign-in link: ${await dashboardLink(user)}`];
    return onboarding(user, text, channel);
  }

  const history = await recentHistory(user.id, 4);
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant")?.text ?? null;
  const intent = await classifyIntent(text, { onboardingComplete: true, recentAssistantMessage: lastAssistant }, llm(), logError("intent"));
  await audit({ userId: user.id, actor: "agent", action: "chat.intent", details: { intent: intent.intent, method: intent.method, channel } });

  switch (intent.intent) {
    case "help":
      return [HELP];
    case "pause":
      await setTradingPaused(user.id, true);
      return ["Trading paused. I won't submit any orders — even approved ones — until you say “resume”. I'll keep monitoring and can still answer questions."];
    case "resume":
      await setTradingPaused(user.id, false);
      return ["Trading resumed. Every order still needs your explicit approval."];
    case "approve":
      return [await handleApproveIntent(user, intent.reference ?? text)];
    case "reject":
      return [await handleReject(user, intent.reference ?? text)];
    case "ask_why":
      return [await handleAskWhy(user, text, intent.reference ?? text)];
    case "portfolio":
      return [await handlePortfolio(user)];
    case "riskiest":
      return [await handleRiskiest(user)];
    case "what_changed":
      return [await handleWhatChanged(user)];
    case "change_position":
      return [await handleChangePosition(user, intent.fraction ?? 1, intent.reference ?? text)];
    case "hedge_question":
      return [await handleHedge(user, intent.reference ?? text)];
    case "link_gemini": {
      const conn = await activeConnection(user.id);
      const link = await dashboardLink(user, "/link");
      if (conn) return [`You're connected via: ${modeLabel(conn.mode as never, conn.env as never)}. Manage it here: ${link}`];
      return [oauthConfigured() ? `Connect your Gemini account (trade-only; Mayflower can't withdraw or transfer): ${link}` : `This server uses ${modeLabel(defaultMode() as never)} for now. Details: ${link}`];
    }
    case "dashboard_link":
      return [`Here's your sign-in link (valid 30 minutes): ${await dashboardLink(user)}`];
    case "find_opportunities":
    case "research": {
      const result = await runDiscovery(user.id, {
        trigger: intent.intent === "research" ? "research" : "user_request",
        focus: intent.topic,
        excludeTopics: intent.excludeTopics,
        maxPersonalized: intent.intent === "research" ? 1 : 1,
        maxGeneral: intent.intent === "research" ? 0 : 1,
      });
      const scope = intent.excludeTopics.length ? ` (skipping ${intent.excludeTopics.join(", ")})` : intent.topic ? ` on ${intent.topic}` : "";
      return sendDiscoveryResults(user, channel, `I scanned ${result.scanned} ${result.marketDataLabel === "demo" ? "DEMO" : "Gemini"} contracts${scope}:`, result);
    }
    case "profile_update":
    case "onboarding": {
      const theses = await activeTheses(user.id);
      const upd = await extractProfile(text, { interests: user.interests, beliefs: theses, riskBudget: user.riskBudget, maxPerPosition: user.maxPerPosition, maxTotalExposure: user.maxTotalExposure, riskStyle: user.riskStyle as never, excludedTopics: user.excludedTopics }, llm(), logError("profile"));
      const changes = await applyProfileUpdate(user.id, upd, channel === "imessage" ? "imessage" : "chat");
      if (changes.length === 0) return ["Noted. I didn't spot a change to your interests or limits — tell me what you'd like to update."];
      return [`Updated: ${changes.join("; ")}. This shapes what I look for — it's never permission to trade.`];
    }
    default: {
      const u = await getUser(user.id);
      const theses = await activeTheses(user.id);
      const pending = await pendingProposals(user.id);
      const historyMsgs = (await recentHistory(user.id)).map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
      const res = await answerQuestion(
        text,
        { facts: { profile: profileSummary(u, theses), pendingProposals: pending.map((p) => ({ title: p.rationale.title, terms: describeTerms(p, p.rationale.title) })), capabilities: HELP }, history: historyMsgs },
        () => `I'm not sure how to help with that yet. ${HELP.split("\n").slice(0, 4).join(" ")}`,
        llm(),
        logError("answer"),
      );
      return [res.text];
    }
  }
}

/** Notify a user about new recommendations created outside a conversation (scheduled discovery). */
export async function notifyRecommendations(userId: string, analyzed: AnalyzedMarket[]): Promise<void> {
  const trades = analyzed.filter((a) => a.sizing.decision === "trade");
  if (trades.length === 0) return;
  const user = await getUser(userId);
  if (user.notifyLevel === "none") return;
  const lines = ["New research-backed idea:", ...trades.slice(0, 2).map((a) => formatRecommendation(a))];
  await sendToUser(user, lines.join("\n\n"));
}

export { getProposal, latestQuotes, quoteFromRow, getMarketRow };
