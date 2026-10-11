// Notion connector: public-integration OAuth, or an internal integration token via NOTION_TOKEN.
// Read-only use: recently edited pages -> plain text from their top-level blocks.

const CLIENT_ID = process.env.NOTION_CLIENT_ID || "";
const CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET || "";
const INTERNAL_TOKEN = process.env.NOTION_TOKEN || "";
const VERSION = "2022-06-28";
const API = "https://api.notion.com/v1";

export const oauthConfigured = !!(CLIENT_ID && CLIENT_SECRET);
/** Internal integration mode: no OAuth, a "connect" just stores NOTION_TOKEN for the user. */
export const internalToken: string | null = !oauthConfigured && INTERNAL_TOKEN ? INTERNAL_TOKEN : null;
export const configured = oauthConfigured || !!INTERNAL_TOKEN;

const MAX_ITEMS = 20;
const MAX_CHARS = 2000;

export interface NotionToken { access_token: string; workspace_name?: string; workspace_id?: string; bot_id?: string; internal?: boolean }

const redirectUri = () => `${process.env.APP_URL || "http://localhost:3000"}/api/connect/notion/callback`;

export function authUrl(state: string): string {
  const p = new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", owner: "user", redirect_uri: redirectUri(), state });
  return `${API}/oauth/authorize?${p}`;
}

export async function exchangeCode(code: string): Promise<{ token: NotionToken; scopes: string[]; accountLabel?: string }> {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/json",
      "Notion-Version": VERSION,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof j.access_token !== "string") throw new Error(`Notion token exchange failed (${res.status}): ${String(j.error ?? "")}`);
  const token: NotionToken = {
    access_token: j.access_token, workspace_name: j.workspace_name as string | undefined,
    workspace_id: j.workspace_id as string | undefined, bot_id: j.bot_id as string | undefined,
  };
  return { token, scopes: ["read_content"], accountLabel: token.workspace_name };
}

/** Token object for internal-integration mode. */
export function internalConnection(): { token: NotionToken; scopes: string[]; accountLabel?: string } {
  return { token: { access_token: INTERNAL_TOKEN, internal: true }, scopes: ["read_content"], accountLabel: "Notion (internal integration)" };
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Notion ${path.split("?")[0]} failed (${res.status})`);
  return (await res.json()) as T;
}

type RichText = { plain_text?: string }[];
type NotionPage = { id: string; url?: string; properties?: Record<string, { type?: string; title?: RichText }> };
type NotionBlock = { type: string; [k: string]: unknown };

function pageTitle(p: NotionPage): string {
  for (const prop of Object.values(p.properties ?? {})) {
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      const t = prop.title.map((r) => r.plain_text ?? "").join("").trim();
      if (t) return t;
    }
  }
  return "Untitled page";
}

function blockText(b: NotionBlock): string {
  const body = b[b.type] as { rich_text?: RichText } | undefined;
  return Array.isArray(body?.rich_text) ? body!.rich_text!.map((r) => r.plain_text ?? "").join("") : "";
}

export async function fetchRecentText(token: NotionToken): Promise<{ title: string; text: string; url?: string }[]> {
  const search = await call<{ results: NotionPage[] }>(token.access_token, "/search", {
    method: "POST",
    body: JSON.stringify({
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: MAX_ITEMS,
    }),
  });
  const out: { title: string; text: string; url?: string }[] = [];
  for (const page of search.results.slice(0, MAX_ITEMS)) {
    try {
      const blocks = await call<{ results: NotionBlock[] }>(token.access_token, `/blocks/${page.id}/children?page_size=100`);
      const text = blocks.results.map(blockText).filter(Boolean).join("\n").slice(0, MAX_CHARS);
      const title = pageTitle(page);
      if (text.trim() || title !== "Untitled page") out.push({ title, text, url: page.url });
    } catch {
      // skip pages we can't read
    }
  }
  return out;
}
