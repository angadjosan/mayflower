import type { ForecastOutput as ForecastOutputT, Market, MarketQuote } from "@mayflower/shared";
import { ForecastOutput, impliedProbability } from "@mayflower/shared";
import type { LLM } from "../llm/llm";
import { FORECAST_SYSTEM } from "../prompts";
import type { EvidenceBundle } from "./research";

/** Forecast agent: independent probability + reasoning, grounded in the evidence digest. */
export async function forecast(llm: LLM, market: Market, quote: MarketQuote, evidence: EvidenceBundle): Promise<ForecastOutputT> {
  const marketP = impliedProbability(quote);
  return llm.structured<ForecastOutputT>({
    system: FORECAST_SYSTEM,
    tier: "deep",
    schema: ForecastOutput,
    prompt: [
      `MARKET: ${market.title}`,
      `ID: ${market.id}`,
      `RESOLUTION RULES: ${market.resolutionRules ?? "(not provided — treat as a risk)"}`,
      `EXPIRES: ${market.expiresAt ?? "unknown"}`,
      `CURRENT YES BID/ASK: ${quote.yesBid ?? "?"} / ${quote.yesAsk ?? "?"} (implied ≈ ${marketP == null ? "?" : (marketP * 100).toFixed(0) + "%"})`,
      `EVIDENCE (${evidence.providerName}):`,
      evidence.digest || "(no evidence found — be very uncertain)",
      `TODAY: ${new Date().toISOString().slice(0, 10)}`,
    ].join("\n"),
  });
}
