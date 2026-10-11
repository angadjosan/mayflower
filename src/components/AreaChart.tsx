"use client";
import { useId, useMemo, useRef, useState } from "react";

export type Point = { at: string; valueUsd: number };

/**
 * Hand-rolled SVG area chart. Scales to its container width; reports the hovered point so the
 * parent can swap the headline number (exchange-style scrubbing). Handles 0/1 points as a flat line.
 */
export function AreaChart({
  points, height = 200, onHover, positive,
}: {
  points: Point[];
  height?: number;
  onHover?: (p: Point | null) => void;
  positive: boolean;
}) {
  const W = 1000; // viewBox width; rendered with preserveAspectRatio="none"
  const H = height;
  const PAD_T = 12, PAD_B = 8;
  const id = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const vals = points.map((p) => p.valueUsd);
    if (vals.length === 0) return null;
    const min = Math.min(...vals), max = Math.max(...vals);
    // Give a flat series some breathing room so it sits mid-chart instead of on the floor.
    const pad = max - min < 1e-9 ? Math.max(1, Math.abs(max) * 0.01) : (max - min) * 0.12;
    const lo = min - pad, hi = max + pad;
    const t0 = new Date(points[0].at).getTime();
    const t1 = new Date(points[points.length - 1].at).getTime();
    const byTime = t1 > t0 && points.length > 2;
    const x = (i: number) =>
      points.length === 1 ? W : byTime ? ((new Date(points[i].at).getTime() - t0) / (t1 - t0)) * W : (i / (points.length - 1)) * W;
    const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
    const xy = points.map((p, i) => [x(i), y(p.valueUsd)] as const);
    const line =
      xy.length === 1
        ? `M0,${xy[0][1].toFixed(1)} L${W},${xy[0][1].toFixed(1)}`
        : xy.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
    const area = `${line} L${xy.length === 1 ? W : xy[xy.length - 1][0].toFixed(1)},${H} L0,${H} Z`;
    return { xy, line, area, baseY: y(points[0].valueUsd) };
  }, [points, H]);

  const color = positive ? "var(--up)" : "var(--down)";

  const move = (clientX: number) => {
    if (!geo || !ref.current || points.length < 2) return;
    const r = ref.current.getBoundingClientRect();
    const fx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < geo.xy.length; i++) if (Math.abs(geo.xy[i][0] - fx) < Math.abs(geo.xy[best][0] - fx)) best = i;
    setHover(best);
    onHover?.(points[best]);
  };
  const leave = () => { setHover(null); onHover?.(null); };

  if (!geo) return <div style={{ height }} />;
  const h = hover != null ? geo.xy[hover] : null;

  return (
    <div className="relative select-none" style={{ height }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full touch-pan-y"
        onPointerMove={(e) => move(e.clientX)}
        onPointerDown={(e) => move(e.clientX)}
        onPointerLeave={leave}
        onPointerCancel={leave}
        role="img"
        aria-label="Portfolio value over time"
      >
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Starting-value reference line */}
        <line x1={0} x2={W} y1={geo.baseY} y2={geo.baseY} stroke="var(--line-strong)" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
        <path d={geo.area} fill={`url(#g${id})`} />
        <path d={geo.line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {h && <line x1={h[0]} x2={h[0]} y1={0} y2={H} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Dots are HTML so they stay round under the non-uniform SVG scale. */}
      {(h ?? (points.length >= 1 ? geo.xy[geo.xy.length - 1] : null)) && (
        <span
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-surface"
          style={{
            left: `${((h ?? geo.xy[geo.xy.length - 1])[0] / W) * 100}%`,
            top: `${((h ?? geo.xy[geo.xy.length - 1])[1] / H) * 100}%`,
            background: color,
          }}
        />
      )}
    </div>
  );
}
