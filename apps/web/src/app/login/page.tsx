"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, Input, Label } from "@/components/ui/primitives";

export default function LoginPage() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"handle" | "code">("handle");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong");
    setDevCode(data.devCode ?? null);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle, code }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong");
    router.push(data.next ?? "/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-6">
        <div className="text-sm font-medium text-accent">Mayflower</div>
        <h1 className="mt-2 text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">We'll send a code to your iMessage.</p>
      </div>
      <Card>
        <CardBody className="pt-5">
          {step === "handle" ? (
            <form onSubmit={start} className="space-y-3">
              <Label htmlFor="handle">iMessage phone number or Apple ID email</Label>
              <Input id="handle" autoFocus required value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="+1 206 555 0100" autoComplete="tel" />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Sending…" : "Send code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-3">
              {devCode ? (
                <div className="rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
                  Dev mode: the iMessage bridge isn't configured, so your code is shown here: <span className="font-mono font-semibold">{devCode}</span>
                </div>
              ) : (
                <p className="text-sm text-muted">Check iMessage for a 6-digit code.</p>
              )}
              <Label htmlFor="code">Code</Label>
              <Input id="code" autoFocus required inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Checking…" : "Sign in"}
              </Button>
              <button type="button" className="w-full text-center text-xs text-muted underline" onClick={() => setStep("handle")}>
                Use a different number
              </button>
            </form>
          )}
          {error ? <p className="mt-3 text-sm text-negative">{error}</p> : null}
        </CardBody>
      </Card>
      <p className="mt-4 text-center text-xs text-muted">New here? Signing in creates your Mayflower profile. You can also just text Mayflower.</p>
    </main>
  );
}
