import { and, desc, eq, gt, lt } from "drizzle-orm";
import {
  checkTradeOnlyScopes,
  createHmacAuth,
  createOAuth,
  GeminiTradingVenue,
  MAYFLOWER_OAUTH_SCOPES,
  SimulatedTradingVenue,
  type OAuthAuthorizationTransactionStore,
  type OAuthTokenStore,
  type OAuthTokens,
  type TradingVenue,
} from "@mayflower/gemini-markets";
import { round, type ExecutionMode } from "@mayflower/shared";
import { config, oauthConfigured, sharedSandboxConfigured } from "./config";
import { decrypt, encrypt } from "./crypto";
import { getDb, schema } from "./db/client";
import type { GeminiConnection } from "./db/schema";
import { marketData } from "./integrations";
import { audit } from "./audit";
import { ledgerBalance, reservedForOpenOrders, type BalanceInfo } from "./portfolio";

const g = globalThis as unknown as { __mayflowerVenueOverride?: (mode: ExecutionMode) => TradingVenue | null; __mayflowerLocks?: Map<string, Promise<unknown>> };

/** Tests: force a venue implementation for a mode. */
export function setVenueOverride(fn: ((mode: ExecutionMode) => TradingVenue | null) | null): void {
  g.__mayflowerVenueOverride = fn ?? undefined;
}

export async function activeConnection(userId: string): Promise<GeminiConnection | null> {
  const db = await getDb();
  const [c] = await db
    .select()
    .from(schema.geminiConnections)
    .where(and(eq(schema.geminiConnections.userId, userId), eq(schema.geminiConnections.status, "active")))
    .orderBy(desc(schema.geminiConnections.linkedAt))
    .limit(1);
  return c ?? null;
}

export function modeLabel(mode: ExecutionMode | null, env = config().geminiEnv): string {
  if (mode === "oauth") return env === "sandbox" ? "Your Gemini sandbox account" : "Your Gemini account";
  if (mode === "shared_sandbox") return "Sandbox – shared account";
  if (mode === "simulated") return "Simulated (no exchange)";
  return "Gemini not linked";
}

/** The mode a user without a connection would get. */
export function defaultMode(): ExecutionMode | "needs_link" {
  if (oauthConfigured()) return "needs_link";
  if (sharedSandboxConfigured()) return "shared_sandbox";
  return "simulated";
}

async function grantAllocation(userId: string, mode: ExecutionMode): Promise<void> {
  if (mode === "oauth") return;
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.userId, userId), eq(schema.ledgerEntries.mode, mode), eq(schema.ledgerEntries.kind, "allocation")))
    .limit(1);
  if (existing) return;
  const amount = config().sandboxAllocationUsd;
  await db.insert(schema.ledgerEntries).values({
    userId,
    mode,
    kind: "allocation",
    amount,
    memo: mode === "shared_sandbox" ? "Sandbox allocation on the shared team account" : "Simulated starting balance",
  });
}

async function deactivateOthers(userId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.geminiConnections)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(schema.geminiConnections.userId, userId), eq(schema.geminiConnections.status, "active")));
}

/** Use the shared sandbox key (Plan B) or simulated execution. Explicit and labelled. */
export async function chooseFallbackMode(userId: string, mode: "shared_sandbox" | "simulated"): Promise<GeminiConnection> {
  if (mode === "shared_sandbox" && !sharedSandboxConfigured()) throw new Error("The shared sandbox account is not configured on this server.");
  const db = await getDb();
  await deactivateOthers(userId);
  const [conn] = await db.insert(schema.geminiConnections).values({ userId, mode, env: config().geminiEnv, scopes: mode === "shared_sandbox" ? "server-side sandbox key" : null }).returning();
  await grantAllocation(userId, mode);
  await audit({ userId, actor: "user", action: "gemini.mode_selected", refType: "gemini_connection", refId: conn.id, details: { mode } });
  return conn;
}

/** Create the default connection when OAuth isn't available (shared sandbox if configured, else simulated). */
export async function ensureDefaultConnection(userId: string): Promise<GeminiConnection | null> {
  const existing = await activeConnection(userId);
  if (existing) return existing;
  const mode = defaultMode();
  if (mode === "needs_link") return null;
  const db = await getDb();
  const [conn] = await db
    .insert(schema.geminiConnections)
    .values({ userId, mode, env: config().geminiEnv, scopes: mode === "shared_sandbox" ? "server-side sandbox key" : null })
    .onConflictDoNothing()
    .returning();
  if (!conn) return activeConnection(userId);
  await grantAllocation(userId, mode);
  await audit({ userId, actor: "system", action: "gemini.default_mode", refType: "gemini_connection", refId: conn.id, details: { mode } });
  return conn;
}

// ---- OAuth (Plan A) -------------------------------------------------------------

function redirectUri(): string {
  return `${config().appUrl}/api/gemini/oauth/callback`;
}

function transactionStore(userId: string): OAuthAuthorizationTransactionStore {
  return {
    async save(tx) {
      const db = await getDb();
      await db.delete(schema.oauthTransactions).where(lt(schema.oauthTransactions.expiresAt, new Date()));
      await db.insert(schema.oauthTransactions).values({ state: tx.state, userId, verifierEnc: encrypt(JSON.stringify(tx)), expiresAt: new Date(Date.now() + 10 * 60_000) });
    },
    async consume(state) {
      const db = await getDb();
      const rows = await db
        .delete(schema.oauthTransactions)
        .where(and(eq(schema.oauthTransactions.state, state), eq(schema.oauthTransactions.userId, userId), gt(schema.oauthTransactions.expiresAt, new Date())))
        .returning();
      const row = rows[0];
      return row?.verifierEnc ? JSON.parse(decrypt(row.verifierEnc)) : undefined;
    },
  };
}

function lock<T>(key: string, op: () => Promise<T>): Promise<T> {
  g.__mayflowerLocks ??= new Map();
  const prev = g.__mayflowerLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(op);
  g.__mayflowerLocks.set(key, next);
  return next;
}

/** OAuth token store backed by the encrypted gemini_connections row. */
class DbTokenStore implements OAuthTokenStore {
  constructor(private readonly connectionId: string) {}

  async load(): Promise<OAuthTokens | undefined> {
    const db = await getDb();
    const [row] = await db.select().from(schema.geminiConnections).where(eq(schema.geminiConnections.id, this.connectionId)).limit(1);
    if (!row?.accessTokenEnc || !row.refreshTokenEnc || row.status !== "active") return undefined;
    return {
      accessToken: decrypt(row.accessTokenEnc),
      refreshToken: decrypt(row.refreshTokenEnc),
      tokenType: "bearer",
      scope: row.scopes ?? "",
      expiresAt: row.tokenExpiresAt?.getTime() ?? 0,
    };
  }

  async save(tokens: OAuthTokens): Promise<void> {
    const db = await getDb();
    await db
      .update(schema.geminiConnections)
      .set({ accessTokenEnc: encrypt(tokens.accessToken), refreshTokenEnc: encrypt(tokens.refreshToken), tokenExpiresAt: new Date(tokens.expiresAt), scopes: tokens.scope })
      .where(eq(schema.geminiConnections.id, this.connectionId));
  }

  async clear(): Promise<void> {
    const db = await getDb();
    await db
      .update(schema.geminiConnections)
      .set({ accessTokenEnc: null, refreshTokenEnc: null, status: "revoked", revokedAt: new Date() })
      .where(eq(schema.geminiConnections.id, this.connectionId));
  }

  async clearIfCurrent(refreshToken: string): Promise<boolean> {
    const current = await this.load();
    if (current?.refreshToken !== refreshToken) return false;
    await this.clear();
    return true;
  }

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return lock(`oauth:${this.connectionId}`, operation);
  }
}

function oauthFor(userId: string, connectionId?: string) {
  const c = config();
  if (!c.geminiOAuthClientId || !c.geminiOAuthClientSecret) throw new Error("Gemini OAuth is not configured");
  return createOAuth({
    env: c.geminiEnv,
    clientId: c.geminiOAuthClientId,
    clientSecret: c.geminiOAuthClientSecret,
    redirectUri: redirectUri(),
    transactionStore: transactionStore(userId),
    tokenStore: connectionId ? new DbTokenStore(connectionId) : undefined,
  });
}

/** Start "Connect Gemini": trade-only scopes, never Fund Manager. */
export async function beginGeminiOAuth(userId: string): Promise<string> {
  const auth = oauthFor(userId);
  const req = await auth.beginAuthorization([...MAYFLOWER_OAUTH_SCOPES]);
  await audit({ userId, actor: "user", action: "gemini.oauth_started", details: { scopes: MAYFLOWER_OAUTH_SCOPES } });
  return req.url;
}

export async function completeGeminiOAuth(userId: string, callbackUrl: string): Promise<{ ok: true; connection: GeminiConnection } | { ok: false; error: string }> {
  const auth = oauthFor(userId);
  let tokens: OAuthTokens;
  try {
    tokens = await auth.completeAuthorization(callbackUrl);
  } catch (err) {
    await audit({ userId, actor: "system", action: "gemini.oauth_failed", details: { error: (err as Error).message } });
    return { ok: false, error: `Gemini didn't complete the connection: ${(err as Error).message}` };
  }
  const scopes = checkTradeOnlyScopes(tokens.scope);
  if (!scopes.ok) {
    // Never keep a credential that could move money (or that can't trade).
    try {
      const db = await getDb();
      const [tmp] = await db.insert(schema.geminiConnections).values({ userId, mode: "oauth", env: config().geminiEnv, status: "error", scopes: tokens.scope, lastError: "rejected scopes" }).returning();
      const store = new DbTokenStore(tmp.id);
      await store.save(tokens);
      await oauthFor(userId, tmp.id).revoke();
    } catch {
      /* best effort */
    }
    await audit({ userId, actor: "system", action: "gemini.oauth_rejected_scopes", details: { granted: scopes.granted, forbidden: scopes.forbidden } });
    return {
      ok: false,
      error: scopes.forbidden.length
        ? `Gemini granted permissions Mayflower refuses to hold (${scopes.forbidden.join(", ")}). The connection was revoked. Please grant only the Trader role.`
        : "Gemini did not grant order permissions (orders:create), so Mayflower can't place approved trades.",
    };
  }
  const db = await getDb();
  await deactivateOthers(userId);
  const [conn] = await db
    .insert(schema.geminiConnections)
    .values({
      userId,
      mode: "oauth",
      env: config().geminiEnv,
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: encrypt(tokens.refreshToken),
      tokenExpiresAt: new Date(tokens.expiresAt),
      scopes: tokens.scope,
    })
    .returning();
  await audit({ userId, actor: "user", action: "gemini.linked", refType: "gemini_connection", refId: conn.id, details: { scopes: scopes.granted, env: conn.env } });
  return { ok: true, connection: conn };
}

export async function disconnectGemini(userId: string): Promise<void> {
  const conn = await activeConnection(userId);
  if (!conn) return;
  if (conn.mode === "oauth") {
    try {
      await oauthFor(userId, conn.id).revoke();
    } catch (err) {
      await audit({ userId, actor: "system", action: "gemini.revoke_failed", details: { error: (err as Error).message } });
    }
  }
  const db = await getDb();
  await db
    .update(schema.geminiConnections)
    .set({ status: "revoked", revokedAt: new Date(), accessTokenEnc: null, refreshTokenEnc: null })
    .where(eq(schema.geminiConnections.id, conn.id));
  await audit({ userId, actor: "user", action: "gemini.disconnected", refType: "gemini_connection", refId: conn.id, details: { mode: conn.mode } });
}

// ---- Venue resolution -----------------------------------------------------------

export function venueForConnection(userId: string, conn: GeminiConnection): TradingVenue {
  const mode = conn.mode as ExecutionMode;
  const override = g.__mayflowerVenueOverride?.(mode);
  if (override) return override;
  const c = config();
  if (mode === "simulated") return new SimulatedTradingVenue(marketData());
  if (mode === "shared_sandbox") {
    if (!c.geminiApiKey || !c.geminiApiSecret) throw new Error("Shared sandbox key is not configured");
    return new GeminiTradingVenue("shared_sandbox", c.geminiEnv, createHmacAuth(c.geminiApiKey, c.geminiApiSecret), c.geminiAccount ?? undefined);
  }
  return new GeminiTradingVenue("oauth", conn.env as "sandbox" | "production", oauthFor(userId, conn.id));
}

export type VenueResolution =
  | { status: "ready"; venue: TradingVenue; mode: ExecutionMode; connection: GeminiConnection }
  | { status: "needs_link" };

export async function resolveVenue(userId: string): Promise<VenueResolution> {
  const conn = (await activeConnection(userId)) ?? (await ensureDefaultConnection(userId));
  if (!conn) return { status: "needs_link" };
  return { status: "ready", venue: venueForConnection(userId, conn), mode: conn.mode as ExecutionMode, connection: conn };
}

export async function markTermsAccepted(connectionId: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.geminiConnections).set({ termsAcceptedAt: new Date() }).where(eq(schema.geminiConnections.id, connectionId));
}

export async function balanceInfo(userId: string): Promise<BalanceInfo> {
  const conn = await activeConnection(userId);
  const c = config();
  if (!conn) {
    const mode = defaultMode();
    if (mode === "needs_link") return { mode: null, available: null, label: modeLabel(null), detail: "You'll link your own Gemini account (trade-only) when you approve your first trade." };
    const created = await ensureDefaultConnection(userId);
    if (!created) return { mode: null, available: null, label: modeLabel(null), detail: "" };
    return balanceInfo(userId);
  }
  const mode = conn.mode as ExecutionMode;
  const reserved = (await reservedForOpenOrders(userId)).total;
  if (mode === "simulated" || mode === "shared_sandbox") {
    const ledger = await ledgerBalance(userId, mode);
    let available = round(ledger - reserved, 2);
    let detail = mode === "simulated" ? `Simulated balance from a ${"$" + c.sandboxAllocationUsd} starting allocation. No real orders are sent.` : `Your allocation on Mayflower's shared Gemini sandbox account (tracked in Mayflower's ledger).`;
    if (mode === "shared_sandbox") {
      try {
        const shared = await venueForConnection(userId, conn).usdBalance();
        if (shared !== null && shared < available) {
          available = round(shared, 2);
          detail += " Limited by the shared account's actual balance.";
        }
      } catch {
        /* ledger only */
      }
    }
    return { mode, available, label: modeLabel(mode), detail };
  }
  try {
    const usd = await venueForConnection(userId, conn).usdBalance();
    return {
      mode,
      available: usd,
      label: modeLabel(mode, conn.env as "sandbox" | "production"),
      detail: usd === null ? "Couldn't read your Gemini balance right now." : "Read from your Gemini account. Mayflower can trade but cannot withdraw or transfer.",
    };
  } catch (err) {
    return { mode, available: null, label: modeLabel(mode), detail: `Couldn't read your Gemini balance: ${(err as Error).message}` };
  }
}
