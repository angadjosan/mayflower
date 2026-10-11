// Group chats: contests (everyone pitches, best % return wins) and group picks (agent reads the chat
// and suggests one trade everyone can join). Every trade is still a per-person proposal that its owner
// approves through a private link — approval links are never posted in the group.
import crypto from "crypto";
import { tx, load, id, now, audit, getOrCreateUser } from "../db";
import { generateJSON, generateText, llmEnabled } from "../llm";
import { listMarkets, getMarket } from "../exchange";
import { sendToChat, sendDirect } from "../transport";
import { storeMessage } from "../notify";
import { approvalUrl } from "../execution";
import { researchAndForecast, matchesTopic } from "./discover";
import { KNOWN_TOPICS } from "./profile";
import type { Group, Contest, Market, ResearchReport, Side, TradeProposal, User } from "../types";

const DEFAULT_STAKE = 10;
const SUGGEST_EVERY_N_MSGS = 12;
const SUGGEST_MIN_GAP_MS = 30 * 60 * 1000;
const PICK_TTL_MS = 6 * 3600 * 1000;

const pct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const yesAsk = (m: Market) => m.yesAsk ?? m.lastPrice ?? 0.5;
const noAsk = (m: Market) => m.noAsk ?? (m.yesBid != null ? 1 - m.yesBid : 1 - (m.lastPrice ?? 0.5));
/** Mid price for a side — contests score at mid so a wide bid/ask spread doesn't look like an instant loss. */
const midFor = (m: Market, side: Side) => {
  const yesMid = m.yesBid != null && m.yesAsk != null ? (m.yesBid + m.yesAsk) / 2 : m.lastPrice ?? m.yesAsk ?? m.yesBid ?? 0.5;
  return side === "YES" ? yesMid : 1 - yesMid;
};
const marketLabel = (m: Market) =>
  !m.title || m.title.startsWith(m.eventTitle) ? m.title || m.eventTitle : `${m.eventTitle} — ${m.title}`;

export function displayName(u?: User) {
  if (!u) return "someone";
  return u.name || (u.handle ? `…${u.handle.replace(/\D/g, "").slice(-4) || u.handle.split("@")[0]}` : u.id);
}

// ---------- entry point ----------

/** Handle one inbound group-chat message. Posts any reply into the group itself. */
export async function handleGroupMessage(chatGuid: string, senderHandle: string, text: string): Promise<void> {
  const sender = getOrCreateUser({ handle: senderHandle });
  const group = ensureGroup(chatGuid, sender.id);
  storeMessage(sender.id, "user", text, "imessage", group.id);

  const reply = await route(group, sender, text);
  if (reply) await postToGroup(group, reply);
}

async function route(group: Group, sender: User, text: string): Promise<string | null> {
  const t = text.trim();
  const addressed = /\b(mayflower|mf)\b/i.test(t) || t.startsWith("@");
  const lower = t.toLowerCase();
  const contest = activeContest(group.id);
  const pick = openPick(group.id);

  // Short replies that don't need the agent's name.
  if (pick && /^(i'?m in|in|count me in|me too|i'?m down|down)\b/i.test(lower)) return joinPick(group, pick, sender);
  if (contest && /^(my (pick|pitch|bet|idea)|pitch)\s*[:\-]/i.test(lower)) return pitch(group, contest, sender, t);

  if (!addressed) return maybeSuggest(group);

  if (/\b(start|new|create|set ?up)\b.*\b(contest|competition|challenge|game|league)\b/i.test(lower)) return startContest(group, sender, t);
  if (/\b(leaderboard|standings|who'?s winning|scores?|ranking)\b/i.test(lower)) return leaderboard(group);
  if (/\b(end|finish|close|call)\b.*\b(contest|competition|game|it)\b/i.test(lower)) return finalizeContest(group, true);
  if (/\b(what should we|suggest|any ideas|group (pick|bet|trade)|something to bet|read the chat)\b/i.test(lower)) return groupPick(group, true);
  if (contest && /\b(i think|i bet|i'?m betting|my (pick|pitch|bet|idea)|pitch)\b/i.test(lower)) return pitch(group, contest, sender, t);
  return answer(group, sender, t);
}

// ---------- groups ----------

function ensureGroup(chatGuid: string, userId: string): Group {
  return tx((db) => {
    let g = db.groups.find((x) => x.chatGuid === chatGuid);
    if (!g) {
      g = { id: id("grp_"), chatGuid, memberUserIds: [], createdAt: now(), msgsSinceSuggestion: 0 };
      db.groups.push(g);
    }
    if (!g.memberUserIds.includes(userId)) g.memberUserIds.push(userId);
    g.msgsSinceSuggestion += 1;
    return g;
  });
}

async function postToGroup(group: Group, text: string) {
  storeMessage(group.memberUserIds[0] ?? "system", "agent", text, "imessage", group.id);
  await sendToChat(group.chatGuid, text);
}

/** DM a member privately (approval links never go in the group). */
async function dm(user: User, text: string) {
  storeMessage(user.id, "agent", text, user.handle ? "imessage" : "web");
  if (user.handle) await sendDirect(user.handle, text);
}

function activeContest(groupId: string): Contest | undefined {
  return load().contests.filter((c) => c.groupId === groupId && c.status === "active").at(-1);
}

function openPick(groupId: string) {
  const t = Date.now();
  return load().groupPicks.filter((p) => p.groupId === groupId && Date.parse(p.expiresAt) > t).at(-1);
}

function recentChat(groupId: string, n = 50) {
  const db = load();
  return db.messages
    .filter((m) => m.groupId === groupId)
    .slice(-n)
    .map((m) => `${m.role === "agent" ? "Mayflower" : displayName(db.users.find((u) => u.id === m.userId))}: ${m.text}`)
    .join("\n");
}

// ---------- per-person proposals ----------

/** Fixed-stake proposal for one member. Stake is capped by that member's own per-trade limit. */
function proposeForUser(a: {
  user: User; market: Market; research: ResearchReport; side: Side; stakeUsd: number;
  groupId: string; contestId?: string; thesis: string;
}): { proposal?: TradeProposal; error?: string } {
  const price = a.side === "YES" ? yesAsk(a.market) : noAsk(a.market);
  if (!(price > 0 && price < 1)) return { error: "that market has no usable price right now" };
  const stake = Math.min(a.stakeUsd, a.user.limits.maxPerTradeUsd);
  const quantity = Math.floor(stake / price);
  if (quantity < 1) return { error: `one contract costs $${price.toFixed(2)}, more than the $${stake} stake` };
  const costUsd = +(quantity * price).toFixed(2);
  const pSide = a.side === "YES" ? a.research.estimatedProbability : 1 - a.research.estimatedProbability;
  const capped = stake < a.stakeUsd ? ` Capped from $${a.stakeUsd} by your $${a.user.limits.maxPerTradeUsd} per-trade limit.` : "";
  const proposal: TradeProposal = {
    id: id("prop_"), userId: a.user.id, marketId: a.market.id, market: a.market, researchId: a.research.id,
    kind: "open", discovery: "group", groupId: a.groupId, contestId: a.contestId,
    side: a.side, quantity, limitPrice: price, costUsd,
    marketProbability: price, estimatedProbability: pSide, edge: +(pSide - price).toFixed(4),
    thesis: a.thesis,
    sizingExplanation: `Group stake: ${quantity} contracts × $${price.toFixed(2)} = $${costUsd.toFixed(2)} (equal stakes keep the contest fair).${capped}`,
    riskNotes: [a.research.criticNotes, `Max loss $${costUsd.toFixed(2)} if ${a.side} loses.`, a.market.source === "mock" ? "Mock market data." : ""].filter(Boolean).join(" "),
    status: "pending", approvalToken: crypto.randomBytes(16).toString("hex"),
    createdAt: now(), expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), version: 1,
  };
  tx((db) => { db.proposals.push(proposal); });
  audit({ userId: a.user.id, actor: "agent", action: "group.proposal.create", ref: proposal.id, detail: { groupId: a.groupId, contestId: a.contestId, marketId: a.market.id, side: a.side, costUsd } });
  return { proposal };
}

function approvalDM(p: TradeProposal, intro: string) {
  return [
    intro,
    `${marketLabel(p.market)}`,
    `Buy ${p.side} @ $${p.limitPrice.toFixed(2)} × ${p.quantity} = $${p.costUsd.toFixed(2)} max loss. Mayflower's estimate for ${p.side}: ${Math.round(p.estimatedProbability * 100)}%.`,
    `Approve this exact order (only you get this link): ${approvalUrl(p)}`,
  ].join("\n");
}

// ---------- contests ----------

function parseContest(text: string) {
  const stake = Number(text.match(/\$\s?(\d+(?:\.\d+)?)/)?.[1] ?? DEFAULT_STAKE);
  const dur = text.match(/(\d+)\s*(hour|hr|day|week|month)s?/i);
  const unitMs: Record<string, number> = { hour: 3.6e6, hr: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.592e9 };
  const endsAt = dur ? new Date(Date.now() + Number(dur[1]) * unitMs[dur[2].toLowerCase()]).toISOString() : undefined;
  const reward = text.match(/\b((?:loser|winner|last place|first place|prize|reward)\b[^.!?\n]*)/i)?.[1]?.trim() || "bragging rights";
  return { stake, endsAt, reward };
}

async function startContest(group: Group, sender: User, text: string) {
  const existing = activeContest(group.id);
  if (existing) return `There's already a contest running ($${existing.stakeUsd} each, reward: ${existing.reward}). Say "Mayflower leaderboard" or "Mayflower end contest".`;
  const { stake, endsAt, reward } = parseContest(text);
  const c: Contest = {
    id: id("con_"), groupId: group.id, stakeUsd: stake, reward, endsAt, status: "active",
    createdByUserId: sender.id, createdAt: now(),
  };
  tx((db) => { db.contests.push(c); });
  audit({ userId: sender.id, actor: "user", action: "contest.start", ref: c.id, detail: { groupId: group.id, stake, endsAt, reward } });
  return [
    `Contest on 🏁 $${stake} each, best % return wins. Reward: ${reward}.${endsAt ? ` Scoring ${new Date(endsAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.` : " No end date — say \"Mayflower end contest\" to score it."}`,
    `Everyone pitch your idea: "my pick: BTC stays above 80k". I'll find the closest real market and DM you a private approval link.`,
    `Positions stay open after scoring. Nobody pays Mayflower anything — the reward is between you.`,
  ].join("\n");
}

interface PitchMatch { marketId?: string; side?: Side; reason?: string }

async function matchPitch(pitchText: string, markets: Market[]): Promise<{ market: Market; side: Side; reason: string } | null> {
  const candidates = markets.slice(0, 80);
  if (llmEnabled) {
    try {
      const r = await generateJSON<PitchMatch>(
        `A friend pitched this prediction-market idea: "${pitchText}"
Markets (id | event — contract | yes ask):
${candidates.map((m) => `${m.id} | ${marketLabel(m)} | ${yesAsk(m).toFixed(2)}`).join("\n")}
Pick the single market that best expresses their view, and the side (YES or NO) that wins if they're right.
Return JSON {"marketId": string | null, "side": "YES" | "NO", "reason": one short sentence}. Use null if nothing fits.`,
        "You map casual opinions to real prediction-market contracts. Return ONLY JSON.",
      );
      const m = candidates.find((x) => x.id === r.marketId);
      if (m && (r.side === "YES" || r.side === "NO")) return { market: m, side: r.side, reason: r.reason ?? "" };
    } catch { /* fall back to keywords */ }
  }
  const words = pitchText.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = candidates
    .map((m) => {
      const txt = `${m.eventTitle} ${m.title} ${m.category ?? ""}`.toLowerCase();
      return { m, s: words.filter((w) => txt.includes(w)).length + Object.keys(KNOWN_TOPICS).filter((t) => pitchText.toLowerCase().includes(t.toLowerCase()) && matchesTopic(m, t)).length };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.m.volume ?? 0) - (a.m.volume ?? 0));
  if (!scored.length) return null;
  const side: Side = /\b(no|not|won'?t|never|below|under|fail|lose|drop|crash)\b/i.test(pitchText) ? "NO" : "YES";
  return { market: scored[0].m, side, reason: "Closest keyword match (AI matcher not configured)." };
}

async function pitch(group: Group, contest: Contest, sender: User, text: string) {
  const db = load();
  const prior = db.contestEntries.find((e) => e.contestId === contest.id && e.userId === sender.id);
  const priorProposal = prior && db.proposals.find((p) => p.id === prior.proposalId);
  if (priorProposal && ["approved", "executed"].includes(priorProposal.status)) {
    return `${displayName(sender)}, you're already locked in on ${marketLabel(priorProposal.market)}.`;
  }
  const pitchText = text.replace(/^.*?\b(my (pick|pitch|bet|idea)|pitch)\s*[:\-]?\s*/i, "").replace(/\b(mayflower|mf)\b[,:]?/gi, "").trim() || text;
  const markets = (await listMarkets()).filter((m) => m.status === "open" || m.status === "unknown");
  const match = await matchPitch(pitchText, markets);
  if (!match) return `${displayName(sender)}, I couldn't find a live market for "${pitchText}". Try something more specific, or ask "Mayflower what can we bet on?"`;

  const research = await researchAndForecast(match.market, sender.id);
  const { proposal, error } = proposeForUser({
    user: sender, market: match.market, research, side: match.side, stakeUsd: contest.stakeUsd,
    groupId: group.id, contestId: contest.id, thesis: `${displayName(sender)}'s pitch: "${pitchText}". ${match.reason}`,
  });
  if (!proposal) return `${displayName(sender)}, ${error}. Pitch another idea?`;

  tx((d) => {
    if (prior) {
      const old = d.proposals.find((p) => p.id === prior.proposalId);
      if (old && old.status === "pending") old.status = "rejected";
      const e = d.contestEntries.find((x) => x.id === prior.id)!;
      e.pitch = pitchText; e.proposalId = proposal.id;
    } else {
      d.contestEntries.push({ id: id("ent_"), contestId: contest.id, userId: sender.id, pitch: pitchText, proposalId: proposal.id, createdAt: now() });
    }
  });
  await dm(sender, approvalDM(proposal, `Your contest pick:`));

  const pSide = proposal.estimatedProbability, price = proposal.limitPrice;
  const take = pSide - price > 0.03 ? "I like it" : pSide - price < -0.03 ? "I'm skeptical — market looks right or rich" : "roughly fairly priced";
  return `${displayName(sender)} → ${match.side} on ${marketLabel(match.market)} @ ${Math.round(price * 100)}¢ (my estimate ${Math.round(pSide * 100)}%, ${take}). Sent you a private approval link.`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "awaiting approval", approved: "submitting", executed: "order open, not filled yet",
  failed: "order failed", rejected: "declined", expired: "expired",
};

interface Standing { user: User; pitch: string; market?: Market; side?: Side; status: string; ret: number | null }

async function standings(contest: Contest): Promise<Standing[]> {
  const db = load();
  const rows: Standing[] = [];
  for (const e of db.contestEntries.filter((x) => x.contestId === contest.id)) {
    const user = db.users.find((u) => u.id === e.userId)!;
    const p = db.proposals.find((x) => x.id === e.proposalId);
    if (!p) continue;
    const pos = db.positions.find((x) => x.proposalId === p.id);
    if (!pos) {
      rows.push({ user, pitch: e.pitch, market: p.market, side: p.side, status: STATUS_LABEL[p.status] ?? p.status, ret: null });
      continue;
    }
    const fresh = (await getMarket(pos.marketId)) ?? pos.market;
    const value = pos.quantity * midFor(fresh, pos.side) + pos.realizedPnlUsd;
    const cost = pos.avgEntryPrice * pos.quantity || pos.costBasisUsd;
    rows.push({ user, pitch: e.pitch, market: fresh, side: pos.side, status: "live", ret: cost > 0 ? (value - cost) / cost : 0 });
  }
  return rows.sort((a, b) => (b.ret ?? -Infinity) - (a.ret ?? -Infinity));
}

async function leaderboard(group: Group) {
  const contest = activeContest(group.id) ?? load().contests.filter((c) => c.groupId === group.id).at(-1);
  if (!contest) return `No contest yet. Start one: "Mayflower start a contest, $10 each, 1 week, loser buys dinner".`;
  const rows = await standings(contest);
  if (!rows.length) return `No picks yet. Pitch with "my pick: …".`;
  const lines = rows.map((r, i) =>
    `${i + 1}. ${displayName(r.user)} ${r.ret == null ? `(${r.status})` : pct(r.ret)} — ${r.side} ${r.market ? marketLabel(r.market) : r.pitch}`);
  const ends = contest.endsAt && contest.status === "active" ? `\nScoring ${new Date(contest.endsAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. Reward: ${contest.reward}.` : `\nReward: ${contest.reward}.`;
  return `${contest.status === "ended" ? "Final standings" : "Leaderboard"} (% return at mid price):\n${lines.join("\n")}${ends}`;
}

/** Score the active contest at current prices and announce the winner. Positions stay open. */
async function finalizeContest(group: Group, manual = false): Promise<string> {
  const contest = activeContest(group.id);
  if (!contest) return manual ? "There's no active contest to end." : "";
  const rows = (await standings(contest)).filter((r) => r.ret != null);
  const winner = rows[0];
  tx((db) => {
    const c = db.contests.find((x) => x.id === contest.id)!;
    c.status = "ended"; c.winnerUserId = winner?.user.id;
  });
  audit({ actor: manual ? "user" : "system", action: "contest.end", ref: contest.id, detail: { winner: winner?.user.id, ret: winner?.ret } });
  if (!winner) return `Contest closed — nobody had an approved trade, so no winner. Start another anytime.`;
  const board = rows.map((r, i) => `${i + 1}. ${displayName(r.user)} ${pct(r.ret!)}`).join("\n");
  return `🏆 ${displayName(winner.user)} wins with ${pct(winner.ret!)}!\n${board}\nReward: ${contest.reward}. Positions stay open — I'll keep watching them.`;
}

/** Called by the monitor cron: score any contest whose end time has passed. */
export async function finalizeDueContests(): Promise<number> {
  const db = load();
  const due = db.contests.filter((c) => c.status === "active" && c.endsAt && Date.parse(c.endsAt) <= Date.now());
  for (const c of due) {
    const g = db.groups.find((x) => x.id === c.groupId);
    if (!g) continue;
    const msg = await finalizeContest(g);
    if (msg) await postToGroup(g, msg);
  }
  return due.length;
}

// ---------- group picks (agent reads the chat) ----------

interface ChatTopic { suggest: boolean; query?: string; side?: Side; marketId?: string; rationale?: string }

async function pickFromChat(group: Group, force: boolean): Promise<{ market: Market; side?: Side; rationale: string } | null> {
  const chat = recentChat(group.id);
  const markets = (await listMarkets()).filter((m) => m.status === "open" || m.status === "unknown").slice(0, 80);
  if (llmEnabled) {
    try {
      const r = await generateJSON<ChatTopic>(
        `Recent group chat:\n${chat}\n\nLive markets (id | event — contract | yes ask):\n${markets.map((m) => `${m.id} | ${marketLabel(m)} | ${yesAsk(m).toFixed(2)}`).join("\n")}

${force ? "The group asked for a trade idea." : "Only suggest if friends expressed a clear, strong opinion about a real-world outcome that one of these markets captures. Otherwise suggest=false."}
Return JSON {"suggest": boolean, "marketId": string, "side": "YES"|"NO" (the side the group seems to believe), "rationale": one sentence quoting what in the chat led to this}.`,
        "You read a friends' group chat and connect what they're debating to real prediction markets. Return ONLY JSON.",
      );
      const m = markets.find((x) => x.id === r.marketId);
      if (r.suggest && m) return { market: m, side: r.side, rationale: r.rationale ?? "" };
      if (!force) return null;
    } catch { if (!force) return null; }
  } else if (!force) return null; // no LLM: never interrupt the group unprompted

  const txt = chat.toLowerCase();
  const topic = Object.keys(KNOWN_TOPICS).find((t) => KNOWN_TOPICS[t].some((k) => txt.includes(k)));
  const pool = topic ? markets.filter((m) => matchesTopic(m, topic)) : markets;
  const m = [...(pool.length ? pool : markets)].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];
  return m ? { market: m, rationale: topic ? `You've been talking about ${topic}.` : "Most active market right now." } : null;
}

async function groupPick(group: Group, force: boolean): Promise<string | null> {
  const found = await pickFromChat(group, force);
  tx((db) => {
    const g = db.groups.find((x) => x.id === group.id)!;
    g.msgsSinceSuggestion = 0; g.lastSuggestionAt = now();
  });
  if (!found) return force ? "Couldn't find a live market that fits the conversation. Try naming a topic." : null;

  const research = await researchAndForecast(found.market);
  const p = research.estimatedProbability;
  const side: Side = found.side ?? (p - yesAsk(found.market) >= (1 - p) - noAsk(found.market) ? "YES" : "NO");
  const price = side === "YES" ? yesAsk(found.market) : noAsk(found.market);
  const pSide = side === "YES" ? p : 1 - p;
  const stakeUsd = activeContest(group.id)?.stakeUsd ?? DEFAULT_STAKE;
  tx((db) => {
    db.groupPicks.push({
      id: id("pick_"), groupId: group.id, market: found.market, researchId: research.id, side, price, stakeUsd,
      rationale: found.rationale, joinedUserIds: [], createdAt: now(), expiresAt: new Date(Date.now() + PICK_TTL_MS).toISOString(),
    });
  });
  audit({ actor: "agent", action: "group.pick", detail: { groupId: group.id, marketId: found.market.id, side, forced: force } });
  const disagree = pSide < price - 0.03 ? ` Heads up: my own estimate is only ${Math.round(pSide * 100)}%, below the price.` : "";
  return [
    `${force ? "Group idea" : "Overheard a trade 👀"}: ${side} on ${marketLabel(found.market)} @ ${Math.round(price * 100)}¢.`,
    `Why: ${found.rationale} ${research.summary.split(/(?<=\.)\s/)[0]}`,
    `My estimate for ${side}: ${Math.round(pSide * 100)}%.${disagree}`,
    `Reply "in" to join with $${stakeUsd} — I'll DM you your own approval link.`,
  ].join("\n");
}

async function joinPick(group: Group, pick: NonNullable<ReturnType<typeof openPick>>, sender: User) {
  if (pick.joinedUserIds.includes(sender.id)) return null;
  const research = load().research.find((r) => r.id === pick.researchId);
  if (!research) return null;
  const fresh = (await getMarket(pick.market.id)) ?? pick.market;
  const { proposal, error } = proposeForUser({
    user: sender, market: fresh, research, side: pick.side, stakeUsd: pick.stakeUsd, groupId: group.id,
    thesis: `Group pick: ${pick.rationale} ${research.summary}`,
  });
  if (!proposal) return `${displayName(sender)}, ${error}.`;
  tx((db) => { db.groupPicks.find((x) => x.id === pick.id)!.joinedUserIds.push(sender.id); });
  await dm(sender, approvalDM(proposal, `You're in on the group pick:`));
  return `${displayName(sender)} is in ✅ (approval link sent privately)`;
}

/** Always-listening: occasionally surface a trade when the group is debating something tradeable. */
async function maybeSuggest(group: Group): Promise<string | null> {
  const g = load().groups.find((x) => x.id === group.id)!;
  const since = g.lastSuggestionAt ? Date.now() - Date.parse(g.lastSuggestionAt) : Infinity;
  if (g.msgsSinceSuggestion < SUGGEST_EVERY_N_MSGS || since < SUGGEST_MIN_GAP_MS || openPick(group.id)) return null;
  return groupPick(group, false);
}

// ---------- free-form ----------

async function answer(group: Group, sender: User, text: string) {
  if (!llmEnabled) {
    return `Commands: "Mayflower start a contest, $10 each, 1 week, loser buys dinner" · "my pick: …" · "Mayflower leaderboard" · "Mayflower what should we bet on?" · reply "in" to join a group pick.`;
  }
  const contest = activeContest(group.id);
  const board = contest ? await leaderboard(group) : "No active contest.";
  return generateText(
    `Group chat so far:\n${recentChat(group.id, 30)}\n\nContest status:\n${board}\n\n${displayName(sender)} just said to you: "${text}"\nReply in 1-3 short sentences.`,
    `You are Mayflower, an AI prediction-market agent added to a friends' iMessage group. You run friendly trading contests (equal stakes, best % return wins a reward the group sets) and suggest group trades. Every trade needs that person's own private approval; never claim to have placed a trade. No promises of profit. Be brief and fun. Commands you support: "start a contest", "my pick: …", "leaderboard", "what should we bet on?", replying "in" to a group pick, "end contest".`,
  );
}
