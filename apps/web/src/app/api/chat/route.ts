import { handleUserMessage } from "@mayflower/core";
import { getContainer } from "@/lib/container";
import { withUser } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Web chat — mirrors the same agent as iMessage (fallback channel). */
export async function POST(req: Request) {
  const { text } = (await req.json()) as { text: string };
  return withUser(async (user) => {
    if (!text?.trim()) throw new Error("Empty message");
    const r = await handleUserMessage(getContainer(), user, text.trim(), "web");
    return { reply: r.reply, actions: r.actions };
  });
}
