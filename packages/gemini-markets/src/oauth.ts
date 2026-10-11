import {
  HmacAuth,
  OAuthAuth,
  BearerAuth,
  type OAuthAuthorizationTransactionStore,
  type OAuthTokenStore,
  type OAuthTokens,
} from "@gemini-markets/sdk/server";
import type { GeminiEnv } from "@mayflower/shared";

/**
 * Scopes Mayflower requests: read balances/positions/history and create
 * orders (the Trader role). It never requests fund-movement scopes such as
 * crypto:send, banks:*, addresses:create or clearing:create (Fund Manager).
 */
export const MAYFLOWER_OAUTH_SCOPES = ["account:read", "balances:read", "orders:read", "orders:create", "history:read"] as const;

const ALLOWED = new Set<string>(MAYFLOWER_OAUTH_SCOPES);

/** Verify a granted scope string contains nothing that could move money. */
export function checkTradeOnlyScopes(granted: string): { ok: boolean; granted: string[]; forbidden: string[] } {
  const list = granted
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const forbidden = list.filter((s) => !ALLOWED.has(s));
  return { ok: forbidden.length === 0 && list.includes("orders:create"), granted: list, forbidden };
}

export interface OAuthConfig {
  env: GeminiEnv;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenStore?: OAuthTokenStore;
  transactionStore?: OAuthAuthorizationTransactionStore;
}

export function createOAuth(cfg: OAuthConfig): OAuthAuth {
  return new OAuthAuth({
    env: cfg.env,
    client: { type: "confidential", clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri },
    tokenStore: cfg.tokenStore,
    authorizationTransactionStore: cfg.transactionStore,
  });
}

export function createHmacAuth(apiKey: string, apiSecret: string): HmacAuth {
  return new HmacAuth({ apiKey, apiSecret });
}

export function createBearerAuth(accessToken: string): BearerAuth {
  return new BearerAuth({ accessToken });
}

export type { OAuthAuthorizationTransactionStore, OAuthTokenStore, OAuthTokens };
