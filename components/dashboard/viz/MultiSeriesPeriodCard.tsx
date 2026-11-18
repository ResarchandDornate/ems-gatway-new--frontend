"use client";

/**
 * A dashboard card with several lines over Day / Week / Month / Year, each
 * line one quantity combined across the selected BESS: the hottest cell
 * (max of the cabinets' max), the coldest (min of their min), or a phase's
 * power (sum over the cabinets). The cabinets report at slightly different
 * instants, so readings are put on a common time grid first — one step is
 * 1/600 of the period, never under a minute — and combined per step.
 */

import { memo, useMemo } from "react";
import { sameProps } from "@/lib/charts/sameProps";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ReferenceDot } from "recharts";
import { PeriodNav, useSwipe } from "@/components/charts/PeriodNav";
import { useCardPeriod } from "@/components/charts/SharedPeriod";
import { periodReadRange } from "@/components/charts/PeriodSeries";
import { usePointHistories } from "@/hooks/useDataAnalysis";
import { chartTokens, cursorStyle, tooltipStyle } from "@/lib/charts/tokens";
import { PLOT_MARGIN, rangeTicks, symmetricTicks, tickLabel, xAxis, yAxis } from "@/lib/charts/axes";
import { useStableTicks } from "@/lib/charts/stable";
import { timeAxisProps, timeTooltipLabel, withGaps, GAP_MS } from "@/lib/charts/timeAxis";
import { AxisUnit, ChartCardHead, Reading } from "./ChartCardHead";
import { ReadingsRow, type Cabinet } from "./PeriodCurves";
import { HoverStamp, ghostMark, hoverStamp, timeHoverHandlers, useHoverSync, valueIn } from "@/components/charts/HoverSync";

export interface SeriesSpec {
  label: string;
  color: string;
  /** The history tag for one cabinet (fetchPointHistory). */
  tagOf: (c: Cabinet) => string;
  /** How the cabinets' readings at one instant become one value. */
  combine: "max" | "min" | "sum";
}

const combineAll = (vals: number[], how: SeriesSpec["combine"]) =>
  how === "max" ? Math.max(...vals) : how === "min" ? Math.min(...vals) : vals.reduce((a, b) => a + b, 0);

function MultiSeriesPeriodCardView({ title, cabinets, specs, unit, decimals = 1, signed = false, domain }: {
  title: string;
  cabinets: Cabinet[];
  specs: SeriesSpec[];
  unit: string;
  decimals?: number;
  /** Keeps 0 in view and centred (power: − charge / + discharge). */
  signed?: boolean;
  /** A fixed axis (battery temperature 0–50 °C); otherwise it fits the data. */
  domain?: [number, number];
}) {
  const { nav, shared } = useCardPeriod("day");
  const swipe = useSwipe(nav);
  const { period, latest } = nav;
  const [startIso, endIso] = periodReadRange(period);
  /* specs × cabinets tags, in that order. */
  const tags = specs.flatMap((s) => cabinets.map((c) => s.tagOf(c)));
  const hist = usePointHistories(tags, startIso, endIso);
  const loading = hist.some((q) => q.isLoading);
  const key = hist.map((q) => `${q.data?.length ?? -1}:${q.dataUpdatedAt}`).join("|");

  const plot = useMemo(() => {
    const step = Math.max(60_000, Math.floor((period.to - period.from) / 600));
    /* step index → per spec → per cabinet → readings in that step */
    const grid = new Map<number, number[][][]>();
    specs.forEach((_, si) => cabinets.forEach((_, ci) => {
      for (const e of hist[si * cabinets.length + ci]?.data ?? []) {
        const t = Date.parse(e.t);
        if (Number.isNaN(t) || t < period.from || t >= period.to || !Number.isFinite(e.value)) continue;
        const k = Math.floor((t - period.from) / step);
        let cell = grid.get(k);
        if (!cell) { cell = specs.map(() => cabinets.map(() => [] as number[])); grid.set(k, cell); }
        cell[si][ci].push(e.value);
      }
    }));
    const out = [...grid.entries()].sort((a, b) => a[0] - b[0]).map(([k, cell]) => {
      const row: Record<string, number | null> = { ts: period.from + k * step + step / 2 };
      specs.forEach((s, si) => {
        /* Every cabinet must have a reading in the step, or the sum would dip. */
        const per = cell[si].map((v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null));
        row[`s${si}`] = per.every((v) => v != null) ? combineAll(per as number[], s.combine) : null;
      });
      return row as { ts: number } & Record<string, number | null>;
    });
    const steps = out.slice(1).map((r, i) => r.ts - out[i].ts).sort((a, b) => a - b);
    const gap = Math.max(GAP_MS, (steps[Math.floor(steps.length / 2)] ?? 0) * 5);
    return { rows: withGaps(out, gap), gap };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, period.from, period.to, specs.length, cabinets.length]);
  const { rows, gap } = plot;

  const vals = rows.flatMap((r) => specs.map((_, i) => r[`s${i}`])).filter((v): v is number => typeof v === "number");
  const rawTicks = domain
    /* A fixed range in five even steps: 0–50 °C reads 0, 10 … 50. */
    ? Array.from({ length: 6 }, (_, k) => domain[0] + ((domain[1] - domain[0]) * k) / 5)
    : signed
    ? symmetricTicks(Math.max(1, ...vals.map((v) => Math.abs(v))))
    : rangeTicks(vals.length ? Math.min(...vals) : 0, vals.length ? Math.max(...vals) : 1);
  const ticks = useStableTicks(rawTicks, `${title}|${period.range}|${period.from}`);
  const span: [number, number] = [period.from, latest ? Math.min(period.to, Date.now()) : period.to];
  /* The newest value per line — or, while any chart on the page is hovered,
     each line's value at that moment (HoverSync). */
  const { hover, own, publish, clear } = useHoverSync();
  const newest = specs.map((_, i) => {
    if (hover) return valueIn(rows.map((r) => ({ ts: r.ts, v: r[`s${i}`] })), hover, gap);
    for (let r = rows.length - 1; r >= 0; r--) { const v = rows[r][`s${i}`]; if (typeof v === "number") return v; }
    return null;
  });
  const mark = hover && !own && hover.to >= period.from && hover.from < period.to ? hover : null;

  return (
    <div className="surface-card chart-card" style={{ padding: "var(--pad-sm) var(--pad)", position: "relative" }}>
      <ChartCardHead title={title} />
      {!shared && <PeriodNav state={nav} />}
      <ReadingsRow>
        <HoverStamp hover={hover} />
        {specs.map((s, i) => (
          <Reading key={s.label} swatch={s.color} label={s.label}
            value={newest[i] == null ? "—" : `${newest[i]!.toFixed(decimals)} ${unit}`} />
        ))}
      </ReadingsRow>
      <div className="chart-body" {...swipe} style={{ ...swipe.style, position: "relative" }}>
        <AxisUnit unit={unit} />
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={PLOT_MARGIN} {...timeHoverHandlers(publish, clear)}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.grid} vertical={false} />
            <XAxis {...xAxis} {...timeAxisProps(rows, span)} />
            <YAxis {...yAxis} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={tickLabel} />
            {signed && <ReferenceLine y={0} stroke={chartTokens.reference} strokeDasharray="4 3" />}
            {/* Another chart's hovered moment: its instant, or its bar's span. */}
            {mark && mark.from === mark.to && <ReferenceLine x={mark.from} stroke={cursorStyle.stroke} strokeDasharray={cursorStyle.strokeDasharray} ifOverflow="hidden" />}
            {mark && mark.from !== mark.to && <ReferenceArea x1={mark.from} x2={mark.to} fill={chartTokens.grid} fillOpacity={0.5} stroke="none" ifOverflow="hidden" />}
            {mark && mark.from === mark.to && specs.map((s, i) => newest[i] != null && (
              <ReferenceDot key={s.label} x={mark.from} y={newest[i]!} r={4} fill={s.color} stroke="var(--surface, #fff)" strokeWidth={1.5} ifOverflow="hidden" />
            ))}
            <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} labelFormatter={timeTooltipLabel}
              formatter={(v, name) => [typeof v === "number" ? `${v.toFixed(decimals)} ${unit}` : "—", name]} />
            {specs.map((s, i) => (
              <Line key={s.label} dataKey={`s${i}`} name={s.label} type="monotone"
                stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4 }} />
            ))}
            {mark && ghostMark(mark, span, hoverStamp(mark), specs.flatMap((s, i) => newest[i] == null ? [] : [{
              name: s.label, color: s.color, value: `${newest[i]!.toFixed(decimals)} ${unit}`,
            }]))}
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
export const MultiSeriesPeriodCard = memo(MultiSeriesPeriodCardView, sameProps);
