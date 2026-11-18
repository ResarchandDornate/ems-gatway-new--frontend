"use client";

import { fmtINRCompact } from "@/lib/format";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { useStationSummary, useRecentPower, useRecentFast, useEnergyBuckets } from "@/hooks/usePowerStation";
import { useRevenueRate } from "../revenueRate";
import { timeAxisProps, timeTooltipLabel, withGaps, GAP_MS } from "@/lib/charts/timeAxis";
import { PLOT_MARGIN, symmetricTicks, tickLabel, xAxis, yAxis, zeroBasedTicks } from "@/lib/charts/axes";
import { AxisUnit } from "@/components/dashboard/viz/ChartCardHead";
import { useNow, useStableTicks } from "@/lib/charts/stable";
import { useMemo } from "react";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState }   from "@/components/shared/ErrorState";
import { SITE_OVERLAY_FOR } from "@/lib/api/overlay/stations";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { BucketBars } from "@/components/charts/BucketChart";
import type { Range } from "@/lib/charts/period";
import { recentRows } from "@/components/dashboard/recentWindow";
import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { usePointHistories } from "@/hooks/useDataAnalysis";
import type { PointHistoryEntry } from "@/lib/api/types";

/* ── Week / Month / Year: the fast stream's thinned history, drawn as lines ── */

const readingsOf = (d: PointHistoryEntry[] | undefined) =>
  (d ?? []).map((e) => ({ ts: Date.parse(e.t), value: e.value })).filter((r) => !Number.isNaN(r.ts));

/** A gap is 5 × the usual spacing, at least GAP_MS: the history is ~30 min apart. */
function gapFor(rows: { ts: number }[]): number {
  if (rows.length < 3) return GAP_MS;
  const steps = rows.slice(1).map((r, i) => r.ts - rows[i].ts).filter((d) => d > 0).sort((a, b) => a - b);
  return Math.max(GAP_MS, (steps[Math.floor(steps.length / 2)] ?? 0) * 5);
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const STEEL = "#5B8AB4";
const TEAL   = "#6FA3A0";
const BLUE   = "#3E6E93";
const GREEN  = "#4E8D6E";
const AMBER  = "#9C844A";
const GRID   = "var(--chart-grid)";
const MUTED  = "#6B7280";

const INV_COLORS = [
  "#5B8AB4", "#6FA3A0", "#3E6E93", "#7E7BA8",
  "#4E8D6E", "#9C844A", "#A7BBD1", "#6E84A8",
];

const tooltipStyle = {
  background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-line)",
  borderRadius: 8, fontSize: 11, color: "var(--tooltip-ink)", padding: "8px 10px",
  boxShadow: "var(--tooltip-shadow)",
};

// ── Shared sub-components ─────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-ink3">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label}
    </div>
  );
}

/* InverterTooltip and mergeInverterSeries lived here, serving the
   Per-Inverter Power section further down. Both went with it; git history
   has them if the section is ever restored. */

/** Clickable chip for multi-series filtering */
function FilterChip({
  color, label, active, onClick,
}: { color: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-[11.5px] px-2.5 py-1 rounded-full border transition-all cursor-pointer select-none"
      style={
        active
          ? { borderColor: color, color, background: `${color}18` }
          : { borderColor: "var(--line)", color: "var(--muted)", background: "transparent", opacity: 0.55 }
      }
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: active ? color : "#6B7280" }}
      />
      {label}
    </button>
  );
}

function StatsFooter({
  rows,
}: {
  rows: { label: string; color: string; min: number; max: number; latest: number; unit: string }[];
}) {
  return (
    <div className="border-t border-line pt-2.5 mt-1">
      <div className="grid grid-cols-4 text-[10px] font-mono text-muted mb-1 px-0.5">
        <span /><span className="text-right">Min</span>
        <span className="text-right">Max</span><span className="text-right">Latest</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-4 items-center py-0.5 px-0.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
            <span className="text-ink2 truncate">{r.label}</span>
          </div>
          <span className="text-right font-mono text-ink">{r.min.toFixed(1)} {r.unit}</span>
          <span className="text-right font-mono text-ink">{r.max.toFixed(1)} {r.unit}</span>
          <span className="text-right font-mono font-semibold" style={{ color: r.color }}>
            {r.latest.toFixed(1)} {r.unit}
          </span>
        </div>
      ))}
    </div>
  );
}

function seriesStats(vals: number[]) {
  const nums = vals.filter((v) => !isNaN(v));
  if (!nums.length) return null;
  /* "Latest" is the last value, 0 included: a battery at rest reads 0 kW and
     that is its current state. (It used to skip zeros, a habit from solar
     inverters that read 0 at night, and so showed an idle battery as busy.) */
  const latest  = nums[nums.length - 1];
  return { min: Math.min(...nums), max: Math.max(...nums), latest };
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-line/60">
      <div className="w-1 h-4 rounded-full bg-accent flex-shrink-0" />
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
    </div>
  );
}

function NoData({ note }: { note?: string }) {
  return (
    <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-muted">
      <div className="w-10 h-10 rounded-xl bg-surface2 border border-line grid place-items-center text-lg">📊</div>
      <span className="text-[12px] text-center px-4">{note ?? "No Data"}</span>
    </div>
  );
}

export function SingleStationDataView({ stationId, initialRange = "day" }: { stationId: string; initialRange?: Range }) {
  const summary     = useStationSummary(stationId);
  const showLoad    = SITE_OVERLAY_FOR(stationId).hasLoad !== false;
  /* Two sources. S2 (useRecentPower) gives battery DC power and SOC every
     ~11 s; S1 (useRecentFast) gives PCS AC power and SOC, and keeps arriving
     when S2 stalls. Neither takes a date range — each returns its newest
     1,000 readings — so any window reaches only as far back as those go, and
     the captions say so. */
  const intraday    = useRecentPower(stationId);
  /* Day / Week / Month / Year (PeriodNav). Day draws the readings; the
     others one capsule per day or month, from the fast stream (below). */
  const nav = usePeriod(initialRange);
  const swipe = useSwipe(nav);
  const { period } = nav;
  const isDay = period.range === "day";
  /* Today draws the live readings. A past day reads the fast stream's thinned
     history per cabinet, as the dashboard's cards do (PeriodCurves): reading a
     past day raw paged ~86,000 1 Hz samples a cabinet newest first, stopped
     after 6,000, and dropped every moment one cabinet lacked — so one failed
     read showed "No Readings" for a day the dashboard drew (19 Oct 2026). */
  const live = isDay && period.to > Date.now();
  /* The fast stream takes a date range, so today asks for today itself.
     S2 cannot be asked for one, and stays the latest. */
  const fast = useRecentFast(stationId,
    live ? { kind: "range", from: period.from, to: Math.min(period.to, Date.now()) } : { kind: "latest" });
  const loading      = live ? intraday.isLoading && fast.isLoading : false;

  const now = useNow(1_000);
  const [rangeFrom, rangeTo]: [number, number] = [period.from, period.to];
  /* The axis covers the whole day — today's runs on to midnight. */
  const axisSpan: [number, number] = [period.from, period.to];
  const inRange = <T extends { ts: number }>(rows: T[]) => rows.filter((d) => d.ts >= rangeFrom && d.ts <= rangeTo);
  /* A day or a week of the fast stream can be thousands of readings; a chart
     a few hundred pixels wide needs about 800. */
  const thin = <T,>(rows: T[]) => {
    const step = Math.ceil(rows.length / 800);
    return step > 1 ? rows.filter((_, i) => i % step === 0) : rows;
  };

  /* A past day, Week / Month / Year: the fast stream's thinned history per selected
     cabinet (the reader Curve Display uses), drawn as continuous lines. */
  const { selected } = useSelectedCabinets();
  const bessIds = selected.map((c) => c.bessId).filter(Boolean);
  const startIso = new Date(period.from).toISOString();
  /* NOT the ticking clock: a key that changed every second started a fresh
     read of ~100 samples every second (25,000 requests in a minute, 13 Oct
     2026). The end moves in 5-minute steps, so the query key is stable. */
  const endIso = new Date(Math.min(period.to, Math.ceil(Date.now() / 300_000) * 300_000)).toISOString();
  const socHist = usePointHistories(live ? [] : bessIds.map((b) => `fast:${b}:bms_values::display_soc`), startIso, endIso);
  const pwrHist = usePointHistories(live ? [] : bessIds.map((b) => `fast:${b}:pcs_values::total_active_power`), startIso, endIso);
  const histLoading = !live && [...socHist, ...pwrHist].some((q) => q.isLoading);
  const histKey = [...socHist, ...pwrHist].map((q) => q.dataUpdatedAt).join(",");
  /* SOC keeps one line per cabinet (no register states capacity, so no
     average); power is summed only where every cabinet has a reading. */
  const histRows = useMemo(() => {
    if (live) return [];
    const cabs = bessIds.map((b) => ({ bessId: b, sourceId: b }));
    const series = Object.fromEntries(bessIds.map((b, i) => [b, {
      soc: readingsOf(socHist[i]?.data), power: readingsOf(pwrHist[i]?.data),
    }]));
    return recentRows(series, cabs).rows.filter((r) => r.ts >= period.from && r.ts < period.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, histKey, bessIds.join(","), period.from, period.to]);

  const s2 = intraday.data ?? [];
  const s1 = fast.data?.points ?? [];

  /* SOC is the same quantity on both streams, so they merge (S2 wins a tick
     both carry). */
  const socByTick = new Map<number, (typeof s2)[number]>();
  for (const r of s1) if (r.soc != null) socByTick.set(r.ts, r);
  for (const r of s2) if (r.soc != null) socByTick.set(r.ts, r);
  /* Today: one `soc` line from the live streams. History: `soc_<bess>` per cabinet. */
  const socKeys = live ? ["soc"] : bessIds.map((b) => `soc_${b}`);
  const socOf = (r: object) => socKeys.map((k) => (r as Record<string, unknown>)[k]).filter((v): v is number => typeof v === "number");
  const socRows: { ts: number }[] = live
    ? thin(inRange([...socByTick.values()].sort((a, b) => a.ts - b.ts)))
    : histRows.filter((r) => socOf(r).length > 0);

  /* Power is DC on S2 and AC on S1 and the two do not agree sample for sample,
     so one source per window — the one whose readings in it are newest. (By
     count, a stalled S2's days-old backlog beat today's S1.) */
  const s2Power = inRange(s2), s1Power = inRange(s1);
  const newestOf = (rows: { ts: number }[]) => rows[rows.length - 1]?.ts ?? -Infinity;
  /* One source: S1's PCS AC power whenever it has readings in the window (it
     takes a date range, so it can cover any window); S2's DC figure only when
     S1 has none. Choosing by newest flipped between AC and DC on refresh. */
  const powerFromFast = s1Power.length > 0;
  const powerRows: { ts: number; power: number; load?: number | null }[] = live
    ? thin(powerFromFast ? s1Power : s2Power)
    : histRows.flatMap((r) => (r.power != null ? [{ ts: r.ts, power: r.power, load: null }] : []));

  const newest = Math.max(newestOf(s2), newestOf(s1));
  const emptyFor = (rows: unknown[]) =>
    !loading && !rows.length
      ? `No Readings For ${period.label}`
      : undefined;
  const socEmpty   = emptyFor(socRows);
  const powerEmpty = emptyFor(powerRows);

  // Pre-compute stats for footer rows
  // Drop absent SOC points rather than coercing them to 0 — a site with no BMS
  // publishes no SOC at all, and a 0 would drag the min/avg down as if measured.
  const socStats   = seriesStats(socRows.flatMap(socOf));
  const powerStats = seriesStats(powerRows.map((d) => d.power));
  /* Load = solar + battery (lib/energy/load). Solar is not on the backend yet,
     so only discharging stretches have a load. */
  const loadVals   = powerRows.map((d) => d.load).filter((v): v is number => v != null);
  const loadStats  = seriesStats(loadVals);
  const loadEmpty  = `No Load Readings For ${period.label}`;

  /* Five round ticks, symmetric about 0 for signed power (lib/charts/axes) —
     the padded min/max domain drew −7 / −14 / −21 kW. */
  const allPower = powerRows.map((d) => d.power).filter((v) => !isNaN(v));
  /* Sticky: grows at once, shrinks only when the data falls well inside it. */
  const scaleKey = `${period.range}:${period.from}`;
  const powerTicks = useStableTicks(symmetricTicks(Math.max(1, ...allPower.map(Math.abs))), scaleKey);
  const powerDomain: [number, number] = [powerTicks[0], powerTicks[powerTicks.length - 1]];
  const loadTicks = useStableTicks(zeroBasedTicks(Math.max(1, ...powerRows.map((d) => d.load ?? 0))), scaleKey);

  /* Real-time axis with the line broken at gaps; see lib/charts/timeAxis. */
  const socGapped   = live ? withGaps(socRows) : withGaps(socRows, gapFor(socRows));
  const powerGapped = live ? withGaps(powerRows) : withGaps(powerRows, gapFor(powerRows));


  /* Charge / Discharge is energy per hour (Day), day (Week / Month) or month
     (Year) from the PCS DC counters — what Power Station Home charts. It
     plotted the same signed power as Station Power below, line for line. */
  const { data: energy, isLoading: energyLoading } = useEnergyBuckets(stationId, period);
  const energyRows = energy ?? [];
  const energyHasData = energyRows.some((b) => b.charge != null || b.discharge != null);

  /* Today's revenue: today's discharge, shown beside it, at the rate Power
     Station Home's revenue tiles use (../revenueRate). */
  const { priceOf } = useRevenueRate(stationId);

  /* After every hook (useNow, useStableTicks), so the hook order never changes. */
  if (summary.isLoading) return <LoadingState rows={4} />;
  if (summary.isError || !summary.data) return <ErrorState onRetry={() => summary.refetch()} />;

  const s            = summary.data;
  const todayRevenue = priceOf(s.todayDischargeKwh);

  return (
    <div className="flex flex-col gap-0 surface-card overflow-hidden">

      {/* ── Real-Time Data strip ─────────────────────────────────────── */}
      <div>
        <SectionHeader title="Real-Time Data" />
        <div className="px-5 py-4 flex items-center gap-8 flex-wrap">
          {[
            /* 0 means unknown on both: installedKw is summed p0094 (0 only if
               unread), capacityKwh is the site overlay, unconfigured today. */
            { label: "Installed Power",    value: s.installedKw > 0 ? s.installedKw.toLocaleString("en-IN") : "—", unit: s.installedKw > 0 ? "kW" : "" },
            { label: "Installed Capacity", value: s.capacityKwh > 0 ? s.capacityKwh.toLocaleString("en-IN") : "—", unit: s.capacityKwh > 0 ? "kWh" : "" },
            { label: `Today's ${s.hasBess ? "Charge" : "Generation"}`,    value: s.todayChargeKwh != null ? s.todayChargeKwh.toLocaleString("en-IN") : "—",    unit: s.todayChargeKwh != null ? "kWh" : "" },
            { label: `Today's ${s.hasBess ? "Discharge" : "Export"}`,   value: s.todayDischargeKwh != null ? s.todayDischargeKwh.toLocaleString("en-IN") : "—", unit: s.todayDischargeKwh != null ? "kWh" : "" },
            { label: "Today's Revenue",    value: todayRevenue != null ? fmtINRCompact(todayRevenue) : "—", unit: "" },
          ].map((item) => (
            <div key={item.label} className="flex items-baseline gap-1.5">
              <span className="text-[11.5px] text-ink3">{item.label}:</span>
              <span className="text-[15px] font-semibold text-ink">{item.value}</span>
              <span className="text-[11px] text-muted">{item.unit}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-line" />

      {/* Day / Week / Month / Year for every chart below. */}
      <div className="px-5 py-3 border-b border-line">
        <PeriodNav state={nav} />
      </div>

      {/* ── Row 1: SOC (BESS only) + Charge/Discharge ───────────────── */}
      <div {...swipe} className={`grid grid-cols-1 ${s.hasBess ? "lg:grid-cols-2" : ""} divide-y lg:divide-y-0 lg:divide-x divide-line`}>

        {/* SOC — hidden for solar/DG-PV sites */}
        {s.hasBess && (
        <div>
          <SectionHeader title="SOC" />
          <div className="p-5 space-y-2">
            <div className="flex items-center gap-5">
              <LegendDot color={STEEL} label="SOC (%)" />
            </div>
            {loading || histLoading ? <LoadingState rows={3} /> : socRows.length === 0 ? <NoData note={socEmpty} /> : (
              <>
                <div style={{ position: "relative" }}>
                <AxisUnit unit="%" />
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={socGapped} margin={PLOT_MARGIN} syncId="station-day" syncMethod="value">
                    <defs>
                      <linearGradient id="grad-soc" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={STEEL} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={STEEL} stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis {...xAxis} {...timeAxisProps(socRows, axisSpan)} />
                    <YAxis {...yAxis} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={tickLabel} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={timeTooltipLabel}
                      formatter={(v, name) => [typeof v === "number" ? `${v.toFixed(1)}%` : "—", name]}
                      cursor={{ stroke: STEEL, strokeWidth: 1, strokeDasharray: "3 3" }}
                    />
                    {socKeys.map((k, i) => {
                      const color = INV_COLORS[i % INV_COLORS.length];
                      return (
                        <Area key={k} isAnimationActive={false} type="linear" dataKey={k} stroke={color} strokeWidth={2}
                          name={socKeys.length > 1 ? `SOC · ${selected[i]?.label ?? k}` : "SOC"}
                          fill={socKeys.length > 1 ? "none" : "url(#grad-soc)"} dot={false}
                          activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
                        />
                      );
                    })}
                  </AreaChart>
                </ResponsiveContainer>
                </div>
                {socStats && (
                  <StatsFooter rows={[{ label: "SOC", color: STEEL, ...socStats, unit: "%" }]} />
                )}
              </>
            )}
          </div>
        </div>
        )}

        {/* Charge / discharge energy per bucket (PCS DC counters). */}
        <div>
          <SectionHeader title={s.hasBess ? "Charge / Discharge" : "Generation / Export"} />
          <div className="p-5 space-y-2">
            <div className="flex items-center gap-5">
              <LegendDot color={BLUE} label={`${s.hasBess ? "Charge" : "Generation"} (kWh)`} />
              <LegendDot color={AMBER} label={`${s.hasBess ? "Discharge" : "Export"} (kWh)`} />
            </div>
            {energyLoading ? <LoadingState rows={3} />
              : !energyHasData ? <NoData note={`No Energy Readings For ${period.label}`} />
              : (
                <BucketBars rows={energyRows} unit="kWh" period={period} height={200}
                  series={[
                    { key: "charge", name: s.hasBess ? "Charge" : "Generation", color: BLUE },
                    { key: "discharge", name: s.hasBess ? "Discharge" : "Export", color: AMBER },
                  ]} />
              )}
          </div>
        </div>
      </div>

      <div className="border-t border-line" />

      {/* ── Row 2: Station Power + Load ─────────────────────────────── */}
      <div {...swipe} className={`grid grid-cols-1 ${showLoad ? "lg:grid-cols-2" : ""} divide-y lg:divide-y-0 lg:divide-x divide-line`}>

        {/* Today's power (station total) */}
        <div>
          <SectionHeader title="Station Power" />
          <div className="p-5 space-y-2">
            <div className="flex items-center gap-5">
              <LegendDot color={STEEL} label="Station Power (kW)" />
            </div>
            {loading || histLoading ? <LoadingState rows={3} /> : powerRows.length === 0 ? <NoData note={powerEmpty} /> : (
              <>
                <div style={{ position: "relative" }}>
                <AxisUnit unit="kW" />
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={powerGapped} margin={PLOT_MARGIN} syncId="station-day" syncMethod="value">
                    <defs>
                      <linearGradient id="grad-stn-pwr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={STEEL} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={STEEL} stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis {...xAxis} {...timeAxisProps(powerRows, axisSpan)} />
                    <YAxis {...yAxis} domain={powerDomain} ticks={powerTicks} tickFormatter={tickLabel} />
                    <ReferenceLine y={0} stroke="var(--chart-ref)" strokeDasharray="4 4" />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={timeTooltipLabel}
                      formatter={(v) => [typeof v === "number" ? `${v.toFixed(1)} kW` : "—", "Station Power"]}
                      cursor={{ stroke: STEEL, strokeWidth: 1, strokeDasharray: "3 3" }}
                    />
                    <Area isAnimationActive={false} type={live ? "stepAfter" : "linear"} dataKey="power" stroke={STEEL} strokeWidth={1.75}
                      fill="none" dot={false}
                      activeDot={{ r: 4, fill: STEEL, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                </div>
                {powerStats && (
                  <StatsFooter rows={[{ label: "Station Power", color: STEEL, ...powerStats, unit: "kW" }]} />
                )}
              </>
            )}
          </div>
        </div>

        {/* Today's load — only where the site has one (overlay hasLoad). */}
        {showLoad && <div>
          <SectionHeader title="Load" />
          <div className="p-5 space-y-2">
            <div className="flex items-center gap-5">
              <LegendDot color={TEAL} label="Load (kW)" />
            </div>
            {!live ? <NoData note={loadEmpty} /> : loading ? <LoadingState rows={3} /> : loadVals.length === 0 ? <NoData note={loadEmpty} /> : (
              <>
                <div style={{ position: "relative" }}>
                <AxisUnit unit="kW" />
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={powerGapped} margin={PLOT_MARGIN} syncId="station-day" syncMethod="value">
                    <defs>
                      <linearGradient id="grad-load" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={TEAL} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={TEAL} stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis {...xAxis} {...timeAxisProps(powerRows, axisSpan)} />
                    <YAxis {...yAxis} domain={[0, loadTicks[loadTicks.length - 1]]} ticks={loadTicks} tickFormatter={tickLabel} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={timeTooltipLabel}
                      formatter={(v) => [typeof v === "number" ? `${v.toFixed(1)} kW` : "—", "Load"]}
                      cursor={{ stroke: TEAL, strokeWidth: 1, strokeDasharray: "3 3" }}
                    />
                    <Area isAnimationActive={false} type="linear" dataKey="load" stroke={TEAL} strokeWidth={2}
                      fill="url(#grad-load)" dot={false}
                      activeDot={{ r: 4, fill: TEAL, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                </div>
                {loadStats && (
                  <StatsFooter rows={[{ label: "Load", color: TEAL, ...loadStats, unit: "kW" }]} />
                )}
              </>
            )}
          </div>
        </div>}
      </div>

      {/* Per-Inverter Power (Today) stood here — each inverter's output for the
          day, stacked against the station total. Removed on request.

          usePerInverterData is untouched and still exported; restoring the
          section means bringing this block back together with the `perInverter`
          and `invSeries` reads near the top of the component. */}
    </div>
  );
}
