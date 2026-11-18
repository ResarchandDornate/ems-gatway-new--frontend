"use client";

/**
 * Cell drift — the trend the cell map cannot show.
 *
 * The map beside this renders the pack as it is right now, and a cell sitting
 * 30 mV below the mean looks identical whether it is failing or merely lowest
 * at this SOC. Only time separates them, so this panel is where the time goes:
 *
 *   PERSISTENCE  how often each cell has held the pack minimum across the
 *                stored window. At 260 cells somebody is always lowest — the
 *                finding is a cell that is lowest almost always.
 *   DRIFT        the examined cell's distance from the pack average, with a
 *                least-squares slope through it in mV per week.
 *
 * Both come from cellTrend.service.ts, which reads six stored signals however
 * large the pack is. See its header for why it is six and not two hundred and
 * sixty.
 *
 * ── What this panel refuses to say ─────────────────────────────────────────
 * It never labels the window with a period it did not measure.
 * `/api/storage/points` takes no time range, so the covered span is whatever
 * the most recent rows happen to reach back to, and the header states that
 * measured span and the cadence it was sampled at. A slope per week fitted
 * over four hours is shown with the four hours next to it, so nobody reads a
 * six-week conclusion off an afternoon.
 */

import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import type { CellTrend } from "@/lib/api/services/cellTrend.service";
import type { CellData } from "@/lib/api/types";
import { chartTokens, axisProps, cursorStyle, tooltipStyle } from "@/lib/charts/tokens";
import { timeAxisProps, timeTooltipLabel, withGaps } from "@/lib/charts/timeAxis";
import { isLatest } from "@/lib/charts/period";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { BucketChart } from "@/components/charts/BucketChart";
import { LoadingState } from "@/components/shared/LoadingState";
import { useCellDriftPeriod, gapFor } from "../periodHistory";
import { CELL_DRIFT_THRESHOLD_MV, isDriftIssue, driftAxisDomain, driftAxisTicks } from "@/lib/energy/cellDrift";

/** A span in ms, said the way a person would say it. */
function humanSpan(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  const d = h / 24;
  return d < 14 ? `${d.toFixed(1)} days` : `${(d / 7).toFixed(1)} weeks`;
}

const dt = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" | "good" }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.04em", color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums",
        color: tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--accent)" : tone === "good" ? "var(--good)" : "var(--ink)",
      }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Whether a drift is an issue. Only at |drift| ≥ 100 mV (lib/energy/cellDrift,
 * the one place the threshold lives); below that the figures are shown as
 * readings with no warning colour, and nothing is called "out of family".
 * How often a cell held the minimum is still shown, as information — it is not
 * a voltage and does not raise an issue on its own.
 */
function verdict(mv: number | null | undefined): { tone: "bad" | undefined; text: string | null } {
  return isDriftIssue(mv)
    ? { tone: "bad", text: `Drift ≥ ${CELL_DRIFT_THRESHOLD_MV} mV` }
    : { tone: undefined, text: null };
}

const signedMv = (mv: number) => `${mv > 0 ? "+" : ""}${mv} mV`;

/**
 * The pack against its own average at ONE instant: the cell voltages the
 * pack layout draws. The trend's figures mix S1's extremes with S2's average
 * a snapshot apart, which put the "worst" cell at +2 mV beside a traced cell
 * at +8 mV on the same card.
 */
function snapshotStats(cells: CellData[] | undefined) {
  const vs = (cells ?? [])
    .map((c) => ({ no: Number(/(\d+)$/.exec(c.cellId)?.[1] ?? 0), mv: c.voltMv }))
    .filter((c): c is { no: number; mv: number } => c.mv != null && c.no > 0);
  if (!vs.length) return null;
  const mean = vs.reduce((a, c) => a + c.mv, 0) / vs.length;
  const dev = new Map(vs.map((c) => [c.no, Math.round((c.mv - mean) * 10) / 10]));
  let worst = vs[0], lowest = vs[0];
  for (const c of vs) {
    if (Math.abs(c.mv - mean) > Math.abs(worst.mv - mean)) worst = c;
    if (c.mv < lowest.mv) lowest = c;
  }
  return { dev, worstNo: worst.no, worstMv: dev.get(worst.no)!, lowestNo: lowest.no };
}

export function CellDriftPanel({
  trend, loading, onSelectCell, sourceId = "", cells,
}: {
  trend: CellTrend | undefined;
  /** The live cell voltages — the "now" figures come from these. */
  cells?: CellData[];
  loading: boolean;
  /** The cabinet (`external_ems_1`) whose cell is traced over a period. */
  sourceId?: string;
  /** Called when a ranked cell is clicked, so the map can follow. */
  onSelectCell?: (cellNo: number) => void;
}) {
  /* The drift chart, Day / Week / Month / Year (PeriodNav). Opens on today. */
  const nav = usePeriod("day");
  const swipe = useSwipe(nav);
  const { period } = nav;
  const isDay = period.range === "day";
  const driftCell = trend?.cell?.cellNo ?? trend?.weakest[0]?.cellNo;
  const drift = useCellDriftPeriod(sourceId, driftCell, period);
  /* Today's read covers the live window too; the trend's own trace fills in
     while it loads or if the cell's point id is not known here. */
  const dayRows = useMemo(() => {
    if (!isDay) return [];
    if (drift.day.length || drift.traceable) return drift.day;
    return isLatest(period, Date.now()) && trend?.cell
      ? trend.cell.deviation.map((p) => ({ ts: p.ts, dev: Math.round(p.value * 10) / 10 }))
      : [];
  }, [isDay, drift.day, drift.traceable, period, trend]);
  const dayGapped = useMemo(() => withGaps(dayRows, gapFor(dayRows.map((r) => r.ts))), [dayRows]);
  const snap = useMemo(() => snapshotStats(cells), [cells]);
  const yDomain = useMemo(
    () => driftAxisDomain(dayRows.map((r) => r.dev).filter((v): v is number => v != null)),
    [dayRows],
  );

  if (loading) {
    return <div style={{ padding: 20, fontSize: 12, color: "var(--muted)" }}>Reading The Stored History…</div>;
  }

  if (!trend?.window) {
    return (
      <div style={{ padding: "16px 4px", fontSize: 12, color: "var(--muted)" }}>
        No Stored History For This Pack
        <span style={{ display: "block", marginTop: 4, fontSize: 11, color: "var(--ink3)" }}>
          Per-cell trending reads <code>/api/storage/points</code>, which serves the
          snapshot store rather than the 1-second fast profile. A gateway that has
          not been retaining snapshots has nothing to trend yet.
        </span>
      </div>
    );
  }

  const { window: w, weakest, cell } = trend;
  /* A trend cached in local storage before `pack` existed lacks it. */
  const pack = trend.pack ?? { latestMv: null, latestTs: null, issueSamples: 0, issue: false };
  const span = w.toTs - w.fromTs;

  /* The stat row is about ONE cell: the one being traced.

     It used to take the cell number and its persistence from weakest[0] while
     taking the deviation and drift from the traced cell — so clicking a
     different cell in the ranking left "#1 · held the minimum 70%" sitting
     next to cell 85's millivolts, and the row read as a single claim about
     cell 1 that was half true of cell 85. On a screen whose entire job is
     attributing a fault to a cell number, that is the one mistake it may not
     make. Everything below now comes from `subject`, and its persistence is
     looked up by that cell's own number. */
  const subject = cell?.cellNo ?? weakest[0]?.cellNo;
  const share = subject != null
    ? weakest.find((c) => c.cellNo === subject)?.sharePct ?? 0
    : null;
  /* The flag is the pack's worst cell when the traced cell has no trace, so a
     drifting cell elsewhere in the pack is never hidden behind a quiet one. */
  /* Now-figures from one computation: the live snapshot when it holds the
     subject cell, otherwise the trend's — never one of each. */
  const fromSnap = snap != null && subject != null && snap.dev.has(subject);
  const nowMv = fromSnap ? snap!.dev.get(subject!)! : cell?.latestDeviationMv ?? null;
  const worstMv = fromSnap ? snap!.worstMv : pack.latestMv;
  const worstNo = fromSnap ? snap!.worstNo : null;
  const v = verdict(nowMv ?? worstMv);
  const worstIssue = isDriftIssue(worstMv);
  const mostOftenLowest = subject != null && weakest[0]?.cellNo === subject;
  /* Weakest = furthest below the pack average. A cell that merely held the
     minimum most often is not called that while it sits above the average. */
  const subjectLabel = (fromSnap ? subject === snap!.lowestNo : mostOftenLowest && (nowMv ?? 0) < 0)
    ? "Weakest Cell" : mostOftenLowest ? "Most Often Lowest" : "Traced Cell";
  /* A slope is only worth stating if the window is long enough to have seen
     one. Below a day, the fit is describing a few hours of SOC movement. */
  const slopeMeaningful = span >= 24 * 3_600_000;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Pack-wide: the worst cell anywhere against the pack average. */}
      {worstMv != null && (
        <div style={{ fontSize: 11.5, color: worstIssue ? "var(--bad)" : "var(--ink3)" }}>
          Worst Cell{worstNo != null ? ` #${worstNo}` : ""}: <strong>{signedMv(worstMv)}</strong> From Pack Average
        </div>
      )}

      {/* The verdict, in the terms somebody acts on. */}
      {subject != null && share != null && (
        <div style={{
          display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          padding: "12px 14px", borderRadius: 10,
          background: "var(--surface2)", border: "1px solid var(--line)",
        }}>
          <Stat label={subjectLabel} value={`#${subject}`} tone={v.tone} />
          <Stat label="Time As Lowest Cell" value={`${share}%`} />
          <Stat
            label="Now vs Pack Average"
            value={nowMv == null ? "—" : signedMv(nowMv)}
            tone={v.tone}
          />
          <Stat
            label="Weekly Trend"
            value={
              cell?.driftMvPerWeek == null ? "—"
                : slopeMeaningful ? `${cell.driftMvPerWeek > 0 ? "+" : ""}${cell.driftMvPerWeek} mV/wk`
                  : "Needs A Day Of Data"
            }
            /* A slope is a trend, not an issue: no colour until the drift itself crosses 100 mV. */
          />
          {v.text && (
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{
                fontSize: 10.5, fontWeight: 600,
                padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap",
                color: "var(--bad)", background: "rgb(var(--color-bad) / 0.1)",
              }}>
                {v.text}
              </span>
            </div>
          )}
        </div>
      )}

      {/* The drift itself, Day / Week / Month / Year. Deviation from the pack
          average, so zero is "in family" and the line is readable without
          knowing the pack voltage. A Day is the readings; longer periods one
          capsule per day or month. */}
      {driftCell != null && (
        <div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 6 }}>
            Cell {driftCell} · Distance From Pack Average (mV)
          </div>
          <div style={{ marginBottom: 10 }}><PeriodNav state={nav} /></div>
          <div {...swipe} style={{ ...swipe.style, height: 190, position: "relative" }}>
            {drift.loading ? <LoadingState rows={3} /> : !isDay ? (
              drift.buckets.every((b) => b.n === 0) ? null : (
                <BucketChart buckets={drift.buckets} kind="measure" color={chartTokens.primary} unit="mV" period={period} height={190} signed />
              )
            ) : dayRows.length < 2 ? null : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dayGapped} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="cellDriftFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartTokens.primary} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={chartTokens.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={chartTokens.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis {...axisProps} {...timeAxisProps(dayRows, [period.from, period.to])} />
                {/* Fixed ±150 mV around the pack average, so a drift's size
                    reads the same on every cell and every day, and the 100 mV
                    issue lines are always in view. Widened only if a reading
                    lies outside it — an outlier is never clipped. */}
                <YAxis
                  width={46}
                  domain={yDomain}
                  ticks={driftAxisTicks(yDomain)}
                  interval={0}
                  allowDataOverflow={false}
                  {...axisProps}
                />
                {/* The pack average — the line a healthy cell sits on. */}
                <ReferenceLine y={0} stroke={chartTokens.reference} strokeDasharray="4 4" />
                {/* The issue threshold either side. */}
                <ReferenceLine y={CELL_DRIFT_THRESHOLD_MV} stroke="var(--bad)" strokeOpacity={0.55} strokeDasharray="2 4" />
                <ReferenceLine y={-CELL_DRIFT_THRESHOLD_MV} stroke="var(--bad)" strokeOpacity={0.55} strokeDasharray="2 4" />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={cursorStyle}
                  labelFormatter={timeTooltipLabel}
                  formatter={(val: number | string) => [`${val} mV`, "Vs Pack Avg"]}
                />
                {/* Filled back to zero rather than to the axis floor, so the
                    shaded band IS the deviation instead of an arbitrary region
                    under the line. */}
                <Area
                  type="monotone" dataKey="dev" baseValue={0}
                  stroke="none" fill="url(#cellDriftFill)" isAnimationActive={false}
                />
                <Line type="monotone" dataKey="dev" stroke={chartTokens.primary} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* The ranking. This is the part that needs no per-cell history at all. */}
      {weakest.length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 6 }}>
            Which Cell Held The Pack Minimum
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {weakest.slice(0, 6).map((c) => {

              return (
                <button
                  key={c.cellNo}
                  type="button"
                  onClick={() => onSelectCell?.(c.cellNo)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "7px 2px",
                    borderTop: "1px solid var(--line)", background: "none", border: "none",
                    borderTopStyle: "solid", cursor: onSelectCell ? "pointer" : "default",
                    textAlign: "left", width: "100%",
                  }}
                  title={onSelectCell ? `Trend cell ${c.cellNo}` : undefined}
                >
                  <span style={{
                    fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--ink)",
                    minWidth: 52, fontWeight: cell?.cellNo === c.cellNo ? 700 : 400,
                  }}>
                    #{c.cellNo}
                  </span>
                  <span style={{ flex: 1, height: 5, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                    <span style={{
                      display: "block", height: "100%", borderRadius: 999,
                      width: `${Math.max(1, Math.min(100, c.sharePct))}%`,
                      /* Information, not a warning — see verdict(). */
                      background: chartTokens.primary,
                    }} />
                  </span>
                  <span style={{
                    fontSize: 11.5, fontVariantNumeric: "tabular-nums", color: "var(--ink2)", minWidth: 46, textAlign: "right",
                  }}>
                    {c.sharePct}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
