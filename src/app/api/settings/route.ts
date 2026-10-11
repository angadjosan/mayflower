import { NextResponse } from "next/server";
import { tx, audit, load, getOrCreateUser } from "@/lib/db";
import { sessionUserId, UNAUTHORIZED } from "@/lib/session";
import { normalizeHandle } from "@/lib/auth";
import type { RiskLimits } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_USD = 100_000;
const STYLES: RiskLimits["riskStyle"][] = ["conservative", "balanced", "aggressive"];

/** Whitelist and bound user-editable limits. Returns an error string on bad input. */
function validateLimits(raw: unknown): Partial<RiskLimits> | string {
  if (!raw || typeof raw !== "object") return "limits must be an object";
  const r = raw as Record<string, unknown>;
  const out: Partial<RiskLimits> = {};
  for (const k of ["budgetUsd", "maxPerTradeUsd", "maxTotalExposureUsd"] as const) {
    if (r[k] === undefined) continue;
    const n = Number(r[k]);
    if (!Number.isFinite(n) || n < 0 || n > MAX_USD) return `${k} must be a number between 0 and ${MAX_USD}`;
    out[k] = Math.round(n * 100) / 100;
  }
  if (r.riskStyle !== undefined) {
    if (!STYLES.includes(r.riskStyle as RiskLimits["riskStyle"])) return `riskStyle must be one of ${STYLES.join(", ")}`;
    out.riskStyle = r.riskStyle as RiskLimits["riskStyle"];
  }
  if (r.excludedTopics !== undefined) {
    if (!Array.isArray(r.excludedTopics) || r.excludedTopics.some((t) => typeof t !== "string")) return "excludedTopics must be a list of strings";
    out.excludedTopics = (r.excludedTopics as string[]).map((t) => t.trim().slice(0, 60)).filter(Boolean).slice(0, 30);
  }
  return out;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    limits?: Partial<RiskLimits>; paused?: boolean; name?: string; handle?: string;
  };
  // Identity comes from the session only; body.userId is ignored.
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json(UNAUTHORIZED, { status: 401 });
  if (typeof body.handle === "string" && body.handle.trim()) {
    const want = normalizeHandle(body.handle);
    const taken = load().users.some((u) => u.id !== userId && u.handle && normalizeHandle(u.handle) === want);
    if (taken) return NextResponse.json({ error: "That handle is already linked to another account." }, { status: 409 });
  }
  let limits: Partial<RiskLimits> | undefined;
  if (body.limits !== undefined) {
    const v = validateLimits(body.limits);
    if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });
    limits = v;
  }
  getOrCreateUser({ id: userId });
  const user = tx((db) => {
    const u = db.users.find((x) => x.id === userId)!;
    if (limits) {
      const merged = { ...u.limits, ...limits };
      // Per-trade and total exposure can never exceed the overall budget.
      merged.maxTotalExposureUsd = Math.min(merged.maxTotalExposureUsd, merged.budgetUsd);
      merged.maxPerTradeUsd = Math.min(merged.maxPerTradeUsd, merged.maxTotalExposureUsd);
      u.limits = merged;
    }
    if (typeof body.paused === "boolean") u.paused = body.paused;
    if (typeof body.name === "string") u.name = body.name;
    if (typeof body.handle === "string") u.handle = body.handle.trim() || undefined;
    return u;
  });
  audit({ userId, actor: "user", action: "settings_update", detail: { limits, paused: body.paused, name: body.name, handle: body.handle } });
  return NextResponse.json({ user });
}
