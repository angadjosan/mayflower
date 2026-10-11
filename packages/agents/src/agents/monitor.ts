import { z } from "zod";
import type { Citation, Market, MarketQuote, Position, ResearchReport } from "@mayflower/shared";
import { MonitorRecommendation, impliedProbability } from "@mayflower/shared";
import { evaluateExit } from "@mayflower/risk";
import type { ResearchProvider } from "@mayflower/context";
import type { LLM } from "../llm/llm.js";
import { MONITOR_SYSTEM } from "../prompts.js";

export const MonitorAssessment = z.object({
  recommendation: MonitorRecommendation,
  summary: z.string(),
  /** True when this is worth notifying the user about (selective notifications). */
  notable: z.boolean(),
  updatedProbability: z.number().min(0).max(1).nullable(),
});
export type MonitorAssessment = z.infer<typeof MonitorAssessment>;

export interface MonitorResult {
  assessment: MonitorAssessment;
  trigger: "price_move" | "new_evidence" | "watch_condition" | "approaching_expiry" | "scheduled";
  evidence: Citation[];
}

/**
 * Monitor agent: checks price triggers deterministically, pulls fresh evidence,
 * and asks the LLM whether the thesis still holds. Returns a recommendation only.
 */
export async function monitorPosition(deps: { llm: LLM; research: ResearchProvider }, input: { position: Position; market: Market; quote: MarketQuote; report: ResearchReport | null }): Promise<MonitorResult> {
  const { position, market, quote, report } = input;
  const price = impliedProbability(quote);
  const pos = { ...position, currentPrice: price ?? position.currentPrice };
  const exitSignals = evaluateExit(pos, market.expiresAt);

  let evidence: Citation[] = [];
  try {
    const hits = await deps.research.search(`${market.title.replace(/^will\s+/i, "").replace(/\?$/, "")} latest`, { limit: 5, freshness: "week" });
    evidence = hits.map((h) => ({ url: h.url, title: h.title, snippet: (h.passages?.[0] ?? h.snippet).slice(0, 400), publishedAt: h.publishedAt ?? null, stance: "neutral" as const }));
  } catch (e) {
    console.warn("[monitor] research failed:", (e as Error).message);
  }

  const assessment = await deps.llm.structured<MonitorAssessment>({
    system: MONITOR_SYSTEM,
    tier: "fast",
    schema: MonitorAssessment,
    prompt: [
      `POSITION: ${position.side} ${position.quantity} @ ${position.avgPrice} on "${market.title}"`,
      `CURRENT IMPLIED YES: ${price ?? "?"}`,
      `ORIGINAL THESIS: ${report?.thesis ?? "(none stored)"}`,
      `ORIGINAL ESTIMATE: ${report?.estimatedProbability ?? "?"} ±${report?.uncertainty ?? "?"}`,
      `WATCH CONDITIONS: ${(report?.watchConditions ?? []).join("; ") || "(none)"}`,
      `DETERMINISTIC SIGNALS: ${exitSignals.map((s) => `${s.trigger}: ${s.detail}`).join(" | ") || "none"}`,
      `NEW EVIDENCE:\n${evidence.map((c, i) => `[${i}] ${c.title} ${c.url}\n  ${c.snippet}`).join("\n") || "(none)"}`,
    ].join("\n"),
  });

  const trigger = exitSignals[0]?.trigger ?? (evidence.length ? "new_evidence" : "scheduled");
  return { assessment, trigger, evidence };
}
