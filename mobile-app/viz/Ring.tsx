"use client";

/**
 * Ring — a segmented donut gauge with the total in the centre.
 *
 * SVG rather than canvas or a chart library: it is a handful of arcs, it
 * scales without raster artefacts, and it takes its colours from CSS
 * variables so it themes with everything else.
 *
 * Segments are drawn as a single circle per segment using stroke-dasharray,
 * which is both cheaper and crisper than generating arc paths.
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";

export interface RingSegment {
  label: string;
  value: number;
  color: string;
}

export function Ring({
  segments, size = 190, thickness = 20, center, caption, className,
}: {
  segments: RingSegment[];
  size?: number;
  thickness?: number;
  center: ReactNode;
  caption?: ReactNode;
  className?: string;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  // A 4° gap between segments so adjacent arcs stay legible without a stroke
  // outline. Dropped entirely when there is only one segment, where a gap
  // would read as a missing slice.
  const gap = segments.length > 1 ? (4 / 360) * circumference : 0;

  let offset = 0;

  return (
    <div className={clsx("m-ring", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={
        segments.map((s) => `${s.label} ${s.value}`).join(", ")
      }>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {/* Track */}
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none"
            stroke="var(--m-ring-track)"
            strokeWidth={thickness}
          />
          {total > 0 && segments.map((s) => {
            const frac = Math.max(0, s.value) / total;
            const len = Math.max(0, frac * circumference - gap);
            const dash = `${len} ${circumference - len}`;
            const el = (
              <circle
                key={s.label}
                cx={size / 2} cy={size / 2} r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeLinecap="round"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            );
            offset += frac * circumference;
            return el;
          })}
        </g>
      </svg>

      <div className="m-ring-center">
        {center}
        {caption && <div className="m-ring-caption">{caption}</div>}
      </div>
    </div>
  );
}
