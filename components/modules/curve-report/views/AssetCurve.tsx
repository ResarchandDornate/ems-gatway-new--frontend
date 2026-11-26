"use client";

/**
 * Curve Display: pick an asset, tick its parameters, see one graph per
 * parameter, export.
 *
 *   · Assets are listed per cabinet — each device the gateway publishes (PCS,
 *     BMS, cooling, …), the BMS split into its cells and temperature probes,
 *     and the PCS / BMS 1 s fast stream as its own asset.
 *   · Up to five parameters are graphed at once, on one graph with three
 *     axes: time on X, and a Y axis each side. A unit shares its axis; a
 *     parameter with no unit has one to itself; a parameter that would need
 *     a third Y axis cannot be ticked (lib/charts/axisPlan). "Select more
 *     for download" lifts the limit for the download only: the first five
 *     ticked that fit the axes are the ones drawn.
 *   · Export is always there. With five or fewer ticked it offers the data
 *     (CSV), the graphs (PNG) and print / PDF; with more than five, only the
 *     CSV download, since the graphs on screen would not be the whole report.
 *   · Changing the asset clears the selection, so a graph never outlives the
 *     asset it belongs to.
 *
 * Every value plotted or exported is a reading from the backend
 * (pointsCentral.service); nothing is filled in.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter } from "recharts";
import { Search, RotateCcw, X, Download, ChevronDown, FileSpreadsheet, Image as ImageIcon, Printer } from "lucide-react";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { BucketChart } from "@/components/charts/BucketChart";
import { GENIE_RANGES, isDownloadOnly, aggregate, bucketsOf, kindOf, periodOf, type Period, type Kind } from "@/lib/charts/period";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { usePointList, usePointHistories, usePointsLatestTs } from "@/hooks/useDataAnalysis";
import { useCommDevices } from "@/hooks/usePowerStation";
import { DEVICE_TYPES, kindOf as deviceKindOf } from "@/lib/devices/registry";
import { useAppConfig } from "@/hooks/useAppConfig";
import { fetchPointHistory } from "@/lib/api/services/pointsCentral.service";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState }   from "@/components/shared/EmptyState";
import type { MeasurementPoint, PointHistoryEntry } from "@/lib/api/types";
import { PLOT_MARGIN, rangeTicks, tickLabel, xAxis, yAxis } from "@/lib/charts/axes";
import { timeAxisProps, timeTooltipLabel, withGaps, GAP_MS, TZ_LABEL } from "@/lib/charts/timeAxis";
import { useStableTicks } from "@/lib/charts/stable";
import { AxisUnit } from "@/components/dashboard/viz/ChartCardHead";
import { downloadCsv } from "@/lib/csv";
import { chartsToPng, downloadDataUrl, printImage } from "@/lib/charts/exportImage";
import { NearestTooltip, nearestValue } from "@/components/charts/NearestTooltip";
import { planAxes, blockReason, scaleKey, isUnitless, SIDES, type AxisPlan, type Side, type Sides } from "@/lib/charts/axisPlan";

/** One colour per line, five clearly different hues (all on one graph, so
 *  two blues side by side could not be told apart). Readable on light and
 *  dark cards alike. */
const SERIES = ["#2563EB", "#EA580C", "#16A34A", "#9333EA", "#DB2777"];
/** Graphs drawn at once. */
const MAX_GRAPHS = 5;
/** The combined graph's key in the export's element map. */
const COMBINED = "__combined";
/** Rows rendered in the parameter list; the filter reaches the rest. */
const GRID = "var(--chart-grid)";
const tooltipStyle = { background:"var(--tooltip-bg)", border:"1px solid var(--tooltip-line)", borderRadius:8, fontSize:11, color:"var(--tooltip-ink)", padding:"8px 10px" };

/* ── Assets ─────────────────────────────────────────────────────────────── */

const KIND_LABEL: Record<string, string> = {
  pcs: "PCS", bms: "BMS", liquid_cooling: "Liquid Cooling", dehumidifier: "Dehumidifier",
  remote_control: "Remote Control", grid_meter: "Grid Meter", ems: "EMS", ems_system: "EMS", io: "I/O", io_module: "I/O",
  fire: "Fire Protection", fire_protection: "Fire Protection",
};

/** A device id the roster would list: `external_ems_<n>_<kind>` with a registry kind. */
const isKnownDevice = (device: string) =>
  /^external_ems_\d+_/.test(device) && DEVICE_TYPES.some((t) => t.kind === deviceKindOf(device));

/** The point list carries "<device> / <key>" — split it back apart. */
function splitPoint(p: MeasurementPoint) {
  const i = p.name.indexOf(" / ");
  return { device: i === -1 ? "" : p.name.slice(0, i), key: i === -1 ? p.name : p.name.slice(i + 3) };
}

/* Words kept upper case in a parameter's label. */
const UPPER = new Set([
  "soc", "soh", "bms", "pcs", "ems", "dc", "ac", "io", "pv", "igbt", "ntc", "rtc", "can", "id", "ip", "hvac",
  "mppt", "pf", "kw", "kwh", "kva", "kvar", "rms", "hv", "lv", "ups", "dsp", "arm", "cpu", "fw", "hw", "sn",
]);

/** `rack_soc_too_low_l1_alarm` → `Rack SOC Too Low L1 Alarm`. Display only — the key stays the id. */
function paramLabel(key: string): string {
  if (!/[_a-z]/.test(key) || /\s/.test(key)) return key;   // already readable, or a bare id
  return key.split(/_+/).filter(Boolean).map((w) => {
    const l = w.toLowerCase();
    if (UPPER.has(l) || /^[a-z]\d+$/.test(l)) return l.toUpperCase();   // SOC, L1, P0204
    return `${l.charAt(0).toUpperCase()}${l.slice(1)}`;
  }).join(" ");
}

/** Asset names come space-separated (`bms bank 1`); same acronym-aware casing as paramLabel. */
function assetLabel(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => {
    const l = w.toLowerCase();
    if (UPPER.has(l) || /^[a-z]\d+$/.test(l)) return l.toUpperCase();
    return `${l.charAt(0).toUpperCase()}${l.slice(1)}`;
  }).join(" ");
}

/**
 * The unit to show. The point list labels some SOC settings kW
 * (master_charge_cutoff_soc_setting, master_discharge_cutoff_soc_setting);
 * a state of charge is a percentage.
 */
function unitOf(p: MeasurementPoint): string {
  const key = splitPoint(p).key.toLowerCase();
  /* A cell or probe number is a position, not a reading of anything. */
  if (/(_id|_no|_number|_index)$/.test(key)) return "";
  if (/(^|_)soc(_|$)/.test(key) && /^k?w$/i.test(p.unit ?? "")) return "%";
  if (p.unit) return p.unit.replace(/℃/g, "°C");
  /* The fast stream (1 Hz) sends no units; its common quantities by name. */
  if (/(^|_)(soc|soh)(_|$)/.test(key)) return "%";
  if (/temperature/.test(key)) return "°C";
  if (/frequency/.test(key)) return "Hz";
  if (/(^|_)power$|_power(_|$)/.test(key) && !/factor/.test(key)) return "kW";
  if (/voltage$|_voltage_|voltage_diff/.test(key)) return /cell_/.test(key) ? "mV" : "V";
  if (/current$|_current_/.test(key)) return "A";
  return "";
}

interface Asset {
  id: string;
  /** Cabinet source id, e.g. external_ems_1 ("" when the device names none). */
  source: string;
  device: string;
  label: string;
  points: MeasurementPoint[];
}

/** Which asset a point belongs to: its device, with the BMS's cells and probes and the fast stream apart. */
function assetFor(p: MeasurementPoint): Omit<Asset, "points"> {
  const { device } = splitPoint(p);
  const m = /^(external_ems_\d+)_(.+)$/.exec(device);
  const source = m?.[1] ?? "";
  const kind = m?.[2] ?? device;
  /* One entry per device: the BMS's cells, temperature probes and 1 Hz
     signals sit with the rest of the BMS (likewise the PCS); a fast-stream
     parameter is tagged "1 Hz" in its row instead. */
  const label = KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
  return { id: `${device}|${label}`, source, device, label };
}

/* ── Time ───────────────────────────────────────────────────────────────── */

function fmtWhen(ms: number) {
  return new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
/** `2026-10-11 12:46:16` — sortable, and no comma to quote in a CSV. */
const istStamp = (iso: string) =>
  new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 19).replace("T", " ");

/* ── One parameter's graph ──────────────────────────────────────────────── */

/** At least 2% of the level (and 1): a near-flat reading should look flat. */
function extent(v: number[]): readonly [number, number] {
  if (!v.length) return [0, 1];
  let lo = Math.min(...v), hi = Math.max(...v);
  const min = Math.max(1, Math.abs((lo + hi) / 2) * 0.02);
  if (hi - lo < min) { const mid = (lo + hi) / 2; lo = mid - min / 2; hi = mid + min / 2; }
  return [lo, hi];
}

/**
 * How a parameter's values should be scaled. A status or alarm flag (only a
 * handful of whole numbers, e.g. 0/1) gets those values as its ticks and a
 * stepped line — a sloped line between 0 and 1 would claim states in between.
 * Anything else is continuous and gets five round ticks around its range.
 */
function scaleFor(values: number[]): { discrete: number[] | null } {
  if (!values.length) return { discrete: null };
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  const discrete = distinct.length <= 6 && distinct.every(Number.isInteger) && distinct[distinct.length - 1] - distinct[0] <= 16;
  return { discrete: discrete ? (distinct.length === 1 ? [distinct[0]] : distinct) : null };
}

/** A gap wider than this breaks the line: 5 × the parameter's usual interval, at least GAP_MS. */
function gapFor(ts: number[]): number {
  if (ts.length < 3) return GAP_MS;
  const steps = ts.slice(1).map((t, i) => t - ts[i]).filter((d) => d > 0).sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)] ?? 0;
  return Math.max(GAP_MS, median * 5);
}

function ParamChart({
  point, asset, color, query, span, latestTs, onJump, chartRef, showTimeLabels, period,
}: {
  /** Day draws the readings; Week / Month / Year draw one bar per day or month. */
  period: Period;
  point: MeasurementPoint;
  asset: Asset;
  color: string;
  query: UseQueryResult<PointHistoryEntry[]>;
  span: [number, number];
  latestTs: number | null | undefined;
  onJump: (ms: number) => void;
  chartRef: (el: HTMLDivElement | null) => void;
  /** Only the bottom graph of a stack prints time labels; the rest keep the grid. */
  showTimeLabels: boolean;
}) {
  const key = paramLabel(splitPoint(point).key);
  const rows = useMemo(
    () => (query.data ?? []).map((e) => ({ ts: Date.parse(e.t), v: e.value })).filter((r) => !Number.isNaN(r.ts)),
    [query.data],
  );
  const values = useMemo(() => rows.map((r) => r.v), [rows]);
  const { discrete } = useMemo(() => scaleFor(values), [values]);
  const continuousTicks = useStableTicks(rangeTicks(...extent(values)), `${point.tagId}|${span.join("-")}`);
  /* Discrete: the states themselves, with half a step of room either side. */
  const ticks = discrete ?? continuousTicks;
  const domain: [number, number] = discrete
    ? [discrete[0] - 0.5, discrete[discrete.length - 1] + 0.5]
    : [continuousTicks[0], continuousTicks[continuousTicks.length - 1]];
  /* Lines break across holes instead of bridging them (no connectNulls). */
  const plotted = useMemo(() => withGaps(rows, gapFor(rows.map((r) => r.ts))), [rows]);
  const unit = unitOf(point);

  /* Week / Month / Year: one bucket per day (or month), from the readings in it. */
  const kind: Kind = useMemo(() => kindOf(unit, values), [unit, values]);
  const bucketed = period.range !== "day";
  const buckets = useMemo(() => {
    if (!bucketed) return [];
    return aggregate(rows.map((r) => ({ ts: r.ts, value: r.v })), bucketsOf(period), kind)
      .map((b) => ({ ...b, range: b.min != null && b.max != null ? [b.min, b.max] as [number, number] : null }));
  /* (withRange in components/charts/BucketChart does the same for other charts.) */
  }, [bucketed, rows, period, kind]);
  const filled = buckets.filter((b) => b.n > 0).length;

  return (
    <div className="surface-card p-4 flex flex-col" ref={chartRef}>
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <i className="w-2.5 h-2.5 rounded-full self-center" style={{ background: color }} />
        <h3 className="text-[13px] font-semibold text-ink">{key}</h3>
        {unit && <span className="text-[11px] text-muted font-mono">{unit}</span>}
        <span className="text-[11px] text-muted" title={asset.device}>· {asset.label}</span>
        {rows.length > 0 && (
          <span className="text-[11px] text-muted font-mono ml-auto">
            {rows.length} Readings{bucketed ? ` · ${filled} Of ${buckets.length} ${period.range === "year" ? "Months" : "Days"} With Data` : ""}
          </span>
        )}
      </div>
      {query.isLoading ? (
        <LoadingState rows={3} />
      ) : query.isError ? (
        <p className="text-[12px] text-ink3 py-10 text-center">Could Not Read This Parameter</p>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center flex flex-col items-center gap-2">
          <p className="text-[12px] text-ink3">No Readings For {period.label}</p>
          <p className="text-[11.5px] text-muted">
            {latestTs ? `Last Reported ${fmtWhen(latestTs)} ${TZ_LABEL}` : latestTs === null ? "No Value Held" : "Checking…"}
          </p>
          {latestTs ? (
            <button onClick={() => onJump(latestTs)} className="btn-outline"><Search size={12} />Show Its Last Day Of Data</button>
          ) : null}
        </div>
      ) : bucketed ? (
        <BucketChart buckets={buckets} kind={kind} color={color} unit={unit} period={period} hideLabels={!showTimeLabels} />
      ) : (
        <div style={{ position: "relative" }} data-chart>
          <AxisUnit unit={unit} />
          <ResponsiveContainer width="100%" height={240}>
            {/* syncId: hovering one graph shows the others at the SAME timestamp
                (matched by value, never interpolated — a graph with no reading
                at that instant shows none). */}
            <LineChart data={plotted} margin={PLOT_MARGIN} syncId="asset-curve" syncMethod="value">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis {...xAxis} {...timeAxisProps(rows, span, { hideLabels: !showTimeLabels })} />
              <YAxis {...yAxis} domain={domain} ticks={ticks} tickFormatter={tickLabel} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={timeTooltipLabel}
                /* The value as the backend sent it — no rounding. */
                /* Seven significant digits: S1 sends 32-bit floats, so 24.3 arrives as
                   24.299999237060547 — the tail is storage noise, not precision. */
                formatter={(v) => [`${typeof v === "number" ? String(Number(v.toPrecision(7))) : v}${unit ? ` ${unit}` : ""}`, key]}
              />
              {/* Monotone, not linear: it still passes through every reading but
                  rounds the corners between them, and — unlike a plain spline —
                  never overshoots above or below the readings it joins, so no
                  peak or dip is drawn that the data does not have. */}
              <Line type={discrete ? "stepAfter" : "monotone"} dataKey="v" name={key} stroke={color} strokeWidth={1.8} dot={rows.length < 3} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ── All selected parameters in one graph ──────────────────────────────── */

interface CombinedItem {
  tagId: string;
  point: MeasurementPoint;
  asset: Asset;
  color: string;
  query: UseQueryResult<PointHistoryEntry[]>;
  /** The Y axis it is drawn against (planAxes). */
  side: Side;
}

const SIDE_LABEL: Record<Side, string> = { left: "Left Axis", right: "Right Axis" };

/**
 * Every selected parameter as a line on one graph, against the Y axis the
 * selection gave it (planAxes): at most two, left and right, both labelled.
 * Day draws the readings; Week / Month / Year one point per day or month
 * (the bucket's average, a counter's rise), so it stays one graph throughout.
 */
function CombinedChart({ items, period, span, chartRef }: {
  items: CombinedItem[];
  period: Period;
  span: [number, number];
  chartRef: (el: HTMLDivElement | null) => void;
}) {
  const bucketed = period.range !== "day";
  const lines = items.map((it) => {
    const unit = unitOf(it.point);
    const raw = (it.query.data ?? []).map((e) => ({ ts: Date.parse(e.t), v: e.value })).filter((r) => !Number.isNaN(r.ts));
    let data: { ts: number; v: number | null }[];
    if (bucketed) {
      const kind = kindOf(unit, raw.map((r) => r.v));
      data = aggregate(raw.map((r) => ({ ts: r.ts, value: r.v })), bucketsOf(period), kind)
        .map((b) => ({ ts: b.ts, v: b.avg }));
    } else {
      data = withGaps(raw, gapFor(raw.map((r) => r.ts)));
    }
    return { ...it, unit, key: paramLabel(splitPoint(it.point).key), raw, data };
  });
  /* The sides in use; each axis is scaled to the lines drawn against it. */
  const used = SIDES.filter((s) => lines.some((l) => l.side === s));
  /* The axis's unit; a unitless parameter's axis is named by its L / R tag in the legend. */
  const axisTitle = (s: Side) => lines.find((l) => l.side === s)?.unit ?? "";
  const ticksFor = (s: Side) => {
    const vals = lines.filter((l) => l.side === s).flatMap((l) => l.data.map((d) => d.v))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return rangeTicks(...extent(vals));
  };
  const loading = items.some((it) => it.query.isLoading);
  const anyData = lines.some((l) => l.raw.length > 0);
  const allTs = lines.flatMap((l) => l.data);

  return (
    <div className="surface-card p-4 flex flex-col" ref={chartRef}>
      <div className="flex items-center gap-x-4 gap-y-1.5 mb-3 flex-wrap">
        {lines.map((l) => (
          <span key={l.tagId} className="inline-flex items-center gap-1.5 text-[12px]">
            <i className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
            <span className="font-semibold text-ink">{l.key}</span>
            {l.unit && <span className="text-[11px] text-muted font-mono">{l.unit}</span>}
            <span className="text-[11px] text-muted" title={l.asset.device}>· {l.asset.label}</span>
            {used.length > 1 && <span className="text-[10px] text-muted font-mono border border-line rounded px-1 leading-4">{l.side === "left" ? "L" : "R"}</span>}
          </span>
        ))}
      </div>
      {loading && !anyData ? (
        <LoadingState rows={3} />
      ) : !anyData ? (
        <p className="text-[12px] text-ink3 py-10 text-center">No Readings For {period.label}</p>
      ) : (
        <div style={{ position: "relative" }} data-chart>
          {used.includes("left") && axisTitle("left") && <AxisUnit unit={axisTitle("left")} />}
          {used.includes("right") && axisTitle("right") && <span style={{ position: "absolute", top: 0, right: 4, fontSize: 10, color: "var(--muted)" }}>{axisTitle("right")}</span>}
          <ResponsiveContainer width="100%" height={340}>
            <LineChart margin={{ ...PLOT_MARGIN, right: used.includes("right") ? 8 : PLOT_MARGIN.right }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis {...xAxis} {...timeAxisProps(allTs, span)} />
              {used.map((s) => {
                const t = ticksFor(s);
                return (
                  <YAxis key={s} yAxisId={s} {...yAxis} orientation={s}
                    domain={[t[0], t[t.length - 1]]} ticks={t} tickFormatter={tickLabel} />
                );
              })}
              {/* Each line's own reading nearest the hovered time — the default
                  tooltip printed one line's value under every name. */}
              <Tooltip content={(p) => (
                <NearestTooltip active={p.active} label={p.label as number | undefined}
                  maxGapMs={bucketed ? (period.to - period.from) / 2 : Math.max(...lines.map((l) => gapFor(l.raw.map((r) => r.ts))))}
                  lines={lines.map((l) => ({ name: l.key, color: l.color, unit: l.unit, data: l.data }))} />
              )} />
              {lines.map((l) => (
                <Line key={l.tagId} yAxisId={l.side} data={l.data} dataKey="v" name={l.key}
                  type="monotone" stroke={l.color} strokeWidth={1.8} dot={l.data.length < 3}
                  isAnimationActive={false} connectNulls={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ── X–Y plot: any parameter against any others ─────────────────────────── */

interface XYOption { tagId: string; label: string; unit: string; group: string }
const TIME = "__time";
const MAX_Y = 5;

/**
 * One parameter (or time) on X against up to five on Y, as dots. Each Y
 * reading is paired with the X reading nearest it in time — within five
 * times X's usual spacing — so a dot is two values the site reported at the
 * same moment. Y parameters share the two Y axes as on the graph above: a
 * third unit cannot be ticked.
 */
/** What the page's Export reads off the X–Y plot. */
export interface XYExport {
  title: string;
  svg: () => SVGSVGElement | null;
  rows: () => unknown[][];
}

function XYPlot({ options, range, period, exportRef }: {
  options: XYOption[];
  range: { start: string; end: string };
  period: Period;
  exportRef: React.MutableRefObject<XYExport | null>;
}) {
  const [xTag, setXTag] = useState(TIME);
  const [yTags, setYTags] = useState<string[]>([]);
  const [find, setFind] = useState("");
  /* The search list: open while the box is in use, closed by a click
     anywhere else or Escape; ticking keeps it open for the next pick. */
  const [listOpen, setListOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listOpen) return;
    const close = (e: MouseEvent) => { if (!pickerRef.current?.contains(e.target as Node)) setListOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setListOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [listOpen]);
  const byTag = useMemo(() => new Map(options.map((o) => [o.tagId, o])), [options]);
  const groups = useMemo(() => {
    const m = new Map<string, XYOption[]>();
    for (const o of options) m.set(o.group, [...(m.get(o.group) ?? []), o]);
    return [...m.entries()];
  }, [options]);
  const words = find.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length
    ? options.filter((o) => words.every((w) => `${o.label} ${o.unit} ${o.group}`.toLowerCase().includes(w))).slice(0, 40)
    : [];

  /* The two Y axes, laid out as on the time graph (sides stick). */
  const sidesRef = useRef<Sides>({});
  const yPlan: AxisPlan = useMemo(() => {
    const next = planAxes(yTags.map((id) => ({ id, scale: scaleKey(byTag.get(id)?.unit ?? "", id) })), sidesRef.current, MAX_Y);
    sidesRef.current = next.sides;
    return next;
  }, [yTags, byTag]);
  const sideName = (s: Side) => {
    const scale = yPlan.sides[s];
    return !scale ? "" : isUnitless(scale) ? byTag.get(scale.slice(1))?.label ?? "No Unit" : scale;
  };
  const yBlock = (o: XYOption) => {
    const why = blockReason(yPlan, scaleKey(o.unit, o.tagId), MAX_Y);
    return why === "limit" ? `Limit ${MAX_Y} Y Parameters`
      : why === "axes" ? `Both Y Axes Are In Use (Left: ${sideName("left")} · Right: ${sideName("right")}). ${o.unit ? `A ${o.unit} Parameter` : "A Parameter With No Unit"} Needs An Axis Of Its Own.`
      : null;
  };

  const tags = [...(xTag === TIME ? [] : [xTag]), ...yTags];
  const hist = usePointHistories(tags, range.start, range.end);
  const series = (tag: string) => {
    const q = hist[tags.indexOf(tag)];
    return (q?.data ?? []).map((e) => ({ ts: Date.parse(e.t), v: e.value }))
      .filter((r) => !Number.isNaN(r.ts) && Number.isFinite(r.v)).sort((a, b) => a.ts - b.ts);
  };
  const loading = hist.some((q) => q.isLoading);

  const xSeries = xTag === TIME ? null : series(xTag);
  const tol = xSeries ? gapFor(xSeries.map((r) => r.ts)) : 0;
  const plotted = yTags.map((tag, i) => {
    const o = byTag.get(tag)!;
    const pts = series(tag).flatMap((r) => {
      const x = xSeries ? nearestValue(xSeries, r.ts, tol) : r.ts;
      return x == null ? [] : [{ x, y: r.v, ts: r.ts }];
    });
    return { tag, label: o?.label ?? tag, unit: o?.unit ?? "", color: SERIES[i % SERIES.length], pts, side: yPlan.sideOf.get(tag) ?? "left" };
  });
  const ySides = SIDES.filter((s) => plotted.some((l) => l.side === s));
  const xs = plotted.flatMap((l) => l.pts.map((p) => p.x));
  const xTicks = rangeTicks(...extent(xs));
  const xUnit = xTag === TIME ? "" : byTag.get(xTag)?.unit ?? "";
  const xLabel = xTag === TIME ? "Time" : byTag.get(xTag)?.label ?? "";
  const any = plotted.some((l) => l.pts.length > 0);
  const fmt = (v: number) => String(Number(v.toPrecision(6)));
  const plotRef = useRef<HTMLDivElement>(null);
  /* Export: the picture, and one row per dot — time, X, the Y it pairs. */
  exportRef.current = any ? {
    title: `${plotted.map((l) => l.label).join(" · ")} Vs ${xLabel}`,
    svg: () => plotRef.current?.querySelector<SVGSVGElement>("svg.recharts-surface") ?? null,
    rows: () => [
      ["time_ist", "x_parameter", "x_value", "x_unit", "y_parameter", "y_value", "y_unit"],
      ...plotted.flatMap((l) => l.pts.map((p) => [
        istStamp(new Date(p.ts).toISOString()), xLabel, xTag === TIME ? istStamp(new Date(p.x).toISOString()) : p.x, xUnit,
        l.label, p.y, l.unit,
      ])),
    ],
  } : null;

  return (
    <div className="surface-card p-4 flex flex-col gap-3">
      <h3 className="text-[14px] font-semibold text-ink">X–Y Plot</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted">X Axis</span>
          <select value={xTag} onChange={(e) => setXTag(e.target.value)} className="filter-input">
            <option value={TIME}>Time</option>
            {groups.map(([g, os]) => (
              <optgroup key={g} label={g}>
                {os.map((o) => <option key={o.tagId} value={o.tagId}>{o.label}{o.unit ? ` (${o.unit})` : ""}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5 relative" ref={pickerRef}>
          <span className="text-[11px] text-muted">Y Axis · Up To {MAX_Y}</span>
          <input value={find} placeholder="Search Parameters" className="filter-input"
            onChange={(e) => { setFind(e.target.value); setListOpen(true); }}
            onFocus={() => setListOpen(true)} />
          {listOpen && matches.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-surface shadow-lg">
              {matches.map((o) => {
                const on = yTags.includes(o.tagId);
                const block = on ? null : yBlock(o);
                return (
                  <label key={o.tagId} title={block ?? undefined}
                    className={`flex items-center gap-2 px-3 py-1.5 text-[12px] ${block ? "opacity-50 cursor-not-allowed" : "hover:bg-surface2 cursor-pointer"}`}>
                    <input type="checkbox" checked={on} disabled={!!block}
                      onChange={() => setYTags((t) => (on ? t.filter((x) => x !== o.tagId) : [...t, o.tagId]))} />
                    <span className="text-ink">{o.label}</span>
                    {o.unit && <span className="text-muted font-mono text-[11px]">{o.unit}</span>}
                    <span className="text-muted text-[11px] ml-auto">{o.group}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {yTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {plotted.map((l) => (
            <span key={l.tag} className="inline-flex items-center gap-1.5 text-[12px] rounded-full border border-line px-2.5 py-1">
              <i className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
              <span className="text-ink">{l.label}</span>
              {l.unit && <span className="text-muted font-mono text-[11px]">{l.unit}</span>}
              {ySides.length > 1 && <span className="text-muted font-mono text-[10px]" title={l.side === "left" ? "Left Axis" : "Right Axis"}>{l.side === "left" ? "L" : "R"}</span>}
              <button type="button" aria-label={`Remove ${l.label}`} onClick={() => setYTags((t) => t.filter((x) => x !== l.tag))}
                className="text-muted hover:text-ink"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {yTags.length === 0 ? (
        <p className="text-[12px] text-ink3 py-8 text-center">Choose The Y Parameters</p>
      ) : loading && !any ? (
        <LoadingState rows={3} />
      ) : !any ? (
        <p className="text-[12px] text-ink3 py-8 text-center">No Readings For {period.label}</p>
      ) : (
        <div style={{ position: "relative" }} ref={plotRef}>
          {ySides.map((s) => {
            const u = plotted.find((l) => l.side === s)?.unit;
            return !u ? null : s === "left" ? <AxisUnit key={s} unit={u} />
              : <span key={s} style={{ position: "absolute", top: 0, right: 4, fontSize: 10, color: "var(--muted)" }}>{u}</span>;
          })}
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ ...PLOT_MARGIN, bottom: 18, right: ySides.includes("right") ? 8 : PLOT_MARGIN.right }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              {xTag === TIME
                ? <XAxis {...xAxis} {...timeAxisProps(xs.map((ts) => ({ ts })), [period.from, period.to])} dataKey="x" type="number" />
                : <XAxis {...xAxis} dataKey="x" type="number" domain={[xTicks[0], xTicks[xTicks.length - 1]]} ticks={xTicks}
                    tickFormatter={tickLabel} label={{ value: `${xLabel}${xUnit ? ` (${xUnit})` : ""}`, position: "insideBottom", offset: -12, fontSize: 11, fill: "var(--muted)" }} />}
              {ySides.map((s) => {
                const vals = plotted.filter((l) => l.side === s).flatMap((l) => l.pts.map((p) => p.y));
                const t = rangeTicks(...extent(vals));
                return <YAxis key={s} yAxisId={s} {...yAxis} dataKey="y" type="number" orientation={s}
                  domain={[t[0], t[t.length - 1]]} ticks={t} tickFormatter={tickLabel} />;
              })}
              <ZAxis range={[14, 14]} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  const d = active ? (payload?.[0]?.payload as { x: number; y: number; ts: number } | undefined) : undefined;
                  const line = plotted.find((l) => l.tag === (payload?.[0] as { name?: string } | undefined)?.name)
                    ?? plotted.find((l) => l.pts.some((p) => p === d));
                  if (!d) return null;
                  return (
                    <div style={tooltipStyle}>
                      <div style={{ marginBottom: 4 }}>{timeTooltipLabel(d.ts)}</div>
                      {xTag !== TIME && <div>{xLabel} : {fmt(d.x)}{xUnit ? ` ${xUnit}` : ""}</div>}
                      {line && <div style={{ color: line.color }}>{line.label} : {fmt(d.y)}{line.unit ? ` ${line.unit}` : ""}</div>}
                    </div>
                  );
                }} />
              {plotted.map((l) => (
                <Scatter key={l.tag} name={l.tag} yAxisId={l.side} data={l.pts} fill={l.color} isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ── The page ───────────────────────────────────────────────────────────── */

export function AssetCurve({ stationId }: { stationId: string }) {
  /* Day / Week / Month / Year, stepped with ‹ › or a swipe (PeriodNav). Every
     graph reads the same period, so their axes line up. Reads end at now:
     there is nothing to fetch from the rest of today. */
  const nav = usePeriod("day", GENIE_RANGES);
  const swipe = useSwipe(nav);
  const { period } = nav;
  /* A Month or Year is never graphed: it is a CSV download, of any number of parameters. */
  const downloadRange = isDownloadOnly(period.range);
  const range = useMemo(() => ({
    start: new Date(period.from).toISOString(),
    end: new Date(Math.min(period.to, Date.now() + 60_000)).toISOString(),
  }), [period]);
  const [assetId, setAssetId] = useState("");
  const [filter, setFilter] = useState("");
  /* Searches every asset at once; while it has text, the parameter panel lists
     its matches from all assets, and ticks can come from more than one. */
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [forDownload, setForDownload] = useState(false);
  /* Said when leaving download mode drops the parameters it could not graph. */
  const [notice, setNotice] = useState<string | null>(null);

  const points = usePointList(stationId);
  const { gatewayId } = useAppConfig();
  const queryClient = useQueryClient();

  /* Total lists every cabinet's assets; BESS 1 / BESS 2 only that one's. */
  const { isTotal, selected, all } = useSelectedCabinets();
  const scope = isTotal ? null : selected.map((c) => c.sourceId);
  const scopeKey = scope?.join(",") ?? "";

  /* A slot the gateway publishes with no device fitted (all zeros, link never
     up — lib/devices/registry) still has points, and is not an asset to pick.
     Only kinds the registry knows are checked against the roster. */
  const { data: roster } = useCommDevices(gatewayId);
  const fittedKey = roster?.map((d) => d.id).join(",") ?? "";

  const { assets, byCabinet } = useMemo(() => {
    const ids = scopeKey ? scopeKey.split(",") : null;
    const fitted = fittedKey ? new Set(fittedKey.split(",")) : null;
    const map = new Map<string, Asset>();
    for (const p of points.data ?? []) {
      const a = assetFor(p);
      if (ids && !ids.includes(a.source)) continue;
      if (fitted && isKnownDevice(a.device) && !fitted.has(a.device)) continue;
      const cur = map.get(a.id) ?? { ...a, points: [] };
      cur.points.push(p);
      map.set(a.id, cur);
    }
    const natural = (x: string, y: string) => x.localeCompare(y, undefined, { numeric: true });
    const list = [...map.values()].sort((x, y) => natural(x.source, y.source) || natural(x.label, y.label));
    for (const a of list) a.points.sort((x, y) => natural(splitPoint(x).key, splitPoint(y).key));
    const groups = new Map<string, Asset[]>();
    for (const a of list) groups.set(a.source, [...(groups.get(a.source) ?? []), a]);
    return { assets: list, byCabinet: [...groups.entries()] };
  }, [points.data, scopeKey, fittedKey]);

  const cabinetLabel0 = (source: string) => all.find((c) => c.sourceId === source)?.label ?? (source || "Site");
  const asset = assets.find((a) => a.id === assetId) ?? null;

  /* Every in-scope point with its asset, for the master search and for graphs
     whose parameters come from more than one asset. */
  const byTag = useMemo(() => {
    const m = new Map<string, { point: MeasurementPoint; asset: Asset }>();
    for (const a of assets) for (const p of a.points) m.set(p.tagId, { point: p, asset: a });
    return m;
  }, [assets]);

  /* Which Y axis each ticked parameter is drawn on, and which are drawn at
     all. Sides stick between selections (the ref), so a unit never swaps
     sides while it is still on the graph. */
  const scaleOfTag = (tagId: string) => {
    const p = byTag.get(tagId)?.point;
    return scaleKey(p ? unitOf(p) : "", tagId);
  };
  const sidesRef = useRef<Sides>({});
  const planFor = (tags: string[]) =>
    planAxes(tags.map((id) => ({ id, scale: scaleOfTag(id) })), sidesRef.current, MAX_GRAPHS);
  const plan = useMemo(() => {
    const next = planFor(picked);
    sidesRef.current = next.sides;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, byTag]);
  /** What a side carries, in words: its unit, or the unitless parameter's name. */
  const sideName = (s: Side) => {
    const scale = plan.sides[s];
    if (!scale) return "";
    if (!isUnitless(scale)) return scale;
    const p = byTag.get(scale.slice(1))?.point;
    return p ? paramLabel(splitPoint(p).key) : "No Unit";
  };
  /** Why a parameter cannot be graphed now. */
  function blockText(why: "limit" | "axes", p: MeasurementPoint) {
    if (why === "limit") return `Limit ${MAX_GRAPHS} Graphs`;
    const u = unitOf(p);
    return `Both Y Axes Are In Use (Left: ${sideName("left")} · Right: ${sideName("right")}). `
      + `${u ? `A ${u} Parameter` : "A Parameter With No Unit"} Needs An Axis Of Its Own — Remove The Parameters On One Side To Free It.`;
  }
  const q = query.trim().toLowerCase();
  const searchHits = useMemo(() => {
    if (!q) return [];
    const words = q.split(/\s+/);
    const out: { asset: Asset; points: MeasurementPoint[] }[] = [];
    for (const a of assets) {
      const hay = `${a.label} ${a.device} ${cabinetLabel0(a.source)}`.toLowerCase();
      const pts = a.points.filter((p) => {
        const k = splitPoint(p).key;
        const text = `${k} ${paramLabel(k)} ${unitOf(p)} ${p.tagId} ${hay}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
      if (pts.length) out.push({ asset: a, points: pts });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, assets]);
  const hitCount = searchHits.reduce((n, g) => n + g.points.length, 0);
  const cabinetLabel = cabinetLabel0;

  /* An asset that left the scope (cabinet picker) takes its selection with it. */
  useEffect(() => {
    if (assetId && !asset) { setAssetId(""); setPicked([]); }
  }, [assetId, asset]);

  function chooseAsset(id: string) {
    if (id === assetId) return;
    setNotice(null);
    setAssetId(id);
    setFilter("");
    setQuery("");
    setPicked([]);              // never carry graphs over from another asset
  }

  const assetPoints = asset?.points ?? [];
  const needle  = filter.trim().toLowerCase();
  const matches = needle ? assetPoints.filter((p) => { const k = splitPoint(p).key; return `${k} ${paramLabel(k)}`.toLowerCase().includes(needle); }) : assetPoints;
  const shown   = matches;
  const anyCount = forDownload || downloadRange;
  const limit   = anyCount ? Infinity : MAX_GRAPHS;
  const full    = picked.length >= limit;

  function toggle(tagId: string) {
    setNotice(null);
    setPicked((cur) => {
      if (cur.includes(tagId)) return cur.filter((t) => t !== tagId);
      /* Download mode takes anything; otherwise only what can be graphed. */
      if (anyCount) return [...cur, tagId];
      return blockReason(planFor(cur), scaleOfTag(tagId), MAX_GRAPHS) ? cur : [...cur, tagId];
    });
  }
  function setDownloadMode(on: boolean) {
    setForDownload(on);
    setNotice(null);
    if (on) return;
    /* Back to graphing only: the download-only ticks go, and the page says which. */
    const dropped = picked.filter((t) => !plan.sideOf.has(t));
    if (!dropped.length) return;
    setPicked((cur) => cur.filter((t) => plan.sideOf.has(t)));
    const names = dropped.map((t) => { const p = pointOf(t); return p ? paramLabel(splitPoint(p).key) : t; });
    setNotice(`Removed ${dropped.length} Download-Only Parameter${dropped.length === 1 ? "" : "s"}: ${names.join(", ")}`);
  }
  function selectAllShown() {
    setPicked((cur) => {
      const next = [...cur];
      for (const p of shown) if (!next.includes(p.tagId) && next.length < limit) next.push(p.tagId);
      return next;
    });
  }
  function reset() {
    nav.setRange("day"); nav.today();
    setAssetId(""); setFilter(""); setQuery(""); setPicked([]); setForDownload(false); setNotice(null);
  }
  /** Jump to the day a parameter last reported. */
  function jumpTo(ms: number) { nav.jumpTo(periodOf("day", ms)); }

  const pointOf = (tagId: string) => byTag.get(tagId)?.point;
  /* Every in-scope parameter, for the X–Y plot's pickers. */
  const xyOptions = useMemo(() => [...byTag.values()].map(({ point, asset: a }) => ({
    tagId: point.tagId, label: paramLabel(splitPoint(point).key), unit: unitOf(point),
    group: `${cabinetLabel(a.source)} · ${a.label}`,
  })), [byTag]);
  const assetOfTag = (tagId: string) => byTag.get(tagId)?.asset ?? asset;
  const graphed = plan.graphed;
  const colorOf = (tagId: string) => SERIES[graphed.indexOf(tagId)];
  const histories = usePointHistories(downloadRange ? [] : graphed, range.start, range.end);
  const emptyTags = graphed.filter((_, i) => !histories[i]?.isLoading && (histories[i]?.data?.length ?? 0) === 0);
  const latest = usePointsLatestTs(emptyTags);
  /* The axis spans the whole period — a Day view of today runs to midnight. */
  const span: [number, number] = [period.from, period.to];
  /* The bottom graph that draws a chart carries the time labels — not one that
     is still loading or has no readings. */
  const labelledGraph = graphed.reduce((acc, _, i) => ((histories[i]?.data?.length ?? 0) > 0 ? i : acc), graphed.length - 1);

  /* ── Export ───────────────────────────────────────────────────────────── */

  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const chartEls = useRef(new Map<string, HTMLDivElement>());
  /* The X–Y plot below the time graph, for the same Export. */
  const xyExport = useRef<XYExport | null>(null);
  /* Some ticks are not on the graph, so a picture would not be the whole report. */
  const downloadOnly = downloadRange || plan.notGraphed.size > 0;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const firstAsset = picked.length ? assetOfTag(picked[0]) : asset;
  const mixed = picked.some((t) => assetOfTag(t)?.id !== firstAsset?.id);
  const fileBase = `curve-${mixed ? "search" : firstAsset?.device ?? "asset"}-${period.range}-${istStamp(new Date(period.from).toISOString()).slice(0, 10)}`;
  const heading = mixed ? `Selected Parameters — ${period.label}`
    : firstAsset ? `${cabinetLabel(firstAsset.source)} · ${firstAsset.label} — ${period.label}` : "";

  async function exportCsv() {
    const xy = downloadRange ? null : xyExport.current;
    if (picked.length === 0 && !xy) return;
    setBusy("Preparing The Download…"); setExportError(null); setMenuOpen(false);
    try {
      if (xy) downloadCsv(`${fileBase}-xy.csv`, xy.rows());
      if (picked.length === 0) return;
      /* Every ticked parameter, graphed or not — the same query the graphs
         use, so what is on screen is read from cache rather than again. */
      const series = await Promise.all(picked.map((tagId) => queryClient.fetchQuery({
        queryKey: ["dataAnalysis", "history", gatewayId, tagId, range.start, range.end] as const,
        queryFn: () => fetchPointHistory(gatewayId, tagId, range.start, range.end),
        staleTime: 60_000,
      })));
      const rows: unknown[][] = [["time_ist", "time_utc", "cabinet", "asset", "device", "parameter", "unit", "value"]];
      picked.forEach((tagId, i) => {
        const p = pointOf(tagId);
        const key = p ? splitPoint(p).key : tagId;
        const a = assetOfTag(tagId);
        for (const e of series[i]) rows.push([istStamp(e.t), e.t, a ? cabinetLabel(a.source) : "", a?.label ?? "", a?.device ?? "", key, p ? unitOf(p) : "", e.value]);
      });
      if (rows.length === 1) { setExportError("None of the selected parameters has a reading in this range, so there is nothing to download."); return; }
      downloadCsv(`${fileBase}.csv`, rows);
    } catch {
      setExportError("The download could not be prepared. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  async function chartImage(): Promise<string | null> {
    const one = chartEls.current.get(COMBINED)?.querySelector<SVGSVGElement>("[data-chart] svg.recharts-surface");
    const xy = xyExport.current;
    const xySvg = xy?.svg();
    if (one || xySvg) {
      const sections = [];
      if (one) {
        const title = graphed.map((t) => { const p = pointOf(t); return p ? paramLabel(splitPoint(p).key) : ""; }).filter(Boolean).join(" · ");
        sections.push({ title, subtitle: "", svg: one });
      }
      if (xy && xySvg) sections.push({ title: xy.title, subtitle: "X–Y Plot", svg: xySvg });
      return chartsToPng(heading || `X–Y Plot — ${period.label}`, sections);
    }
    const sections = graphed.flatMap((tagId) => {
      const svg = chartEls.current.get(tagId)?.querySelector<SVGSVGElement>("[data-chart] svg.recharts-surface");
      const p = pointOf(tagId);
      if (!svg || !p) return [];
      const u = unitOf(p);
      const a = assetOfTag(tagId);
      return [{ title: `${paramLabel(splitPoint(p).key)}${u ? ` (${u})` : ""}`, subtitle: a ? `${cabinetLabel(a.source)} · ${a.label}` : "", svg }];
    });
    if (!sections.length) { setExportError("No graph has data to export yet."); return null; }
    return chartsToPng(heading, sections);
  }

  async function exportPng() {
    setMenuOpen(false); setExportError(null); setBusy("Drawing The Graphs…");
    try { const url = await chartImage(); if (url) downloadDataUrl(`${fileBase}.png`, url); }
    catch { setExportError("The graphs could not be exported."); }
    finally { setBusy(null); }
  }
  async function exportPrint() {
    setMenuOpen(false); setExportError(null); setBusy("Drawing The Graphs…");
    try { const url = await chartImage(); if (url) printImage(heading, url); }
    catch { setExportError("The graphs could not be printed."); }
    finally { setBusy(null); }
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  if (points.isLoading) return <LoadingState rows={5} />;
  if (!assets.length)   return <EmptyState title="No Measurement Points" description="" />;

  /* Export has something when either graph does. */
  const nothing = picked.length === 0 && (downloadRange || !xyExport.current);

  /** One parameter's checkbox row, shared by the asset list and the search
   *  results. A render function, not a component: defined in here, a component
   *  would remount every row on each tick and drop the next click. */
  function paramRow(p: MeasurementPoint) {
    const on = picked.includes(p.tagId);
    const block = on ? null : blockReason(plan, scaleOfTag(p.tagId), MAX_GRAPHS);
    /* Download mode still takes it — for the download only. */
    const locked = !!block && !anyCount;
    const { key } = splitPoint(p);
    const unit = unitOf(p);
    const title = block ? `${forDownload ? "Download Only — " : ""}${blockText(block, p)}` : key;
    return (
      <label key={p.tagId} title={title}
        className={`flex items-center gap-1.5 text-[11px] leading-5 px-1 rounded ${on ? "text-ink" : locked ? "text-muted/60 cursor-not-allowed" : "text-ink2 hover:bg-surface2/60 cursor-pointer"}`}>
        <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(p.tagId)} className="accent-[var(--accent)] scale-90" />
        <span className="truncate">{paramLabel(key)}</span>
        {p.category === "fast" && <span className="text-accent font-mono text-[9px] shrink-0 border border-line rounded px-1 leading-4">1 Hz</span>}
        {unit && <span className="text-muted font-mono text-[9.5px] ml-auto shrink-0">{unit}</span>}
      </label>
    );
  }
  const menuItem = "w-full text-left flex items-start gap-2 px-3 py-2 text-[12px] rounded hover:bg-surface2 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col gap-3">
      {/* Range and export */}
      <div className="surface-card px-3 py-2.5 flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <PeriodNav state={nav} />
        </div>
        <button onClick={reset} className="btn-outline"><RotateCcw size={12} />Reset</button>

        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((o) => !o)} className="btn-outline" aria-haspopup="menu" aria-expanded={menuOpen} disabled={!!busy}>
            <Download size={12} />{busy ?? "Export"}<ChevronDown size={12} />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 mt-1 w-[270px] z-20 surface-card p-1.5 shadow-lg">
              {nothing ? (
                <p className="text-[11.5px] text-muted px-3 py-2">Nothing Selected</p>
              ) : (
                <>
                  <p className="text-[10.5px] text-muted px-3 pt-1 pb-1.5">
                    {picked.length > 0 && <>{mixed ? "Several Assets" : firstAsset?.label} · {picked.length} Parameter{picked.length === 1 ? "" : "s"}</>}
                    {picked.length > 0 && xyExport.current ? " · " : ""}
                    {xyExport.current ? "X–Y Plot" : ""}
                    {downloadRange ? " — Month And Year Are Download Only" : downloadOnly ? " — Not All Graphed, So Download Only" : ""}
                  </p>
                  <button role="menuitem" className={menuItem} onClick={exportCsv}>
                    <FileSpreadsheet size={13} className="mt-0.5" />
                    <span className="text-ink">Download Data (CSV)</span>
                  </button>
                  {!downloadOnly && (
                    <>
                      <button role="menuitem" className={menuItem} onClick={exportPng}>
                        <ImageIcon size={13} className="mt-0.5" />
                        <span className="text-ink">Download Graphs (PNG)</span>
                      </button>
                      <button role="menuitem" className={menuItem} onClick={exportPrint}>
                        <Printer size={13} className="mt-0.5" />
                        <span className="text-ink">Print / Save As PDF</span>
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {exportError && <p className="text-[11.5px] text-[#A8505E] -mt-2">{exportError}</p>}

      {/* Master search — every asset at once */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Every Asset — e.g. “temperature”, “soc”, “bms cell 12”, “kWh”, “p0204”"
          aria-label="Search all parameters" className="filter-input h-9 text-[12px] w-full" style={{ paddingLeft: 32, paddingRight: 32 }} />
        {query && (
          <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={13} /></button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Assets */}
        <nav className="surface-card p-1.5 flex flex-col gap-1 lg:max-h-[380px] lg:overflow-auto" aria-label="Assets">
          {/* Column headers: the asset, and how many parameters it carries. */}
          <div className="flex items-center gap-2 px-2 pt-1 pb-1 mb-0.5 border-b border-line text-[10px] uppercase tracking-wide text-muted">
            <span>Parameter</span>
            <span className="ml-auto">Numbers</span>
          </div>
          {byCabinet.map(([source, list]) => {
            const groupLabel = assetLabel(cabinetLabel(source));
            return (
              <div key={source || "site"}>
                {/* The generic site bucket needs no sub-header; the column header covers it. */}
                {groupLabel.toLowerCase() !== "site" && (
                  <div className="text-[10px] uppercase tracking-wide text-muted px-2 pt-1 pb-0.5" title={source}>{groupLabel}</div>
                )}
                {list.map((a) => {
                  const on = a.id === assetId && !q;
                  return (
                    <button key={a.id} onClick={() => chooseAsset(a.id)} aria-current={on ? "true" : undefined}
                      className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded-md text-[11.5px] border transition-colors ${on ? "border-[var(--accent)] bg-[rgb(var(--color-accent)/0.08)] text-ink font-semibold" : "border-transparent text-ink2 hover:bg-surface2/60"}`}>
                      <span className="truncate">{assetLabel(a.label)}</span>
                      <span className="ml-auto text-[10px] text-muted font-mono">{a.points.length}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Parameters — the chosen asset's, or the master search's matches */}
        <div className="surface-card px-3 py-2.5 flex flex-col gap-2 min-w-0">
          {!asset && !q ? (
            <EmptyState title="Select An Asset Or Search" description="" />
          ) : (
            <>
              <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
                <h3 className="text-[13px] font-semibold text-ink">
                  {q ? <>Results For “{query.trim()}”</> : asset!.label}
                </h3>
                <span className="text-[11px] text-muted">
                  {q ? `${hitCount} In ${searchHits.length} Asset${searchHits.length === 1 ? "" : "s"}` : cabinetLabel(asset!.source)}
                </span>
                <span className={`text-[11px] font-semibold ${full ? "text-[#9C844A]" : "text-ink2"}`} aria-live="polite">
                  {downloadRange
                    ? `${picked.length} Selected`
                    : forDownload
                    ? `${picked.length} Selected · ${graphed.length}/${MAX_GRAPHS} Graphed`
                    : `${picked.length}/${MAX_GRAPHS} Selected`}
                </span>
                {!q && (
                  <>
                    <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter This Asset…"
                      aria-label="Search parameters" className="filter-input h-7 text-[11.5px] w-[180px]" />
                    <span className="text-[10.5px] text-muted font-mono">
                      {matches.length === assetPoints.length ? `${assetPoints.length}` : `${matches.length}/${assetPoints.length}`}
                    </span>
                  </>
                )}
                <label className="flex items-center gap-1.5 text-[11px] text-ink2 ml-auto cursor-pointer">
                  <input type="checkbox" checked={forDownload} onChange={(e) => setDownloadMode(e.target.checked)} className="accent-[var(--accent)]" />
                  More Than {MAX_GRAPHS} For Download
                </label>
              </div>

              {picked.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {picked.map((t) => {
                    const p = pointOf(t);
                    const k = p ? paramLabel(splitPoint(p).key) : t;
                    const a = assetOfTag(t);
                    const tagLabel = mixed && a ? `${k} · ${cabinetLabel(a.source)} ${a.label}` : k;
                    const side = plan.sideOf.get(t);
                    const why = plan.notGraphed.get(t);
                    return (
                      <span key={t} className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-surface2 border border-line">
                        {side
                          ? <i className="w-1.5 h-1.5 rounded-full" style={{ background: colorOf(t) }} />
                          : <Download size={9} className="text-muted" aria-label="Download only" />}
                        <span title={why && p ? `Download Only — ${blockText(why, p)}` : tagLabel}>{tagLabel}</span>
                        {side && <span className="text-[9.5px] text-muted font-mono" title={`${SIDE_LABEL[side]} · ${sideName(side)}`}>{side === "left" ? "L" : "R"}</span>}
                        <button onClick={() => toggle(t)} aria-label={`Remove ${k}`} className="text-muted hover:text-ink"><X size={10} /></button>
                      </span>
                    );
                  })}
                  <button onClick={() => { setPicked([]); setNotice(null); }} className="text-[11px] text-muted underline underline-offset-2 hover:text-ink ml-1">Clear</button>
                </div>
              )}

              {/* The graph's three axes and what each carries. */}
              {graphed.length > 0 && !downloadRange && (
                <p className="text-[10.5px] text-muted flex items-center gap-x-3 gap-y-0.5 flex-wrap" aria-live="polite">
                  <span>X: Time</span>
                  {SIDES.map((s) => (
                    <span key={s}>Y {s === "left" ? "Left" : "Right"}: <span className={plan.sides[s] ? "text-ink2 font-mono" : ""}>{sideName(s) || "Free"}</span></span>
                  ))}
                  {plan.sides.left && plan.sides.right && !forDownload && (
                    <span>Both Y Axes In Use — Only {sideName("left")} Or {sideName("right")} Parameters Can Be Added</span>
                  )}
                </p>
              )}
              {notice && <p className="text-[10.5px] text-[#9C844A]" role="status">{notice}</p>}

              {/* Scrolls inside its own box: eq-card sets overflow hidden, so the
                  scroll is set inline, after it. Up to half the screen tall. */}
              <div className="eq-card px-2 py-1" style={{ maxHeight: "50vh", overflowY: "auto" }}>
                {q ? (
                  hitCount === 0 ? <p className="text-[11.5px] text-muted p-2">No Match For “{query.trim()}”</p>
                  : searchHits.map((g) => (
                    <div key={g.asset.id} className="mb-1">
                      <div className="sticky top-0 bg-[var(--surface2,inherit)] text-[10px] tracking-wide text-muted pt-1 pb-0.5 z-[1]">
                        {cabinetLabel(g.asset.source)} · {g.asset.label} <span className="normal-case tracking-normal font-mono">({g.points.length})</span>
                      </div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-x-4">
                        {g.points.map(paramRow)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-x-4">
                    {shown.length === 0 && <p className="text-[11.5px] text-muted p-2">No Match For “{filter}”</p>}
                    {shown.map(paramRow)}
                  </div>
                )}
              </div>
              {(full && !forDownload) || (forDownload && (downloadOnly || shown.length > 0)) ? (
                <div className="flex items-center gap-3 flex-wrap text-[10.5px] text-muted">
                  {forDownload && !q && shown.length > 0 && (
                    <button onClick={selectAllShown} className="underline underline-offset-2 hover:text-ink">Select All {shown.length} Shown</button>
                  )}
                  {full && !forDownload && <span>Limit {MAX_GRAPHS} Graphs</span>}
                  {forDownload && downloadOnly && <span>{graphed.length} Graphed · All {picked.length} Downloaded</span>}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Graphs */}
      {downloadRange ? (asset || q || picked.length > 0) && (
        /* A Year: no graph, only the download. */
        <div className="surface-card p-4 min-h-[160px] flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-[13px] font-semibold text-ink">{period.label} Is Download Only</p>
          <p className="text-[11.5px] text-muted">A month or year is not graphed. Download the selected parameters' readings as a CSV.</p>
          <button onClick={exportCsv} className="btn-outline" disabled={!!busy || picked.length === 0}>
            <FileSpreadsheet size={12} />{busy ?? (picked.length ? `Download ${picked.length} Parameter${picked.length === 1 ? "" : "s"} (CSV)` : "Select Parameters To Download")}
          </button>
        </div>
      ) : (asset || q || picked.length > 0) && (
        graphed.length === 0 ? (
          <div className="surface-card p-4 min-h-[200px] grid place-items-center">
            <EmptyState title="No Parameters Selected" description="" />
          </div>
        ) : (
          /* One column, full width: every graph on the same time window, so
             their ticks and vertical grid lines line up; only the bottom one
             prints the time labels. */
          /* One graph for every selected parameter, on the period's time axis. */
          <div className="transition-opacity duration-200" {...swipe}>
            <CombinedChart
              key={`${period.range}|${period.from}`}
              period={period}
              span={span}
              items={graphed.flatMap((tagId, i) => {
                const p = pointOf(tagId);
                const a = assetOfTag(tagId);
                const side = plan.sideOf.get(tagId);
                return p && a && side ? [{ tagId, point: p, asset: a, color: SERIES[i], query: histories[i], side }] : [];
              })}
              chartRef={(el) => { if (el) chartEls.current.set(COMBINED, el); else chartEls.current.delete(COMBINED); }}
            />
          </div>
        )
      )}

      {/* Any parameter against any others, below the time graph. */}
      {xyOptions.length > 0 && !downloadRange && <XYPlot options={xyOptions} range={range} period={period} exportRef={xyExport} />}
    </div>
  );
}
