"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { Button, time } from "./ui";

export function Chat({ messages, onSend, sending }: { messages: ChatMessage[]; onSend: (text: string) => Promise<void>; sending: boolean }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending]);

  return (
    <section className="flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white lg:h-[calc(100vh-3rem)]">
      <div className="border-b border-stone-100 px-5 py-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Chat with Mayflower</h2>
        <p className="text-xs text-stone-500">iMessage is primary; this mirrors it.</p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="pt-8 text-center text-sm text-stone-400">
            Say hi, tell Mayflower what you follow, or ask &ldquo;what should I look at?&rdquo;
          </p>
        )}
        {messages.map((m) => {
          const mine = m.role === "user";
          return (
            <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  mine ? "rounded-br-md bg-indigo-600 text-white" : "rounded-bl-md bg-stone-100 text-stone-800"
                }`}
              >
                <Linkified text={m.text} light={mine} />
              </div>
              <span className="mt-0.5 px-1 text-[10px] text-stone-400">
                {m.channel === "imessage" ? "iMessage" : "Web"} · {time(m.createdAt)}
              </span>
            </div>
          );
        })}
        {sending && (
          <div className="flex items-start">
            <div className="rounded-2xl rounded-bl-md bg-stone-100 px-3.5 py-2 text-sm text-stone-400">Thinking…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-stone-100 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || sending) return;
          setText("");
          await onSend(t);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message Mayflower"
          className="min-w-0 flex-1 rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm outline-none focus:border-indigo-300 focus:bg-white"
        />
        <Button variant="primary" type="submit" disabled={sending || !text.trim()}>Send</Button>
      </form>
    </section>
  );
}

function Linkified({ text, light }: { text: string; light: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s)]+|\/approve\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^(https?:\/\/|\/approve\/)/.test(part) ? (
          <a key={i} href={part} target={part.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" className={`underline ${light ? "text-white" : "text-indigo-600"}`}>
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
