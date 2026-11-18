"use client";

/**
 * Tooltip content for a chart whose lines each carry their own readings (a
 * <Line data={…}> per series). Recharts' default tooltip matches the hovered
 * index across series, which for separate arrays shows one line's value under
 * every name — DC voltage's 857 V was printed as "SOC 857 %". This looks up
 * each line's own reading nearest the hovered time instead, and leaves a line
 * out when it has none within `maxGapMs` of it.
 */

import { timeTooltipLabel } from "@/lib/charts/timeAxis";
import { tooltipStyle } from "@/lib/charts/tokens";

export interface TooltipLine {
  name: string;
  color: string;
  unit: string;
  data: { ts: number; v: number | null }[];
}

/** The reading nearest `ts`, or null if none is within `maxGapMs`. Data oldest first. */
export function nearestValue(data: TooltipLine["data"], ts: number, maxGapMs: number): number | null {
  let lo = 0, hi = data.length - 1, best: { ts: number; v: number | null } | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].ts < ts) lo = mid + 1; else hi = mid - 1;
  }
  for (const i of [lo - 1, lo]) {
    const d = data[i];
    if (!d || d.v == null) continue;
    if (!best || Math.abs(d.ts - ts) < Math.abs(best.ts - ts)) best = d;
  }
  return best && Math.abs(best.ts - ts) <= maxGapMs ? best.v : null;
}

export function NearestTooltip({ active, label, lines, maxGapMs, fmt }: {
  active?: boolean;
  label?: number | string;
  lines: TooltipLine[];
  maxGapMs: number;
  fmt?: (v: number) => string;
}) {
  if (!active || label == null) return null;
  const ts = Number(label);
  if (!Number.isFinite(ts)) return null;
  const rows = lines.map((l) => ({ ...l, v: nearestValue(l.data, ts, maxGapMs) })).filter((r) => r.v != null);
  if (!rows.length) return null;
  const f = fmt ?? ((v: number) => String(Number(v.toPrecision(7))));
  return (
    <div style={tooltipStyle}>
      <div style={{ marginBottom: 4 }}>{timeTooltipLabel(ts)}</div>
      {rows.map((r) => (
        <div key={r.name} style={{ color: r.color }}>{r.name} : {f(r.v!)}{r.unit ? ` ${r.unit}` : ""}</div>
      ))}
    </div>
  );
}
