import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  fs.rmSync(path.join(process.cwd(), ".data", "db.json"), { force: true });
  return NextResponse.json({ ok: true });
}
