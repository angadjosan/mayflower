"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/ui";

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
    <div className="animate-rise w-full max-w-sm space-y-6 rounded-[28px] bg-white p-7 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_40px_-20px_rgba(0,0,0,0.2)]">
      <div className="flex flex-col items-center text-center">
        <Logo size={56} />
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Welcome to Mayflower</h1>
        <p className="mt-1 text-sm text-stone-500">Your money copilot, right in Messages.</p>
      </div>

      {expired && !sent && (
        <p className="rounded-2xl bg-amber-50 px-3 py-2 text-sm text-amber-800">That link expired or was already used. Request a new one.</p>
      )}

      {sent ? (
        <div className="space-y-3">
          <div className="flex justify-end">
            <div className="animate-pop max-w-[85%] origin-bottom-right rounded-[20px] rounded-br-[6px] bg-imsg px-3.5 py-2 text-[15px] text-white">Here&apos;s your sign-in link ✨</div>
          </div>
          <p className="text-center text-sm font-semibold">Check your Messages.</p>
          <p className="text-center text-sm text-stone-500">{sent}</p>
          <button className="block w-full text-center text-sm font-semibold text-imsg hover:underline" onClick={() => setSent(null)}>Use a different handle</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-medium text-stone-600" htmlFor="handle">Phone number, Apple ID, or Discord handle</label>
          <input
            id="handle"
            className="w-full rounded-2xl bg-stone-100 px-4 py-3 text-[15px] outline-none ring-imsg transition focus:bg-white focus:ring-2"
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
            className="w-full rounded-full bg-imsg px-4 py-3 text-[15px] font-bold text-white shadow-[0_10px_20px_-10px_rgba(10,132,255,0.9)] transition-all hover:bg-imsg-dark active:scale-[0.97] disabled:opacity-40"
          >
            {busy ? "Sending…" : "💬 Text me a sign-in link"}
          </button>
        </form>
      )}

      <p className="text-center text-xs leading-relaxed text-stone-500">
        No passwords. Text Mayflower first if you haven&apos;t — your account is created from your messages. You can also text
        &quot;dashboard&quot; to Mayflower to get a link.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
