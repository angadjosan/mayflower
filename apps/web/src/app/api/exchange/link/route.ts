import { encryptSecret } from "@mayflower/db";
import { newId } from "@mayflower/shared";
import { getContainer } from "@/lib/container";
import { withUser } from "@/lib/api";
export const dynamic = "force-dynamic";

/**
 * API-key fallback for linking a Gemini (sandbox) account with the Trader role.
 * Credentials are AES-GCM encrypted at rest. OAuth (Plan A) lives in ./oauth.
 */
export async function POST(req: Request) {
  const { apiKey, apiSecret } = (await req.json()) as { apiKey: string; apiSecret: string };
  return withUser(async (user) => {
    if (!apiKey || !apiSecret) throw new Error("apiKey and apiSecret are required");
    const c = getContainer();
    await c.repo.saveExchangeConnection({ id: newId(), userId: user.id, provider: "gemini", kind: "api-key", roles: ["trader"], status: "active", linkedAt: new Date().toISOString(), encryptedCredentials: encryptSecret(JSON.stringify({ kind: "hmac", apiKey, apiSecret })) });
    await c.repo.audit({ userId: user.id, actor: "user", action: "exchange.linked", payload: { kind: "api-key", roles: ["trader"] } });
    return { linked: true };
  });
}
export async function GET() {
  return withUser(async (user) => {
    const conn = await getContainer().repo.getExchangeConnection(user.id);
    return { connection: conn ? { kind: conn.kind, roles: conn.roles, status: conn.status, linkedAt: conn.linkedAt } : null };
  });
}
