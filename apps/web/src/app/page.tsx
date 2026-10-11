import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle, ShieldCheck, Search, Scale } from "lucide-react";
import { buttonVariants } from "@/components/ui/primitives";
import { getSessionUser } from "@/server/session";

export const dynamic = "force-dynamic";

const points = [
  { icon: MessageCircle, title: "Talk to it in iMessage", body: "Tell Mayflower what you follow and believe. It turns that into researched prediction-market ideas." },
  { icon: Search, title: "Research, not hype", body: "Every idea comes with a thesis, evidence for and against, sources, and Mayflower's probability vs. the market's." },
  { icon: Scale, title: "Risk sized for you", body: "A deterministic risk engine sizes each trade inside your limits — and says so when the answer is no trade." },
  { icon: ShieldCheck, title: "You approve every trade", body: "Nothing is placed without your explicit, exact approval. Mayflower can trade on your Gemini account but can never move your money." },
];

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:py-24">
      <div className="text-sm font-medium text-accent">Mayflower</div>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Your personal AI hedge fund for prediction markets.</h1>
      <p className="mt-5 text-lg text-muted">
        Mayflower learns what you care about, researches the world, finds opportunities inside and outside your interests, and recommends trades sized to your risk. Approve each one yourself — it never trades behind your back.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/login" className={buttonVariants({ size: "lg" })}>
          Sign in with iMessage
        </Link>
      </div>
      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {points.map((p) => (
          <div key={p.title} className="rounded-xl border border-border bg-surface p-5">
            <p.icon className="h-5 w-5 text-accent" aria-hidden />
            <div className="mt-3 font-medium">{p.title}</div>
            <div className="mt-1 text-sm text-muted">{p.body}</div>
          </div>
        ))}
      </div>
      <p className="mt-12 text-xs text-muted">
        Prediction-market contracts can lose their full cost and estimates can be wrong. Mayflower makes no promises of profit. During the hackathon all execution uses Gemini sandbox funds or is clearly labelled as simulated.
      </p>
    </main>
  );
}
