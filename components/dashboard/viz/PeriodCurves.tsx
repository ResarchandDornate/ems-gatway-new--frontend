"use client";

/**
 * The dashboard's State Of Charge and Power cards on Day / Week / Month / Year
 * (PeriodNav), opening on Day.
 *
 *   Hour / Day,  the live rows PerStation already reads (fast stream from
 *   latest       midnight, S2 as fallback): SOC one line per cabinet, power
 *                one stepped line summed over the selection.
 *   Hour / Day,  the same lines from the fast-stream history of that window.
 *   past
 *   Week and up  the same lines again, from the thinned history: a sample
 *                every half hour or so, joined straight (not stepped — a
 *                step would claim the power held between samples).
 *
 * History reads use the fast-stream tags Single Station Data uses
 * (`fast:<bess>:bms_values::display_soc`, `fast:<bess>:pcs_values::total_active_power`).
 * Power is + discharge / − charge throughout.
 */

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { sameProps } from "@/lib/charts/sameProps";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, ReferenceDot,
} from "recharts";
import { HoverStamp, ghostMark, hoverStamp, timeHoverHandlers, useHoverSync, valueIn, type HoverWindow } from "@/components/charts/HoverSync";
import { PeriodNav, useSwipe, type PeriodState } from "@/components/charts/PeriodNav";
import { useCardPeriod } from "@/components/charts/SharedPeriod";
import { periodReadRange } from "@/components/charts/PeriodSeries";
import { isRaw, type Period } from "@/lib/charts/period";
import { chartTokens, cursorStyle, series, tooltipStyle } from "@/lib/charts/tokens";
import { AreaGradient } from "@/lib/charts/AreaGradient";
import { PLOT_MARGIN, symmetricTicks, tickLabel, xAxis, yAxis } from "@/lib/charts/axes";
import { useNow, useStableTicks } from "@/lib/charts/stable";
import { timeAxisProps, timeTooltipLabel, withGaps, GAP_MS } from "@/lib/charts/timeAxis";

/** A gap is 5 × the usual spacing, at least GAP_MS: today's live rows are
 *  seconds apart, a past day's history ~30 min apart. */
function gapFor(rows: { ts: number }[]): number {
  if (rows.length < 3) return GAP_MS;
  const steps = rows.slice(1).map((r, i) => r.ts - rows[i].ts).filter((d) => d > 0).sort((a, b) => a - b);
  return Math.max(GAP_MS, (steps[Math.floor(steps.length / 2)] ?? 0) * 5);
}
import { usePointHistories } from "@/hooks/useDataAnalysis";
import type { PointHistoryEntry } from "@/lib/api/types";
import type { S2RecentSeries } from "@/lib/api/services/dashboardCentral.service";
import { recentRows, type RecentRow } from "../recentWindow";
import { AxisUnit, ChartCardHead, Reading } from "./ChartCardHead";

export interface Cabinet { bessId: string; sourceId: string; label: string }

const socTag = (b: string) => `fast:${b}:bms_values::display_soc`;
const pwrTag = (b: string) => `fast:${b}:pcs_values::total_active_power`;
/** A past day's Power reads one sample every 30 minutes, like the other cards. */
const POWER_STEP_MS = 30 * 60_000;
const roleOf = (i: number) => (i % 2 === 0 ? "primary" : "secondary") as "primary" | "secondary";

const readingsOf = (d: PointHistoryEntry[] | undefined) =>
  (d ?? []).map((e) => ({ ts: Date.parse(e.t), value: e.value })).filter((r) => !Number.isNaN(r.ts));


/** The plot box's height, for the bucket charts (they take pixels, not 100%). */
export function useBoxHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setH(Math.floor(e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, h] as const;
}

/**
 * Everything a card needs for its period: the Day rows (live today, history
 * otherwise) and the Week / Month / Year histories per cabinet.
 */
function usePeriodData(period: Period, latest: boolean, cabinets: Cabinet[], todayRows: RecentRow[], tagOf: (b: string) => string, stepMs?: number) {
  const isDay = isRaw(period.range);
  const live = isDay && latest;
  const [startIso, endIso] = periodReadRange(period);
  const hist = usePointHistories(live ? [] : cabinets.map((c) => tagOf(c.bessId)), startIso, endIso, stepMs);
  const datas = hist.map((q) => q.data);
  const key = datas.map((d) => d?.length ?? -1).join(",") + "|" + hist.map((q) => q.dataUpdatedAt).join(",");

  const dayRows = useMemo(() => {
    if (live) return period.range === "hour" ? todayRows.filter((r) => r.ts >= period.from) : todayRows;
    const isSoc = tagOf("x") === socTag("x");
    const seriesBySource: Record<string, S2RecentSeries> = {};
    cabinets.forEach((c, i) => {
      const pts = readingsOf(datas[i]);
      seriesBySource[c.sourceId] = isSoc ? { soc: pts, power: [] } : { soc: [], power: pts };
    });
    return recentRows(seriesBySource, cabinets).rows.filter((r) => r.ts >= period.from && r.ts < period.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDay, live, todayRows, key, period.from, period.to, cabinets.map((c) => c.bessId).join(",")]);

  const loading = hist.some((q) => q.isLoading);
  return { isDay, live, dayRows, datas, key, loading };
}

/** The readings under the period row; holds its height when empty so the
 *  plots of a row of cards start level. */
export function ReadingsRow({ children }: { children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", minHeight: 22, margin: "10px 0 4px" }}>
      {children}
    </div>
  );
}

function CardShell({ title, readings, nav, shared = false, loading, children }: {
  title: string; readings?: React.ReactNode; nav: PeriodState; shared?: boolean; loading?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="surface-card chart-card" style={{ padding: "var(--pad-sm) var(--pad)", position: "relative" }}>
      {/* Title, range bar, period row, then the readings — the same order and
          heights as Energy Throughput, so the three range bars line up. */}
      <ChartCardHead title={title} />
      {!shared && <PeriodNav state={nav} />}
      <ReadingsRow>{readings}</ReadingsRow>
      {children}
      {/* A period's history can take a while; say so, so an empty plot only
          ever means no data. Clicks pass through to the period controls. */}
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

/** Newest non-null value of `key` in the rows, formatted; "—" if none. */
function latestOf(rows: RecentRow[], key: string, unit: string): string {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = (rows[i] as unknown as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return `${v.toFixed(1)}${unit}`;
  }
  return "—";
}

/** `key`'s value in the rows for a hovered window (HoverSync), formatted; "—" if none. */
function hoveredOf(rows: RecentRow[], key: string, unit: string, hover: HoverWindow, gapMs: number): string {
  const v = valueIn(rows.map((r) => ({ ts: r.ts, v: (r as unknown as Record<string, number | null>)[key] ?? null })), hover, gapMs);
  return v == null ? "—" : `${v.toFixed(1)}${unit}`;
}

/** Another chart's hovered moment inside this one's span, to mark; null when this chart is the one hovered. */
function markOf(hover: HoverWindow | null, own: boolean, span: [number, number]): HoverWindow | null {
  return hover && !own && hover.to >= span[0] && hover.from < span[1] ? hover : null;
}

function SocPeriodCardView({ cabinets, todayRows }: { cabinets: Cabinet[]; todayRows: RecentRow[] }) {
  const { nav, shared } = useCardPeriod("day");
  const swipe = useSwipe(nav);
  const { period, latest } = nav;
  const now = useNow(15_000);
  const [boxRef] = useBoxHeight();
  const { live, dayRows, loading } = usePeriodData(period, latest, cabinets, todayRows, socTag);
  const span: [number, number] = live ? [period.from, now] : [period.from, period.to];
  const gap = gapFor(dayRows);
  const gapped = useMemo(() => withGaps(dayRows, gapFor(dayRows)), [dayRows]);
  const { hover, own, publish, clear } = useHoverSync();
  const mark = markOf(hover, own, span);
  /* Waves on every range: the SOC curve itself across the day, week, month
     or year, one line per BESS — not a bar per day. */

  return (
    <CardShell
      title="State Of Charge"
      nav={nav}
      shared={shared}
      loading={loading}
      readings={hover || live ? <>
        <HoverStamp hover={hover} />
        {cabinets.map((c, i) => (
          <Reading key={c.bessId} swatch={series(roleOf(i)).stroke}
            label={cabinets.length > 1 ? c.label : "SOC"}
            value={hover ? hoveredOf(dayRows, `soc_${c.bessId}`, "%", hover, gap) : latestOf(dayRows, `soc_${c.bessId}`, "%")} />
        ))}
      </> : null}
    >
      <div ref={boxRef} className="chart-body" {...swipe} style={{ ...swipe.style, position: "relative" }}>
        {(
          <>
            <AxisUnit unit="%" />
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={gapped} margin={PLOT_MARGIN} {...timeHoverHandlers(publish, clear)}>
                <defs>
                  <AreaGradient id="dashSocFill-primary" role="primary" />
                  <AreaGradient id="dashSocFill-secondary" role="secondary" />
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.grid} vertical={false} />
                <XAxis {...xAxis} {...timeAxisProps(dayRows, span)} />
                <YAxis {...yAxis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={tickLabel} />
                <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} labelFormatter={timeTooltipLabel} formatter={(v, name) => [typeof v === "number" ? `${v.toFixed(1)}%` : "—", name]} />
                {mark && mark.from === mark.to && <ReferenceLine x={mark.from} stroke={cursorStyle.stroke} strokeDasharray={cursorStyle.strokeDasharray} ifOverflow="hidden" />}
                {mark && mark.from !== mark.to && <ReferenceArea x1={mark.from} x2={mark.to} fill={chartTokens.grid} fillOpacity={0.5} stroke="none" ifOverflow="hidden" />}
                {mark && mark.from === mark.to && cabinets.map((c, i) => {
                  const v = valueIn(dayRows.map((r) => ({ ts: r.ts, v: (r as unknown as Record<string, number | null>)[`soc_${c.bessId}`] ?? null })), mark, gap);
                  return v != null && <ReferenceDot key={c.bessId} x={mark.from} y={v} r={4} fill={series(roleOf(i)).stroke} stroke="var(--surface, #fff)" strokeWidth={1.5} ifOverflow="hidden" />;
                })}
                {cabinets.map((c, i) => (
                  <Area
                    key={c.bessId}
                    type="monotone"
                    dataKey={`soc_${c.bessId}`}
                    isAnimationActive={false}
                    name={cabinets.length > 1 ? `SOC · ${c.label}` : "SOC"}
                    stroke={series(roleOf(i)).stroke}
                    strokeWidth={2}
                    fill="none"
                    dot={false}
                    activeDot={{ r: 4, style: { filter: series(roleOf(i)).glow } }}
                  />
                ))}
                {mark && ghostMark(mark, span, hoverStamp(mark), cabinets.map((c, i) => ({
                  name: cabinets.length > 1 ? `SOC · ${c.label}` : "SOC", color: series(roleOf(i)).stroke,
                  value: hoveredOf(dayRows, `soc_${c.bessId}`, "%", mark, gap),
                })).filter((r) => r.value !== "—"))}
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </CardShell>
  );
}

/**
 * @param nowKw the live battery power the flow diagram shows (S1, summed over
 *   the selection) and `nowTs` its sample time: the "Now" reading and the
 *   line's last point, so the card and the flow agree.
 */
function PowerPeriodCardView({ cabinets, todayRows, nowKw = null, nowKwBySource = {}, nowTs = null }: {
  cabinets: Cabinet[]; todayRows: RecentRow[]; nowKw?: number | null;
  /** Each cabinet's power in the same samples as nowKw, by source id. */
  nowKwBySource?: Record<string, number | null>;
  nowTs?: number | null;
}) {
  const { nav, shared } = useCardPeriod("day");
  const swipe = useSwipe(nav);
  const { period, latest } = nav;
  const now = useNow(15_000);
  const [boxRef] = useBoxHeight();
  const { isDay, live, dayRows: periodRows, loading } = usePeriodData(period, latest, cabinets, todayRows, pwrTag, POWER_STEP_MS);
  const dayRows = useMemo(() => {
    const last = periodRows[periodRows.length - 1];
    if (!live || nowKw == null || nowTs == null || nowTs < period.from || (last && nowTs <= last.ts)) return periodRows;
    const t = new Date(nowTs).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
    const row = { ts: nowTs, t, power: nowKw } as RecentRow;
    for (const c of cabinets) row[`pwr_${c.bessId}`] = nowKwBySource[c.sourceId] ?? null;
    return [...periodRows, row];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodRows, live, nowKw, nowTs, period.from, cabinets.map((c) => `${c.sourceId}:${nowKwBySource[c.sourceId]}`).join(",")]);
  const span: [number, number] = live ? [period.from, now] : [period.from, period.to];
  const gap = gapFor(dayRows);
  const gapped = useMemo(() => withGaps(dayRows, gapFor(dayRows)), [dayRows]);
  const { hover, own, publish, clear } = useHoverSync();
  const mark = markOf(hover, own, span);
  /* Several cabinets: one line each, and their Total (drawn only where every
     cabinet has a reading — recentRows). One cabinet: its line alone. */
  const lines = cabinets.length > 1
    ? [
        ...cabinets.map((c, i) => ({ key: `pwr_${c.bessId}`, name: c.label, color: series(roleOf(i)).stroke, width: 1.5, opacity: 1 })),
        /* The sum, kept quiet: thinner, grey and drawn beneath the cabinets,
           so it frames them rather than drowning them out. */
        { key: "power", name: "Total", color: chartTokens.textMuted, width: 1.25, opacity: 0.75 },
      ]
    : [{ key: "power", name: "Power", color: series("secondary").stroke, width: 1.75, opacity: 1 }];
  const valueOf = (r: RecentRow, key: string) => (r as unknown as Record<string, number | null>)[key] ?? null;
  /* Signed power around 0, in round steps that fit the largest swing of any line. */
  const ticks = useStableTicks(symmetricTicks(
    Math.max(1, ...dayRows.flatMap((r) => lines.map((l) => Math.abs(valueOf(r, l.key) ?? 0)))),
  ), `${cabinets.map((c) => c.bessId).join(",")}|${period.from}`);

  return (
    <CardShell
      title="Power"
      nav={nav}
      shared={shared}
      loading={loading}
      readings={hover ? <>
        {/* While a chart is hovered: the power then. */}
        <HoverStamp hover={hover} />
        {lines.map((l) => <Reading key={l.key} swatch={l.color} label={l.name} value={hoveredOf(dayRows, l.key, " kW", hover, gap)} />)}
      </> : live ? <>
        {/* Now: the newest row — the flow diagram's samples when it has them,
            so the cabinets add up to the total. */}
        {lines.map((l) => (
          <Reading key={l.key} swatch={l.color} label={l.key === "power" ? (lines.length > 1 ? "Total Now" : "Now") : l.name}
            value={latestOf(dayRows, l.key, " kW")} />
        ))}
      </> : null}
    >
      <div ref={boxRef} className="chart-body" {...swipe} style={{ ...swipe.style, position: "relative" }}>
        {(
          <>
            <AxisUnit unit="kW" />
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={gapped} margin={PLOT_MARGIN} {...timeHoverHandlers(publish, clear)}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.grid} vertical={false} />
                <XAxis {...xAxis} {...timeAxisProps(dayRows, span)} />
                <YAxis {...yAxis} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={tickLabel} />
                <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} labelFormatter={timeTooltipLabel} formatter={(v, name) => [typeof v === "number" ? `${v.toFixed(1)} kW` : "—", name]}
                  itemSorter={(item) => lines.findIndex((l) => l.key === item.dataKey)} />
                <ReferenceLine y={0} stroke={chartTokens.reference} strokeDasharray="3 3" />
                {mark && mark.from === mark.to && <ReferenceLine x={mark.from} stroke={cursorStyle.stroke} strokeDasharray={cursorStyle.strokeDasharray} ifOverflow="hidden" />}
                {mark && mark.from !== mark.to && <ReferenceArea x1={mark.from} x2={mark.to} fill={chartTokens.grid} fillOpacity={0.5} stroke="none" ifOverflow="hidden" />}
                {mark && mark.from === mark.to && lines.map((l) => {
                  const v = valueIn(dayRows.map((r) => ({ ts: r.ts, v: valueOf(r, l.key) })), mark, gap);
                  return v != null && <ReferenceDot key={l.key} x={mark.from} y={v} r={4} fill={l.color} stroke="var(--surface, #fff)" strokeWidth={1.5} ifOverflow="hidden" />;
                })}
                {/* Broken at gaps. Stepped on Hour / Day, where samples are the
                    PCS's own refreshes and power is held between them; joined
                    straight on longer ranges, where they are samples. */}
                {/* Last in the legend, first on the canvas: the total sits underneath. */}
                {[...lines].reverse().map((l) => (
                  <Line
                    key={l.key}
                    type={isDay ? "stepAfter" : "linear"}
                    dataKey={l.key}
                    name={l.name}
                    isAnimationActive={false}
                    stroke={l.color}
                    strokeWidth={l.width}
                    strokeOpacity={l.opacity}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
                {mark && ghostMark(mark, span, hoverStamp(mark), lines.map((l) => ({ name: l.name, color: l.color, value: hoveredOf(dayRows, l.key, " kW", mark, gap) })).filter((r) => r.value !== "—"))}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </CardShell>
  );
}

/* Memoised by value: the dashboard re-renders on every poll and hands these
   fresh-but-identical props (see lib/charts/sameProps). */
export const SocPeriodCard = memo(SocPeriodCardView, sameProps);
export const PowerPeriodCard = memo(PowerPeriodCardView, sameProps);
