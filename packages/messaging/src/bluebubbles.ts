/**
 * BlueBubbles Server (iMessage bridge) — verified against server source 1.9.9 / docs (Oct 2026).
 *  - Auth: query param `password` only. No header auth.
 *  - Send:  POST /api/v1/message/text { chatGuid, tempGuid, message, method }
 *  - Chat:  GET /api/v1/chat/{guid}; POST /api/v1/chat/new { addresses, message, method }
 *  - DM GUID format: "iMessage;-;+15551234567"
 *  - Webhooks: unsigned JSON { type, data }. Protect the receiver with a secret in the URL.
 *  - Inbound filter: type==="new-message" && !isFromMe && itemType===0 && !associatedMessageGuid
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { OutboundChannel } from "./channel.js";

export const BBHandle = z.object({ address: z.string(), service: z.string().optional() }).passthrough();
export const BBChat = z.object({ guid: z.string(), style: z.number().optional(), chatIdentifier: z.string().optional() }).passthrough();
export const BBMessage = z.object({
  guid: z.string(),
  text: z.string().nullable().optional(),
  handle: BBHandle.nullable().optional(),
  isFromMe: z.boolean(),
  itemType: z.number().default(0),
  associatedMessageGuid: z.string().nullable().optional(),
  dateCreated: z.number().nullable().optional(),
  chats: z.array(BBChat).optional(),
  tempGuid: z.string().optional(),
}).passthrough();
export const BBWebhook = z.object({ type: z.string(), data: z.unknown() });

export interface InboundText {
  externalId: string;
  text: string;
  fromHandle: string;
  chatGuid: string;
  createdAt: string;
}

/** Parse a webhook body; returns null for anything that is not a fresh inbound text. */
export function parseInboundText(body: unknown): InboundText | null {
  const w = BBWebhook.safeParse(body);
  if (!w.success || w.data.type !== "new-message") return null;
  const m = BBMessage.safeParse(w.data.data);
  if (!m.success) return null;
  const d = m.data;
  if (d.isFromMe || d.itemType !== 0 || d.associatedMessageGuid) return null;
  const chatGuid = d.chats?.[0]?.guid;
  const from = d.handle?.address ?? d.chats?.[0]?.chatIdentifier;
  const text = (d.text ?? "").trim();
  if (!chatGuid || !from || !text) return null;
  // Ignore group chats; Mayflower is a 1:1 agent.
  if (chatGuid.includes(";+;")) return null;
  return { externalId: d.guid, text, fromHandle: from, chatGuid, createdAt: new Date(d.dateCreated ?? Date.now()).toISOString() };
}

export function normalizeHandle(h: string): string {
  const t = h.trim();
  if (t.includes("@")) return t.toLowerCase();
  const digits = t.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

export const dmChatGuid = (handle: string) => `iMessage;-;${normalizeHandle(handle)}`;

export interface BlueBubblesOptions {
  baseUrl: string;
  password: string;
  method?: "private-api" | "apple-script";
  fetchImpl?: typeof fetch;
}

export class BlueBubblesChannel implements OutboundChannel {
  readonly name = "imessage" as const;
  private f: typeof fetch;
  constructor(private opts: BlueBubblesOptions) { this.f = opts.fetchImpl ?? fetch; }

  private url(path: string, q: Record<string, string> = {}) {
    const u = new URL(path, this.opts.baseUrl.replace(/\/$/, "") + "/");
    u.searchParams.set("password", this.opts.password);
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    return u;
  }

  async healthy(): Promise<boolean> {
    try {
      const r = await this.f(this.url("api/v1/ping"), { signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch { return false; }
  }

  async chatExists(chatGuid: string): Promise<boolean> {
    const r = await this.f(this.url(`api/v1/chat/${encodeURIComponent(chatGuid)}`), { signal: AbortSignal.timeout(10_000) });
    return r.ok;
  }

  async send(to: { handle?: string; chatGuid?: string; userId: string }, text: string): Promise<{ externalId: string | null }> {
    const chatGuid = to.chatGuid ?? (to.handle ? dmChatGuid(to.handle) : null);
    if (!chatGuid) throw new Error("BlueBubbles: no chatGuid or handle for recipient");
    const method = this.opts.method ?? "private-api";
    const tempGuid = randomUUID();
    // iMessage has no hard length limit but long texts render poorly; split on paragraphs > 1500 chars.
    const chunks = splitMessage(text, 1500);
    let last: string | null = null;
    for (const chunk of chunks) {
      let res = await this.f(this.url("api/v1/message/text"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatGuid, tempGuid: randomUUID(), message: chunk, method }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404 || (res.status === 500 && method === "private-api" && to.handle)) {
        // Chat may not exist yet for a brand-new contact: create it with the first message.
        res = await this.f(this.url("api/v1/chat/new"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addresses: [normalizeHandle(to.handle!)], message: chunk, method, tempGuid, service: "iMessage" }),
          signal: AbortSignal.timeout(30_000),
        });
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`BlueBubbles send failed (${res.status}): ${body.slice(0, 300)}`);
      }
      const j = (await res.json().catch(() => ({}))) as { data?: { guid?: string; messages?: Array<{ guid?: string }> } };
      last = j.data?.guid ?? j.data?.messages?.[0]?.guid ?? null;
    }
    return { externalId: last };
  }
}

export function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (const para of text.split(/\n\n+/)) {
    if ((cur + "\n\n" + para).length > max && cur) { out.push(cur); cur = para; } else cur = cur ? cur + "\n\n" + para : para;
  }
  if (cur) out.push(cur);
  return out;
}
