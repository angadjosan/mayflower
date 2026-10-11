"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Msg = { role: string; text: string; channel?: string };

export function Chat({ initial, fallbackNote }: { initial: Msg[]; fallbackNote: string }) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  const send = async () => {
    if (!text.trim() || busy) return;
    const mine = text.trim(); setText(""); setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: mine, channel: "web" }]);
    const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: mine }) });
    const j = await r.json();
    setMsgs((m) => [...m, { role: "assistant", text: r.ok ? j.reply : `Error: ${j.error}`, channel: "web" }]);
    setBusy(false); router.refresh();
  };
  return (
    <div className="card flex flex-col h-[480px]">
      <div className="text-xs text-muted mb-2">{fallbackNote}</div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {msgs.length === 0 && <div className="text-sm text-muted">Try: “I follow the Seahawks and AI, worried about a recession, and I can risk $200.”</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "ml-auto bg-accent text-white" : "bg-background border border-border"}`}>{m.text}{m.channel === "imessage" && <span className="ml-2 text-[10px] opacity-60">iMessage</span>}</div>
        ))}
        {busy && <div className="text-xs text-muted">Mayflower is thinking…</div>}
        <div ref={bottom} />
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message Mayflower…" />
        <button className="btn btn-primary" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
