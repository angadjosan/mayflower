"use client";
// Theme-matched wrapper around React Bits AnimatedList, used for Activity and Memory.
import type { CSSProperties, ReactNode } from "react";
import { useResolvedTheme } from "./hooks";
import AnimatedList, { type AnimatedListItem } from "./reactbits/AnimatedList";

const TOKENS = {
  "--al-tile": "var(--surface)",
  "--al-tile-edge": "var(--line)",
  "--al-tile-highlight": "transparent",
  "--al-tile-shadow": "none",
  "--al-well": "var(--sunken)",
  "--al-ink": "var(--fg)",
  "--al-muted": "var(--muted)",
  "--al-thumb": "var(--line-strong)",
} as CSSProperties;

export function Feed({ items, renderItem, maxHeight = 440 }: {
  items: AnimatedListItem[];
  renderItem?: (item: AnimatedListItem, index: number, selected: boolean) => ReactNode;
  maxHeight?: number;
}) {
  const theme = useResolvedTheme();
  return (
    <AnimatedList
      items={items}
      renderItem={renderItem}
      theme={theme}
      accentColor="var(--accent)"
      animation="slide"
      stagger={0.04}
      frame={false}
      showGradients={items.length > 6}
      enableArrowNavigation
      radius={14}
      gap={6}
      width="100%"
      maxHeight={maxHeight}
      style={TOKENS}
    />
  );
}
