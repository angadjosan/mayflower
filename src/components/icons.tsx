// Small hand-rolled icon set (16px grid, 1.5 stroke). No icon library.
import type { SVGProps } from "react";

const PATHS = {
  message: <path d="M8 2.2c-3.5 0-6.3 2.4-6.3 5.3 0 1.7.9 3.2 2.4 4.1-.1.8-.4 1.6-1.1 2.3 1.3 0 2.4-.6 3.1-1.1.6.1 1.2.2 1.9.2 3.5 0 6.3-2.4 6.3-5.4S11.5 2.2 8 2.2Z" fill="currentColor" stroke="none" />,
  info: <><circle cx="8" cy="8" r="6.2" /><path d="M8 7.3v3.6M8 5.1v.1" /></>,
  x: <path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" />,
  check: <path d="M3.5 8.4l3 3 6-6.8" />,
  more: <><circle cx="3.5" cy="8" r=".9" fill="currentColor" /><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="12.5" cy="8" r=".9" fill="currentColor" /></>,
  arrowRight: <path d="M3 8h10M9 4l4 4-4 4" />,
  arrowUpRight: <path d="M5 11l6-6M6 5h5v5" />,
  chevronDown: <path d="M4 6l4 4 4-4" />,
  shield: <path d="M8 1.8l5 1.9v4c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5v-4l5-1.9Z" />,
  user: <><circle cx="8" cy="5.4" r="2.6" /><path d="M2.8 13.8c.7-2.5 2.8-4 5.2-4s4.5 1.5 5.2 4" /></>,
  plug: <path d="M6 1.8v3M10 1.8v3M4.3 4.8h7.4v2.4A3.7 3.7 0 0 1 8 10.9a3.7 3.7 0 0 1-3.7-3.7V4.8ZM8 10.9v3.3" />,
  receipt: <path d="M3.5 1.8h9v12.4l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1V1.8ZM5.8 5.2h4.4M5.8 8h4.4" />,
  pulse: <path d="M1.5 8.5h3l1.8-4.5 3.4 8 1.8-3.5h3" />,
  sun: <><circle cx="8" cy="8" r="2.8" /><path d="M8 1.3v1.4M8 13.3v1.4M1.3 8h1.4M13.3 8h1.4M3.3 3.3l1 1M11.7 11.7l1 1M3.3 12.7l1-1M11.7 4.3l1-1" /></>,
  moon: <path d="M13.3 10.3A5.6 5.6 0 0 1 5.7 2.7a5.6 5.6 0 1 0 7.6 7.6Z" />,
  system: <><rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.4" /><path d="M5.5 14h5M8 11.2V14" /></>,
  refresh: <path d="M13.2 6.3A5.3 5.3 0 0 0 3.4 5M2.8 9.7a5.3 5.3 0 0 0 9.8 1.3M13.4 2.6v3.8H9.6M2.6 13.4V9.6h3.8" />,
  play: <path d="M5 3.2v9.6L12.6 8 5 3.2Z" fill="currentColor" stroke="none" />,
  reset: <path d="M2.8 3.2v3.6h3.6M3.1 6.6A5.2 5.2 0 1 1 3 9.8" />,
  wallet: <><path d="M2.2 4.6c0-1 .8-1.8 1.8-1.8h7.6v2.4" /><rect x="2.2" y="4.6" width="11.6" height="8.6" rx="1.6" /><circle cx="10.9" cy="8.9" r=".9" fill="currentColor" /></>,
  plus: <path d="M8 3.2v9.6M3.2 8h9.6" />,
  minus: <path d="M3.2 8h9.6" />,
  external: <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />,
  search: <><circle cx="7" cy="7" r="4.3" /><path d="M10.3 10.3l3.4 3.4" /></>,
  sparkle: <path d="M8 1.8l1.4 4.1 4.1 1.4-4.1 1.4L8 12.8 6.6 8.7 2.5 7.3l4.1-1.4L8 1.8Z" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  logout: <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10 11l3-3-3-3M13 8H6" />,
  link: <path d="M6.6 9.4a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.4 6.6a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />,
  clock: <><circle cx="8" cy="8" r="6.2" /><path d="M8 4.6V8l2.3 1.5" /></>,
  target: <><circle cx="8" cy="8" r="6.2" /><circle cx="8" cy="8" r="3.2" /><circle cx="8" cy="8" r=".6" fill="currentColor" /></>,
  layers: <path d="M8 2 1.8 5.2 8 8.4l6.2-3.2L8 2ZM1.8 8 8 11.2 14.2 8M1.8 10.8 8 14l6.2-3.2" />,
  pencil: <path d="M10.6 2.6l2.8 2.8-7.9 7.9H2.7v-2.8l7.9-7.9Z" />,
  hash: <path d="M5.5 2.5l-1 11M11.5 2.5l-1 11M2.5 6h11M2 10h11" />,
  bolt: <path d="M9 1.8 3.6 9h4.1L7 14.2 12.4 7H8.3L9 1.8Z" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "h-4 w-4", ...rest }: { name: IconName; className?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {PATHS[name]}
    </svg>
  );
}
