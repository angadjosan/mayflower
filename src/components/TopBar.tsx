"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DashState } from "./state";
import { Logo, MessageIcon, TestnetPill, Toggle, smsHref } from "./ui";

const DEMO_USER_ID = "user_demo";

type Theme = "system" | "light" | "dark";

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("mf-theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch { /* storage blocked */ }
  }, []);
  const set = (t: Theme) => {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("mf-theme");
      else localStorage.setItem("mf-theme", t);
    } catch { /* storage blocked */ }
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  return [theme, set];
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "dark")
    return <path d="M13.5 10.6A5.5 5.5 0 0 1 7.4 2.5a5.5 5.5 0 1 0 6.1 8.1Z" fill="currentColor" />;
  if (theme === "light")
    return (
      <g stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
        <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
        <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
      </g>
    );
  return (
    <g>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth={1.4} />
      <path d="M8 2a6 6 0 0 1 0 12Z" fill="currentColor" />
    </g>
  );
}

function AccountMenu({ s, onTogglePause, busy }: { s: DashState; onTogglePause: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const demo = s.user.id === DEMO_USER_ID;
  const name = demo ? "Demo" : s.user.name || s.user.handle || "You";
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 items-center gap-2 rounded-full border border-line-strong pl-1 pr-2.5 text-sm text-fg transition-colors hover:bg-sunken"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sunken text-xs font-semibold uppercase text-fg-2">{name.slice(0, 1)}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${s.user.paused ? "bg-warn" : "bg-up"}`} aria-label={s.user.paused ? "Trading paused" : "Trading on"} />
      </button>
      {open && (
        <div role="menu" className="animate-pop absolute right-0 top-11 z-40 w-72 origin-top-right rounded-2xl border border-line bg-surface p-2 shadow-[0_16px_48px_-16px_rgba(0,0,0,0.35)]">
          <div className="px-3 pb-3 pt-2">
            <div className="truncate text-sm font-semibold text-fg">{demo ? "Demo account" : name}</div>
            <div className="truncate text-xs text-muted">{demo ? "Signed out · sample data" : s.user.handle || s.user.id}</div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-sunken">
            <div>
              <div className="text-sm text-fg">{s.user.paused ? "Trading paused" : "Trading on"}</div>
              <div className="text-xs text-muted">{s.user.paused ? "No orders will be placed" : "You approve every trade"}</div>
            </div>
            <Toggle on={!s.user.paused} onChange={onTogglePause} disabled={busy} label="Allow trading" />
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="text-sm text-fg">Theme</span>
            <div className="flex rounded-full border border-line p-0.5" role="radiogroup" aria-label="Theme">
              {(["system", "light", "dark"] as Theme[]).map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={theme === t}
                  aria-label={t}
                  title={t[0].toUpperCase() + t.slice(1)}
                  onClick={() => setTheme(t)}
                  className={`flex h-7 w-8 items-center justify-center rounded-full transition-colors ${theme === t ? "bg-sunken text-fg" : "text-subtle hover:text-fg"}`}
                >
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden><ThemeIcon theme={t} /></svg>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1 border-t border-line pt-1">
            {demo ? (
              <a href="/login" className="block rounded-xl px-3 py-2.5 text-sm text-fg hover:bg-sunken">Sign in</a>
            ) : (
              <button onClick={signOut} className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-fg hover:bg-sunken">Sign out</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar({ s, onTogglePause, busy }: { s: DashState; onTogglePause: () => void; busy: boolean }) {
  return (
    <div className="flex h-16 items-center justify-between gap-3">
      <Link href="/" className="flex min-w-0 items-center gap-2.5">
        <Logo size={28} />
        <span className="text-[17px] font-semibold tracking-tight text-fg">Mayflower</span>
        <TestnetPill className="hidden min-[380px]:inline-flex" />
      </Link>
      <div className="flex items-center gap-2">
        <a
          href={smsHref()}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-sm font-medium text-ink-fg transition-opacity hover:opacity-90"
        >
          <MessageIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Text Mayflower</span>
          <span className="sm:hidden">Text</span>
        </a>
        <AccountMenu s={s} onTogglePause={onTogglePause} busy={busy} />
      </div>
    </div>
  );
}
