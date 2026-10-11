import { config } from "@/server/config";
import { safeEqual } from "@/server/crypto";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; other schedulers (Trigger.dev, the worker script) do the same. */
export function cronAuthorized(req: Request): boolean {
  const secret = config().cronSecret;
  if (!secret) return !config().isProd;
  const header = req.headers.get("authorization") ?? "";
  return safeEqual(header, `Bearer ${secret}`);
}
