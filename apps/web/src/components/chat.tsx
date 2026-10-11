"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Badge, Button, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: string;
  channel: string;
  text: string;
  delivery: string;
  createdAt: string;
}

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} className="break-all underline" target={part.includes("/approve/") || part.includes("/auth/magic") ? "_self" : "_blank"} rel="noreferrer noopener">
            {part.includes("/approve/") ? "Confirm this exact order →" : part.includes("/auth/magic") ? "Open link →" : part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function Chat({ initial, initialAsk, bridgeOnline }: { initial: ChatMessage[]; initialAsk?: string; bridgeOnline: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [text, setText] = useState(initialAsk ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/chat", { cache: "no-store" });
    if (res.ok) setMessages(((await res.json()) as { messages: ChatMessage[] }).messages);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (!busy) void refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [busy, refresh]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", channel: "web", text: t, delivery: "n/a", createdAt: new Date().toISOString() }]);
    const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong");
    await refresh();
    setBusy(false);
  }

  return (
    <div className="flex h-[calc(100dvh-12rem)] min-h-[420px] flex-col rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted">
        <Badge tone={bridgeOnline ? "positive" : "warning"}>{bridgeOnline ? "iMessage connected" : "iMessage bridge offline"}</Badge>
        <span>{bridgeOnline ? "This mirrors your iMessage conversation with Mayflower." : "Web chat is the fallback while iMessage is unavailable."}</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-md pt-10 text-center text-sm text-muted">
            Say hi and tell Mayflower what you follow, what you believe, and how much you can afford to risk. For example: “I follow the Seahawks, think AI infrastructure spending will keep growing, and I have $200 I can risk.”
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap", m.role === "user" ? "bg-accent text-accent-fg" : "bg-surface-2 text-text")}>
              <Linkified text={m.text} />
              <div className={cn("mt-1 text-[10px]", m.role === "user" ? "text-accent-fg/70" : "text-muted")}>
                {m.channel === "imessage" ? "iMessage" : "web"} · {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                {m.delivery.startsWith("failed") ? " · iMessage delivery failed" : ""}
              </div>
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mayflower is thinking — research can take a few seconds…
          </div>
        ) : null}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex items-end gap-2 border-t border-border p-3">
        <Textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message Mayflower…"
          className="max-h-32 min-h-10 resize-none"
        />
        <Button type="submit" disabled={busy || !text.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
      {error ? <div className="px-4 pb-3 text-xs text-negative">{error}</div> : null}
    </div>
  );
}
