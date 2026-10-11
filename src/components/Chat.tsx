"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { Logo } from "./ui";

const SUGGESTIONS = ["What should I look at? 👀", "How's my portfolio doing?", "What's my riskiest bet?", "Explain how this works"];

// Gap between messages that earns a centered timestamp, like Messages.
const GAP_MS = 15 * 60 * 1000;

function stamp(s: string) {
  const d = new Date(s);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `Today ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Chat({ messages, onSend, sending }: { messages: ChatMessage[]; onSend: (text: string) => Promise<void>; sending: boolean }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, sending]);

  const submit = async (raw: string) => {
    const t = raw.trim();
    if (!t || sending) return;
    setText("");
    await onSend(t);
  };

  const lastMine = [...messages].reverse().find((m) => m.role === "user")?.id;

  return (
    <section className="flex h-[75vh] flex-col overflow-hidden rounded-3xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(0,0,0,0.15)] lg:h-[calc(100vh-3rem)]">
      <div className="flex flex-col items-center border-b border-stone-100 bg-stone-50/80 px-5 pb-3 pt-4 backdrop-blur">
        <Logo size={44} />
        <h2 className="mt-1.5 text-[13px] font-semibold tracking-tight">Mayflower ›</h2>
        <p className="text-[11px] text-stone-500">iMessage · mirrored here</p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="animate-rise flex flex-col items-center pt-10 text-center">
            <div className="text-4xl" aria-hidden>👋</div>
            <p className="mt-2 text-sm font-semibold text-stone-800">Say hi to Mayflower</p>
            <p className="mt-1 max-w-[16rem] text-xs text-stone-500">Tell it what you follow, or tap a suggestion below to get going.</p>
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.role === "user";
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const showStamp = !prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GAP_MS;
          const groupStart = showStamp || prev?.role !== m.role;
          const groupEnd =
            !next || next.role !== m.role || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > GAP_MS;
          return (
            <Fragment key={m.id}>
              {showStamp && (
                <div className="my-3 text-center text-[11px] font-medium text-stone-400">
                  {m.channel === "imessage" ? "iMessage · " : ""}
                  {stamp(m.createdAt)}
                </div>
              )}
              <div className={`flex ${mine ? "justify-end" : "justify-start"} ${groupStart ? "mt-2" : "mt-0.5"}`}>
                <div
                  className={`animate-pop max-w-[78%] whitespace-pre-wrap break-words rounded-[20px] px-3.5 py-2 text-[15px] leading-snug ${
                    mine ? "origin-bottom-right bg-imsg text-white" : "origin-bottom-left bg-bubble text-stone-900"
                  } ${groupEnd ? (mine ? "rounded-br-[6px]" : "rounded-bl-[6px]") : ""}`}
                >
                  <Linkified text={m.text} light={mine} />
                </div>
              </div>
              {m.id === lastMine && (
                <div className="mt-0.5 pr-1 text-right text-[11px] font-medium text-stone-400">
                  {m.id === "pending" ? "Sending…" : "Delivered"}
                </div>
              )}
            </Fragment>
          );
        })}
        {sending && (
          <div className="mt-2 flex justify-start" aria-label="Mayflower is typing">
            <div className="animate-pop flex origin-bottom-left items-center gap-1 rounded-[20px] rounded-bl-[6px] bg-bubble px-4 py-3">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-2 w-2 animate-dot rounded-full bg-stone-500" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {!sending && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
          {SUGGESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => submit(q)}
              className="shrink-0 rounded-full border border-imsg/30 bg-white px-3 py-1.5 text-xs font-semibold text-imsg transition-all hover:bg-imsg/5 active:scale-95"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2 border-t border-stone-100 px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
      >
        <div className="flex min-w-0 flex-1 items-center rounded-full border border-stone-300 bg-white py-1 pl-4 pr-1 focus-within:border-stone-400">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="iMessage"
            aria-label="Message Mayflower"
            className="min-w-0 flex-1 bg-transparent py-1 text-[15px] outline-none placeholder:text-stone-400"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-imsg text-white transition-all hover:bg-imsg-dark active:scale-90 disabled:scale-75 disabled:opacity-0"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>
    </section>
  );
}

function Linkified({ text, light }: { text: string; light: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s)]+|\/approve\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!/^(https?:\/\/|\/approve\/)/.test(part)) return <span key={i}>{part}</span>;
        // Approval links get a tappable "money" chip instead of a raw URL.
        if (part.includes("/approve/")) {
          return (
            <a
              key={i}
              href={part}
              className="my-1 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-semibold text-stone-900 no-underline shadow-sm transition-transform active:scale-95"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-money-500 text-white" aria-hidden>$</span>
              <span className="flex-1">Review &amp; approve trade</span>
              <span className="text-stone-400" aria-hidden>›</span>
            </a>
          );
        }
        return (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={`underline ${light ? "text-white" : "text-imsg"}`}>
            {part}
          </a>
        );
      })}
    </>
  );
}
