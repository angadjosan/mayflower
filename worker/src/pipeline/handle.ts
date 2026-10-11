// Entry point for every inbound message, whatever the channel.
import type { App } from '../app.js';
import type { InboundMessage, UserProfile } from '../core/types.js';
import { approve, APPROVE_RE } from './approve.js';
import { getOrCreateUser, logMessage, updateUser, DEFAULT_BUDGET, DEFAULT_CAP } from './repo.js';
import { runVerdict } from './verdict.js';

const queues = new Map<string, Promise<void>>();

/** Serializes messages per user so two texts from one phone never race each other. */
export function enqueueInbound(app: App, msg: InboundMessage): Promise<void> {
  const prev = queues.get(msg.from) ?? Promise.resolve();
  const next = prev.then(() => handleInbound(app, msg)).catch(async (e) => {
    console.error('[pipeline]', e);
    await app.messenger.send({ to: msg.from, text: `Something broke on my side while working on that. Text it again in a minute.` })
      .catch((e2) => console.error('[pipeline] fallback reply failed', e2));
  });
  queues.set(msg.from, next);
  void next.finally(() => { if (queues.get(msg.from) === next) queues.delete(msg.from); });
  return next;
}

async function handleInbound(app: App, msg: InboundMessage): Promise<void> {
  let text = msg.text?.trim() ?? '';
  let source: 'text' | 'voice' = 'text';
  if (msg.audio) {
    try {
      text = (await app.voice.transcribe(msg.audio.data, msg.audio.mime)).trim();
      source = 'voice';
    } catch (e) {
      console.error('[voice]', e);
      if (!text) return reply(app, msg, `I couldn't make out that voice memo. Mind texting it instead?`);
    }
  }
  const fresh = await logMessage(app.db, { phone: msg.from, direction: 'in', channel: msg.channel, body: text, hasAudio: !!msg.audio, externalId: msg.externalId });
  if (!fresh || !text) return;

  const user = await getOrCreateUser(app.db, msg.from);
  const code = APPROVE_RE.exec(text)?.[1];
  if (code) return reply(app, msg, await approve(app, user.phone, code));

  const kind = await app.brain.classify(text, user);
  if (kind === 'onboarding') {
    const patch = await app.brain.extractProfile(text, user);
    const u = await updateUser(app.db, user.phone, patch);
    return reply(app, msg, welcome(u));
  }
  if (kind === 'belief') {
    let u = user;
    let note = '';
    if (!user.onboarded) {
      u = await updateUser(app.db, user.phone, {});
      note = `\n(Using a default ${'$'}${DEFAULT_BUDGET} risk budget and ${'$'}${DEFAULT_CAP} per-trade cap. Text "my budget is $X" to change it.)`;
    }
    const v = await runVerdict(app, u, text, source);
    const audio = source === 'voice' ? await app.voice.speak(v.speech).catch(() => null) : null;
    return reply(app, msg, v.text + note, audio ?? undefined);
  }
  if (kind === 'question') {
    return reply(app, msg, await app.brain.answer(text, await context(app, user)));
  }
  return reply(app, msg, `Text me an opinion about something that hasn't happened yet ("the Chiefs win Sunday", "BTC above 120k by Friday") and I'll tell you if it's worth betting on.`);
}

async function reply(app: App, msg: InboundMessage, text: string, audio?: { data: Buffer; mime: string; filename: string }): Promise<void> {
  await app.messenger.send({ to: msg.from, text, audio });
  await logMessage(app.db, { phone: msg.from, direction: 'out', channel: msg.channel, body: text, hasAudio: !!audio });
}

function welcome(u: UserProfile): string {
  const interests = u.interests.length ? ` I'll watch ${u.interests.join(', ')}.` : '';
  const skip = u.excludedTopics.length ? ` Skipping ${u.excludedTopics.join(', ')}.` : '';
  return `Got it: $${u.riskBudget} risk budget, max $${u.perTradeCap} per trade.${interests}${skip} Text me any opinion and I'll tell you if it's an edge. Every trade needs your exact APPROVE code.`;
}

async function context(app: App, u: UserProfile): Promise<string> {
  const positions = await app.db.query<{ title: string; side: string; qty: number; cost_basis: number; sim_flag: boolean }>(
    `select coalesce(m.title, p.instrument_symbol) as title, p.side, p.qty, p.cost_basis, p.sim_flag
     from positions p left join markets m on m.instrument_symbol = p.instrument_symbol where p.user_phone = $1 and p.status = 'open'`, [u.phone]);
  const verdicts = await app.db.query<{ type: string; reasoning: string }>(
    'select type, reasoning from verdicts where user_phone = $1 order by created_at desc limit 3', [u.phone]);
  return JSON.stringify({ budget: u.riskBudget, perTradeCap: u.perTradeCap, positions, recentVerdicts: verdicts });
}
