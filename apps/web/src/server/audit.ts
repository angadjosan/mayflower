import { getDb, schema } from "./db/client";

export type Actor = "user" | "agent" | "system";

/** Every agent action, approval, order and setting change is logged here. */
export async function audit(entry: {
  userId?: string | null;
  actor: Actor;
  action: string;
  refType?: string;
  refId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(schema.auditEvents).values({
      userId: entry.userId ?? null,
      actor: entry.actor,
      action: entry.action,
      refType: entry.refType ?? null,
      refId: entry.refId ?? null,
      details: entry.details ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to record", entry.action, err);
  }
}

export function logError(scope: string) {
  return (err: unknown) => {
    console.warn(`[${scope}]`, (err as Error)?.message ?? err);
  };
}
