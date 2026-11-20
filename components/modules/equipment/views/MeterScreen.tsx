"use client";

/**
 * The meter screen, shared by the site meter and the cabinet's sub meter.
 *
 * Both instruments report exactly the same quantities — the same three phases,
 * the same totals, the same power factors — so they get the same screen. What
 * differs is not the layout but what is behind it, and that is the `banner`:
 * the site meter maps 1:1 onto the gateway's `utility_meter` asset, while the
 * sub meter has no registers at all. One component, two honestly different
 * captions, instead of two screens drifting apart.
 */

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useMemo } from "react";
import type { MeterReadings } from "../readings";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { BucketChart, withRange } from "@/components/charts/BucketChart";
import { periodReadRange } from "@/components/charts/PeriodSeries";
import { aggregate, bucketsOf, isLatest } from "@/lib/charts/period";
import { usePointHistories } from "@/hooks/useDataAnalysis";
import { makeTag } from "@/lib/api/services/pointsCentral.service";
import { LoadingState } from "@/components/shared/LoadingState";
import { gapFor } from "../periodHistory";
import { Card, Row, StatusTile, PhaseTable, num, CommLostScope } from "./equipmentUi";
import { axisProps, chartTokens, tooltipStyle, cursorStyle } from "@/lib/charts/tokens";
import { timeAxisProps, timeTooltipLabel, withGaps } from "@/lib/charts/timeAxis";

/** The bus as the PCS sees it — shown beside a meter that cannot report it. */
export interface BusFromPcs { frequencyHz: number | null; phaseV: { label: string; v: number | null }[] }

export function MeterScreen({ m, banner, tone = "amber", bus, traceAsset, comm }: {
  m: MeterReadings;
  /** The meter's link and capture time (EquipmentReadings.comm.meter). */
  comm?: { state: string; at: number | null };
  /** The meter's S2 asset (`external_ems_1_grid_meter`) for its power history.
      Omitted, only the live trace in `m.chart` is drawn, on today. */
  traceAsset?: string;
  /** Optional: the bus frequency and voltages from the PCS, labelled as such. */
  bus?: BusFromPcs;
  /** Said once at the top. What is true about this instrument's data. */
  banner: React.ReactNode;
  /** amber where nothing is wired yet, neutral where the registers exist. */
  tone?: "amber" | "neutral";
}) {
  return (
    <CommLostScope lost={comm?.state === "Communication Lost"}>
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

      <div className="surface-card" style={{
        padding: "10px var(--pad)",
        borderLeft: `3px solid ${tone === "amber" ? "var(--amber)" : "var(--accent)"}`,
      }}>
        <p style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.5, margin: 0 }}>{banner}</p>
      </div>

      <Card title="Meter Status">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, alignItems: "center" }}>
          <StatusTile label="Online Status" state={comm?.state ?? (m.online === "online" ? "Online" : "Offline")} at={comm?.at} />
          <div>
            <Row label="Frequency"          value={num(m.frequencyHz)} unit="Hz" />
            <Row label="Total Power Factor" value={num(m.totalPowerFactor)} />
          </div>
          <div>
            <Row label="Total Active Power"   value={num(m.totalActiveKw)}     unit="kW" />
            <Row label="Total Reactive Power" value={num(m.totalReactiveKvar)} unit="kVAR" />
            <Row label="Total Apparent Power" value={num(m.totalApparentKva)}  unit="kVA" />
          </div>
        </div>
      </Card>

      {m.phases.some((ph) => ph.voltageV != null || ph.currentA != null || ph.activeKw != null) && (
        <Card title="Per Phase">
          <PhaseTable phases={m.phases} />
        </Card>
      )}

      <Card title="Energy" note="Cumulative, As The Meter Counts It">
        <Row label="Import (Forward Active Energy)" value={num(m.forwardEnergyKwh, 1)} unit="kWh" />
        <Row label="Export (Reverse Active Energy)" value={num(m.reverseEnergyKwh, 1)} unit="kWh" />
      </Card>

      {bus && (
        <Card title="Bus · From The PCS" note="the 415 V bus as the PCS measures it — not a meter reading" commLost={false}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <div><Row label="Frequency" value={num(bus.frequencyHz)} unit="Hz" /></div>
            <div>
              {bus.phaseV.map((p) => <Row key={p.label} label={`${p.label} Voltage`} value={num(p.v, 1)} unit="V" />)}
            </div>
          </div>
        </Card>
      )}

      {/* Three traces on one axis because they share a unit family and are read
          against each other — apparent is the hypotenuse of the other two, and
          that relationship is the reason to plot them together at all.

          The third stroke is --gold rather than a chart token: lib/charts/tokens
          defines two series roles, primary and secondary, because every other
          chart in the app plots at most two. Reactive power is the third here and
          takes a palette colour directly rather than inventing a third role that
          only this screen would use. */}
      <Card title="Power Chart">
        <MeterPowerChart asset={traceAsset} live={m.chart} />
      </Card>
    </div>
    </CommLostScope>
  );
}

/* ── The power chart, Day / Week / Month / Year ───────────────────────── */

type PowerRow = { ts: number; activeKw: number | null; apparentKva: number | null; reactiveKvar: number | null };

const SERIES = [
  { key: "activeKw", point: "p1368", name: "Total Active (kW)", unit: "kW", color: chartTokens.primary, signed: true },
  { key: "apparentKva", point: "p1376", name: "Total Apparent (kVA)", unit: "kVA", color: chartTokens.secondary, signed: false },
  { key: "reactiveKvar", point: "p1372", name: "Total Reactive (kVAR)", unit: "kVAR", color: "var(--gold)", signed: true },
] as const;

const HEIGHT = 260;

/**
 * A Day is the three traces as lines; a Week / Month / Year is one capsule per
 * day or month for each, stacked, the bottom one carrying the labels.
 */
function MeterPowerChart({ asset, live }: { asset?: string; live: MeterReadings["chart"] }) {
  const nav = usePeriod("day");
  const swipe = useSwipe(nav);
  const { period } = nav;
  const isDay = period.range === "day";
  const [startIso, endIso] = periodReadRange(period);
  const qs = usePointHistories(asset ? SERIES.map((x) => makeTag(asset, x.point)) : [], startIso, endIso);
  const loading = qs.some((q) => q.isLoading);

  const d0 = qs[0]?.data, d1 = qs[1]?.data, d2 = qs[2]?.data;
  const series = useMemo(() => [d0, d1, d2].map((d) =>
    (d ?? []).map((e) => ({ ts: Date.parse(e.t), value: e.value })).filter((r) => Number.isFinite(r.ts)),
  ), [d0, d1, d2]);

  const rows = useMemo<PowerRow[]>(() => {
    if (!isDay) return [];
    const byTs = new Map<number, PowerRow>();
    const row = (ts: number) => {
      let r = byTs.get(ts);
      if (!r) { r = { ts, activeKw: null, apparentKva: null, reactiveKvar: null }; byTs.set(ts, r); }
      return r;
    };
    if (asset) SERIES.forEach((x, i) => { for (const p of series[i]) row(p.ts)[x.key] = p.value; });
    /* The live trace, on today only. */
    if (isLatest(period, Date.now())) {
      for (const c of live) {
        if (c.ts < period.from || c.ts >= period.to) continue;
        Object.assign(row(c.ts), { activeKw: c.activeKw, apparentKva: c.apparentKva, reactiveKvar: c.reactiveKvar });
      }
    }
    return [...byTs.values()].sort((a, b) => a.ts - b.ts);
  }, [isDay, asset, series, live, period]);
  const plotted = useMemo(() => withGaps(rows, gapFor(rows.map((r) => r.ts))), [rows]);

  const buckets = useMemo(
    () => (isDay ? [] : series.map((pts) => withRange(aggregate(pts, bucketsOf(period), "measure")))),
    [isDay, series, period],
  );

  const empty = isDay ? rows.length === 0 : buckets.every((b) => b.every((x) => x.n === 0));
  const each = Math.round((HEIGHT + 60) / 3);

  return (
    <>
      <div style={{ marginBottom: 10 }}><PeriodNav state={nav} /></div>
      <div {...swipe} style={{ ...swipe.style, minHeight: HEIGHT }}>
        {loading ? <LoadingState rows={3} /> : empty ? null : !isDay ? (
          SERIES.map((x, i) => (
            <div key={x.key}>
              <div style={{ fontSize: 11, color: "var(--ink3)", margin: i ? "6px 0 2px" : "0 0 2px" }}>{x.name}</div>
              <BucketChart buckets={buckets[i]} kind="measure" color={x.color} unit={x.unit} period={period}
                height={each} signed={x.signed} hideLabels={i < SERIES.length - 1} />
            </div>
          ))
        ) : (
          <div style={{ height: HEIGHT }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={plotted} margin={{ top: 6, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.grid} vertical={false} />
                {/* Spaced by width, not by count: a fixed "every 12th reading"
                    put a label every few pixels once the window held ~1,000
                    readings, and the times printed on top of each other. */}
                <XAxis {...axisProps} {...timeAxisProps(rows, [period.from, period.to])} />
                <YAxis width={52} {...axisProps} />
                <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} labelFormatter={timeTooltipLabel} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {SERIES.map((x) => (
                  <Line key={x.key} type="monotone" dataKey={x.key} name={x.name} stroke={x.color}
                    strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}
