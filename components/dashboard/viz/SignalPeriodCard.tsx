"use client";

/**
 * A dashboard card for one battery signal over Day / Week / Month / Year: one
 * line per BESS on every range — the curve itself, not a bar per day — read
 * from the fast-stream history (`fast:<bess>:<group>::<signal>`), with the
 * newest value per BESS in the readings row. The dashboard's second chart
 * row: State Of Health, Average Temperature and Current.
 */

import { memo, useMemo } from "react";
import { sameProps } from "@/lib/charts/sameProps";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ReferenceDot } from "recharts";
import { PeriodNav, useSwipe } from "@/components/charts/PeriodNav";
import { useCardPeriod } from "@/components/charts/SharedPeriod";
import { periodReadRange } from "@/components/charts/PeriodSeries";
import { usePointHistories } from "@/hooks/useDataAnalysis";
import { chartTokens, cursorStyle, series, tooltipStyle } from "@/lib/charts/tokens";
import { PLOT_MARGIN, rangeTicks, symmetricTicks, tickLabel, xAxis, yAxis } from "@/lib/charts/axes";
import { useStableTicks } from "@/lib/charts/stable";
import { timeAxisProps, timeTooltipLabel, withGaps, GAP_MS } from "@/lib/charts/timeAxis";
import { AxisUnit, ChartCardHead, Reading } from "./ChartCardHead";
import { ReadingsRow, type Cabinet } from "./PeriodCurves";
import { NearestTooltip } from "@/components/charts/NearestTooltip";
import { HoverStamp, ghostMark, hoverStamp, timeHoverHandlers, useHoverSync, valueIn } from "@/components/charts/HoverSync";

type Pt = { ts: number; v: number | null };

/** A line breaks at 5 × its usual spacing, at least GAP_MS. */
function gapFor(rows: { ts: number }[]): number {
  if (rows.length < 3) return GAP_MS;
  const steps = rows.slice(1).map((r, i) => r.ts - rows[i].ts).filter((d) => d > 0).sort((a, b) => a - b);
  return Math.max(GAP_MS, (steps[Math.floor(steps.length / 2)] ?? 0) * 5);
}


function SignalPeriodCardView({ title, cabinets, signal, group = "bms_values", unit, decimals = 1, domain, signed = false, tagOf, color }: {
  title: string;
  /** Overrides the fast-stream tag, e.g. an S2 point (`<asset>::<point>`). */
  tagOf?: (c: Cabinet) => string;
  cabinets: Cabinet[];
  /** The fast-stream signal, e.g. `soh`, `average_temperature`. */
  signal: string;
  group?: "bms_values" | "pcs_values";
  unit: string;
  decimals?: number;
  /** A fixed axis (SOH 0–100); otherwise it fits the data. */
  domain?: [number, number];
  /** Keeps 0 in view and centred (current: − charge / + discharge). */
  signed?: boolean;
  /** Line + swatch colour; each card a different one. Defaults to the primary series. */
  color?: string;
}) {
  const { nav, shared } = useCardPeriod("day");
  const swipe = useSwipe(nav);
  const { period, latest } = nav;
  const [startIso, endIso] = periodReadRange(period);
  const hist = usePointHistories(
    cabinets.map((c) => (tagOf ? tagOf(c) : `fast:${c.bessId}:${group}::${signal}`)), startIso, endIso,
  );
  const loading = hist.some((q) => q.isLoading);
  const key = hist.map((q) => `${q.data?.length ?? -1}:${q.dataUpdatedAt}`).join("|");
  const lineColor = color ?? series("primary").stroke;

  /* One line: the mean across the selected BESS at each sampled time. The
     cabinets read the same windows, so points align; where only some report a
     time, the mean is over those present. */
  const avg = useMemo(() => {
    const byTs = new Map<number, number[]>();
    for (const q of hist) {
      for (const e of q.data ?? []) {
        const ts = Date.parse(e.t);
        if (Number.isNaN(ts) || ts < period.from || ts >= period.to) continue;
        if (e.value == null || !Number.isFinite(e.value)) continue;
        const arr = byTs.get(ts); if (arr) arr.push(e.value); else byTs.set(ts, [e.value]);
      }
    }
    const pts: Pt[] = [...byTs.entries()].sort((a, b) => a[0] - b[0])
      .map(([ts, vs]) => ({ ts, v: vs.reduce((a, b) => a + b, 0) / vs.length }));
    return withGaps(pts, gapFor(pts));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, period.from, period.to]);

  const all = avg;
  const vals = all.map((p) => p.v).filter((v): v is number => v != null && Number.isFinite(v));
  const rawTicks = domain
    /* A fixed range in five even steps: 0–50 °C reads 0, 10 … 50. */
    ? Array.from({ length: 6 }, (_, k) => domain[0] + ((domain[1] - domain[0]) * k) / 5)
    : signed
      ? symmetricTicks(Math.max(1, ...vals.map((v) => Math.abs(v))))
      : rangeTicks(vals.length ? Math.min(...vals) : 0, vals.length ? Math.max(...vals) : 1);
  const ticks = useStableTicks(rawTicks, `${title}|${period.range}|${period.from}`);
  const span: [number, number] = [period.from, latest ? Math.min(period.to, Date.now()) : period.to];

  /* The newest average for the readings row — or, while any chart on the page
     is hovered, the average at that moment (HoverSync). */
  const { hover, own, publish, clear } = useHoverSync();
  const gap = gapFor(avg.filter((x) => x.v != null));
  const newest: number | null = hover
    ? valueIn(avg, hover, gap)
    : (() => { for (let k = avg.length - 1; k >= 0; k--) if (avg[k].v != null) return avg[k].v as number; return null; })();
  const mark = hover && !own && hover.to >= period.from && hover.from < period.to ? hover : null;

  return (
    <div className="surface-card chart-card" style={{ padding: "var(--pad-sm) var(--pad)", position: "relative" }}>
      <ChartCardHead title={title} />
      {!shared && <PeriodNav state={nav} />}
      <ReadingsRow>
        <HoverStamp hover={hover} />
        <Reading swatch={lineColor} label={cabinets.length > 1 ? "Average" : "Now"}
          value={newest == null ? "—" : `${newest.toFixed(decimals)} ${unit}`} />
      </ReadingsRow>
      <div className="chart-body" {...swipe} style={{ ...swipe.style, position: "relative" }}>
        <AxisUnit unit={unit} />
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={PLOT_MARGIN} {...timeHoverHandlers(publish, clear)}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.grid} vertical={false} />
            <XAxis {...xAxis} {...timeAxisProps(all, span)} />
            <YAxis {...yAxis} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={tickLabel} />
            {signed && <ReferenceLine y={0} stroke={chartTokens.reference} strokeDasharray="4 3" />}
            {/* Another chart's hovered moment: its instant, or its bar's span. */}
            {mark && mark.from === mark.to && <ReferenceLine x={mark.from} stroke={cursorStyle.stroke} strokeDasharray={cursorStyle.strokeDasharray} ifOverflow="hidden" />}
            {mark && mark.from !== mark.to && <ReferenceArea x1={mark.from} x2={mark.to} fill={chartTokens.grid} fillOpacity={0.5} stroke="none" ifOverflow="hidden" />}
            {mark && mark.from === mark.to && newest != null && (
              <ReferenceDot x={mark.from} y={newest} r={4} fill={lineColor} stroke="var(--surface, #fff)" strokeWidth={1.5} ifOverflow="hidden" />
            )}
            {/* The average nearest the hovered time. */}
            <Tooltip cursor={cursorStyle} content={(p) => (
              <NearestTooltip active={p.active} label={p.label as number | undefined}
                maxGapMs={gap}
                fmt={(v) => v.toFixed(decimals)}
                lines={[{ name: cabinets.length > 1 ? "Average" : title, color: lineColor, unit, data: avg }]} />
            )} />
            <Line data={avg} dataKey="v" type="monotone"
              name={cabinets.length > 1 ? "Average" : title}
              stroke={lineColor} strokeWidth={2} dot={false} isAnimationActive={false}
              activeDot={{ r: 4 }} />
            {mark && ghostMark(mark, span, hoverStamp(mark), newest == null ? [] : [{
              name: cabinets.length > 1 ? "Average" : title, color: lineColor, value: `${newest.toFixed(decimals)} ${unit}`,
            }])}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {loading && (
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none",
          fontSize: 12, fontWeight: 600, color: "var(--muted)",
        }}>
          Loading…
        </div>
      )}
    </div>
  );
}

/* Memoised by value: the dashboard re-renders on every poll and hands these
   fresh-but-identical props (see lib/charts/sameProps). */
export const SignalPeriodCard = memo(SignalPeriodCardView, sameProps);
