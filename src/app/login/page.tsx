"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo, MessageIcon, smsHref } from "@/components/ui";

function LoginForm() {
  const params = useSearchParams();
  const expired = params.get("error") === "expired";
  const next = params.get("next") || undefined;
  const [handle, setHandle] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, next }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setSent(data.message || "We sent a link to your Messages.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-rise w-full max-w-sm">
      <div className="flex flex-col items-center text-center">
        <Logo size={48} />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg">Sign in to Mayflower</h1>
              </div>

      <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-card">
        {expired && !sent && (
          <p className="mb-4 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">That link expired or was already used. Request a new one.</p>
        )}

        {sent ? (
          <div className="space-y-2 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
              <MessageIcon className="h-5 w-5" />
            </div>
            <p className="pt-2 text-[15px] font-medium text-fg">Check your Messages</p>
            <p className="text-sm text-muted">{sent}</p>
            <button className="pt-2 text-[13px] text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => setSent(null)}>Use a different handle</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="sr-only" htmlFor="handle">Phone number, Apple ID, or Discord handle</label>
            <input
              id="handle"
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 text-[15px] text-fg outline-none transition placeholder:text-subtle focus:border-accent"
              placeholder="Phone, Apple ID, or discord:name"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              autoFocus
              autoComplete="username"
            />
            {error && <p className="text-[13px] text-down">{error}</p>}
            <button
              type="submit"
              disabled={busy || !handle.trim()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-medium text-ink-fg transition-opacity hover:opacity-90 active:scale-[0.99] disabled:opacity-40"
            >
              <MessageIcon className="h-4 w-4" />
              {busy ? "Sending…" : "Text me a sign-in link"}
            </button>
          </form>
        )}
      </div>

      <a href={smsHref()} className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted hover:text-fg">
        <MessageIcon className="h-3.5 w-3.5" /> New here? Text Mayflower
      </a>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
