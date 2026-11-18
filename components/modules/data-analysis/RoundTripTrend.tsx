"use client";

/**
 * Round-trip efficiency, trended.
 *
 * Three things on screen, in the order they should be read:
 *
 *   1. The mean, and the fitted slope WITH its uncertainty. A slope that does
 *      not clear its own error bar is reported as "too short to tell" rather
 *      than as a number, because over a few weeks the fit is mostly reading
 *      the SOC noise at day boundaries and will happily return the wrong sign.
 *   2. The daily figures as points, with a 7-day rolling mean through them.
 *      The scatter is the honest picture; the rolling line is what makes the
 *      trend legible without pretending the scatter is not there.
 *   3. The days that were REFUSED, and why. A screen that charted only the
 *      days it could compute would read as a battery that ran that many days.
 *
 * All of the arithmetic — the SOC-drift correction, the plausibility gates,
 * the slope and its standard error — is in roundTrip.service.ts. Its header
 * explains why `discharged / charged` is not an efficiency, which is the one
 * thing worth reading before trusting anything here.
 */

import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Scatter, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend,
} from "recharts";
import { TrendingDown } from "lucide-react";
import type { RoundTrip, SkipReason } from "@/lib/api/services/roundTrip.service";
import { chartTokens, tooltipStyle } from "@/lib/charts/tokens";
import { PLOT_MARGIN, rangeTicks, tickLabel, yAxis } from "@/lib/charts/axes";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { dailyToBuckets, ymdOf } from "@/lib/charts/period";
import { AxisUnit } from "@/components/dashboard/viz/ChartCardHead";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { everyBucketX } from "./staggerTick";

const SKIP_LABEL: Record<SkipReason, string> = {
  "no-capacity": "Rated Capacity Not Set",
  "no-soc": "Battery Level Missing At Start Or End Of Day",
  "no-throughput": "Too Little Energy Moved",
  "drift-dominates": "Battery Level Changed Too Much Overnight To Measure",
  implausible: "Result Outside 60–100%",
  "partial-day": "Data Missing For Part Of The Day",
};

/** Round ticks around [lo, hi], never above 100 % — an efficiency cannot exceed it. */
function rteAxisTicks(lo: number, hi: number): number[] {
  const t = rangeTicks(lo, Math.min(100, hi));
  const over = t[t.length - 1] - 100;
  return over > 0 ? t.map((v) => +(v - over).toFixed(6)) : t;
}

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad) var(--pad)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 11 }}>
        <h3 className="card-title">{title}</h3>
        {note && <span style={{ fontSize: 11, color: "var(--muted)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Big({ label, value, unit, sub, tone }: {
  label: string; value: string; unit?: string; sub?: string; tone?: "bad" | "warn" | "good";
}) {
  const colour = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--accent)" : tone === "good" ? "var(--good)" : "var(--ink)";
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 600, marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: colour, lineHeight: 1.1 }}>
        {value}
        {unit && <small style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginLeft: 4 }}>{unit}</small>}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function RoundTripTrend({ data, loading }: { data: RoundTrip | undefined; loading: boolean }) {
  /* Day / Week / Month / Year (PeriodNav). Efficiency is a per-day figure, so a
     Day is that one day; a Week or Month each day; a Year each month's mean. */
  const nav = usePeriod("week");
  const swipe = useSwipe(nav);
  const { period } = nav;
  const chart = useMemo(() => {
    if (!data) return [];
    const rows = data.days.map((d, i) => ({ date: d.date, rte: d.rtePct, rolling: data.rollingRtePct[i] ?? null }));
    if (period.range === "day") {
      const r = rows.find((x) => x.date === ymdOf(period.from));
      return [{ label: period.label, ts: period.from, rte: r?.rte ?? null, rolling: r?.rolling ?? null }];
    }
    return dailyToBuckets(rows, period, { rte: "avg", rolling: "avg" });
  }, [data, period]);
  /* Five round ticks around the data, not from 0: a two-point decline is the
     whole question, and a 0-based axis would flatten it. */
  const rteVals = chart.flatMap((d) => [d.rte, d.rolling]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const rteTicks = rteAxisTicks(
    rteVals.length ? Math.min(...rteVals) - 1 : 80,
    rteVals.length ? Math.max(...rteVals) + 1 : 100,
  );

  const skipped = useMemo(() => {
    const m = new Map<SkipReason, number>();
    for (const d of data?.days ?? []) if (d.reason) m.set(d.reason, (m.get(d.reason) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  if (loading) return <LoadingState rows={6} />;

  if (!data?.window || !data.days.length) {
    return (
      <EmptyState
        title="No Efficiency History Yet"
        description=""
      />
    );
  }

  /* Capacity is the gate on the whole screen, not a footnote: without it there
     is no drift correction, so there is no efficiency — only a ratio. Said
     first and on its own rather than left to be inferred from empty charts. */
  if (data.capacityKwh == null) {
    return (
      <Card title="Round-Trip Efficiency" note={`${data.days.length} Days Read`}>
        <EmptyState
          title="Rated Capacity Not Set For This Site"
          description=""
        />
      </Card>
    );
  }

  const {
    meanRtePct, trendPctPerMonth: slope, trendSePctPerMonth: se,
    trendConfident, scatterPct, currentRtePct, windowScatterPct, windowDays,
  } = data;

  /* The headline is the latest ROLLING window, not the latest day and not the
     mean of every day. A single day carries the SOC-reading noise of its two
     boundaries; the window carries the same two readings spread over seven
     times the throughput, so it is the figure worth quoting — and it is what
     the trend is fitted on, so the headline and the slope describe the same
     series rather than two that can disagree. */
  const headline = currentRtePct ?? meanRtePct;

  const trendTone = !trendConfident ? undefined : slope != null && slope < -0.15 ? "bad" : "good";
  const meanTone = headline == null ? undefined
    : headline >= 88 ? "good" : headline >= 84 ? "warn" : "bad";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

      <Card
        title="Round-Trip Efficiency"
        note={`${data.reported} Of ${data.days.length} Days Measured · ${data.days[0].date} → ${data.days[data.days.length - 1].date}`}
      >
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <Big
            label={currentRtePct != null ? `Efficiency · Last ${windowDays} Days` : `Efficiency · Average Of ${data.reported} Day${data.reported === 1 ? "" : "s"}`}
            value={headline == null ? "—" : headline.toFixed(1)} unit="%"
            sub={
              windowScatterPct != null && scatterPct != null
                ? `Varies ±${scatterPct.toFixed(1)}% Day To Day`
                : scatterPct != null ? `Varies ±${scatterPct.toFixed(1)}% Day To Day` : undefined
            }
            tone={meanTone}
          />
          <Big
            label="Trend"
            value={
              slope == null ? "—"
                : trendConfident ? `${slope > 0 ? "+" : ""}${slope.toFixed(2)}`
                  : "No Clear Trend"
            }
            unit={slope != null && trendConfident ? "% per month" : undefined}
            sub={
              slope == null ? "Needs More Days Of Data"
                : trendConfident
                  ? `Based On ${data.weekly.filter((w) => w.rtePct != null).length} Weeks`
                  : "Too Little Change To Call Either Way"
            }
            tone={trendTone}
          />
          <Big
            label="Battery Capacity Used For This"
            value={String(data.capacityKwh)} unit="kWh"
          />
          <Big
            label="Effect Of Temperature"
            value={data.tempCorrelation == null ? "—"
              : Math.abs(data.tempCorrelation) < 0.4 ? "None Seen"
                : data.tempCorrelation < 0 ? "Lower When Warm" : "Higher When Warm"}
            sub={
              data.tempCorrelation == null ? "Too Few Days"
                : `Correlation ${data.tempCorrelation.toFixed(2)}`
            }
          />
        </div>

        {slope != null && trendConfident && slope < -0.15 && (
          <div style={{
            display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14, padding: "10px 12px",
            borderRadius: 8, background: "rgb(var(--color-bad) / 0.08)", border: "1px solid rgb(var(--color-bad) / 0.25)",
          }}>
            <TrendingDown size={15} style={{ color: "var(--bad)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5 }}>
              <strong>Falling {Math.abs(slope).toFixed(2)}% Per Month</strong> (±{se?.toFixed(2)})
            </span>
          </div>
        )}
      </Card>

      {/* ── The trend itself ──────────────────────────────────────────────── */}
      <Card
        title="Efficiency Over Time"
        note={period.range === "year" ? "Monthly Means" : undefined}
      >
        <div style={{ marginBottom: 10 }}><PeriodNav state={nav} /></div>
        <div {...swipe} style={{ ...swipe.style, height: 260, position: "relative" }}>
          <AxisUnit unit="%" />
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={PLOT_MARGIN}>
              <CartesianGrid stroke={chartTokens.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis {...everyBucketX(chart.length)} />
              {/* Domain from the data, not from zero. An efficiency axis
                  starting at 0 compresses every real movement into the top
                  tenth of the chart, where a two-point decline is invisible —
                  and two points is the entire question. */}
              <YAxis {...yAxis} domain={[rteTicks[0], rteTicks[rteTicks.length - 1]]} ticks={rteTicks} tickFormatter={tickLabel} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number | string, name: string) => [
                  `${v}%`, name === "rte" ? "That Day Alone" : `${windowDays} Days To Here`,
                ]}
              />
              <Legend
                verticalAlign="top" height={26} iconSize={10}
                formatter={(value) => (
                  <span style={{ fontSize: 11, color: "var(--ink3)" }}>
                    {value === "rte" ? "Daily" : `${windowDays}-Day Average`}
                  </span>
                )}
              />
              {meanRtePct != null && (
                <ReferenceLine y={meanRtePct} stroke={chartTokens.reference} strokeDasharray="5 4" />
              )}
              {/* The daily points are drawn faint: they are the evidence, not
                  the reading. The window line is what the trend is fitted on
                  and what the headline quotes. */}
              <Scatter dataKey="rte" fill={chartTokens.primary} fillOpacity={0.4} isAnimationActive={false} />
              <Line
                type="monotone" dataKey="rolling" stroke={chartTokens.secondary}
                strokeWidth={2} dot={false} isAnimationActive={false} connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── What was refused ──────────────────────────────────────────────── */}
      {skipped.length > 0 && (
        <Card title="Days Without A Figure" note={`${data.days.length - data.reported} Of ${data.days.length}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {skipped.map(([reason, n]) => (
              <div key={reason} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{
                  flexShrink: 0, minWidth: 30, textAlign: "right",
                  fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--ink)",
                }}>
                  {n}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>
                    {SKIP_LABEL[reason]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}
