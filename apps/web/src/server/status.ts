import type { FeatureLabel } from "@mayflower/shared";
import { blueBubblesConfigured, config, oauthConfigured, sharedSandboxConfigured } from "./config";
import { databaseLabel } from "./db/client";
import { pingBlueBubbles } from "./bluebubbles";
import { tradingGloballyEnabled } from "./execution";
import { defaultMode } from "./gemini-link";

export interface FeatureStatus {
  key: string;
  name: string;
  label: FeatureLabel;
  detail: string;
}

/** Honest, user-facing labels for every integration. Network checks only when deep=true. */
export async function featureStatuses(opts: { deep?: boolean } = {}): Promise<FeatureStatus[]> {
  const c = config();
  const out: FeatureStatus[] = [];
  out.push({
    key: "market_data",
    name: "Gemini prediction markets",
    label: c.demoMode ? "demo" : c.geminiEnv === "sandbox" ? "sandbox" : "live",
    detail: c.demoMode ? "Offline DEMO catalog — these are not real markets (MAYFLOWER_DEMO_MODE=true)." : `Real contracts and quotes from Gemini's ${c.geminiEnv} environment via the official SDK.`,
  });
  const dm = defaultMode();
  out.push({
    key: "execution",
    name: "Order execution",
    label: dm === "simulated" ? "simulated" : c.geminiEnv === "sandbox" ? "sandbox" : "live",
    detail:
      dm === "needs_link"
        ? `Users link their own Gemini ${c.geminiEnv} account with trade-only OAuth (Plan A).${sharedSandboxConfigured() ? " Shared sandbox fallback available." : ""}`
        : dm === "shared_sandbox"
          ? "Gemini sandbox via one shared team API key; each user's allocation is tracked in Mayflower's ledger (Plan B)."
          : "No exchange credentials configured: orders are SIMULATED against current quotes and labelled as such.",
  });
  out.push({
    key: "research",
    name: "Context.dev research",
    label: c.contextDevApiKey ? "live" : c.demoMode ? "demo" : "offline",
    detail: c.contextDevApiKey ? "Live web research with citations." : c.demoMode ? "Demo placeholder evidence (not real research)." : "Not configured — Mayflower will recommend no trade without evidence.",
  });
  out.push({
    key: "llm",
    name: "Google Gemini reasoning",
    label: c.googleApiKey ? "live" : "offline",
    detail: c.googleApiKey ? `Structured reasoning with ${c.googleModel}.` : "Not configured — using clearly labelled keyword heuristics instead of an LLM.",
  });
  let bb: FeatureStatus = {
    key: "imessage",
    name: "iMessage (BlueBubbles)",
    label: blueBubblesConfigured() ? "live" : "offline",
    detail: blueBubblesConfigured() ? "Configured. Inbound via webhook, replies via REST." : "Bridge not configured — the web chat is the fallback.",
  };
  if (opts.deep && blueBubblesConfigured()) {
    const ping = await pingBlueBubbles();
    bb = { ...bb, label: ping.ok ? "live" : "offline", detail: ping.ok ? "Server reachable." : `Bridge unreachable (${ping.detail}) — use the web chat fallback.` };
  }
  out.push(bb);
  out.push({
    key: "oauth",
    name: "Gemini account linking (OAuth)",
    label: oauthConfigured() ? (c.geminiEnv === "sandbox" ? "sandbox" : "live") : "offline",
    detail: oauthConfigured() ? "Trade-only scopes; never the Fund Manager role." : "OAuth client not configured.",
  });
  out.push({
    key: "kill_switch",
    name: "Global trading switch",
    label: (await tradingGloballyEnabled()) ? "live" : "offline",
    detail: (await tradingGloballyEnabled()) ? "Approved orders can be submitted." : "Kill switch ON — no orders will be sent.",
  });
  out.push({ key: "database", name: "Database", label: "live", detail: databaseLabel() });
  out.push({ key: "connectors", name: "Email / Notion / Slack / Discord context", label: "not_implemented", detail: "Optional personal-context connectors are future work." });
  out.push({ key: "voice", name: "Phone calls (ElevenLabs)", label: "not_implemented", detail: "Stretch feature, not built." });
  out.push({ key: "bnb", name: "BNB Chain audit receipts", label: "not_implemented", detail: "Optional YZi demo, not built." });
  return out;
}
