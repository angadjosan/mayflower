// Gmail connector: Google OAuth (gmail.readonly, offline). Uses subject + snippet only, never full bodies.

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
export const configured = !!(CLIENT_ID && CLIENT_SECRET);

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email"];
const MAX_ITEMS = 20;
const MAX_CHARS = 2000;

export interface GmailToken { access_token: string; refresh_token?: string; expires_at?: number; email?: string }

const redirectUri = () => `${process.env.APP_URL || "http://localhost:3000"}/api/connect/gmail/callback`;

export function authUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: "code", scope: SCOPES.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google token request failed: ${j.error ?? res.status}`);
  return j;
}

function emailFromIdToken(idToken?: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString("utf8")) as { email?: string };
    return payload.email;
  } catch {
    return undefined;
  }
}

export async function exchangeCode(code: string): Promise<{ token: GmailToken; scopes: string[]; accountLabel?: string }> {
  const j = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  const email = emailFromIdToken(j.id_token);
  return {
    token: { access_token: j.access_token!, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000, email },
    scopes: (j.scope ?? "").split(" ").filter(Boolean),
    accountLabel: email,
  };
}

/** Returns a fresh token if the access token is (nearly) expired; mutates and returns the same object. */
export async function ensureFresh(token: GmailToken): Promise<{ token: GmailToken; refreshed: boolean }> {
  if (token.expires_at && token.expires_at - 60_000 > Date.now()) return { token, refreshed: false };
  if (!token.refresh_token) return { token, refreshed: false };
  const j = await tokenRequest({ refresh_token: token.refresh_token, grant_type: "refresh_token" });
  token.access_token = j.access_token!;
  token.expires_at = Date.now() + (j.expires_in ?? 3600) * 1000;
  if (j.refresh_token) token.refresh_token = j.refresh_token;
  return { token, refreshed: true };
}

async function gapi<T>(token: GmailToken, path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!res.ok) throw new Error(`Gmail ${path.split("?")[0]} failed (${res.status})`);
  return (await res.json()) as T;
}

export async function fetchRecentText(token: GmailToken): Promise<{ title: string; text: string; url?: string }[]> {
  await ensureFresh(token);
  const list = await gapi<{ messages?: { id: string }[] }>(token, `messages?${new URLSearchParams({
    q: "newer_than:14d -category:social", maxResults: String(MAX_ITEMS),
  })}`);
  const out: { title: string; text: string; url?: string }[] = [];
  for (const m of (list.messages ?? []).slice(0, MAX_ITEMS)) {
    try {
      const msg = await gapi<{ id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } }>(
        token, `messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      );
      const h = (n: string) => msg.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      const subject = h("subject") || "(no subject)";
      const from = h("from").replace(/<[^>]*>/, "").trim();
      out.push({
        title: from ? `${subject} — ${from}` : subject,
        text: `${subject}\n${decodeEntities(msg.snippet ?? "")}`.slice(0, MAX_CHARS),
        url: `https://mail.google.com/mail/u/0/#all/${msg.id}`,
      });
    } catch {
      // skip unreadable messages
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
