// Gemini OAuth 2.0 (spec §7 Plan A): per-user, trade-only account linking.
// Docs: https://developer.gemini.com/authentication/oauth — authorization-code grant with refresh tokens.
// Mayflower NEVER requests fund-management scopes (addresses:*, banks:*, crypto:send, clearing:create):
// it can place approved trades but cannot move or withdraw money.
// Plan B (one shared sandbox API key in exchange.ts) stays the default when OAuth isn't configured.
import crypto from "crypto";
import { tx, load, id, now, audit } from "./db";
import { sign, verify } from "./session";
import { encryptJSON, decryptJSON } from "./crypto";
import type { ConnectedSource } from "./types";

const CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GEMINI_OAUTH_CLIENT_SECRET;
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const SANDBOX = (process.env.GEMINI_EXCHANGE_BASE_URL || "https://api.sandbox.gemini.com").includes("sandbox");
/** OAuth host: sandbox unless GEMINI_EXCHANGE_BASE_URL points at production. Override with GEMINI_OAUTH_BASE_URL. */
export const OAUTH_BASE = (process.env.GEMINI_OAUTH_BASE_URL || (SANDBOX ? "https://exchange.sandbox.gemini.com" : "https://exchange.gemini.com")).replace(/\/$/, "");
const AUTHORIZE_URL = `${OAUTH_BASE}/auth`;
const TOKEN_URL = `${OAUTH_BASE}/auth/token`;
const REVOKE_URL = `${OAUTH_BASE}/auth/token/revoke`;
export const REDIRECT_URI = process.env.GEMINI_OAUTH_REDIRECT_URI || `${APP_URL}/api/gemini-oauth/callback`;

/** Trade-only: read balances/orders/history, create orders. Nothing that moves money. */
export const GEMINI_OAUTH_SCOPES = ["balances:read", "orders:create", "orders:read", "history:read"] as const;
const FORBIDDEN_SCOPE = /^(addresses|banks|clearing):|^crypto:send$|fund|transfer|withdraw/i;

export const geminiOAuthConfigured = Boolean(CLIENT_ID && CLIENT_SECRET);
export const STATE_COOKIE = "mf_gemini_oauth";
const STATE_TTL_MS = 15 * 60 * 1000;

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  expiresAt: string; // ISO
}

// ---------- state (CSRF) ----------

/** Signed state `${userId}.${ts}.${nonce}.${sig}`; the nonce is also set as a cookie to bind the flow to this browser. */
export function makeState(userId: string): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(12).toString("base64url");
  const payload = `${userId}.${Date.now()}.${nonce}`;
  return { state: `${payload}.${sign(payload)}`, nonce };
}

export function verifyState(state: string | null | undefined, cookieNonce?: string): { userId: string } | null {
  if (!state) return null;
  const i = state.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = state.slice(0, i), sig = state.slice(i + 1);
  if (!verify(payload, sig)) return null;
  const parts = payload.split(".");
  if (parts.length < 3) return null;
  const nonce = parts.pop()!, ts = Number(parts.pop());
  const userId = parts.join(".");
  if (!Number.isFinite(ts) || Date.now() - ts > STATE_TTL_MS) return null;
  if (!cookieNonce || cookieNonce !== nonce) return null;
  return { userId };
}

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    state,
    scope: GEMINI_OAUTH_SCOPES.join(","),
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

// ---------- token endpoint ----------

async function tokenRequest(body: Record<string, string>): Promise<StoredToken> {
  // Docs list the fields but not the encoding; send JSON (Gemini's convention) and fall back to form encoding.
  let res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 400 || res.status === 415) {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15000),
    });
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini token ${res.status}: ${text.slice(0, 200)}`);
  const j = JSON.parse(text) as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Gemini token response had no access_token");
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    scope: j.scope,
    expiresAt: new Date(Date.now() + (Number(j.expires_in) || 86_399) * 1000).toISOString(),
  };
}

export function exchangeCode(code: string): Promise<StoredToken> {
  return tokenRequest({
    client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, code, redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
  });
}

function refresh(refreshToken: string): Promise<StoredToken> {
  return tokenRequest({ client_id: CLIENT_ID!, client_secret: CLIENT_SECRET!, refresh_token: refreshToken, grant_type: "refresh_token" });
}

// ---------- storage ----------

async function activeSource(userId: string): Promise<ConnectedSource | undefined> {
  return (await load()).connectedSources.find((s) => s.userId === userId && s.provider === "gemini" && s.status === "connected");
}

/** Store (or replace) the user's Gemini connection, encrypted at rest, and mark the user linked. */
export async function saveGeminiToken(userId: string, tok: StoredToken): Promise<ConnectedSource> {
  const scopes = (tok.scope ? tok.scope.split(/[,\s]+/) : [...GEMINI_OAUTH_SCOPES]).filter(Boolean);
  const bad = scopes.filter((s) => FORBIDDEN_SCOPE.test(s));
  if (bad.length) {
    // Defense in depth: we never ask for these, so refuse to keep a token that has them.
    void revokeToken(tok.access_token);
    throw new Error(`Gemini granted fund-management scopes (${bad.join(", ")}); refusing to store this token.`);
  }
  const src = await tx((db) => {
    const t = now();
    let s = db.connectedSources.find((x) => x.userId === userId && x.provider === "gemini");
    if (s) {
      Object.assign(s, { status: "connected", scopes, tokenEnc: encryptJSON(tok), connectedAt: t, lastError: undefined, revokedAt: undefined });
    } else {
      s = { id: id("src_"), userId, provider: "gemini", status: "connected", scopes, tokenEnc: encryptJSON(tok), accountLabel: SANDBOX ? "Gemini sandbox (OAuth)" : "Gemini (OAuth)", connectedAt: t };
      db.connectedSources.push(s);
    }
    const u = db.users.find((x) => x.id === userId);
    if (u) u.geminiLinked = true;
    return { ...s };
  });
  await audit({ userId, actor: "user", action: "gemini_linked", ref: src.id, detail: { method: "oauth", scopes } });
  return src;
}

/**
 * The user's Gemini OAuth access token, refreshed when within 2 minutes of expiry (refresh tokens are one-time use,
 * so the new one replaces the old). Returns null when the user hasn't linked via OAuth — callers then use Plan B.
 */
export async function getUserAccessToken(userId: string): Promise<string | null> {
  const src = await activeSource(userId);
  if (!src) return null;
  let tok: StoredToken;
  try {
    tok = decryptJSON<StoredToken>(src.tokenEnc);
  } catch {
    await tx((db) => { const s = db.connectedSources.find((x) => x.id === src.id); if (s) { s.status = "error"; s.lastError = "Token could not be decrypted"; } });
    return null;
  }
  if (Date.parse(tok.expiresAt) - Date.now() > 120_000) return tok.access_token;
  if (!tok.refresh_token || !geminiOAuthConfigured) return null;
  try {
    const next = await refresh(tok.refresh_token);
    if (!next.refresh_token) next.refresh_token = tok.refresh_token;
    await tx((db) => { const s = db.connectedSources.find((x) => x.id === src.id); if (s) { s.tokenEnc = encryptJSON(next); s.lastError = undefined; } });
    return next.access_token;
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : "refresh failed";
    await tx((db) => { const s = db.connectedSources.find((x) => x.id === src.id); if (s) { s.status = "error"; s.lastError = msg; } });
    await audit({ userId, actor: "system", action: "gemini_oauth.refresh_failed", ref: src.id, detail: { error: msg } });
    return null;
  }
}

async function revokeToken(token: string) {
  if (!geminiOAuthConfigured) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
      signal: AbortSignal.timeout(10000),
    });
  } catch { /* best effort */ }
}

/** Revoke at Gemini (best effort) and mark the connection revoked. */
export async function disconnectGemini(userId: string): Promise<boolean> {
  const src = await activeSource(userId);
  if (!src) return false;
  try {
    const tok = decryptJSON<StoredToken>(src.tokenEnc);
    await revokeToken(tok.refresh_token ?? tok.access_token);
  } catch { /* still revoke locally */ }
  await tx((db) => {
    const s = db.connectedSources.find((x) => x.id === src.id);
    if (s) { s.status = "revoked"; s.revokedAt = now(); s.tokenEnc = ""; }
    const u = db.users.find((x) => x.id === userId);
    if (u) u.geminiLinked = false;
  });
  await audit({ userId, actor: "user", action: "gemini_unlinked", ref: src.id });
  return true;
}
