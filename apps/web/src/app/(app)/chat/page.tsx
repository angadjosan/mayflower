import { requireUser } from "@/server/session";
import { messagesFor } from "@/server/views";
import { blueBubblesConfigured } from "@/server/config";
import { Chat } from "@/components/chat";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ ask?: string }> }) {
  const user = await requireUser();
  const { ask } = await searchParams;
  const msgs = await messagesFor(user.id, 200);
  return (
    <div className="mx-auto max-w-3xl">
      <Chat
        initial={msgs.map((m) => ({ id: m.id, role: m.role, channel: m.channel, text: m.text, delivery: m.delivery, createdAt: m.createdAt.toISOString() }))}
        initialAsk={ask}
        bridgeOnline={blueBubblesConfigured() && Boolean(user.imessageHandle)}
      />
    </div>
  );
}
