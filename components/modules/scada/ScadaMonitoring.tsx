"use client";

/**
 * SCADA Live Monitor
 *
 * Layout (top → bottom):
 *   ① Header + refresh control
 *   ② Site tabs (one per customer)
 *   ③ Device selector buttons
 *   ④ Active device info strip
 *   ⑤ Trend Charts grid  — one AreaChart per numeric parameter, global time range
 *   ⑥ Parameter grid     — latest values grouped by category
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, AlertCircle, MapPin, Wifi, WifiOff } from "lucide-react";
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  fetchScadaSites,
  fetchScadaDevices,
  fetchScadaKeys,
  fetchScadaLatest,
  fetchScadaSeries,
} from "@/lib/api/services/scada.service";
import type {
  ScadaSite, ScadaDevice, ScadaParameter, ScadaSeriesPoint,
} from "@/lib/api/services/scada.service";
import { deviceLabel, deviceTitle } from "@/lib/deviceNames";

// ── Constants ─────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 30_000;

const CATEGORY_ORDER = [
  "Power", "DC", "AC", "Battery", "Performance",
  "Temperature", "Status", "Digital I/O", "Transformer", "Other",
];

const CATEGORY_COLORS: Record<string, string> = {
  "Power":       "#5B8AB4",
  "DC":          "#3E6E93",
  "AC":          "#6FA3A0",
  "Battery":     "#4E8D6E",
  "Performance": "#7E7BA8",
  "Temperature": "#9C844A",
  "Status":      "#94A3B8",
  "Digital I/O": "#64748B",
  "Transformer": "#8DA2BC",
  "Other":       "#6B7280",
};

// Shared chart theme — mirrors Charts.tsx
const CHART_GRID  = "var(--chart-grid)";
const CHART_MUTED = "#6B7280";

const tooltipStyle: React.CSSProperties = {
  background:   "var(--tooltip-bg)",
  border:       "1px solid var(--tooltip-line)",
  borderRadius: 8,
  fontSize:     11,
  color:        "var(--tooltip-ink)",
  padding:      "8px 10px",
  boxShadow:    "var(--tooltip-shadow)",
};

const axisProps = {
  tickLine: false,
  axisLine: false,
} as const;

function localInputToMs(s: string): number { return new Date(s).getTime(); }

function msToLocalInput(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}T` +
    `${String(d.getHours()).padStart(2, "0")}:` +
    `${String(d.getMinutes()).padStart(2, "0")}`
  );
}

// ── Site name matcher ──────────────────────────────────────────────────────────
/** Best-effort match: EMS station name → UGX customer name */
function matchSite(sites: ScadaSite[], stationName: string): ScadaSite | null {
  if (!sites.length) return null;
  if (!stationName) return sites[0];
  const q    = stationName.toLowerCase();
  const base = q.split("·")[0].trim(); // "dalmia cement · lanka" → "dalmia cement"
  return (
    sites.find((s) => s.name.toLowerCase() === q)                          ??
    sites.find((s) => q.includes(s.name.toLowerCase()))                    ??
    sites.find((s) => s.name.toLowerCase().includes(base))                 ??
    sites.find((s) => base.includes(s.name.toLowerCase()))                 ??
    sites[0]
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ScadaMonitoring({ stationName = "" }: { stationName?: string }) {
  const [sites,        setSites]        = useState<ScadaSite[]>([]);
  const [activeSite,   setActiveSite]   = useState<ScadaSite | null>(null);
  const [devices,      setDevices]      = useState<ScadaDevice[]>([]);
  const [activeDevice, setActiveDevice] = useState<ScadaDevice | null>(null);
  const [params,       setParams]       = useState<ScadaParameter[]>([]);
  const [lastUpdate,   setLastUpdate]   = useState<number>(0);
  const [siteLoading,  setSiteLoading]  = useState(true);
  const [devLoading,   setDevLoading]   = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [countdown,    setCountdown]    = useState(REFRESH_INTERVAL / 1000);
  const [error,        setError]        = useState<string | null>(null);

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load sites ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchScadaSites()
      .then((s) => { setSites(s); setActiveSite(matchSite(s, stationName)); })
      .catch((e: Error) => setError(e.message ?? "Failed to load sites"))
      .finally(() => setSiteLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-match site when global station changes ────────────────────────────────
  useEffect(() => {
    if (sites.length === 0) return; // not loaded yet
    const matched = matchSite(sites, stationName);
    if (matched && matched.customerId !== activeSite?.customerId) {
      setActiveSite(matched);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationName, sites.length]);

  // ── Load devices on site change ─────────────────────────────────────────────
  useEffect(() => {
    if (!activeSite) return;
    setDevices([]); setActiveDevice(null); setParams([]); setError(null); setDevLoading(true);
    fetchScadaDevices(activeSite.customerId)
      .then((d) => { setDevices(d); if (d.length > 0) setActiveDevice(d[0]); })
      .catch((e: Error) => setError(e.message ?? "Failed to load devices"))
      .finally(() => setDevLoading(false));
  }, [activeSite]);

  // ── Telemetry fetch ─────────────────────────────────────────────────────────
  const doRefresh = useCallback(async () => {
    if (!activeDevice) return;
    try {
      setRefreshing(true); setError(null);
      const keys   = await fetchScadaKeys(activeDevice.id);
      const values = await fetchScadaLatest(activeDevice.id, keys);
      setParams(values);
      setLastUpdate(Date.now());
    } catch (e: unknown) {
      setError((e as Error).message ?? "Telemetry fetch failed");
    } finally {
      setRefreshing(false);
      setCountdown(REFRESH_INTERVAL / 1000);
    }
  }, [activeDevice]);

  useEffect(() => {
    if (!activeDevice) return;
    doRefresh();
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(doRefresh, REFRESH_INTERVAL);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [activeDevice, doRefresh]);

  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!activeDevice) return;
    countdownRef.current = setInterval(
      () => setCountdown((c) => Math.max(0, c - 1)), 1000
    );
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [activeDevice, lastUpdate]);

  // ── Group params for cards ──────────────────────────────────────────────────
  const grouped: Record<string, ScadaParameter[]> = {};
  for (const p of params) (grouped[p.category] ??= []).push(p);
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => grouped[c]?.length),
    ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c) && grouped[c].length),
  ];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 overflow-y-auto page-fill">

      {/* ── Hero strip ─────────────────────────────────────────────────── */}
      <div className="surface-card ps-hero">
        <div>
          <h1 className="ps-hero-title">SCADA Live Monitor</h1>
          <p className="ps-hero-sub">
            Real-time telemetry · UniqGrid platform ·{" "}
            {lastUpdate
              ? `Updated ${new Date(lastUpdate).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata",
                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                })}`
              : "Awaiting first fetch…"}
          </p>
        </div>

        <div className="ps-hero-stats items-center">
          <div>
            <div className="ps-stat-k">Sites</div>
            <div className="ps-stat-v" style={{ color: "var(--ink)" }}>{sites.length || "—"}</div>
          </div>
          <div>
            <div className="ps-stat-k">Parameters</div>
            <div className="ps-stat-v" style={{ color: "var(--ink)" }}>{params.length || "—"}</div>
          </div>
          <button
            onClick={doRefresh}
            disabled={refreshing || !activeDevice}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface2 border border-line
                       text-[12px] text-ink2 hover:text-ink hover:bg-surface3 transition-all
                       disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : `Refresh (${countdown}s)`}
          </button>
        </div>
      </div>

      {/* ── Site tabs ──────────────────────────────────────────────────── */}
      {siteLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <RefreshCw size={13} className="animate-spin" /> Loading sites…
        </div>
      ) : sites.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-surface2 border border-line text-[12.5px] text-muted">
          <AlertCircle size={14} /> No customers found on this tenant.
        </div>
      ) : (
        <div className="flex items-center gap-1 bg-surface2 p-1 rounded-lg border border-line flex-wrap">
          {sites.map((s) => (
            <button
              key={s.customerId}
              onClick={() => setActiveSite(s)}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-all",
                activeSite?.customerId === s.customerId
                  ? "bg-accent/15 text-accent ring-1 ring-accent/25"
                  : "text-ink3 hover:text-ink hover:bg-surface3",
              ].join(" ")}
            >
              {s.name}
              {s.location && (
                <span className="flex items-center gap-0.5 text-[10px] text-muted font-normal">
                  <MapPin size={9} />{s.location}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Device selector ─────────────────────────────────────────────── */}
      {activeSite && (
        devLoading ? (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <RefreshCw size={13} className="animate-spin" /> Loading devices…
          </div>
        ) : devices.length === 0 ? (
          <p className="text-[12px] text-muted">No devices found for {activeSite.name}.</p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono tracking-[1px] text-muted shrink-0">
              Devices
            </span>
            {devices.map((d) => (
              <button
                key={d.id}
                onClick={() => setActiveDevice(d)}
                className={[
                  "flex items-center gap-2 px-3 py-1.5 rounded-md border text-[12px] font-medium transition-all",
                  activeDevice?.id === d.id
                    ? "bg-accent/10 text-accent border-accent/20"
                    : "bg-surface2 text-ink2 border-line hover:text-ink hover:bg-surface3",
                ].join(" ")}
              >
                {d.active
                  ? <Wifi    size={11} className="text-good shrink-0" />
                  : <WifiOff size={11} className="text-bad  shrink-0" />}
                <span title={deviceTitle(d.name)}>{deviceLabel(d.name)}</span>
                {d.type && <span className="text-[10px] text-muted font-normal">{d.type}</span>}
              </button>
            ))}
          </div>
        )
      )}

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-bad/10 border border-bad/20 text-[12.5px] text-bad">
          <AlertCircle size={14} className="shrink-0" />{error}
        </div>
      )}

      {/* ── Active device strip ─────────────────────────────────────────── */}
      {activeDevice && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-surface2 border border-line text-[12px]">
          <span className={[
            "w-2 h-2 rounded-full shrink-0",
            activeDevice.active
              ? "bg-good shadow-[0_0_6px_rgb(var(--color-good))]"
              : "bg-bad",
          ].join(" ")} />
          <span className="font-semibold text-ink" title={deviceTitle(activeDevice.name)}>
            {deviceLabel(activeDevice.name)}
          </span>
          <span className="text-muted">{activeDevice.type}</span>
          <span className={[
            "ml-auto text-[11px] font-mono px-2 py-0.5 rounded",
            activeDevice.active ? "bg-good/10 text-good" : "bg-bad/10 text-bad",
          ].join(" ")}>
            {activeDevice.active ? "ACTIVE" : "INACTIVE"}
          </span>
        </div>
      )}

      {/* ── Loading skeleton ─────────────────────────────────────────────── */}
      {refreshing && params.length === 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-surface2 border border-line rounded-xl p-3 h-[188px] animate-pulse" />
          ))}
        </div>
      )}

      {/* ── ① TREND CHARTS (top) ─────────────────────────────────────────── */}
      {activeDevice && params.length > 0 && (
        <ScadaChartGrid deviceId={activeDevice.id} params={params} />
      )}

      {/* ── ② PARAMETER GRID (below charts) ─────────────────────────────── */}
      {params.length > 0 && (
        <div className="space-y-4 pt-1">
          {orderedCategories.map((cat) => (
            <section key={cat}>
              <div className="flex items-center gap-3 mb-3">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] font-mono tracking-[1.2px] text-muted whitespace-nowrap">
                  {cat}
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {grouped[cat].map((p) => <ParameterCard key={p.key} param={p} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Empty / no-device states ────────────────────────────────────── */}
      {activeDevice && params.length === 0 && !refreshing && !error && (
        <p className="text-center py-16 text-[12px] text-muted">
          No telemetry data found for {deviceLabel(activeDevice.name)}.
        </p>
      )}
      {!activeSite && !siteLoading && (
        <p className="text-center py-16 text-[12px] text-muted">
          Select a site above to begin monitoring.
        </p>
      )}
    </div>
  );
}

// ── Parameter card ─────────────────────────────────────────────────────────────

function ParameterCard({ param }: { param: ScadaParameter }) {
  const { label, value, unit } = param;
  const fmt =
    value === null ? "—"
    : typeof value === "number"
      ? value.toLocaleString("en-IN", { maximumFractionDigits: 3 })
      : String(value);
  const isBool     = value === 1 || value === 0 || value === "1" || value === "0";
  const isOn       = value === 1 || value === "1";
  const valueClass = isBool ? (isOn ? "text-good" : "text-bad") : "text-ink";

  return (
    <div className="bg-surface2 border border-line rounded-lg p-3 space-y-1.5 hover:border-line2 transition-colors">
      <div className="text-[10.5px] text-muted font-mono truncate leading-tight" title={param.key}>
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[17px] font-bold tabular-nums leading-none ${valueClass}`}>{fmt}</span>
        {unit && <span className="text-[10px] text-muted leading-none">{unit}</span>}
      </div>
    </div>
  );
}

// ── Trend chart grid ──────────────────────────────────────────────────────────

type RangeMode = "1h" | "6h" | "24h" | "7d" | "custom";

const RANGE_OFFSETS: Record<Exclude<RangeMode, "custom">, number> = {
  "1h":  3_600_000,
  "6h":  6 * 3_600_000,
  "24h": 86_400_000,
  "7d":  7 * 86_400_000,
};

function ScadaChartGrid({
  deviceId,
  params,
}: {
  deviceId: string;
  params: ScadaParameter[];
}) {
  const now = Date.now();
  const [rangeMode,   setRangeMode]   = useState<RangeMode>("24h");
  const [customStart, setCustomStart] = useState(msToLocalInput(now - 86_400_000));
  const [customEnd,   setCustomEnd]   = useState(msToLocalInput(now));
  const [appliedRange, setAppliedRange] = useState<{ start: number; end: number }>({
    start: now - 86_400_000,
    end:   now,
  });

  // Update range whenever preset mode changes
  useEffect(() => {
    if (rangeMode === "custom") return;
    const n = Date.now();
    setAppliedRange({ start: n - RANGE_OFFSETS[rangeMode], end: n });
  }, [rangeMode]);

  function handleApply() {
    const s = localInputToMs(customStart);
    const e = localInputToMs(customEnd);
    if (!isNaN(s) && !isNaN(e) && s < e) setAppliedRange({ start: s, end: e });
  }

  // Only numeric params, sorted by category priority
  const numericParams = params.filter((p) => typeof p.value === "number");
  const sortedParams = [
    ...CATEGORY_ORDER.flatMap((cat) => numericParams.filter((p) => p.category === cat)),
    ...numericParams.filter((p) => !CATEGORY_ORDER.includes(p.category)),
  ];

  if (sortedParams.length === 0) return null;

  return (
    <div className="space-y-4">

      {/* Header + range controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-semibold text-ink">Trend Charts</h3>
          <span className="text-[11px] text-muted">
            {sortedParams.length} parameter{sortedParams.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Preset range buttons */}
          <div className="flex items-center gap-0.5 bg-surface3 p-0.5 rounded-md border border-line">
            {(["1h", "6h", "24h", "7d", "custom"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRangeMode(r)}
                className={[
                  "px-2.5 py-1 rounded text-[11px] font-medium transition-all",
                  rangeMode === r
                    ? "bg-accent/15 text-accent"
                    : "text-ink3 hover:text-ink",
                ].join(" ")}
              >
                {r === "custom" ? "Custom" : r}
              </button>
            ))}
          </div>

          {/* Custom date pickers */}
          {rangeMode === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="datetime-local" value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2 py-1 rounded-md bg-surface3 border border-line text-[11px]
                           text-ink2 focus:outline-none focus:border-accent/40"
              />
              <span className="text-[10px] text-muted">→</span>
              <input
                type="datetime-local" value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2 py-1 rounded-md bg-surface3 border border-line text-[11px]
                           text-ink2 focus:outline-none focus:border-accent/40"
              />
              <button
                onClick={handleApply}
                className="px-3 py-1 rounded-md bg-accent/10 border border-accent/20
                           text-[11px] text-accent hover:bg-accent/20 transition-colors"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chart grid — 2 cols sm, 3 cols lg, 4 cols xl */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {sortedParams.map((p) => (
          <ScadaMiniChart
            key={p.key}
            deviceId={deviceId}
            param={p}
            startTs={appliedRange.start}
            endTs={appliedRange.end}
          />
        ))}
      </div>
    </div>
  );
}

// ── Mini chart — one per parameter ───────────────────────────────────────────

function ScadaMiniChart({
  deviceId,
  param,
  startTs,
  endTs,
}: {
  deviceId: string;
  param:    ScadaParameter;
  startTs:  number;
  endTs:    number;
}) {
  const [series,  setSeries]  = useState<ScadaSeriesPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const color = CATEGORY_COLORS[param.category] ?? "#6B7280";
  const gradId = `grad-${param.key.replace(/[^a-z0-9]/gi, "_")}`;

  useEffect(() => {
    if (!deviceId || !param.key) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchScadaSeries(deviceId, param.key, startTs, endTs)
      .then((pts) => { if (!cancelled) setSeries(pts); })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deviceId, param.key, startTs, endTs]);

  const tickInterval = Math.max(0, Math.ceil(series.length / 6) - 1);
  const unit = param.unit;

  function fmtY(v: number) {
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000)     return `${(v / 1_000).toFixed(1)}k`;
    return v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  }

  const currentValue =
    param.value === null ? "—"
    : typeof param.value === "number"
      ? param.value.toLocaleString("en-IN", { maximumFractionDigits: 2 })
      : String(param.value);

  return (
    <div className="bg-surface2 border border-line rounded-xl p-3.5 space-y-2.5
                    hover:border-line2 transition-colors group">

      {/* Card header: label + live value */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className="text-[11.5px] font-semibold text-ink leading-snug truncate"
            title={param.label}
          >
            {param.label}
          </div>
          <div className="text-[9.5px] text-muted font-mono mt-0.5 truncate" title={param.key}>
            {param.key}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className="text-[15px] font-bold tabular-nums leading-none"
            style={{ color }}
          >
            {currentValue}
          </div>
          {unit && (
            <div className="text-[9px] text-muted mt-0.5">{unit}</div>
          )}
        </div>
      </div>

      {/* Chart body */}
      {err ? (
        <div className="h-[110px] flex items-center justify-center text-[10px] text-bad gap-1">
          <AlertCircle size={11} /> No data
        </div>
      ) : loading ? (
        <div className="h-[110px] rounded-lg bg-surface3 animate-pulse" />
      ) : series.length === 0 ? (
        <div className="h-[110px] flex items-center justify-center text-[10px] text-muted">
          No data in range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={110}>
          <AreaChart data={series} margin={{ top: 4, right: 2, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0}    />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis
              dataKey="t"
              {...axisProps}
              interval={tickInterval}
              tick={{ fill: CHART_MUTED, fontSize: 9 }}
            />
            <YAxis
              {...axisProps}
              width={40}
              tickFormatter={fmtY}
              tick={{ fill: CHART_MUTED, fontSize: 9 }}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number) => [
                `${v.toLocaleString("en-IN", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`,
                param.label,
              ]}
              cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            <Area
              type="linear"
              dataKey="value"
              stroke={color}
              strokeWidth={1.8}
              fill={`url(#${gradId})`}
              dot={false}
              activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Mini footer: point count */}
      {series.length > 0 && (
        <div className="text-[9.5px] text-muted font-mono">
          {series.length} pts
        </div>
      )}
    </div>
  );
}
