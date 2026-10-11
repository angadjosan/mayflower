import type { GeminiEnv } from "@mayflower/shared";

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

function str(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

/** Read lazily so tests and scripts can set env vars before first use. */
export function config() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    isProd,
    appUrl: (str("APP_URL") ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, ""),
    /** Offline demo catalog + demo evidence. Never on unless explicitly enabled. */
    demoMode: bool("MAYFLOWER_DEMO_MODE", false),
    geminiEnv: (str("GEMINI_ENV") ?? "sandbox") as GeminiEnv,
    geminiApiKey: str("GEMINI_API_KEY"),
    geminiApiSecret: str("GEMINI_API_SECRET"),
    geminiAccount: str("GEMINI_ACCOUNT"),
    geminiOAuthClientId: str("GEMINI_OAUTH_CLIENT_ID"),
    geminiOAuthClientSecret: str("GEMINI_OAUTH_CLIENT_SECRET"),
    contextDevApiKey: str("CONTEXT_DEV_API_KEY"),
    googleApiKey: str("GOOGLE_GEMINI_API_KEY") ?? str("GEMINI_LLM_API_KEY") ?? str("GOOGLE_API_KEY"),
    googleModel: str("GOOGLE_GEMINI_MODEL") ?? "gemini-flash-latest",
    blueBubblesUrl: str("BLUEBUBBLES_URL")?.replace(/\/$/, "") ?? null,
    blueBubblesPassword: str("BLUEBUBBLES_PASSWORD"),
    blueBubblesWebhookSecret: str("BLUEBUBBLES_WEBHOOK_SECRET"),
    blueBubblesMethod: (str("BLUEBUBBLES_SEND_METHOD") ?? "apple-script") as "apple-script" | "private-api",
    sessionSecret: str("SESSION_SECRET") ?? (isProd ? null : "dev-only-session-secret-change-me-0123456789abcdef"),
    encryptionKey: str("ENCRYPTION_KEY"),
    cronSecret: str("CRON_SECRET"),
    sandboxAllocationUsd: Number(str("SANDBOX_ALLOCATION_USD") ?? 1000),
    /** Global kill switch. */
    tradingEnabled: bool("MAYFLOWER_TRADING_ENABLED", true),
    /** Show login codes on screen when the iMessage bridge is not configured. Never in production unless explicitly enabled. */
    devLogin: bool("MAYFLOWER_DEV_LOGIN", !isProd),
    /** Allow "APPROVE <code>" replies in iMessage in addition to the signed web confirmation link. */
    imessageCodeApproval: bool("IMESSAGE_CODE_APPROVAL", true),
    proposalTtlHours: Number(str("PROPOSAL_TTL_HOURS") ?? 12),
    approvalLinkMinutes: Number(str("APPROVAL_LINK_MINUTES") ?? 15),
    defaultTimeInForce: (str("ORDER_TIME_IN_FORCE") ?? "good-til-cancel") as "good-til-cancel" | "immediate-or-cancel",
    feePerContract: Number(str("ESTIMATED_FEE_PER_CONTRACT") ?? 0.01),
  };
}

export type AppConfig = ReturnType<typeof config>;

export function oauthConfigured(c = config()): boolean {
  return Boolean(c.geminiOAuthClientId && c.geminiOAuthClientSecret);
}

export function sharedSandboxConfigured(c = config()): boolean {
  return Boolean(c.geminiApiKey && c.geminiApiSecret && c.geminiEnv === "sandbox");
}

export function blueBubblesConfigured(c = config()): boolean {
  return Boolean(c.blueBubblesUrl && c.blueBubblesPassword);
}
