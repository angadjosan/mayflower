"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

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
    <div className="w-full max-w-sm space-y-6 rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">M</div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in to Mayflower</h1>
      </div>

      {expired && !sent && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">That link expired or was already used. Request a new one.</p>
      )}

      {sent ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">We sent a link to your Messages.</p>
          <p className="text-sm text-stone-500">{sent}</p>
          <button className="text-sm text-indigo-600 hover:underline" onClick={() => setSent(null)}>Use a different handle</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-stone-600" htmlFor="handle">Phone number, Apple ID, or Discord handle</label>
          <input
            id="handle"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            placeholder="+1 555 123 4567, you@icloud.com, or discord:yourname"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            autoFocus
            autoComplete="username"
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !handle.trim()}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Sending..." : "Text me a sign-in link"}
          </button>
        </form>
      )}

      <p className="text-xs text-stone-500">
        No passwords. Text Mayflower first if you haven&apos;t — your account is created from your messages. You can also text
        &quot;dashboard&quot; to Mayflower to get a link.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
