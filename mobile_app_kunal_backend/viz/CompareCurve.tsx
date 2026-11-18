"use client";

/**
 * CompareCurve — one metric, every unit, on one pair of axes.
 *
 * The Site screen's per-unit charts each scale to their own range, which is
 * right for reading a unit and wrong for comparing two: a taller line is not
 * necessarily a bigger number. This is the other half of that. One axis, one
 * line per unit, so height means the same thing in both.
 *
 * It does not reuse PowerCurve. That component is design-approved and draws a
 * fixed pair of series — power as an area with SOC behind it — and bending it
 * into an n-series line chart would have meant editing it. The axis maths
 * below is therefore a deliberate second copy of the two helpers PowerCurve
 * keeps private, and it is copied rather than shared for exactly one reason:
 * this file must be able to change without the dashboard's hero chart moving.
 *
 * Colour is never the only difference between two lines. §7.8 of the brief is
 * about status, but the argument is the same here — the second unit is dashed,
 * the third dotted, and the legend states the mapping in words. Two teals a
 * hue apart on a phone in sunlight is not a distinction.
 */

import { useMemo } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";

/** One unit's line. `v` is nullable end to end: a gap is a gap, never a zero. */
export interface CompareSeries {
  id: string;
  label: string;
  points: { t: number; v: number | null }[];
}

/* Four is the practical ceiling — beyond it the lines stop being separable at
   172 px whatever they are dashed with, and a site with five BESS wants a
   different screen, not a busier chart. */
const STROKES = [
  { color: "var(--m-series-1)", dash: undefined,  name: "solid" },
  { color: "var(--m-series-2)", dash: "6 4",      name: "dashed" },
  { color: "var(--m-series-3)", dash: "2 3",      name: "dotted" },
  { color: "var(--m-series-4)", dash: "10 3 2 3", name: "dash-dot" },
] as const;

export const strokeFor = (i: number) => STROKES[i % STROKES.length];

/**
 * A y-axis with round numbers on it that hold still.
 *
 * Same reasoning as PowerCurve's: an axis whose labels move with every poll
 * cannot be used to compare one glance to the next, so the range is snapped
 * outward to a round step and only changes when the data crosses a whole one.
 */
function niceAxis(lo: number, hi: number, includeZero: boolean, targetTicks = 5) {
  let min = includeZero ? Math.min(0, lo) : lo;
  let max = includeZero ? Math.max(0, hi) : hi;
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (min === max) max = min + 1;

  const raw = (max - min) / (targetTicks - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;

  const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const from = round6(Math.floor(min / step) * step);
  const to = round6(Math.ceil(max / step) * step);

  const ticks: number[] = [];
  for (let v = from; v <= to + step / 2; v += step) ticks.push(round6(v));
  return { domain: [from, to] as [number, number], ticks };
}

const TIME_STEPS = [
  60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000,
  3600_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000,
  86_400_000,
];

function timeTicks([from, to]: [number, number], target = 4): number[] {
  const span = Math.max(1, to - from);
  const step = TIME_STEPS.find((s) => span / s <= target) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return ticks;
}

const clock = (ms: number, span: number) =>
  new Date(ms).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit",
    ...(span <= 15 * 60_000 ? { second: "2-digit" as const } : {}),
    hour12: false,
  });

function Tip({ active, payload, label, series, unit, precision, span }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, number | null> | undefined;
  if (!row) return null;

  return (
    <div className="m-tip">
      <div className="m-tip-t">{typeof label === "number" ? clock(label, span) : label}</div>
      {(series as CompareSeries[]).map((s) => {
        const v = row[s.id];
        return (
          <div className="m-tip-row" key={s.id}>
            <span>{s.label}</span>
            {/* Absent stays absent here too. A unit that reported nothing for
                this bucket is not a unit that reported zero. */}
            <strong>{v == null ? "—" : `${v.toFixed(precision)}${unit ? ` ${unit}` : ""}`}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function CompareCurve({
  series, window: win, unit, precision = 1, fixedDomain, zeroLine,
}: {
  series: CompareSeries[];
  /** The window that was asked for. The axis spans it whatever arrived, so a
      partly-filled period looks partly filled rather than like a short one. */
  window: [number, number];
  unit: string;
  precision?: number;
  /** For a bounded quantity — SOC is 0–100 whatever the data did. */
  fixedDomain?: [number, number];
  /** Draw the zero rule. On a signed series it is the charge/discharge line. */
  zeroLine?: boolean;
}) {
  /* One row per instant, every unit's value on it. The units share a bucket
     grid — same span, same anchor, so the server buckets them identically —
     but the merge is by timestamp rather than by index anyway: a unit whose
     window is still filling has fewer points, and lining those up by position
     would slide its line sideways under a time axis. */
  const rows = useMemo(() => {
    const byT = new Map<number, Record<string, number | null>>();
    for (const s of series) {
      for (const p of s.points) {
        let row = byT.get(p.t);
        if (!row) { row = { t: p.t }; byT.set(p.t, row); }
        row[s.id] = p.v;
      }
    }
    return [...byT.values()].sort((a, b) => (a.t as number) - (b.t as number));
  }, [series]);

  const span = win[1] - win[0];
  const xTicks = useMemo(() => timeTicks(win), [win]);

  const y = useMemo(() => {
    if (fixedDomain) {
      const [lo, hi] = fixedDomain;
      const step = (hi - lo) / 4;
      return { domain: fixedDomain, ticks: [0, 1, 2, 3, 4].map((i) => lo + i * step) };
    }
    let lo = Infinity, hi = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.v == null || !Number.isFinite(p.v)) continue;
        if (p.v < lo) lo = p.v;
        if (p.v > hi) hi = p.v;
      }
    }
    if (!Number.isFinite(lo)) return niceAxis(0, 1, !!zeroLine);
    return niceAxis(lo, hi, !!zeroLine);
  }, [series, fixedDomain, zeroLine]);

  return (
    <>
      <div className="m-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: -22 }}>
            <CartesianGrid vertical={false} stroke="var(--m-border)" strokeDasharray="2 5" />

            <XAxis
              dataKey="t"
              type="number"
              domain={win}
              ticks={xTicks}
              scale="time"
              tickFormatter={(v: number) => clock(v, span)}
              tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={12}
            />
            <YAxis
              domain={y.domain}
              ticks={y.ticks}
              tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />

            {zeroLine && <ReferenceLine y={0} stroke="var(--m-border-strong)" />}

            <Tooltip
              content={<Tip series={series} unit={unit} precision={precision} span={span} />}
              cursor={{ stroke: "var(--m-border-strong)", strokeWidth: 1 }}
            />

            {series.map((s, i) => {
              const stroke = strokeFor(i);
              return (
                <Line
                  key={s.id}
                  type="monotone"
                  dataKey={s.id}
                  stroke={stroke.color}
                  strokeWidth={2}
                  strokeDasharray={stroke.dash}
                  dot={false}
                  isAnimationActive={false}
                  /* False, deliberately. Joining across a gap draws a segment
                     nobody measured, and on this screen it would draw it
                     straight through the period a unit was not reporting. */
                  connectNulls={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="m-chart-legend">
        {series.map((s, i) => {
          const stroke = strokeFor(i);
          return (
            <span className="m-legend-key" key={s.id}>
              <span
                className="m-legend-swatch"
                style={{
                  background: stroke.dash ? "none" : stroke.color,
                  borderTop: stroke.dash ? `3px dashed ${stroke.color}` : undefined,
                  height: stroke.dash ? 0 : undefined,
                }}
              />
              {s.label}
            </span>
          );
        })}
      </div>
    </>
  );
}
