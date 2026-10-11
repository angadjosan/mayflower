import { monitorUser } from "@mayflower/core";
import { getContainer } from "@/lib/container";
import { withUser } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST() {
  return withUser(async (user) => ({ events: await monitorUser(getContainer(), user) }));
}
