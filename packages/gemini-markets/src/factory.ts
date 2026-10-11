import { exchangeMode, optionalEnv } from "@mayflower/shared";
import type { ExchangeClient } from "./exchange.js";
import { GeminiRestExchange, type GeminiAuth } from "./gemini-rest.js";
import { SimulatedExchange } from "./simulated.js";

let sim: SimulatedExchange | null = null;

/**
 * Build an exchange client for a user.
 *  - MAYFLOWER_EXCHANGE_MODE=simulated → in-process simulated venue (default).
 *  - sandbox/live + per-user auth      → Plan A (user's own linked account).
 *  - sandbox + GEMINI_SANDBOX_API_KEY  → Plan B shared sandbox account, labelled as such.
 */
export function createExchangeClient(userAuth?: GeminiAuth | null): ExchangeClient {
  const mode = exchangeMode();
  if (mode === "simulated") return (sim ??= new SimulatedExchange());
  if (userAuth) return new GeminiRestExchange({ mode, auth: userAuth });
  const key = optionalEnv("GEMINI_SANDBOX_API_KEY"), secret = optionalEnv("GEMINI_SANDBOX_API_SECRET");
  if (mode === "sandbox" && key && secret) return new GeminiRestExchange({ mode, auth: { kind: "hmac", apiKey: key, apiSecret: secret }, label: "Sandbox – shared account" });
  // Public market data only; trading calls will throw NOT_LINKED.
  return new GeminiRestExchange({ mode });
}
