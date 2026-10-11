import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dev only: wipe the whole local datastore. */
export async function POST() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  fs.rmSync(path.join(process.cwd(), ".data", "db.json"), { force: true });
  return NextResponse.json({ ok: true });
}
