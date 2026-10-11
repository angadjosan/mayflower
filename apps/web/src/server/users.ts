import { and, desc, eq, ilike } from "drizzle-orm";
import { formatUsd, round, type ProfileUpdate, type RiskStyle, type UserRiskLimits } from "@mayflower/shared";
import { getDb, schema } from "./db/client";
import type { Thesis, User } from "./db/schema";
import { audit } from "./audit";

export async function getUser(userId: string): Promise<User> {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!u) throw new Error(`User ${userId} not found`);
  return u;
}

export async function getOrCreateUserByHandle(handle: string): Promise<User> {
  const db = await getDb();
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.imessageHandle, handle)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(schema.users).values({ imessageHandle: handle }).onConflictDoNothing().returning();
  if (created) {
    await audit({ userId: created.id, actor: "system", action: "user.created", details: { via: "imessage_handle" } });
    return created;
  }
  const [again] = await db.select().from(schema.users).where(eq(schema.users.imessageHandle, handle)).limit(1);
  return again;
}

export const DEFAULT_BUDGET = 100;

/** Risk limits with sensible defaults (10% per position, 50% total) when the user hasn't set them. */
export function effectiveLimits(user: Pick<User, "riskBudget" | "maxPerPosition" | "maxTotalExposure" | "riskStyle">): UserRiskLimits {
  const budget = user.riskBudget ?? DEFAULT_BUDGET;
  return {
    riskBudget: budget,
    maxPerPosition: user.maxPerPosition ?? round(Math.max(1, budget * 0.1), 2),
    maxTotalExposure: user.maxTotalExposure ?? round(budget * 0.5, 2),
    riskStyle: (user.riskStyle as RiskStyle) ?? "conservative",
  };
}

export async function activeTheses(userId: string): Promise<Thesis[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.userTheses)
    .where(and(eq(schema.userTheses.userId, userId), eq(schema.userTheses.active, true)))
    .orderBy(desc(schema.userTheses.updatedAt));
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list.map((s) => s.trim()).filter(Boolean)) {
    const k = item.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

/** Apply an extracted profile update. Returns human-readable change notes. */
export async function applyProfileUpdate(userId: string, update: ProfileUpdate, source: "chat" | "imessage" | "dashboard"): Promise<string[]> {
  const db = await getDb();
  const user = await getUser(userId);
  const changes: string[] = [];
  const patch: Partial<User> = {};

  const removed = new Set(update.removeInterests.map((s) => s.toLowerCase()));
  const interests = dedupe([...user.interests.filter((i) => !removed.has(i.toLowerCase())), ...update.interests]);
  if (interests.join("|") !== user.interests.join("|")) {
    patch.interests = interests;
    const added = update.interests.filter((i) => !user.interests.some((u) => u.toLowerCase() === i.toLowerCase()));
    if (added.length) changes.push(`interests: ${added.join(", ")}`);
    if (removed.size) changes.push(`removed interests: ${[...removed].join(", ")}`);
  }

  const excluded = dedupe([...user.excludedTopics, ...update.excludedTopics.map((x) => x.toLowerCase())]);
  if (excluded.length !== user.excludedTopics.length) {
    patch.excludedTopics = excluded;
    changes.push(`excluding: ${update.excludedTopics.join(", ")}`);
  }

  const positive = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 ? round(n, 2) : null);
  const budget = positive(update.riskBudget);
  if (budget !== null && budget !== user.riskBudget) {
    patch.riskBudget = budget;
    changes.push(`risk budget ${formatUsd(budget)}`);
  }
  const per = positive(update.maxPerPosition);
  if (per !== null && per !== user.maxPerPosition) {
    patch.maxPerPosition = per;
    changes.push(`max ${formatUsd(per)} per position`);
  }
  const total = positive(update.maxTotalExposure);
  if (total !== null && total !== user.maxTotalExposure) {
    patch.maxTotalExposure = total;
    changes.push(`max ${formatUsd(total)} total at risk`);
  }
  if (update.riskStyle && update.riskStyle !== user.riskStyle) {
    patch.riskStyle = update.riskStyle;
    changes.push(`${update.riskStyle} sizing`);
  }
  if (update.displayName && update.displayName !== user.displayName) patch.displayName = update.displayName;

  // Keep limits internally consistent: per-position ≤ total ≤ budget.
  const effBudget = patch.riskBudget ?? user.riskBudget;
  const effTotal = patch.maxTotalExposure ?? user.maxTotalExposure;
  const effPer = patch.maxPerPosition ?? user.maxPerPosition;
  if (effBudget !== null && effTotal !== null && effTotal > effBudget) {
    patch.maxTotalExposure = effBudget;
    changes.push(`total exposure capped at your ${formatUsd(effBudget)} budget`);
  }
  const capTotal = patch.maxTotalExposure ?? effTotal ?? effBudget;
  if (effPer !== null && capTotal !== null && effPer > capTotal) {
    patch.maxPerPosition = capTotal;
    changes.push(`per-position limit capped at ${formatUsd(capTotal)}`);
  }

  if (Object.keys(patch).length) {
    await db.update(schema.users).set({ ...patch, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  }

  for (const b of update.beliefs) {
    const [dup] = await db
      .select()
      .from(schema.userTheses)
      .where(and(eq(schema.userTheses.userId, userId), eq(schema.userTheses.active, true), ilike(schema.userTheses.belief, b.belief)))
      .limit(1);
    if (dup) continue;
    await db.insert(schema.userTheses).values({ userId, topic: b.topic, belief: b.belief, stance: b.stance, confidence: b.confidence, source });
    changes.push(`belief noted: “${b.belief}”`);
  }

  for (const topic of update.lowerConfidenceTopics) {
    const theses = await activeTheses(userId);
    const target = topic === "LAST" ? theses[0] : theses.find((t) => t.topic.toLowerCase().includes(topic.toLowerCase()) || t.belief.toLowerCase().includes(topic.toLowerCase()));
    if (target) {
      const confidence = round(Math.max(0.1, target.confidence * 0.6), 2);
      await db.update(schema.userTheses).set({ confidence, updatedAt: new Date() }).where(eq(schema.userTheses.id, target.id));
      changes.push(`lowered your confidence in “${target.belief}” to ${Math.round(confidence * 100)}%`);
    }
  }

  if (changes.length) await audit({ userId, actor: "user", action: "profile.updated", details: { changes, source } });
  return changes;
}

export async function setOnboardingState(userId: string, state: "new" | "collecting" | "confirm_limits" | "complete"): Promise<void> {
  const db = await getDb();
  await db.update(schema.users).set({ onboardingState: state, updatedAt: new Date() }).where(eq(schema.users.id, userId));
}

export async function setTradingPaused(userId: string, paused: boolean, actor: "user" | "system" = "user"): Promise<void> {
  const db = await getDb();
  await db.update(schema.users).set({ tradingPaused: paused, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  await audit({ userId, actor, action: paused ? "trading.paused" : "trading.resumed" });
}

export function profileSummary(user: User, theses: Thesis[]): string {
  const l = effectiveLimits(user);
  const parts: string[] = [];
  if (user.interests.length) parts.push(`Interests: ${user.interests.join(", ")}.`);
  if (theses.length) parts.push(`Beliefs: ${theses.slice(0, 4).map((t) => `${t.topic} (${t.stance}, ${Math.round(t.confidence * 100)}%)`).join("; ")}.`);
  parts.push(`Risk: ${formatUsd(l.riskBudget)} budget, max ${formatUsd(l.maxPerPosition)} per position, max ${formatUsd(l.maxTotalExposure)} at risk in total, ${l.riskStyle} sizing.`);
  if (user.excludedTopics.length) parts.push(`Skipping: ${user.excludedTopics.join(", ")}.`);
  return parts.join(" ");
}

/** Direct edits from the dashboard profile form (exact values, validated). */
export async function updateProfileDirect(
  userId: string,
  input: { riskBudget: number; maxPerPosition: number; maxTotalExposure: number; riskStyle: RiskStyle; interests: string[]; excludedTopics: string[]; notifyLevel: "important" | "all" | "none"; displayName?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(input.riskBudget > 0)) return { ok: false, error: "Risk budget must be positive." };
  if (!(input.maxTotalExposure > 0) || input.maxTotalExposure > input.riskBudget) return { ok: false, error: "Total exposure must be positive and no more than your risk budget." };
  if (!(input.maxPerPosition > 0) || input.maxPerPosition > input.maxTotalExposure) return { ok: false, error: "Per-position limit must be positive and no more than your total exposure limit." };
  const db = await getDb();
  await db
    .update(schema.users)
    .set({
      riskBudget: round(input.riskBudget, 2),
      maxPerPosition: round(input.maxPerPosition, 2),
      maxTotalExposure: round(input.maxTotalExposure, 2),
      riskStyle: input.riskStyle,
      interests: dedupe(input.interests),
      excludedTopics: dedupe(input.excludedTopics.map((x) => x.toLowerCase())),
      notifyLevel: input.notifyLevel,
      ...(input.displayName !== undefined ? { displayName: input.displayName || null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId));
  await audit({ userId, actor: "user", action: "profile.updated", details: { source: "dashboard", ...input } });
  return { ok: true };
}

export async function addThesis(userId: string, t: { topic: string; belief: string; stance: "bullish" | "bearish" | "neutral"; confidence: number }): Promise<void> {
  const db = await getDb();
  await db.insert(schema.userTheses).values({ userId, topic: t.topic.slice(0, 80), belief: t.belief.slice(0, 400), stance: t.stance, confidence: Math.min(1, Math.max(0.05, t.confidence)), source: "dashboard" });
  await audit({ userId, actor: "user", action: "thesis.added", details: t });
}

export async function deactivateThesis(userId: string, thesisId: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.userTheses).set({ active: false, updatedAt: new Date() }).where(and(eq(schema.userTheses.id, thesisId), eq(schema.userTheses.userId, userId)));
  await audit({ userId, actor: "user", action: "thesis.removed", refType: "thesis", refId: thesisId });
}
