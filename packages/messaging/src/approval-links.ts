/**
 * Signed, expiring approval links (spec §3): sensitive approval uses a web
 * confirmation bound to the exact proposal version, not an ambiguous text.
 * Token = base64url(payload).base64url(HMAC-SHA256(payload)).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ApprovalLinkPayload {
  proposalId: string;
  version: number;
  bindingHash: string;
  userId: string;
  exp: number; // epoch seconds
}

const b64u = (b: Buffer) => b.toString("base64url");

export function signApprovalLink(p: ApprovalLinkPayload, secret: string): string {
  const payload = b64u(Buffer.from(JSON.stringify(p)));
  const sig = b64u(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyApprovalLink(token: string, secret: string, now = Math.floor(Date.now() / 1000)): ApprovalLinkPayload | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = b64u(createHmac("sha256", secret).update(payload).digest());
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ApprovalLinkPayload;
    if (typeof p.exp !== "number" || p.exp < now) return null;
    return p;
  } catch { return null; }
}
