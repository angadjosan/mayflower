"use client";
// Motion/theme helpers shared by the React Bits integrations.
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useLowPower, useMedia, useReducedMotion, useResolvedTheme } from "./hooks";
import FadeContent from "./reactbits/FadeContent";

// ---------- Hero backdrop ----------

// WebGL is client-only and code-split: the shader never ships in the main chunk or runs on the server.
const Aurora = dynamic(() => import("./reactbits/Aurora"), { ssr: false, loading: () => null });

/** Low-contrast cyan aurora behind the hero, or a static gradient when motion is off or the device is weak. */
export function HeroBackdrop() {
  const theme = useResolvedTheme();
  const low = useLowPower();
  const small = useMedia("(max-width: 640px)");
  const fallback = (
    <div
      className="absolute inset-0"
      style={{ background: "radial-gradient(80% 60% at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%)" }}
    />
  );
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px] overflow-hidden sm:h-[560px]"
      style={{ maskImage: "linear-gradient(to bottom, #000 30%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, #000 30%, transparent)" }}
    >
      {fallback}
      {!low && (
        <Aurora
          key={theme}
          colorStops={theme === "dark" ? ["#0e7490", "#22d3ee", "#164e63", "#0891b2"] : ["#22d3ee", "#a5f3fc", "#06b6d4", "#67e8f9"]}
          lightMode={theme === "light"}
          opacity={theme === "dark" ? 0.32 : 0.4}
          amplitude={0.9}
          blend={0.85}
          speed={0.45}
          height={0.5}
          glow={0.5}
          intro={false}
          mouseInteraction={!small}
          dpr={small ? 0.75 : 1}
        />
      )}
    </div>
  );
}

// ---------- Section entrance ----------

/** Fades a section in as it scrolls into view (GSAP), or renders it plainly with reduced motion. */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <FadeContent duration={600} delay={delay} threshold={0.05} className={className}>
      {children}
    </FadeContent>
  );
}
