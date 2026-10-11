import { randomUUID } from 'node:crypto';
import type { Messenger } from '../core/ports.js';
import type { InboundMessage, OutboundMessage } from '../core/types.js';

interface Bb { url: string; password: string }

function endpoint(bb: Bb, path: string): string {
  const base = bb.url.replace(/\/+$/, '');
  return `${base}/api/v1${path}${path.includes('?') ? '&' : '?'}password=${encodeURIComponent(bb.password)}`;
}

async function check(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`BlueBubbles ${what} failed ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res;
}

async function postJson(bb: Bb, path: string, body: unknown): Promise<Response> {
  const res = await fetch(endpoint(bb, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return check(res, path);
}

export class BlueBubblesMessenger implements Messenger {
  readonly mode = 'bluebubbles' as const;
  private readonly bb: Bb;

  constructor(url: string, password: string) {
    this.bb = { url, password };
  }

  async send({ to, text, audio }: OutboundMessage): Promise<void> {
    const chatGuid = text ? await this.sendText(to, text) : `any;-;${to}`;
    if (audio) await this.sendAttachment(chatGuid, audio);
  }

  // macOS 26 (Tahoe) stores 1:1 chats as `any;-;<handle>`: sending to `iMessage;-;` there
  // still delivers but hangs until timeout (measured 2026-10-11), so try `any;-;` first.
  // Only a definite error response moves on to the next guid; a timeout may have delivered,
  // so it is thrown rather than retried (a retry would double-text the user).
  private async sendText(to: string, text: string): Promise<string> {
    let lastError = '';
    for (const chatGuid of [`any;-;${to}`, `iMessage;-;${to}`]) {
      const res = await fetch(endpoint(this.bb, '/message/text'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatGuid, tempGuid: `mf-${randomUUID()}`, message: text, method: 'apple-script' }),
        signal: AbortSignal.timeout(20_000),
      });
      const raw = await res.text();
      // BlueBubbles can answer HTTP 200 with an error envelope; only a clean status counts as sent
      let env: { status?: number; error?: unknown } = {};
      try { env = JSON.parse(raw); } catch { /* non-JSON body */ }
      if (res.ok && !env.error && (env.status === undefined || env.status < 400)) return chatGuid;
      lastError = `${res.status}: ${raw.slice(0, 500)}`;
    }
    const chatMissing = /chat[\s\S]{0,80}?(not found|does not exist|doesn't exist)|failed to find chat/i.test(lastError);
    if (!chatMissing) throw new Error(`BlueBubbles /message/text failed ${lastError}`);
    await postJson(this.bb, '/chat/new', {
      addresses: [to],
      message: text,
      service: 'iMessage',
      method: 'apple-script',
      tempGuid: `mf-${randomUUID()}`,
    });
    return `any;-;${to}`;
  }

  private async sendAttachment(chatGuid: string, audio: NonNullable<OutboundMessage['audio']>): Promise<void> {
    const form = new FormData();
    form.set('chatGuid', chatGuid);
    form.set('tempGuid', `mf-${randomUUID()}`);
    form.set('name', audio.filename);
    form.set('method', 'apple-script');
    form.set('attachment', new Blob([new Uint8Array(audio.data)], { type: audio.mime }), audio.filename);
    const res = await fetch(endpoint(this.bb, '/message/attachment'), { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
    await check(res, '/message/attachment');
  }
}

const AUDIO_EXT = /\.(caf|m4a|mp3|wav|amr|aac|ogg|opus)$/i;

interface BbAttachment { guid?: string; mimeType?: string | null; transferName?: string | null }

function pickAudio(attachments: unknown): BbAttachment | null {
  if (!Array.isArray(attachments)) return null;
  for (const a of attachments as BbAttachment[]) {
    if (!a?.guid) continue;
    if (a.mimeType?.startsWith('audio/') || (a.transferName && AUDIO_EXT.test(a.transferName))) return a;
  }
  return null;
}

function guessMime(a: BbAttachment): string {
  if (a.mimeType?.startsWith('audio/')) return a.mimeType;
  const name = a.transferName?.toLowerCase() ?? '';
  if (name.endsWith('.caf')) return 'audio/x-caf';
  if (name.endsWith('.m4a')) return 'audio/mp4';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}

// Phones match on digits (so +1 (555) 010-0000 == 5550100000), emails case-insensitively.
const normHandle = (h: string) => (h.includes('@') ? h.trim().toLowerCase() : h.replace(/\D/g, ''));

/** Fails closed: empty = nobody, `*` = everyone. On a personal Apple ID, `*` answers every friend. */
export function senderAllowed(from: string, allowed: readonly string[]): boolean {
  if (allowed.includes('*')) return true;
  const f = normHandle(from);
  return allowed.some((a) => {
    const n = normHandle(a);
    if (!n || !f) return false;
    if (n === f) return true;
    if (from.includes('@') || a.includes('@')) return false;
    // US numbers with and without the country code; never a looser suffix match (+52 555... != 555...)
    const [short, long] = n.length < f.length ? [n, f] : [f, n];
    return short.length === 10 && long === `1${short}`;
  });
}

// Group chat guids look like `iMessage;+;chat123`; the bot only talks 1:1
const inGroupChat = (chats: unknown) =>
  Array.isArray(chats) && chats.some((c: { guid?: unknown }) => typeof c?.guid === 'string' && c.guid.includes(';+;'));

export async function parseBlueBubblesWebhook(body: unknown, bb: Bb, allowedSenders: readonly string[]): Promise<InboundMessage | null> {
  const evt = body as { type?: string; data?: Record<string, any> } | null;
  if (!evt || evt.type !== 'new-message' || !evt.data) return null;
  const d = evt.data;
  if (d.isFromMe === true) return null;
  if (d.associatedMessageType) return null;
  const from: unknown = d.handle?.address;
  if (typeof from !== 'string' || !from) return null;
  if (!senderAllowed(from, allowedSenders) || inGroupChat(d.chats)) return null;

  const text = typeof d.text === 'string' ? d.text : '';
  const att = pickAudio(d.attachments);
  let audio: InboundMessage['audio'];
  if (att) {
    const res = await fetch(endpoint(bb, `/attachment/${encodeURIComponent(att.guid!)}/download`));
    await check(res, 'attachment download');
    audio = { data: Buffer.from(await res.arrayBuffer()), mime: guessMime(att) };
  }
  if (!text && !audio) return null;
  return { from, text, audio, channel: 'imessage', externalId: typeof d.guid === 'string' ? d.guid : null };
}

export async function registerWebhook(bbUrl: string, password: string, webhookUrl: string): Promise<void> {
  const bb = { url: bbUrl, password };
  const listRes = await check(await fetch(endpoint(bb, '/webhook')), '/webhook list');
  const existing = ((await listRes.json()) as { data?: Array<{ id: number; url: string }> }).data ?? [];
  for (const w of existing.filter((w) => w.url === webhookUrl)) {
    await check(await fetch(endpoint(bb, `/webhook/${w.id}`), { method: 'DELETE' }), 'webhook delete');
  }
  await postJson(bb, '/webhook', { url: webhookUrl, events: ['new-message'] });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const need = (k: string) => {
    const v = process.env[k]?.trim();
    if (!v) throw new Error(`${k} is required`);
    return v;
  };
  const target = `${need('PUBLIC_BASE_URL').replace(/\/+$/, '')}/webhooks/bluebubbles/${need('WEBHOOK_SECRET')}`;
  await registerWebhook(need('BLUEBUBBLES_URL'), need('BLUEBUBBLES_PASSWORD'), target);
  console.log('registered new-message webhook ->', target.replace(/[^/]+$/, '***'));
}
