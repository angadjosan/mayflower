import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/server/session";
import { monitorUser } from "@/server/monitor";

export const maxDuration = 120;

export async function POST() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const r = await monitorUser(user.id, { forceResearch: false });
  const summary = r.events.length ? `${r.events.length} update${r.events.length === 1 ? "" : "s"} — see “What Mayflower is watching”.` : r.errors.length ? r.errors[0] : "No meaningful changes.";
  return NextResponse.json({ summary, errors: r.errors });
}
