import { randomUUID, createHash } from "node:crypto";

export const newId = (): string => randomUUID();

/** Stable content hash used for approval binding and idempotent order submission. */
export function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
