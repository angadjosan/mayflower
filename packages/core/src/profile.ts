import type { RiskLimits, User, UserThesis } from "@mayflower/shared";
import { DEFAULT_RISK_LIMITS, newId } from "@mayflower/shared";
import { extractProfile } from "@mayflower/agents";
import type { Container } from "./container.js";

/** Conversational onboarding / profile update: extract → persist → return a summary. */
export async function applyProfileMessage(c: Container, user: User, message: string): Promise<{ summary: string; limits: RiskLimits; theses: UserThesis[] }> {
  const existing = await c.repo.listTheses(user.id);
  const extracted = await extractProfile(c.llm, message, existing.length || user.riskLimits.totalBudget ? { interests: existing.filter((t) => t.isInterest).map((t) => t.topic), beliefs: existing.filter((t) => !t.isInterest).map((t) => t.belief), totalBudget: user.riskLimits.totalBudget } : null);
  const now = new Date().toISOString();
  for (const i of extracted.interests) {
    if (existing.some((t) => t.isInterest && t.topic === i.topic)) continue;
    await c.repo.upsertThesis({ id: newId(), userId: user.id, topic: i.topic, belief: i.note ?? `Follows ${i.topic}`, confidence: 0.5, isInterest: true, source: "conversation", active: true, updatedAt: now });
  }
  for (const b of extracted.beliefs) {
    const prev = existing.find((t) => !t.isInterest && t.topic === b.topic);
    await c.repo.upsertThesis({ id: prev?.id ?? newId(), userId: user.id, topic: b.topic, belief: b.belief, confidence: b.confidence, isInterest: false, source: "conversation", active: true, updatedAt: now });
  }
  const limits: RiskLimits = {
    ...DEFAULT_RISK_LIMITS,
    ...user.riskLimits,
    totalBudget: extracted.totalBudget ?? user.riskLimits.totalBudget,
    maxPerPosition: extracted.maxPerPosition ?? (extracted.totalBudget && !user.riskLimits.maxPerPosition ? Math.max(1, Math.round(extracted.totalBudget * 0.1)) : user.riskLimits.maxPerPosition),
    excludedTopics: Array.from(new Set([...user.riskLimits.excludedTopics, ...extracted.excludedTopics])),
  };
  await c.repo.updateRiskLimits(user.id, limits);
  await c.repo.audit({ userId: user.id, actor: "user", action: "profile.updated", payload: extracted });
  const theses = await c.repo.listTheses(user.id);
  const summary = [
    theses.filter((t) => t.isInterest).length ? `Interests: ${theses.filter((t) => t.isInterest).map((t) => t.topic).join(", ")}.` : "",
    theses.filter((t) => !t.isInterest).length ? `Beliefs: ${theses.filter((t) => !t.isInterest).map((t) => t.belief).join("; ")}.` : "",
    limits.totalBudget ? `Budget you can risk: $${limits.totalBudget} (max $${limits.maxPerPosition} per position).` : "No budget set yet — tell me how much you can afford to lose.",
    limits.excludedTopics.length ? `Excluded: ${limits.excludedTopics.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  return { summary, limits, theses };
}
