import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { isLocalRequest } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dev only, and only from this machine (not through a tunnel): wipe the whole local datastore. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" || !isLocalRequest(req.headers)) return NextResponse.json({ error: "not found" }, { status: 404 });
  fs.rmSync(path.join(process.cwd(), ".data", "db.json"), { force: true });
  return NextResponse.json({ ok: true });
}
