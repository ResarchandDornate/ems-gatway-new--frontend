"use client";

/**
 * The Week / Month / Year chart bodies, shared by every graph that uses
 * PeriodNav (see lib/charts/period.ts for the buckets and how they aggregate).
 *
 *   BucketChart  one parameter: a measurement is a capsule from the bucket's
 *                lowest to highest reading with a dot at the average (Apple
 *                Health's range bars); a counter is a bar of how much it rose;
 *                a flag is a bar on the buckets it was ever on.
 *   BucketBars   one or more totals per bucket side by side — charge and
 *                discharge energy, revenue — already summed by the caller.
 *
 * A bucket with no reading is a gap on the axis, never a zero. Tooltips carry
 * the figures only.
 */

import type { ReactNode } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceArea } from "recharts";
import type { BucketValue, Kind, Period } from "@/lib/charts/period";
import { PLOT_MARGIN, rangeTicks, zeroBasedTicks, tickLabel, xAxis, yAxis } from "@/lib/charts/axes";
import { useStableTicks } from "@/lib/charts/stable";
import { AxisUnit } from "@/components/dashboard/viz/ChartCardHead";
import { bucketLabelAt, bucketWindow, ghostLabel, useHoverSync } from "./HoverSync";

/**
 * A bucket chart's part in the page's shared hover (HoverSync): hovering a
 * bar publishes its hour / day / month; another chart's hover shades the
 * bucket holding it. Nothing outside a HoverSyncProvider.
 */
function useBucketHover(period: Period, labels: string[]) {
  const { hover, own, publish, clear } = useHoverSync();
  const handlers = {
    onMouseMove: (e: { activeLabel?: unknown } | null) => {
      const l = e?.activeLabel;
      const w = l == null ? null : bucketWindow(period, String(l));
      if (w) publish(w.from, w.to);
    },
    onMouseLeave: clear,
  };
  const shaded = hover && !own ? bucketLabelAt(period, labels, hover.from) : null;
  return { handlers, shaded };
}

const GRID = "var(--chart-grid)";
/* The same band the hovered chart's own cursor draws. */
const SHADE = { fill: GRID, fillOpacity: 0.5, stroke: "none" };
const tooltipStyle = {
  background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-line)", borderRadius: 8,
  fontSize: 11, color: "var(--tooltip-ink)", padding: "8px 10px",
};

export type BucketRow = BucketValue & { range: [number, number] | null };

/** Adds the [min, max] pair the capsule draws from. */
export const withRange = (b: BucketValue[]): BucketRow[] =>
  b.map((x) => ({ ...x, range: x.min != null && x.max != null ? [x.min, x.max] : null }));

const num7 = (v: number) => String(Number(v.toPrecision(7)));
/** Decimals a reading carries (24.3 → 1), for stating an average one place finer, not fifteen. */
const decimalsOf = (v: number) => (String(Number(v.toPrecision(7))).split(".")[1] ?? "").length;

/** At least 2% of the level (and 1): a near-flat reading should look flat. */
function extent(v: number[]): readonly [number, number] {
  if (!v.length) return [0, 1];
  let lo = Math.min(...v), hi = Math.max(...v);
  const min = Math.max(1, Math.abs((lo + hi) / 2) * 0.02);
  if (hi - lo < min) { const mid = (lo + hi) / 2; lo = mid - min / 2; hi = mid + min / 2; }
  return [lo, hi];
}

/** One capsule: nothing for an empty bucket, at least 4 px tall so a flat one stays visible. */
function RangeCapsule(props: unknown) {
  const { x, y, width, height, fill, fillOpacity, payload } = props as {
    x: number; y: number; width: number; height: number; fill: string; fillOpacity: number; payload: BucketRow;
  };
  if (!payload?.range || !Number.isFinite(y) || !Number.isFinite(height)) return <g />;
  const h = Math.max(Math.abs(height), 4);
  const top = Math.min(y, y + height) - (h - Math.abs(height)) / 2;
  const w = Math.min(width, 14);
  return <rect x={x + (width - w) / 2} y={top} width={w} height={h} rx={w / 2} fill={fill} fillOpacity={fillOpacity} />;
}

/* Every bucket labelled — each date of a Month, each month of a Year. Past
   14 the labels alternate between two rows, so a 31-day month stays legible
   on a narrow card. */
function StaggerTick({ x, y, payload, index }: { x?: number; y?: number; payload?: { value?: string | number }; index?: number }) {
  return (
    <text x={x} y={(y ?? 0) + ((index ?? 0) % 2 ? 22 : 10)} textAnchor="middle"
      fill={xAxis.tick.fill} fontSize={xAxis.tick.fontSize}>
      {payload?.value}
    </text>
  );
}
const xFor = (n: number) => ({
  ...xAxis, dataKey: "label", interval: 0 as const, minTickGap: 0,
  /* Two rows only for a month's 28–31 dates; a day's 24 two-digit hours fit
     one row at a smaller size. */
  ...(n > 24 ? { tick: <StaggerTick />, height: 34, tickMargin: 0 }
    : n > 14 ? { tick: { ...xAxis.tick, fontSize: 9 } } : {}),
});

export function BucketChart({ buckets, kind, color, unit, period, height = 240, signed = false, hideLabels = false }: {
  buckets: BucketRow[]; kind: Kind; color: string; unit: string; period: Period;
  height?: number;
  /** Keep the categories but print no labels — for the upper charts of a stack whose bottom chart carries them. */
  hideLabels?: boolean;
  /** Signed values (battery power: − charging) — the axis keeps 0 in view. */
  signed?: boolean;
}) {
  const vals = buckets.flatMap((b) => kind === "measure" ? [b.min, b.max] : kind === "counter" ? [b.avg] : [b.max])
    .filter((v): v is number => typeof v === "number");
  const [lo, hi] = extent(vals);
  const ticks = useStableTicks(
    kind === "flag" ? [0, 1]
      : kind === "counter" ? rangeTicks(0, Math.max(1, ...vals))
        : signed ? rangeTicks(Math.min(0, lo), Math.max(0, hi)) : rangeTicks(lo, hi),
    `${period.range}|${period.from}|${kind}`,
  );
  const many = buckets.length > 14;
  const { handlers, shaded } = useBucketHover(period, buckets.map((b) => b.label));
  /* One bucket's figures: the tooltip, and the box mirrored onto this chart when another is hovered. */
  const tip = (b: BucketRow) => {
    const u = unit ? ` ${unit}` : "";
    return (
      <div style={tooltipStyle}>
        {b.n === 0 ? <div>No Readings</div>
          : kind === "measure" ? (
            <>
              <div>Range {num7(b.min!)}–{num7(b.max!)}{u}</div>
              <div>Avg {b.avg!.toFixed(Math.min(6, Math.max(decimalsOf(b.min!), decimalsOf(b.max!)) + 1))}{u}</div>
            </>
          ) : kind === "counter" ? (
            <div>{b.avg == null ? "—" : `+${num7(b.avg)}${u}`}</div>
          ) : (
            <div>{b.max ? "On" : "Off"}</div>
          )}
      </div>
    );
  };
  const shadedRow = shaded != null ? buckets.find((b) => b.label === shaded) : undefined;
  const flip = shaded != null && buckets.findIndex((b) => b.label === shaded) / Math.max(1, buckets.length) > 0.55;
  return (
    <div style={{ position: "relative" }} data-chart>
      <AxisUnit unit={kind === "flag" ? "" : unit} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={buckets} margin={PLOT_MARGIN} barCategoryGap={many ? "22%" : "38%"} {...handlers}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis {...xFor(buckets.length)} {...(hideLabels ? { tick: () => <g />, height: 6, tickMargin: 0 } : {})} />
          <YAxis {...yAxis} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks}
            tickFormatter={kind === "flag" ? (v: number) => (v === 1 ? "On" : v === 0 ? "Off" : "") : tickLabel} />
          {shaded != null && <ReferenceArea x1={shaded} x2={shaded} {...SHADE} ifOverflow="visible" />}
          <Tooltip
            cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
            content={({ active, payload }) => {
              const b = active ? (payload?.[0]?.payload as BucketRow | undefined) : undefined;
              return b ? tip(b) : null;
            }}
          />
          {kind === "measure" && (
            <Bar dataKey="range" fill={color} fillOpacity={0.35} shape={RangeCapsule} isAnimationActive animationDuration={250} />
          )}
          {kind === "measure" && (
            <Line dataKey="avg" stroke="none" dot={{ r: many ? 2 : 3, fill: color, stroke: color }} activeDot={{ r: 4 }} isAnimationActive={false} />
          )}
          {kind === "counter" && <Bar dataKey="avg" fill={color} radius={[4, 4, 0, 0]} isAnimationActive animationDuration={250} />}
          {kind === "flag" && <Bar dataKey="max" fill={color} radius={[4, 4, 0, 0]} isAnimationActive animationDuration={250} />}
          {/* Last, so the mirrored box sits over the bars. */}
          {shadedRow && <ReferenceArea x1={shaded!} x2={shaded!} fillOpacity={0} stroke="none" ifOverflow="visible" label={ghostLabel(tip(shadedRow), flip)} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}


/** When a period has more buckets than fit a narrow card (a day's hours, a
 *  month's dates), the strip keeps a minimum width per bucket and scrolls
 *  horizontally inside the card with no visible scrollbar (.no-scrollbar).
 *  Few buckets fill the card as before, with no scroll. */
function ScrollPlot({ count, children }: { count: number; children: ReactNode }) {
  const minW = count > 10 ? count * 36 : 0;
  return (
    <div className="no-scrollbar" style={{ overflowX: "auto", overflowY: "hidden" }}>
      <div style={{ width: "100%", minWidth: minW ? `${minW}px` : undefined }}>{children}</div>
    </div>
  );
}

export interface BarSeries { key: string; name: string; color: string }

/**
 * Totals per bucket, side by side. `rows` carry `label` plus one number (or
 * null — no figure) per series key. `format` writes a value for the tooltip.
 */
export function BucketBars<T extends { label: string }>({ rows, series, unit, period, height = 240, format, legend = true }: {
  rows: T[]; series: BarSeries[]; unit: string; period: Period; height?: number;
  format?: (v: number) => string;
  /** Off where the card already names the series above the plot. */
  legend?: boolean;
}) {
  const vals = rows.flatMap((r) => series.map((s) => (r as Record<string, unknown>)[s.key]))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const ticks = useStableTicks(zeroBasedTicks(Math.max(1, ...vals)), `${period.range}|${period.from}|bars`);
  const { handlers, shaded } = useBucketHover(period, rows.map((r) => r.label));
  /* One bucket's figures: the tooltip, and the box mirrored onto this chart when another is hovered. */
  const tip = (r: Record<string, unknown>) => {
    const shown = series.filter((s) => typeof r[s.key] === "number");
    const head = typeof r.label === "string" ? (period.range === "day" ? `${r.label}:00` : r.label) : "";
    return (
      <div style={tooltipStyle}>
        {/* Which bar: the hour, day or month it stands for. */}
        {typeof r.label === "string" && <div style={{ fontWeight: 600, marginBottom: 4 }}>{head}</div>}
        {shown.length === 0 ? <div>No Data</div>
          : shown.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color, flex: "0 0 auto" }} />
              <span>{s.name} {fmt(r[s.key] as number)}</span>
            </div>
          ))}
      </div>
    );
  };
  const shadedRow = shaded != null ? (rows.find((r) => r.label === shaded) as Record<string, unknown> | undefined) : undefined;
  const flip = shaded != null && rows.findIndex((r) => r.label === shaded) / Math.max(1, rows.length) > 0.55;
  const fmt = format ?? ((v: number) => `${num7(Math.round(v * 10) / 10)}${unit ? ` ${unit}` : ""}`);
  return (
    <div style={{ position: "relative" }} data-chart>
      <AxisUnit unit={unit} />
      <ScrollPlot count={rows.length}>
        <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={PLOT_MARGIN} barCategoryGap={rows.length > 14 ? "18%" : "30%"} barGap={2} {...handlers}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis {...xFor(rows.length)} tickFormatter={period.range === "day" ? (v: string) => `${v}:00` : undefined} />
          <YAxis {...yAxis} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={tickLabel} />
          {shaded != null && <ReferenceArea x1={shaded} x2={shaded} {...SHADE} ifOverflow="visible" />}
          <Tooltip
            cursor={{ fill: "var(--chart-grid)", opacity: 0.5 }}
            content={({ active, payload }) => {
              const r = active ? (payload?.[0]?.payload as Record<string, unknown> | undefined) : undefined;
              return r ? tip(r) : null;
            }}
          />
          {legend && series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" iconSize={8} />}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} isAnimationActive animationDuration={250} />
          ))}
          {shadedRow && <ReferenceArea x1={shaded!} x2={shaded!} fillOpacity={0} stroke="none" ifOverflow="visible" label={ghostLabel(tip(shadedRow), flip)} />}
        </ComposedChart>
      </ResponsiveContainer>
      </ScrollPlot>
    </div>
  );
}
