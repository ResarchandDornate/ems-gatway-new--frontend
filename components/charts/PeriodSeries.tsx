"use client";

/**
 * One parameter over a Day / Week / Month / Year period (PeriodNav): a Day is
 * its readings as a line, a Week / Month / Year one capsule (or bar) per day
 * or month — BucketChart. Works for any history tag fetchPointHistory reads:
 * an S2 point (`<asset>::<point>`) or a fast-stream signal (`fast:…`).
 *
 * The read's end moves in 5-minute steps, never with a ticking clock: a key
 * that changed every second refetched a hundred samples a second.
 */

import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { usePointHistories } from "@/hooks/useDataAnalysis";
import { aggregate, bucketsOf, isRaw, kindOf, type Period } from "@/lib/charts/period";
import { BucketChart, withRange } from "@/components/charts/BucketChart";
import { PLOT_MARGIN, rangeTicks, tickLabel, xAxis, yAxis } from "@/lib/charts/axes";
import { timeAxisProps, timeTooltipLabel, withGaps, GAP_MS } from "@/lib/charts/timeAxis";
import { useStableTicks } from "@/lib/charts/stable";
import { AxisUnit } from "@/components/dashboard/viz/ChartCardHead";
import { LoadingState } from "@/components/shared/LoadingState";

const tooltipStyle = {
  background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-line)", borderRadius: 8,
  fontSize: 11, color: "var(--tooltip-ink)", padding: "8px 10px",
};

/** A gap wider than this breaks the line: 5 × the usual interval, at least GAP_MS. */
function gapFor(ts: number[]): number {
  if (ts.length < 3) return GAP_MS;
  const steps = ts.slice(1).map((t, i) => t - ts[i]).filter((d) => d > 0).sort((a, b) => a - b);
  return Math.max(GAP_MS, (steps[Math.floor(steps.length / 2)] ?? 0) * 5);
}

function extent(v: number[]): readonly [number, number] {
  if (!v.length) return [0, 1];
  let lo = Math.min(...v), hi = Math.max(...v);
  const min = Math.max(1, Math.abs((lo + hi) / 2) * 0.02);
  if (hi - lo < min) { const mid = (lo + hi) / 2; lo = mid - min / 2; hi = mid + min / 2; }
  return [lo, hi];
}

/**
 * [startIso, endIso] for a period's read. Hour and Day: the period, ended at
 * now (5-minute steps). Week and longer: the whole period, so the read keeps
 * one key all day — an end that moved every five minutes started a week's
 * slow read over each time it passed a mark (21 Oct 2026). The cache behind
 * it (pointsCentral fastSeries) re-reads a window that reaches past now
 * every ten minutes, so new hours still arrive.
 */
export function periodReadRange(period: Period): [string, string] {
  const end = isRaw(period.range) ? Math.min(period.to, Math.ceil(Date.now() / 300_000) * 300_000) : period.to;
  return [new Date(period.from).toISOString(), new Date(end).toISOString()];
}

export function PeriodSeries({ tag, label, unit, color, period, height = 220, signed = false }: {
  tag: string | null;
  label: string;
  unit: string;
  color: string;
  period: Period;
  height?: number;
  /** Signed values (power: − charging): 0 stays in view. */
  signed?: boolean;
}) {
  const [startIso, endIso] = periodReadRange(period);
  const [q] = usePointHistories(tag ? [tag] : [], startIso, endIso);
  const rows = useMemo(
    () => (q?.data ?? []).map((e) => ({ ts: Date.parse(e.t), v: e.value })).filter((r) => !Number.isNaN(r.ts)),
    [q?.data],
  );
  const values = useMemo(() => rows.map((r) => r.v), [rows]);
  const isDay = period.range === "day";
  const kind = useMemo(() => kindOf(unit, values), [unit, values]);
  const buckets = useMemo(
    () => (isDay ? [] : withRange(aggregate(rows.map((r) => ({ ts: r.ts, value: r.v })), bucketsOf(period), kind))),
    [isDay, rows, period, kind],
  );
  const [lo, hi] = extent(values);
  const ticks = useStableTicks(signed ? rangeTicks(Math.min(0, lo), Math.max(0, hi)) : rangeTicks(lo, hi), `${tag}|${period.range}|${period.from}`);
  const plotted = useMemo(() => withGaps(rows, gapFor(rows.map((r) => r.ts))), [rows]);

  if (!tag) return <Empty height={height} text={`${label} has no stored history.`} />;
  if (!q || q.isLoading) return <div style={{ height }}><LoadingState rows={3} /></div>;
  if (q.isError) return <Empty height={height} text="Could not read this parameter. Try again in a moment." />;
  if (!rows.length) return <Empty height={height} text={`No readings for ${period.label}.`} />;

  if (!isDay) return <BucketChart buckets={buckets} kind={kind} color={color} unit={unit} period={period} height={height} signed={signed} />;

  return (
    <div style={{ position: "relative" }} data-chart>
      <AxisUnit unit={unit} />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={plotted} margin={PLOT_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
          <XAxis {...xAxis} {...timeAxisProps(rows, [period.from, period.to])} />
          <YAxis {...yAxis} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={tickLabel} />
          {signed && <ReferenceLine y={0} stroke="var(--chart-ref)" strokeDasharray="4 4" />}
          <Tooltip contentStyle={tooltipStyle} labelFormatter={timeTooltipLabel}
            formatter={(v) => [`${typeof v === "number" ? String(Number(v.toPrecision(7))) : v}${unit ? ` ${unit}` : ""}`, label]} />
          <Line type={kind === "flag" ? "stepAfter" : "monotone"} dataKey="v" name={label} stroke={color} strokeWidth={1.8}
            dot={rows.length < 3} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Empty({ height, text }: { height: number; text: string }) {
  return <div style={{ height, display: "grid", placeItems: "center", fontSize: 12, color: "var(--muted)" }}>{text}</div>;
}
