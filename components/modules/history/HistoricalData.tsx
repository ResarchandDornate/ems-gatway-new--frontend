"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Search, AlertTriangle } from "lucide-react";
import { usePlantConfig } from "@/hooks/usePlantConfig";
import { useDeviceKeys } from "@/hooks/useDeviceTelemetry";
import { useDeviceHistory } from "@/hooks/useDeviceHistory";
import { msToHm, msToDtLocal } from "@/lib/api/time";
import { activeProfile, classifyTags, type MetricId } from "@/lib/api/metrics";
import type { HistoryPoint } from "@/lib/api/services/history.service";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { istDateTimeInput, parseIst } from "@/lib/api/time";

const PALETTE = ["#5B8AB4", "#3E6E93", "#6FA3A0", "#8DA2BC", "#6E84A8", "#4E8D8A", "#A7BBD1", "#B3C4D6"];
const LINE = "var(--chart-grid)";
const axisProps = { tickLine: false, axisLine: false, tick: { fill: "#6B7280", fontSize: 10 } };

const INTERVAL_OPTIONS = [
  { label: "1 minute",   value: 60_000 },
  { label: "5 minutes",  value: 300_000 },
  { label: "15 minutes", value: 900_000 },
  { label: "1 hour",     value: 3_600_000 },
  { label: "1 day",      value: 86_400_000 },
];

/** One-click range shortcuts. Each carries a paired interval sized so the
 *  request stays well under the point-count safety limit — 30 days at the
 *  default 5-minute interval would ask for ~8,600 points, so wider ranges
 *  step up to a coarser interval instead of truncating on the first load. */
const RANGE_PRESETS = [
  { label: "1 Day",   days: 1,   interval: 300_000 },
  { label: "7 Days",  days: 7,   interval: 300_000 },
];

/** Matches the 5000-point safety ceiling the other UGX history calls in this
 *  codebase use (dataAnalysis.service.ts, deviceTelemetry.service.ts). UGX
 *  returns points reverse-chronological, so once a request exceeds this the
 *  oldest part of the range — not the newest — is what gets dropped. */
const MAX_LIMIT = 5000;
const ONE_DAY_MS = 24 * 3600_000;

/**
 * Curated "what an EMS operator actually looks at" groupings, expressed as
 * canonical metric ids rather than raw tag names — so they resolve through
 * the same profile-driven tag map every other screen uses (lib/api/metrics)
 * instead of hardcoding a vendor tag spelling that may not exist on every
 * device. A group renders only once at least one of its metrics has a real,
 * live tag on the current device (see quickCharts below) — nothing here is
 * asserted to exist, it is discovered.
 */
const PRESET_GROUPS: { id: string; title: string; metrics: MetricId[] }[] = [
  { id: "soc",      title: "State of Charge",          metrics: ["bank.soc", "rack.soc"] },
  { id: "power",    title: "Charge / Discharge Power",  metrics: ["bank.power", "rack.power"] },
  { id: "soh",      title: "State of Health",           metrics: ["bank.soh", "rack.soh"] },
  { id: "voltage",  title: "Bank / Rack Voltage",        metrics: ["bank.voltage", "rack.voltage"] },
  { id: "cellVolt", title: "Cell Voltage Range",         metrics: ["bank.cellVoltMax", "bank.cellVoltMin", "bank.cellVoltAvg"] },
  { id: "cellTemp", title: "Cell Temperature Range",     metrics: ["bank.cellTempMax", "bank.cellTempMin", "bank.cellTempAvg"] },
  { id: "grid",     title: "Grid Power & Frequency",     metrics: ["site.gridPower", "pcs.frequency"] },
  { id: "pcsAc",    title: "PCS AC Output",              metrics: ["pcs.activePower", "pcs.reactivePower", "pcs.apparentPower"] },
];

interface SeriesMeta { key: string; unit: string; color: string }

/* The input shows IST wall time, whatever zone the browser is in. */
function toDatetimeLocal(dt: Date) {
  return istDateTimeInput(dt.getTime());
}

/** Heckbert's "nice numbers" rounding — the standard trick for turning an
 *  arbitrary data range into round, evenly-spaced axis labels (1/2/5 × 10ⁿ)
 *  instead of whatever fractional bounds the raw min/max happened to produce. */
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  } else {
    niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

/** Rounds [rawMin, rawMax] to a nice domain plus explicit, evenly-spaced
 *  ticks — so every panel's Y-axis reads like a normal chart instead of
 *  Recharts picking "nice-ish" tick values inside an arbitrary padded domain
 *  (which is what produced the uneven-looking gaps: labels rounded, but the
 *  domain edges themselves weren't, so the first/last gap never matched). */
function niceAxis(rawMin: number, rawMax: number, targetTicks = 5): { domain: [number, number]; ticks: number[] } {
  if (rawMin === rawMax) { rawMin -= 1; rawMax += 1; }
  const range = niceNum(rawMax - rawMin, false);
  const step = niceNum(range / (targetTicks - 1), true);
  const niceMin = Math.floor(rawMin / step) * step;
  const niceMax = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  for (let t = niceMin; t <= niceMax + step / 2; t += step) {
    ticks.push(Math.round((t + Number.EPSILON) * 1e6) / 1e6);
  }
  return { domain: [niceMin, niceMax], ticks };
}

/** "D/M" — e.g. 1/7, 15/7. Derived from the same UTC calendar day the tooltip's
 *  msToDtLocal already uses, so the axis and the tooltip never disagree about
 *  which day a point falls on. */
function dayLabel(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${parseInt(iso.slice(8, 10), 10)}/${parseInt(iso.slice(5, 7), 10)}`;
}

/** One tick per calendar day, so a multi-day range labels every date instead
 *  of the 3–4 sparse ticks Recharts' default auto-spacing would pick. Used
 *  up to LONG_RANGE_MS (see below) — beyond that, monthTicks takes over so a
 *  year view isn't 365 individually-labeled days. */
function dayTicks(startTs: number, endTs: number): number[] {
  const ticks: number[] = [];
  for (let t = Math.ceil(startTs / ONE_DAY_MS) * ONE_DAY_MS; t <= endTs; t += ONE_DAY_MS) {
    ticks.push(t);
  }
  return ticks;
}

/** "M/YY" — e.g. 1/26, 2/26. One tick per calendar month, for ranges long
 *  enough (year-scale) that a tick per day would be unreadable regardless of
 *  chart width. */
function monthLabel(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${parseInt(iso.slice(5, 7), 10)}/${iso.slice(2, 4)}`;
}

function monthTicks(startTs: number, endTs: number): number[] {
  const s = new Date(startTs);
  let cursor = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1);
  if (cursor < startTs) cursor = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1);
  const ticks: number[] = [];
  while (cursor <= endTs) {
    ticks.push(cursor);
    const d = new Date(cursor);
    cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return ticks;
}

/** Past this span, switch from daily to monthly ticks. */
const LONG_RANGE_MS = 45 * ONE_DAY_MS;

/**
 * Time range + interval controls, shared by the Quick Charts panel and the
 * custom builder below so the preset buttons (1D/7D/30D/1Y) and layout only
 * need to be maintained in one place.
 */
function TimeRangeControls({
  startDt, endDt, interval, onStartChange, onEndChange, onIntervalChange, onPreset, trailing,
}: {
  startDt: string;
  endDt: string;
  interval: number;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  onIntervalChange: (v: number) => void;
  onPreset: (startDt: string, endDt: string, interval: number) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 flex-nowrap overflow-x-auto">
      <span className="text-[11.5px] text-ink3 flex-shrink-0">Time Select:</span>
      <div className="w-[180px] flex-shrink-0">
        <input
          type="datetime-local" value={startDt} onChange={(e) => onStartChange(e.target.value)}
          className="filter-input h-8 text-[11.5px]"
        />
      </div>
      <span className="text-muted text-[11px] flex-shrink-0">–</span>
      <div className="w-[180px] flex-shrink-0">
        <input
          type="datetime-local" value={endDt} onChange={(e) => onEndChange(e.target.value)}
          className="filter-input h-8 text-[11.5px]"
        />
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              const end = new Date();
              const start = new Date(end.getTime() - p.days * ONE_DAY_MS);
              onPreset(toDatetimeLocal(start), toDatetimeLocal(end), p.interval);
            }}
            className="px-2 h-8 rounded-md text-[10.5px] font-medium text-ink3 border border-line2 hover:text-ink hover:bg-surface3 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      <span className="text-[11.5px] text-ink3 flex-shrink-0 ml-2">Interval:</span>
      <div className="w-[130px] flex-shrink-0">
        <select
          value={interval}
          onChange={(e) => onIntervalChange(Number(e.target.value))}
          className="filter-input h-8 text-[11.5px]"
        >
          {INTERVAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {trailing}
    </div>
  );
}

/**
 * Shared multi-series time chart used by both the quick-chart presets and
 * the custom builder below, so unit-axis grouping/domain logic lives in one
 * place instead of being duplicated per chart instance.
 */
function HistorySeriesChart({
  data, seriesMeta, startTs, endTs, spanMs, compact,
}: {
  data: HistoryPoint[];
  seriesMeta: SeriesMeta[];
  startTs: number;
  endTs: number;
  spanMs: number;
  compact?: boolean;
}) {
  // Series of different units must not share one linear axis — a raw kWh
  // reading in the thousands next to a 0–100% SOC reading squashes the SOC
  // line flat against zero. Group selected keys by unit and give each group
  // its own axis+domain instead. A percentage group always stays fixed to
  // 0–100; every other group is auto-padded around its own min/max so a flat
  // or single-point series doesn't collapse to zero height.
  const unitGroups = useMemo(() => {
    const map = new Map<string, SeriesMeta[]>();
    for (const s of seriesMeta) {
      const id = s.unit || "unitless";
      const list = map.get(id) ?? [];
      list.push(s);
      map.set(id, list);
    }
    return Array.from(map.entries());
  }, [seriesMeta]);

  function axisSpecForGroup(unitId: string, group: SeriesMeta[]): { domain: [number, number]; ticks: number[] } {
    if (unitId === "%") return { domain: [0, 100], ticks: [0, 25, 50, 75, 100] };
    const vals = data
      .flatMap((d) => group.map((s) => d[s.key]))
      .filter((v): v is number => typeof v === "number");
    if (!vals.length) return { domain: [0, 1], ticks: [0, 1] };
    return niceAxis(Math.min(...vals, 0), Math.max(...vals, 0));
  }

  // Multi-day ranges get one explicit tick per calendar day ("D/M"); ranges
  // past LONG_RANGE_MS (year-scale) switch to one tick per month ("M/YY")
  // instead — 365 individually-labeled days would be unreadable no matter
  // how wide the chart is. Same-day ranges keep "HH:MM".
  const isMultiDay = spanMs > ONE_DAY_MS;
  const isLongRange = spanMs > LONG_RANGE_MS;
  const xTicks = isLongRange ? monthTicks(startTs, endTs) : isMultiDay ? dayTicks(startTs, endTs) : undefined;
  function xTickFormatter(v: number) {
    if (isLongRange) return monthLabel(v);
    return isMultiDay ? dayLabel(v) : msToHm(v);
  }

  // The hover tile renders in its own slot ABOVE the chart (where the legend
  // normally sits) instead of as a Recharts floating tooltip that follows the
  // cursor over the plot — a fixed slot in normal document flow can never
  // overlap the lines/axis below it, no matter how tall the tile gets with
  // 5-6 series. A crosshair (Tooltip's own `cursor`) still marks the hovered
  // x position on the chart itself.
  const [hover, setHover] = useState<{ ts: number; values: Record<string, number> } | null>(null);
  function handleMouseMove(e: { activeLabel?: string | number; activePayload?: { dataKey?: string | number; value?: unknown }[] }) {
    if (!e?.activePayload?.length) return;
    const values: Record<string, number> = {};
    for (const p of e.activePayload) {
      if (typeof p.dataKey === "string" && typeof p.value === "number") values[p.dataKey] = p.value;
    }
    setHover({ ts: Number(e.activeLabel), values });
  }
  function fmtVal(v: number) {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Fixed height regardless of hover state — swapping the plain legend
          for the hover tile must never resize this box, or the chart below
          visibly jumps/shrinks on every mouse move. Overflow scrolls inside
          the box instead of growing it. */}
      <div
        className={`mb-1 flex-none rounded-md overflow-y-auto no-scrollbar ${hover ? "border border-line bg-surface2 px-2 py-1" : ""}`}
        style={{ height: compact ? 44 : 54 }}
      >
        <div className={`flex items-center gap-${compact ? "2.5" : "4"} flex-wrap`}>
          {hover && (
            <span className="text-[9.5px] text-muted font-mono flex-shrink-0">{msToDtLocal(hover.ts)}</span>
          )}
          {seriesMeta.map((s) => {
            const v = hover?.values[s.key];
            return (
              <div key={s.key} className={`flex items-center gap-1 text-ink3 ${compact ? "text-[10px]" : "text-[11.5px]"}`}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <span className="truncate">
                  {s.key}{v != null ? `: ${fmtVal(v)}${s.unit}` : (!hover && s.unit ? ` (${s.unit})` : "")}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {!compact && unitGroups.length > 2 && (
        <p className="text-[10.5px] text-muted mb-3 flex-none">
          {unitGroups.length} different units selected — only the first two get a visible axis
          (left/right); the rest still scale correctly, just check the tooltip for exact values.
        </p>
      )}
      {(compact || unitGroups.length <= 2) && <div className="mb-2 flex-none" />}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHover(null)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
            <XAxis
              dataKey="ts"
              type="number"
              // Locked to the requested window, not the data's own min/max —
              // otherwise a device that only reports for part of the range
              // silently narrows the axis and hides how sparse the data is.
              domain={[startTs, endTs]}
              ticks={xTicks}
              // interval=0 forces every explicit day-tick to render — without
              // it Recharts silently drops ticks it thinks won't fit, which is
              // exactly the "hides dates" behaviour this replaces.
              interval={xTicks ? 0 : undefined}
              tickFormatter={xTickFormatter}
              minTickGap={xTicks ? 2 : 40}
              // Rotated so a full day-per-tick axis (up to ~60 labels) fits
              // without labels overlapping into an unreadable smear.
              angle={xTicks ? -60 : 0}
              textAnchor={xTicks ? "end" : "middle"}
              height={xTicks ? (compact ? 46 : 54) : 30}
              {...axisProps}
            />
            {unitGroups.map(([unitId, group], i) => {
              const spec = axisSpecForGroup(unitId, group);
              return (
                <YAxis
                  key={unitId}
                  yAxisId={unitId}
                  orientation={i % 2 === 0 ? "left" : "right"}
                  domain={spec.domain}
                  ticks={spec.ticks}
                  allowDataOverflow={false}
                  hide={i >= 2}
                  width={i < 2 ? (compact ? 40 : 56) : 0}
                  {...axisProps}
                />
              );
            })}
            {/* content=null suppresses the floating box entirely — hover values
                render in the legend row above instead (see `hover` state) —
                but this still draws the vertical crosshair at the cursor x. */}
            <Tooltip content={() => null} cursor={{ stroke: "var(--chart-ref)", strokeWidth: 1 }} />
            {seriesMeta.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                yAxisId={s.unit || "unitless"}
                name={s.unit ? `${s.key} (${s.unit})` : s.key}
                stroke={s.color}
                strokeWidth={2}
                // A line needs ≥2 points to draw a path — with dots off, a key that
                // only ever reported once (common for sparsely-updated readings)
                // renders as nothing at all. Small dots keep isolated points visible.
                dot={{ r: compact ? 1.5 : 2.5, fill: s.color, strokeWidth: 0 }}
                activeDot={{ r: 4, fill: s.color, strokeWidth: 0 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** One preset panel — fetches its own fixed recent window independently of
 *  the custom builder's state, so switching one never disturbs the other. */
function QuickChartCard({
  title, deviceId, tags, keyUnit, startTs, endTs, interval, limit,
}: {
  title: string;
  deviceId: string;
  tags: string[];
  keyUnit: (key: string) => string;
  startTs: number;
  endTs: number;
  interval: number;
  limit: number;
}) {
  const history = useDeviceHistory(deviceId, tags, startTs, endTs, interval, limit, !!deviceId && tags.length > 0);
  const data = history.data ?? [];
  const seriesMeta: SeriesMeta[] = tags.map((key, i) => ({ key, unit: keyUnit(key), color: PALETTE[i % PALETTE.length] }));

  return (
    <div className="surface-card overflow-hidden flex flex-col" style={{ height: 340 }}>
      <div className="px-3 py-2 border-b border-line flex-none">
        <h4 className="text-[11.5px] font-semibold text-ink">{title}</h4>
      </div>
      <div className="flex-1 min-h-0 p-3 flex flex-col overflow-hidden">
        {history.isLoading && <LoadingState rows={3} />}
        {history.isError && (
          <ErrorState
            message={(history.error as Error)?.message ?? "Failed to load."}
            onRetry={() => history.refetch()}
          />
        )}
        {!history.isLoading && !history.isError && data.length === 0 && (
          <EmptyState title="No data" description="No readings in this window." />
        )}
        {!history.isLoading && !history.isError && data.length > 0 && (
          <HistorySeriesChart data={data} seriesMeta={seriesMeta} startTs={startTs} endTs={endTs} spanMs={endTs - startTs} compact />
        )}
      </div>
    </div>
  );
}

export function HistoricalData({ stationId }: { stationId: string }) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - ONE_DAY_MS);

  const [startDt, setStartDt] = useState(toDatetimeLocal(dayAgo));
  const [endDt, setEndDt] = useState(toDatetimeLocal(now));
  const [interval, setInterval_] = useState(INTERVAL_OPTIONS[1].value);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [keyFilter, setKeyFilter] = useState("");

  // Quick Charts range — defaults to the last 24h, independently adjustable
  // from the custom builder's own range below.
  const [quickStartDt, setQuickStartDt] = useState(toDatetimeLocal(dayAgo));
  const [quickEndDt, setQuickEndDt] = useState(toDatetimeLocal(now));
  const [quickInterval, setQuickInterval] = useState(INTERVAL_OPTIONS[1].value);

  const [applied, setApplied] = useState<{
    startTs: number; endTs: number; interval: number; keys: string[]; limit: number; truncated: boolean;
  } | null>(null);

  const { data: config, isLoading: configLoading } = usePlantConfig(stationId);
  const deviceId = config?.deviceId ?? "";

  const { data: availableKeys = [], isLoading: keysLoading } = useDeviceKeys(deviceId);

  // Device changed (e.g. the user switched station) — the previous key
  // selection and any fetched series belong to a different device's key
  // namespace, so drop them instead of silently querying stale keys.
  useEffect(() => {
    setSelectedKeys([]);
    setApplied(null);
  }, [deviceId]);

  const filteredKeys = useMemo(
    () => availableKeys.filter((k) => k.key.toLowerCase().includes(keyFilter.toLowerCase())),
    [availableKeys, keyFilter]
  );

  // Group by inferred category (Power, Battery, Temperature, AC, DC, ...) so
  // keys like SOC or kW_* are easy to spot instead of one flat alphabetical list.
  const groupedKeys = useMemo(() => {
    const map = new Map<string, typeof filteredKeys>();
    for (const k of filteredKeys) {
      const list = map.get(k.category) ?? [];
      list.push(k);
      map.set(k.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredKeys]);

  const keyUnit = (key: string) => availableKeys.find((k) => k.key === key)?.unit ?? "";

  // Resolve each preset group's metric ids to whatever real tags this
  // specific device actually publishes, via the same tag-map every other
  // screen uses. A group with no matching live tag simply doesn't render —
  // nothing here is invented for a device that doesn't have it.
  const quickCharts = useMemo(() => {
    if (!availableKeys.length) return [];
    const { mapped } = classifyTags(activeProfile(), availableKeys.map((k) => k.key));
    const tagsByMetric = new Map<MetricId, string[]>();
    for (const [tag, match] of Object.entries(mapped)) {
      const list = tagsByMetric.get(match.metric) ?? [];
      list.push(tag);
      tagsByMetric.set(match.metric, list);
    }
    return PRESET_GROUPS
      .map((g) => ({ ...g, tags: g.metrics.flatMap((m) => tagsByMetric.get(m) ?? []) }))
      .filter((g) => g.tags.length > 0);
  }, [availableKeys]);

  const quickStartTs = new Date(quickStartDt).getTime();
  const quickEndTs = new Date(quickEndDt).getTime();
  const quickRangeValid = Number.isFinite(quickStartTs) && Number.isFinite(quickEndTs) && quickEndTs > quickStartTs;
  const quickSpanMs = quickRangeValid ? quickEndTs - quickStartTs : 0;
  const quickExpectedPoints = quickRangeValid ? Math.ceil(quickSpanMs / quickInterval) + 1 : 0;
  const quickIntervalWiderThanRange = quickRangeValid && quickInterval > quickSpanMs;
  const quickLimit = Math.min(MAX_LIMIT, Math.max(1, quickExpectedPoints));

  // ── Live validation of the current (not-yet-applied) form state ──────────
  /* The inputs hold IST wall time. */
  const startTs = parseIst(startDt);
  const endTs = parseIst(endDt);
  const rangeValid = Number.isFinite(startTs) && Number.isFinite(endTs) && endTs > startTs;
  const spanMs = rangeValid ? endTs - startTs : 0;
  const expectedPoints = rangeValid ? Math.ceil(spanMs / interval) + 1 : 0;
  const willTruncate = expectedPoints > MAX_LIMIT;
  const intervalWiderThanRange = rangeValid && interval > spanMs;

  const history = useDeviceHistory(
    deviceId,
    applied?.keys ?? [],
    applied?.startTs ?? 0,
    applied?.endTs ?? 0,
    applied?.interval ?? 60_000,
    applied?.limit ?? MAX_LIMIT,
    !!applied
  );

  function toggleKey(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function handleSearch() {
    if (!rangeValid || selectedKeys.length === 0) return;
    setApplied({
      startTs,
      endTs,
      interval,
      keys: selectedKeys,
      limit: Math.min(MAX_LIMIT, Math.max(1, expectedPoints)),
      truncated: willTruncate,
    });
  }

  const seriesMeta: SeriesMeta[] = (applied?.keys ?? []).map((key, i) => ({
    key,
    unit: keyUnit(key),
    color: PALETTE[i % PALETTE.length],
  }));

  const data = history.data ?? [];
  const appliedSpanMs = applied ? applied.endTs - applied.startTs : 0;

  return (
    <div className="flex flex-col gap-3 overflow-y-auto pr-1 page-fill">

      {/* ── Hero strip ──────────────────────────────────────────────────── */}
      <div className="surface-card ps-hero flex-none">
        <div>
          <h1 className="ps-hero-title">Historical Data</h1>
          <p className="ps-hero-sub">
            Curated quick charts, or build your own from any combination of tags and time range.
          </p>
        </div>
        <div className="ps-hero-stats">
          <div>
            <div className="ps-stat-k">Tags available</div>
            <div className="ps-stat-v" style={{ color: "var(--ink)" }}>
              {keysLoading ? "—" : availableKeys.length ? String(availableKeys.length) : "—"}
            </div>
          </div>
          <div>
            <div className="ps-stat-k">Quick charts</div>
            <div className="ps-stat-v" style={{ color: "var(--ink)" }}>
              {quickCharts.length ? String(quickCharts.length) : "—"}
            </div>
          </div>
          <div>
            <div className="ps-stat-k">Selected</div>
            <div className="ps-stat-v" style={{ color: "var(--ink)" }}>
              {selectedKeys.length ? String(selectedKeys.length) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Charts: curated presets, auto-populated from live tags ── */}
      {!configLoading && deviceId && (keysLoading || quickCharts.length > 0) && (
        <div className="flex-none">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-4 rounded-full bg-accent" />
            <h3 className="text-[12.5px] font-semibold text-ink">Quick Charts</h3>
            <span className="text-[10.5px] text-muted">— auto-selected from this device's live tags; defaults to the last 24h</span>
          </div>

          <div className="surface-card p-2.5 mb-2 flex flex-col gap-1.5">
            <TimeRangeControls
              startDt={quickStartDt}
              endDt={quickEndDt}
              interval={quickInterval}
              onStartChange={setQuickStartDt}
              onEndChange={setQuickEndDt}
              onIntervalChange={setQuickInterval}
              onPreset={(s, e, i) => { setQuickStartDt(s); setQuickEndDt(e); setQuickInterval(i); }}
            />
            {!quickRangeValid && (
              <p className="text-[11px] text-bad px-1">End time must be after start time.</p>
            )}
            {quickRangeValid && quickIntervalWiderThanRange && (
              <p className="text-[11px] text-muted px-1">
                Selected interval is wider than the time range — expect 0–1 points. Pick a smaller interval.
              </p>
            )}
          </div>

          {keysLoading ? (
            <LoadingState rows={3} />
          ) : !quickRangeValid ? null : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {quickCharts.map((g) => (
                <QuickChartCard
                  key={g.id}
                  title={g.title}
                  deviceId={deviceId}
                  tags={g.tags}
                  keyUnit={keyUnit}
                  startTs={quickStartTs}
                  endTs={quickEndTs}
                  interval={quickInterval}
                  limit={quickLimit}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Build Your Own: any combination, any range ────────────────── */}
      <div className="flex items-center gap-2 flex-none">
        <div className="w-1 h-4 rounded-full bg-accent" />
        <h3 className="text-[12.5px] font-semibold text-ink">Build Your Own</h3>
        <span className="text-[10.5px] text-muted">— pick any combination of tags and a custom time range</span>
      </div>

      <div className="flex gap-2 flex-none" style={{ height: 640 }}>

        {/* Sidebar: key selector, grouped by category */}
        <div className="w-[220px] flex-shrink-0 surface-card p-2 flex flex-col gap-2 overflow-hidden">
          <input
            type="text"
            value={keyFilter}
            onChange={(e) => setKeyFilter(e.target.value)}
            placeholder="Filter keys… e.g. soc, power"
            className="filter-input h-8 text-[11.5px]"
          />
          <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-0.5">
            {keysLoading && <LoadingState rows={6} />}
            {!keysLoading && filteredKeys.length === 0 && (
              <p className="text-[11px] text-muted px-2 py-4 text-center">No keys found.</p>
            )}
            {!keysLoading && groupedKeys.map(([category, ks]) => (
              <div key={category}>
                <div className="px-2 pt-2 pb-1 text-[11px] font-mono tracking-[1.2px] text-muted">
                  {category}
                </div>
                {ks.map((k) => (
                  <label
                    key={k.key}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface3 cursor-pointer text-[11.5px]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(k.key)}
                      onChange={() => toggleKey(k.key)}
                      className="accent-accent"
                    />
                    <span className="flex-1 truncate text-ink2">{k.key}</span>
                    {k.unit && <span className="text-muted font-mono text-[10px]">{k.unit}</span>}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden">

          {/* Controls row — always one line; scrolls horizontally rather than wrapping */}
          <div className="surface-card p-3 flex flex-col gap-2 flex-none">
            <TimeRangeControls
              startDt={startDt}
              endDt={endDt}
              interval={interval}
              onStartChange={setStartDt}
              onEndChange={setEndDt}
              onIntervalChange={setInterval_}
              onPreset={(s, e, i) => { setStartDt(s); setEndDt(e); setInterval_(i); }}
              trailing={
                <>
                  <button
                    onClick={handleSearch}
                    disabled={!deviceId || selectedKeys.length === 0 || !rangeValid}
                    className="btn-primary ml-2 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Search size={12} />Search
                  </button>

                  {rangeValid && selectedKeys.length > 0 && (
                    <span className="text-[10.5px] text-muted font-mono flex-shrink-0">
                      ≈{expectedPoints.toLocaleString()} pts/key
                    </span>
                  )}
                </>
              }
            />

            {/* Inline validation / heads-up messages for the current form state */}
            {!rangeValid && (
              <p className="text-[11px] text-bad px-1">End time must be after start time.</p>
            )}
            {rangeValid && intervalWiderThanRange && (
              <p className="text-[11px] text-muted px-1">
                Selected interval is wider than the time range — expect 0–1 points. Pick a smaller interval.
              </p>
            )}
            {rangeValid && !intervalWiderThanRange && willTruncate && (
              <div className="flex items-center gap-1.5 text-[11px] text-warn px-1">
                <AlertTriangle size={11} />
                This exceeds the {MAX_LIMIT.toLocaleString()}-point safety limit — only the most recent portion
                of the range will be returned. Narrow the range or increase the interval for full coverage.
              </div>
            )}
          </div>

          {/* Chart */}
          <div className="surface-card overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="px-5 py-4 border-b border-line flex items-center gap-2 flex-none">
              <div className="w-1 h-5 rounded-full bg-accent" />
              <h3 className="text-[13px] font-semibold text-ink">Historical Data</h3>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden p-5 flex flex-col">
              {configLoading && <LoadingState message="Loading device…" rows={4} />}

              {!configLoading && !deviceId && (
                <ErrorState message="No device found for this station." />
              )}

              {!configLoading && deviceId && !applied && (
                <EmptyState
                  title="No keys selected"
                  description="Pick one or more keys from the list, choose a time range and interval, then click Search."
                />
              )}

              {applied && history.isLoading && <LoadingState rows={6} />}

              {applied && history.isError && (
                <ErrorState
                  message={(history.error as Error)?.message ?? "Failed to load history."}
                  onRetry={() => history.refetch()}
                />
              )}

              {applied && !history.isLoading && !history.isError && data.length === 0 && (
                <EmptyState title="No data" description="No data available for the selected range." />
              )}

              {applied && !history.isLoading && !history.isError && data.length > 0 && (
                <HistorySeriesChart
                  data={data}
                  seriesMeta={seriesMeta}
                  startTs={applied.startTs}
                  endTs={applied.endTs}
                  spanMs={appliedSpanMs}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
