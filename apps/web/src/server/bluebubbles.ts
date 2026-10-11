import { randomUUID } from "node:crypto";
import { blueBubblesConfigured, config } from "./config";

/** Normalize a phone number or Apple ID email into a stable handle. */
export function normalizeHandle(input: string): string {
  const raw = input.trim();
  if (raw.includes("@")) return raw.toLowerCase();
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `+${digits.slice(1).replace(/\D/g, "")}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : raw.toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return /^\+\d{8,15}$/.test(handle) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(handle);
}

function endpoint(path: string): string {
  const c = config();
  const url = new URL(`${c.blueBubblesUrl}${path}`);
  url.searchParams.set("password", c.blueBubblesPassword ?? "");
  return url.toString();
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** Send an iMessage through the BlueBubbles server REST API. */
export async function sendIMessage(address: string, text: string): Promise<SendResult> {
  if (!blueBubblesConfigured()) return { ok: false, error: "BlueBubbles is not configured" };
  const c = config();
  const body = { chatGuid: `iMessage;-;${address}`, tempGuid: randomUUID(), message: text, method: c.blueBubblesMethod };
  try {
    const res = await fetch(endpoint("/api/v1/message/text"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { ok: true };
    // A brand-new conversation may not have a chat yet: create it with the first message.
    const created = await fetch(endpoint("/api/v1/chat/new"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ addresses: [address], message: text, method: c.blueBubblesMethod, tempGuid: randomUUID() }),
      signal: AbortSignal.timeout(20_000),
    });
    if (created.ok) return { ok: true };
    return { ok: false, error: `BlueBubbles responded ${res.status} / ${created.status}` };
  } catch (err) {
    return { ok: false, error: `BlueBubbles unreachable: ${(err as Error).message}` };
  }
}

export async function pingBlueBubbles(): Promise<{ ok: boolean; detail: string }> {
  if (!blueBubblesConfigured()) return { ok: false, detail: "not configured" };
  try {
    const res = await fetch(endpoint("/api/v1/ping"), { signal: AbortSignal.timeout(5_000) });
    return res.ok ? { ok: true, detail: "server reachable" } : { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

export interface InboundIMessage {
  guid: string;
  text: string;
  handle: string;
  chatGuid: string | null;
  isFromMe: boolean;
  isGroup: boolean;
}

/** Parse a BlueBubbles "new-message" webhook. Returns null for other event types. */
export function parseBlueBubblesWebhook(payload: unknown): InboundIMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { type?: string; data?: Record<string, unknown> };
  if (p.type !== "new-message" || !p.data) return null;
  const d = p.data as {
    guid?: string;
    text?: string | null;
    isFromMe?: boolean;
    handle?: { address?: string } | null;
    chats?: { guid?: string; chatIdentifier?: string; participants?: unknown[] }[];
  };
  const chat = d.chats?.[0];
  const chatGuid = chat?.guid ?? null;
  // Group chats use ";+;" in the GUID. Mayflower only works in 1:1 conversations.
  const isGroup = Boolean(chatGuid && chatGuid.includes(";+;"));
  const address = d.handle?.address ?? (chatGuid && !isGroup ? chatGuid.split(";").pop() : undefined);
  if (!d.guid || !address) return null;
  return {
    guid: d.guid,
    text: (d.text ?? "").toString(),
    handle: normalizeHandle(address),
    chatGuid,
    isFromMe: Boolean(d.isFromMe),
    isGroup,
  };
}
