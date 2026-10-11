"use client";
// Tab bar built on React Bits GooeyNav (WebGL gooey pill), themed to the dashboard tokens.
import { useResolvedTheme } from "./hooks";
import { Icon, type IconName } from "./icons";
import GooeyNav from "./reactbits/GooeyNav";

export function TabBar<K extends string>({ tabs, value, onChange }: {
  tabs: readonly { key: K; label: string; icon: IconName }[];
  value: K;
  onChange: (k: K) => void;
}) {
  const theme = useResolvedTheme();
  const index = Math.max(0, tabs.findIndex((t) => t.key === value));
  return (
    <div className="no-scrollbar -mx-4 mb-4 overflow-x-auto px-4 py-1 sm:mx-0 sm:px-0">
      <GooeyNav
        items={tabs.map((t) => ({ label: t.label, icon: <Icon name={t.icon} /> }))}
        activeIndex={index}
        onChange={(i) => onChange(tabs[i].key)}
        theme={theme}
        color={theme === "dark" ? "#f3f4f6" : "#0b0c0e"}
        size="sm"
        frame
        particleCount={10}
        className="min-w-max"
      />
    </div>
  );
}
