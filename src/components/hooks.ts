"use client";
// Theme / motion / device hooks (kept separate from fx.tsx so pages that only need these don't pull in GSAP).
import { useEffect, useState, useSyncExternalStore } from "react";

// ---------- Environment hooks ----------

function subscribeTheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener("change", cb);
  return () => { mo.disconnect(); mq.removeEventListener("change", cb); };
}
function readTheme(): "dark" | "light" {
  const forced = document.documentElement.dataset.theme;
  if (forced === "dark" || forced === "light") return forced;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
/** The theme actually on screen (system or forced), kept in sync with the toggle. */
export function useResolvedTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeTheme, readTheme, () => "dark");
}

export function useMedia(query: string, server = false) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => server,
  );
}
export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)", true);

/** True when heavy effects should be skipped: reduced motion, Save-Data, or a weak device. */
export function useLowPower() {
  const reduced = useReducedMotion();
  const [weak, setWeak] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    setWeak(Boolean(nav.connection?.saveData) || (nav.deviceMemory != null && nav.deviceMemory <= 2) || (navigator.hardwareConcurrency || 8) <= 2);
  }, []);
  return reduced || weak;
}

