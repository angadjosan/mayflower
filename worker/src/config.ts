// Every external key is optional. Missing key = that integration runs in its
// labeled fallback mode, so the whole loop runs on a laptop with zero setup.
const env = (k: string) => (process.env[k]?.trim() || undefined);
const num = (k: string, d: number) => (env(k) ? Number(env(k)) : d);

export const config = {
  port: num('PORT', 8787),
  publicBaseUrl: env('PUBLIC_BASE_URL') ?? 'http://localhost:8787',
  dashboardUrl: env('DASHBOARD_URL') ?? 'http://localhost:3000',
  databaseUrl: env('DATABASE_URL'),                 // unset = local PGlite in .data/pglite
  pgliteDir: env('PGLITE_DIR') ?? new URL('../../.data/pglite', import.meta.url).pathname,

  gemini: {
    apiKey: env('GEMINI_SANDBOX_API_KEY'),
    apiSecret: env('GEMINI_SANDBOX_API_SECRET'),
    sandboxRest: 'https://api.sandbox.gemini.com',
    productionRest: 'https://api.gemini.com',
    productionWs: 'wss://ws.gemini.com',
    sandboxWs: 'wss://ws.sandbox.gemini.com',
  },
  googleApiKey: env('GOOGLE_API_KEY') ?? env('GEMINI_API_KEY'),
  llmModel: env('LLM_MODEL') ?? 'gemini-3.8-flash',
  llmFastModel: env('LLM_FAST_MODEL') ?? 'gemini-3.5-flash-lite',
  contextDevKey: env('CONTEXT_DEV_API_KEY'),

  bluebubbles: {
    url: env('BLUEBUBBLES_URL'),                    // e.g. https://xyz.ngrok.app
    password: env('BLUEBUBBLES_PASSWORD'),
    webhookSecret: env('WEBHOOK_SECRET') ?? 'dev-secret-change-me',
    allowedSenders: (env('ALLOWED_SENDERS') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  },
  elevenlabs: {
    apiKey: env('ELEVENLABS_API_KEY'),
    voiceId: env('ELEVENLABS_VOICE_ID') ?? 'JBFqnCBsd6RMkjVDRZzb',
  },

  risk: {
    safetyMargin: num('RISK_SAFETY_MARGIN', 0.05),
    kellyFraction: num('RISK_KELLY_FRACTION', 0.25),
    wMin: 0.2,
    wMax: 0.6,
    proposalTtlMinutes: num('PROPOSAL_TTL_MINUTES', 10),
  },
  recordTicks: env('RECORD_TICKS') !== '0',
};

export type Config = typeof config;
