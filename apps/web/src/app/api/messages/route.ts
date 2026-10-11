import { getContainer } from "@/lib/container";
import { withUser } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET() {
  return withUser(async (user) => ({ messages: await getContainer().repo.listMessages(user.id, 100) }));
}
