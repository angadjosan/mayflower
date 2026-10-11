import { NextResponse } from "next/server";
import { tx, type DB } from "@/lib/db";
import { isLocalRequest } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dev only, and only from this machine (not through a tunnel): wipe the whole datastore (file or Supabase row). */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" || !isLocalRequest(req.headers)) return NextResponse.json({ error: "not found" }, { status: 404 });
  await tx((db) => {
    for (const k of Object.keys(db) as (keyof DB)[]) (db as unknown as Record<string, unknown>)[k] = k === "loopState" ? {} : [];
  });
  return NextResponse.json({ ok: true });
}
