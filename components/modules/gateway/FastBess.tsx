"use client";

/**
 * Live BESS — the first plant measurement this app reads from the central
 * backend.
 *
 * ── The quality caveat, stated on screen and not only here ─────────────────
 *
 * The memo asked for PER-SIGNAL quality. What S1 ships is SAMPLE-level:
 * one `quality` string for the whole reading, plus good/bad signal counts.
 * That is better than nothing and not the same thing — when bad_signal_count
 * is non-zero, some number among the 63 below is stale and the payload does
 * not say which. The gateway holds the last decoded value in place when a
 * register read fails, so a stale register is indistinguishable from a live
 * one by looking at it.
 *
 * The header therefore reports the sample's quality and bad count prominently
 * rather than burying them, because they are the only handle a reader has on
 * whether to trust the grid of numbers underneath. See
 * docs/central-backend-s1-contract.md §1.
 *
 * ── Window ─────────────────────────────────────────────────────────────────
 *
 * Read off the data, never from what was requested. The short ranges ask for a
 * sample count; 1 h asks for a date range (S1 takes from_time/to_time since
 * 1 Oct 2026) and pages it, because one response stops at 1,000 samples.
 */

import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { PLOT_MARGIN, rangeTicks, symmetricTicks, tickLabel, xAxis, yAxis } from "@/lib/charts/axes";
import { timeAxisProps, timeTooltipLabel, withGaps } from "@/lib/charts/timeAxis";
import { useNow, useStableTicks } from "@/lib/charts/stable";
import { chartTokens, tooltipStyle } from "@/lib/charts/tokens";
import { AxisUnit } from "@/components/dashboard/viz/ChartCardHead";
import {
  chronological, windowOf, reading,
  type FastBessSample,
} from "@/lib/central";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { useGatewayHealth } from "@/hooks/useGatewayHealth";
import { FastBessHistory } from "./FastBessHistory";
import { cabinetLabel } from "@/lib/deviceNames";

/**
 * Selectable windows.
 *
 * The short ones are sample counts: the gateway logs 1 Hz per unit, so a count
 * IS a duration once the request names a unit, and one request carries at most
 * 1,000. An hour is ~3,600 samples, so it is a date range, paged (~4 pages of
 * ~3 MB). "Max" (1,000 samples) went: it was the 15-minute window again.
 */
export const RANGES: Record<string, { label: string; limit?: number; windowMs?: number }> = {
  "1m":  { label: "1 min",  limit: 60 },
  "5m":  { label: "5 min",  limit: 300 },
  "15m": { label: "15 min", limit: 900 },
  "1h":  { label: "1 h",    windowMs: 3_600_000 },
};

export type RangeKey = "1m" | "5m" | "15m" | "1h";

const DASH = "—";

/* Display-only Title Case for raw ids like "display_soc"; the raw id stays in
   the tooltip. */
const ACRONYMS = new Set(["ems", "pcs", "bms", "io", "ac", "dc", "soc", "soh", "kw", "kwh"]);
const UNITS: Record<string, string> = { kw: "kW", kwh: "kWh", kva: "kVA", kvar: "kVAr" };
const pretty = (id: string) =>
  id.split(/[_\s]+/).filter(Boolean)
    .map((w) => {
      const l = w.toLowerCase();
      return UNITS[l] ?? (ACRONYMS.has(l) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
    })
    .join(" ");

const fmt = (v: number | null, dp = 2) =>
  v === null ? DASH : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const clock = (iso: string | undefined) => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? DASH
    : new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};

const span = (ms: number) =>
  ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60_000).toFixed(1)} min`;

function Tile({ label, value, unit, sub, tone }: {
  label: string; value: string; unit?: string; sub?: string; tone?: "ok" | "warn" | "bad";
}) {
  const colour = tone === "ok" ? "var(--accent)" : tone === "warn" ? "#C9A227" : tone === "bad" ? "#C2566B" : "var(--ink)";
  return (
    <div className="surface-card" style={{ padding: "var(--pad)" }}>
      <p className="card-eyebrow">{label}</p>
      <div className="text-[24px] font-semibold leading-tight" style={{ color: colour }}>
        {value}{unit && <span className="text-[12px] font-normal text-muted ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-[10px] font-mono tracking-[0.08em] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function SignalGrid({ title, values, count }: {
  title: string; values: Record<string, number | null | undefined>; count?: number;
}) {
  const names = Object.keys(values).sort();
  return (
    <div className="surface-card" style={{ padding: "var(--pad)" }}>
      <div className="flex items-baseline justify-between">
        <p className="card-eyebrow">{title}</p>
        <span className="text-[10px] font-mono text-muted">{count ?? names.length} Signals</span>
      </div>
      {names.length === 0 ? (
        <p className="text-[12px] text-muted mt-2">None</p>
      ) : (
        <div className="mt-2 grid gap-x-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
          {names.map((n) => {
            const v = values[n];
            return (
              <div key={n} className="flex justify-between gap-3 py-[3px] border-b border-line text-[11.5px]">
                <span className="text-muted truncate" title={n}>{pretty(n)}</span>
                <span className="text-ink3 flex-none">
                  {typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-IN") : DASH}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type ChartKey = "soc" | "kw" | "vdc" | "temp";
interface ChartSpec { key: ChartKey; label: string; unit: string; signed?: boolean; minSpan: number }

/* minSpan keeps a near-flat reading from being blown up to fill the plot:
   SOC moving 0.1 % should look nearly flat, not like a cliff. */
const CHARTS: ChartSpec[] = [
  { key: "soc",  label: "State Of Charge",      unit: "%",  minSpan: 4 },
  { key: "kw",   label: "Active Power",         unit: "kW", signed: true, minSpan: 10 },
  { key: "vdc",  label: "DC Voltage",           unit: "V",  minSpan: 20 },
  { key: "temp", label: "Max Cell Temperature", unit: "°C", minSpan: 4 },
];

type ChartRow = { ts: number } & Partial<Record<ChartKey, number | null>>;

/**
 * One Live BESS chart on the shared axes. Its own component so each chart
 * keeps its own sticky scale (useStableTicks) — the old "auto" domain re-fit
 * on every poll, so the line changed shape each time a sample arrived.
 */
function LiveChart({ spec, data, windowMs, resetKey }: {
  spec: ChartSpec; data: ChartRow[]; windowMs: number; resetKey: string;
}) {
  const now = useNow(1_000);
  const vals = data.map((d) => d[spec.key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (hi - lo < spec.minSpan) { const mid = (hi + lo) / 2; lo = mid - spec.minSpan / 2; hi = mid + spec.minSpan / 2; }
  if (spec.key === "soc") { lo = Math.max(0, lo); hi = Math.min(100, hi); }
  let wanted = spec.signed
    ? symmetricTicks(Math.max(spec.minSpan / 2, ...vals.map(Math.abs)))
    : rangeTicks(lo, hi);
  /* SOC cannot pass 100 %: shift a scale that rounds above it back down. */
  if (spec.key === "soc" && wanted[wanted.length - 1] > 100) {
    const over = wanted[wanted.length - 1] - 100;
    wanted = wanted.map((t) => +(t - over).toFixed(6));
  }
  const ticks = useStableTicks(wanted, resetKey);
  const span: [number, number] = [now - windowMs, now];

  return (
    <div className="surface-card" style={{ padding: "var(--pad)" }}>
      <p className="card-eyebrow">{spec.label}</p>
      <div style={{ height: 200, marginTop: 8, position: "relative" }}>
        <AxisUnit unit={spec.unit} />
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={PLOT_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.grid} vertical={false} />
            <XAxis {...xAxis} {...timeAxisProps(data, span)} />
            <YAxis {...yAxis} domain={[ticks[0], ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={tickLabel} allowDataOverflow />
            {spec.signed && <ReferenceLine y={0} stroke={chartTokens.reference} strokeDasharray="3 3" />}
            <Tooltip contentStyle={tooltipStyle} labelFormatter={timeTooltipLabel}
              formatter={(v) => [typeof v === "number" ? `${+v.toFixed(2)} ${spec.unit}` : "—", spec.label]} />
            {/* Gaps are gaps: a dropped sample must not be joined across, or
                a stalled logger reads as a straight line. */}
            <Line type="monotone" dataKey={spec.key} stroke={chartTokens.primary}
              strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function FastBess({
  gatewayId, samples, loading, error, configPending,
  units, activeUnit, onUnit, range, onRange,
}: {
  gatewayId: string;
  samples: FastBessSample[] | undefined;
  loading: boolean;
  error: Error | null;
  /** Config still in flight — gatewayId "" means unknown, not unset. */
  configPending?: boolean;
  units: string[];
  activeUnit: string | null;
  onUnit: (u: string) => void;
  range: RangeKey;
  onRange: (r: RangeKey) => void;
}) {
  const rows = samples ?? [];
  /* An empty S1 list is ambiguous on its own; /health is not. Records there
     mean the gateway is registered and reporting — just not S1 samples. */
  const health = useGatewayHealth(gatewayId, 1);
  const hb = health.data?.[0];

  /* ONE ARRAY, MANY UNITS. Unfiltered, this endpoint returns every cabinet
     interleaved — bess_1 and bess_2 rows sharing timestamps — so rows[0] would
     be whichever the backend listed first, and plotting the array straight
     would draw two cabinets as one line. The query names a unit for that
     reason, and because naming one doubles the window a given limit reaches.

     Filtered here as well: a response that lands while the selection is
     changing still belongs to the previous unit for one render. */
  const unitRows = useMemo(
    () => (activeUnit ? rows.filter((r) => r.bess_id === activeUnit) : rows),
    [rows, activeUnit],
  );

  const latest = unitRows[0];                   // API order is newest first
  const series = useMemo(() => chronological(unitRows), [unitRows]);
  const win = useMemo(() => windowOf(unitRows), [unitRows]);

  const [signalTab, setSignalTab] = useState<"pcs_values" | "bms_values">("pcs_values");

  /* An hour is ~3,600 samples; a few hundred pixels cannot show more than
     ~1,200, so longer windows are thinned to every nth sample for the charts. */
  const plotted = useMemo(() => {
    const step = Math.max(1, Math.ceil(series.length / 1200));
    return step === 1 ? series : series.filter((_, i) => i % step === 0 || i === series.length - 1);
  }, [series]);
  const chartData = useMemo(
    () => withGaps(plotted.map((s) => ({
      ts: Date.parse(s.sample_time_utc ?? ""),
      soc: reading(s, "bms_values", "display_soc") ?? reading(s, "pcs_values", "soc"),
      kw: reading(s, "pcs_values", "total_active_power"),
      vdc: reading(s, "pcs_values", "dc_voltage"),
      temp: reading(s, "bms_values", "battery_max_temperature"),
    })).filter((d) => !Number.isNaN(d.ts))),
    [plotted],
  );
  /* The window the axis spans: the requested range, so it slides with the
     clock rather than jumping to the newest sample on each poll. */
  const windowMs = RANGES[range].windowMs ?? (RANGES[range].limit ?? 300) * 1_000;

  const bad = latest?.data?.bad_signal_count;
  const quality = latest?.quality;

  if (!gatewayId) {
    if (configPending) {
      return (
        <div className="surface-card" style={{ padding: "var(--pad)" }}>
          <p className="card-eyebrow">Loading…</p>
        </div>
      );
    }
    return (
      <div className="surface-card ps-hero">
        <div>
          <h1 className="ps-hero-title">No Gateway Configured</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Live BESS">
        {win && <PageStat label="Window" value={`${clock(new Date(win.fromMs).toISOString())}–${clock(new Date(win.toMs).toISOString())} (${span(win.spanMs)})`} />}
      </PageHeader>

      {error && (
        <div className="surface-card" style={{ padding: "var(--pad)", borderColor: "#C2566B" }}>
          <p className="card-eyebrow" style={{ color: "#C2566B" }}>Could Not Read</p>
          <p className="text-[12px] text-ink3 mt-1">{error.message}</p>
        </div>
      )}

      {loading && !samples && (
        <div className="surface-card" style={{ padding: "var(--pad)" }}>
          <p className="card-eyebrow">Loading…</p>
        </div>
      )}

      {!error && !loading && rows.length === 0 && (
        <div className="surface-card" style={{ padding: "var(--pad)" }}>
          <p className="card-eyebrow">No Samples</p>
          <p className="text-[12px] text-ink3 mt-1">
            {health.isLoading
              ? "Checking…"
              : hb
                ? hb.data?.health?.fast_bess_logger?.running === false ? "Gateway Online · Logger Stopped" : "Gateway Online"
                : "Gateway Not Reporting"}
          </p>
        </div>
      )}

      {latest && (
        <>
          {/* Quality first: everything below is only as trustworthy as this. */}
          <div
            className="surface-card flex flex-wrap items-center gap-x-5 gap-y-1.5"
            style={{
              padding: "10px var(--pad)",
              borderColor: bad ? "#C9A227" : undefined,
            }}
          >
            <span className="card-eyebrow" style={{ margin: 0 }}>Sample Quality</span>
            <span className="text-[13px] font-semibold" style={{ color: quality === "good" ? "var(--accent)" : "#C9A227" }}>
              {quality ? quality.charAt(0).toUpperCase() + quality.slice(1).toLowerCase() : DASH}
            </span>
            <span className="text-[11px] text-muted">
              Good {latest.data?.good_signal_count ?? DASH} · Bad {bad ?? DASH}
            </span>
            {typeof latest.max_data_age_ms === "number" && (
              <span className="text-[11px] text-muted">Oldest Register {latest.max_data_age_ms} ms</span>
            )}
            {latest.data?.profile_name && (
              <span className="text-[11px] text-muted" title={latest.data.profile_name}>{pretty(latest.data.profile_name)}</span>
            )}
            <span className="text-[11px] text-muted ml-auto">
              <span title={latest.source_id ?? undefined}>{latest.source_id ? cabinetLabel(latest.source_id) : DASH}</span> · Sampled {clock(latest.sample_time_utc)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {units.length > 1 && (
              <div className="nav-track">
                {units.map((u) => (
                  <button
                    key={u} type="button" onClick={() => onUnit(u)}
                    className={`nav-pill ${u === activeUnit ? "on" : ""}`}
                  >
                    {cabinetLabel(u)}
                  </button>
                ))}
              </div>
            )}
            <div className="nav-track">
              {(Object.keys(RANGES) as RangeKey[]).map((k) => (
                <button
                  key={k} type="button" onClick={() => onRange(k)}
                  className={`nav-pill ${k === range ? "on" : ""}`}
                >
                  {RANGES[k].label}
                </button>
              ))}
            </div>
            {/* Covered span read off the samples, not the request: asking for
                900 does not mean 900 exist yet. */}
            {win && (
              <span className="text-[10px] font-mono tracking-[0.08em] text-muted">
                {unitRows.length} Samples · {span(win.spanMs)} Covered
              </span>
            )}
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <Tile label="State Of Charge" value={fmt(reading(latest, "bms_values", "display_soc") ?? reading(latest, "pcs_values", "soc"), 1)} unit="%" />
            <Tile label="Active Power" value={fmt(reading(latest, "pcs_values", "total_active_power"), 1)} unit="kW" />
            <Tile label="DC Voltage" value={fmt(reading(latest, "pcs_values", "dc_voltage"), 1)} unit="V" />
            <Tile label="Grid Frequency" value={fmt(reading(latest, "pcs_values", "grid_frequency"), 2)} unit="Hz" />
            <Tile label="State Of Health" value={fmt(reading(latest, "bms_values", "soh"), 1)} unit="%" />
            <Tile label="Max Cell Temp" value={fmt(reading(latest, "bms_values", "battery_max_temperature"), 1)} unit="°C" />
          </div>

          {chartData.length > 1 && (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
              {CHARTS.map((c) => (
                <LiveChart key={c.key} spec={c} data={chartData} windowMs={windowMs} resetKey={`${activeUnit}:${range}`} />
              ))}
            </div>
          )}

          {/* The same signals back through time: Day / Week / Month / Year. */}
          {activeUnit && <FastBessHistory bessId={activeUnit} />}

          <div className="nav-track" style={{ alignSelf: "flex-start" }}>
            <button type="button" onClick={() => setSignalTab("pcs_values")} className={`nav-pill ${signalTab === "pcs_values" ? "on" : ""}`}>
              PCS
            </button>
            <button type="button" onClick={() => setSignalTab("bms_values")} className={`nav-pill ${signalTab === "bms_values" ? "on" : ""}`}>
              BMS
            </button>
          </div>

          <SignalGrid
            title={signalTab === "pcs_values" ? "PCS Signals" : "BMS Signals"}
            values={latest.data?.[signalTab] ?? {}}
            count={signalTab === "pcs_values" ? latest.data?.pcs_signal_count : latest.data?.bms_signal_count}
          />
        </>
      )}
    </div>
  );
}
