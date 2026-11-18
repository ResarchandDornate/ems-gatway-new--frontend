"use client";

/**
 * PowerOverviewChart
 *
 * Multi-series AreaChart — Grid Power / Solar Power / Battery Power /
 * Plant Load (computed).
 *
 * ─── DATA FLOW ────────────────────────────────────────────────────────────────
 * useWidgetKeys("power-graph", stationId)
 *   → derives PlantMode from PlantConfig
 *   → resolves correct PlantKey[] from parameter-registry + PlantKeyMap
 *   → no hardcoded key names; works for solar, dg-pv, bess, bess-solar
 *
 * Plant Load is COMPUTED (not a separate telemetry key):
 *   plantLoad = Σ(all non-derived kW series)
 * This mirrors the UGX "Power Graph" calculation.
 *
 * ─── REAL-TIME ────────────────────────────────────────────────────────────────
 * Polls UGX every POLL_INTERVAL_MS for the last 5 minutes of data and merges
 * new points into the existing series — no full reload on each tick.
 *
 * ─── BRUSH NAVIGATOR ─────────────────────────────────────────────────────────
 * Recharts <Brush> preserves scroll position across live-poll merges.
 * Auto-advances end index only when the user is already watching the live tail.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { RefreshCw, AlertCircle, Radio } from "lucide-react";
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Brush,
} from "recharts";
import { fetchScadaSeries } from "@/lib/api/services/scada.service";
import type { ScadaSeriesPoint } from "@/lib/api/services/scada.service";
import { useWidgetKeys } from "@/lib/hooks/useWidgetKeys";
import type { ResolvedWidgetKey } from "@/lib/hooks/useWidgetKeys";
import { istMidnight } from "@/lib/api/time";
import { msToHm } from "@/lib/api/time";

// ── Theme ──────────────────────────────────────────────────────────────────────
const CHART_GRID  = "var(--chart-grid)";
const CHART_MUTED = "#6B7280";

// The computed "plant-load" synthetic key ID
const PLANT_LOAD_PARAM = "plant-load";

const POLL_INTERVAL_MS = 30_000;

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
  tick: { fill: CHART_MUTED, fontSize: 10.5 },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStartMs(): number {
  return istMidnight();
}

function fmtTs(ts: number): string {
  return msToHm(ts);
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** One point in the merged chart data array */
type ChartPoint = {
  ts:        number;
  t:         string;
  /** Values keyed by parameterId, e.g. "grid-power", "solar-power" */
  [paramId: string]: number | null | string;
};

/** Merge new points into existing array, deduplicating by ts, sorted ascending */
function mergePoints(existing: ChartPoint[], incoming: ChartPoint[]): ChartPoint[] {
  const map = new Map(existing.map((p) => [p.ts, p]));
  for (const p of incoming) {
    const prev = map.get(p.ts);
    // Merge: keep all param fields from both old and new point
    map.set(p.ts, prev ? { ...prev, ...p } : p);
  }
  return Array.from(map.values()).sort((a, b) => (a.ts as number) - (b.ts as number));
}

/**
 * Build chart points from a map of series data.
 * Also computes "plant-load" = sum of all real (non-derived) kW values.
 */
function buildPoints(
  seriesMap: Map<string, ScadaSeriesPoint[]>,
  realKeys:  ResolvedWidgetKey[],   // non-derived keys
): ChartPoint[] {
  // Union of all timestamps
  const allTs = [...new Set(
    [...seriesMap.values()].flatMap((s) => s.map((p) => p.ts))
  )].sort((a, b) => a - b);

  return allTs.map((ts) => {
    const point: ChartPoint = { ts, t: fmtTs(ts) };
    let loadSum      = 0;
    let loadHasValue = false;

    for (const key of realKeys) {
      const series = seriesMap.get(key.parameterId);
      const val    = series?.find((p) => p.ts === ts)?.value ?? null;
      point[key.parameterId] = val;
      if (val !== null) { loadSum += val; loadHasValue = true; }
    }

    // Computed plant load
    point[PLANT_LOAD_PARAM] = loadHasValue ? loadSum : null;
    return point;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PowerOverviewChart({
  stationId,
  dateRange,
  height = 320,
}: {
  stationId: string;
  /** When set, fetches data for this window (static, no live poll).
   *  When null/undefined, defaults to today-from-midnight with live polling. */
  dateRange?: { from: Date; to: Date } | null;
  height?: number | string;
}) {

  // ── Key resolution from registry ───────────────────────────────────────────
  const { keys, isLoading: keysLoading } = useWidgetKeys("power-graph", stationId);

  // Split into real (UGX telemetry) and derived (computed) keys
  const realKeys    = useMemo(() => keys.filter((k) => !k.isDerived && k.key !== PLANT_LOAD_PARAM), [keys]);
  const derivedKeys = useMemo(() => keys.filter((k) => k.isDerived),  [keys]);
  const plantLoadDef= useMemo(() => derivedKeys.find((k) => k.parameterId === PLANT_LOAD_PARAM), [derivedKeys]);

  // ── Chart data state ───────────────────────────────────────────────────────
  const [data,         setData]         = useState<ChartPoint[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null);
  const [brushIndices, setBrushIndices] = useState<{ start: number; end: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch window for a set of real keys ───────────────────────────────────
  const fetchWindow = useCallback(async (
    activeKeys: ResolvedWidgetKey[],
    startTs: number,
    endTs: number,
  ): Promise<ChartPoint[]> => {
    if (activeKeys.length === 0) return [];

    const results = await Promise.all(
      activeKeys.map((k) =>
        fetchScadaSeries(k.deviceId, k.key, startTs, endTs)
          .then((series) => ({ paramId: k.parameterId, series }))
          .catch(() => ({ paramId: k.parameterId, series: [] as ScadaSeriesPoint[] }))
      )
    );

    const seriesMap = new Map(results.map((r) => [r.paramId, r.series]));
    return buildPoints(seriesMap, activeKeys);
  }, []);

  // ── Reset + initial load when stationId, resolved keys, or dateRange changes
  useEffect(() => {
    if (keysLoading) return;                     // wait for key resolution

    let cancelled = false;
    setData([]); setLoading(true); setError(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    if (realKeys.length === 0) {
      setLoading(false);
      return;
    }

    // Use custom date range when provided; otherwise default to today
    const startMs = dateRange ? dateRange.from.getTime() : todayStartMs();
    const endMs   = dateRange ? dateRange.to.getTime()   : Date.now();
    const isLive  = !dateRange;

    (async () => {
      try {
        const points = await fetchWindow(realKeys, startMs, endMs);
        if (cancelled) return;

        setData(points);
        setBrushIndices({
          start: points.length > 120 ? points.length - 120 : 0,
          end:   points.length - 1,
        });
        setLastUpdated(new Date());
        setLoading(false);

        // ── Live poll — only when showing today's live data ───────────────────
        if (isLive) {
          pollRef.current = setInterval(async () => {
            try {
              const now   = Date.now();
              const fresh = await fetchWindow(realKeys, now - 5 * 60_000, now);
              setData((prev) => {
                const merged = mergePoints(prev, fresh);
                setBrushIndices((b) => {
                  if (!b) return { start: merged.length > 120 ? merged.length - 120 : 0, end: merged.length - 1 };
                  const wasAtEnd = b.end >= prev.length - 1;
                  return wasAtEnd
                    ? { start: b.start, end: merged.length - 1 }
                    : b;
                });
                return merged;
              });
              setLastUpdated(new Date());
            } catch { /* silent — stale data stays */ }
          }, POLL_INTERVAL_MS);
        }

      } catch (e: unknown) {
        if (!cancelled) {
          setError((e as Error).message ?? "Failed to load power data");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, keysLoading, realKeys, fetchWindow, dateRange]);

  // ── Y-axis domain ─────────────────────────────────────────────────────────
  const allParamIds = useMemo(() =>
    [...realKeys.map((k) => k.parameterId), PLANT_LOAD_PARAM],
    [realKeys]
  );

  const allVals = data.flatMap((d) =>
    allParamIds.map((id) => d[id]).filter((v): v is number => typeof v === "number")
  );
  const rawMin = allVals.length ? Math.min(...allVals, 0) : -400;
  const rawMax = allVals.length ? Math.max(...allVals, 0) :  400;
  const pad    = (rawMax - rawMin) * 0.1 || 40;
  const domain: [number, number] = [Math.floor(rawMin - pad), Math.ceil(rawMax + pad)];
  const tickInterval = Math.max(0, Math.ceil(data.length / 12) - 1);

  // ── Stats per series ───────────────────────────────────────────────────────
  function stats(paramId: string) {
    const nums = data.map((d) => d[paramId]).filter((v): v is number => typeof v === "number");
    if (!nums.length) return null;
    return { min: Math.min(...nums), max: Math.max(...nums), latest: nums[nums.length - 1] };
  }

  // ── All series to render ───────────────────────────────────────────────────
  // Real keys first, then the computed plant-load
  const allSeries: Array<{ paramId: string; label: string; color: string; isDerived: boolean }> =
    useMemo(() => {
      const out = realKeys.map((k) => ({
        paramId:   k.parameterId,
        label:     k.label,
        color:     k.color,
        isDerived: false,
      }));
      if (plantLoadDef && realKeys.length > 0) {
        out.push({
          paramId:   PLANT_LOAD_PARAM,
          label:     plantLoadDef.label,
          color:     plantLoadDef.color,
          isDerived: true,
        });
      }
      return out;
    }, [realKeys, plantLoadDef]);

  // ── Gradient IDs ───────────────────────────────────────────────────────────
  const gradientId = (paramId: string) => `pow-ov-grad-${paramId.replace(/[^a-z0-9]/gi, "-")}`;

  // ── Render ─────────────────────────────────────────────────────────────────
  const isSpinning = keysLoading || loading;
  const isLiveView = !dateRange;

  const chartH = height === "100%" ? "100%" : height;
  const placeholderCls = height === "100%" ? "h-full" : "h-[300px]";

  return (
    <div className={height === "100%" ? "h-full flex flex-col gap-2" : "space-y-3"}>

      {/* Header row: legend + live/historical badge + timestamp */}
      <div className="flex items-center justify-between flex-none">
        <div className="flex items-center gap-5">
          {allSeries.map((s) => (
            <Dot key={s.paramId} color={s.color} label={s.label} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10.5px] font-mono text-muted">
              {lastUpdated.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          {!isSpinning && !error && isLiveView && (
            <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-emerald-400">
              <Radio size={10} className="animate-pulse" />
              LIVE
            </div>
          )}
          {!isSpinning && !error && !isLiveView && (
            <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-blue-400">
              HISTORICAL
            </div>
          )}
        </div>
      </div>

      {/* Chart area */}
      <div className={height === "100%" ? "flex-1 min-h-0" : ""}>
      {error ? (
        <div className={`${placeholderCls} flex items-center justify-center gap-2 text-[12px] text-bad`}>
          <AlertCircle size={14} />{error}
        </div>
      ) : isSpinning ? (
        <div className={`${placeholderCls} flex items-center justify-center gap-2 text-[12px] text-muted`}>
          <RefreshCw size={13} className="animate-spin" /> Loading power data…
        </div>
      ) : data.length === 0 ? (
        <div className={`${placeholderCls} flex items-center justify-center text-[12px] text-muted`}>
          {isLiveView ? "No telemetry data for today yet." : "No data available for the selected range."}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={chartH}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              {allSeries.map((s) => (
                <linearGradient key={s.paramId} id={gradientId(s.paramId)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={s.color} stopOpacity={s.isDerived ? 0.12 : 0.22} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="t" {...axisProps} interval={tickInterval} />
            <YAxis
              {...axisProps}
              width={64}
              domain={domain}
              tickFormatter={(v: number) => `${v} kW`}
            />
            <ReferenceLine y={0} stroke="var(--chart-ref)" strokeDasharray="4 4" strokeWidth={1} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number, name: string) => [
                `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kW`,
                name,
              ]}
              cursor={{ stroke: CHART_MUTED, strokeWidth: 1, strokeDasharray: "3 3" }}
            />

            {allSeries.map((s) => (
              <Area
                key={s.paramId}
                type="linear"
                dataKey={s.paramId}
                name={s.label}
                stroke={s.color}
                strokeWidth={s.isDerived ? 1.5 : 2}
                fill={`url(#${gradientId(s.paramId)})`}
                dot={false}
                activeDot={{ r: 4, fill: s.color, strokeWidth: 0 }}
                connectNulls
              />
            ))}

            <Brush
              dataKey="t"
              height={28}
              stroke="var(--tooltip-line)"
              fill="var(--chart-brush-bg)"
              travellerWidth={6}
              startIndex={brushIndices?.start ?? 0}
              endIndex={brushIndices?.end ?? Math.max(0, data.length - 1)}
              onChange={(e) => {
                if (e && typeof e.startIndex === "number" && typeof e.endIndex === "number") {
                  setBrushIndices({ start: e.startIndex, end: e.endIndex });
                }
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
      </div>

      {/* Min / Max / Latest footer — hidden when height="100%" to save space */}
      {height !== "100%" && data.length > 0 && (
        <div className="border-t border-line pt-3">
          <div className="grid grid-cols-4 text-[10.5px] font-mono text-muted mb-1.5 px-1">
            <span /><span className="text-right">Min</span>
            <span className="text-right">Max</span><span className="text-right">Latest</span>
          </div>
          {allSeries.map(({ paramId, label, color }) => {
            const s = stats(paramId);
            if (!s) return null;
            return (
              <div key={paramId} className="grid grid-cols-4 items-center py-1 px-1 text-[11.5px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-ink2">{label}</span>
                </div>
                <span className="text-right font-mono text-ink">{s.min.toFixed(1)} kW</span>
                <span className="text-right font-mono text-ink">{s.max.toFixed(1)} kW</span>
                <span className="text-right font-mono font-semibold" style={{ color }}>
                  {s.latest.toFixed(1)} kW
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-ink3">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label}
    </div>
  );
}
