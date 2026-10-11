// Slack connector: OAuth v2 user token. Reads the user's own recent messages only.

const CLIENT_ID = process.env.SLACK_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET || "";
export const configured = !!(CLIENT_ID && CLIENT_SECRET);

export const USER_SCOPES = ["channels:history", "groups:history", "channels:read", "groups:read", "search:read", "users:read"];
const MAX_ITEMS = 20;
const MAX_CHARS = 2000;

export interface SlackToken { access_token: string; user_id?: string; team_id?: string; team_name?: string }

const redirectUri = () => `${process.env.APP_URL || "http://localhost:3000"}/api/connect/slack/callback`;

export function authUrl(state: string): string {
  const p = new URLSearchParams({ client_id: CLIENT_ID, user_scope: USER_SCOPES.join(","), redirect_uri: redirectUri(), state });
  return `https://slack.com/oauth/v2/authorize?${p}`;
}

export async function exchangeCode(code: string): Promise<{ token: SlackToken; scopes: string[]; accountLabel?: string }> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, redirect_uri: redirectUri() }),
  });
  const j = (await res.json().catch(() => ({}))) as {
    ok?: boolean; error?: string; team?: { id?: string; name?: string };
    authed_user?: { id?: string; access_token?: string; scope?: string };
  };
  const at = j.authed_user?.access_token;
  if (!j.ok || !at) throw new Error(`Slack token exchange failed: ${j.error ?? res.status}`);
  return {
    token: { access_token: at, user_id: j.authed_user?.id, team_id: j.team?.id, team_name: j.team?.name },
    scopes: (j.authed_user?.scope ?? "").split(",").filter(Boolean),
    accountLabel: j.team?.name,
  };
}

async function api<T>(token: string, method: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!j.ok) throw new Error(`Slack ${method} failed: ${j.error ?? res.status}`);
  return j;
}

type Msg = { text?: string; ts?: string; user?: string; permalink?: string; channel?: { id?: string; name?: string } };

export async function fetchRecentText(token: SlackToken): Promise<{ title: string; text: string; url?: string }[]> {
  try {
    const r = await api<{ messages?: { matches?: Msg[] } }>(token.access_token, "search.messages", {
      query: "from:me", sort: "timestamp", sort_dir: "desc", count: String(MAX_ITEMS),
    });
    const matches = r.messages?.matches ?? [];
    if (matches.length) {
      return matches.slice(0, MAX_ITEMS).filter((m) => m.text?.trim()).map((m) => ({
        title: `Slack message${m.channel?.name ? ` in #${m.channel.name}` : ""}`,
        text: (m.text ?? "").slice(0, MAX_CHARS),
        url: m.permalink,
      }));
    }
  } catch {
    // fall through to conversations.history
  }
  // Fallback: the user's own messages from a few channels they belong to.
  const convs = await api<{ channels?: { id: string; name?: string }[] }>(token.access_token, "users.conversations", {
    types: "public_channel,private_channel", exclude_archived: "true", limit: "10",
  });
  const out: { title: string; text: string; url?: string }[] = [];
  for (const ch of (convs.channels ?? []).slice(0, 5)) {
    try {
      const h = await api<{ messages?: Msg[] }>(token.access_token, "conversations.history", { channel: ch.id, limit: "50" });
      for (const m of h.messages ?? []) {
        if (token.user_id && m.user !== token.user_id) continue;
        if (!m.text?.trim()) continue;
        out.push({ title: `Slack message${ch.name ? ` in #${ch.name}` : ""}`, text: m.text.slice(0, MAX_CHARS) });
        if (out.length >= MAX_ITEMS) return out;
      }
    } catch {
      // skip channels we can't read
    }
  }
  return out;
}
