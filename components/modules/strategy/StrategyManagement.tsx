"use client";

import { useState } from "react";
import { BarChart3, Table2, Search, Download, RotateCcw } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import {
  useAntiBackflow, useAntiBackflowConfig, useBackflowMeters, useDeviceSchedule, useCabinetSetpoints, useStrategyCabinet, useDemandConfig,
} from "@/hooks/useStrategy";
import { LoadingState }    from "@/components/shared/LoadingState";
import { ErrorState }      from "@/components/shared/ErrorState";
import { PolicyTemplates } from "./PolicyTemplates";
import { PolicySchedule }  from "./PolicySchedule";
import { SocControllerView } from "./SocControllerView";
import { PairControlView } from "./PairControlView";
import { PageHeader } from "@/components/PageHeader";
import { istDate } from "@/lib/api/time";
import { downloadCsv } from "@/lib/csv";
import { AxisUnit } from "@/components/dashboard/viz/ChartCardHead";
import { PLOT_MARGIN, xAxis, yAxis, symmetricTicks, tickLabel } from "@/lib/charts/axes";
import { timeAxisProps, timeTooltipLabel } from "@/lib/charts/timeAxis";
import { parseIst } from "@/lib/api/time";
import { bessLabel } from "@/lib/api/services/bessLabel";

type NavKey   = "controller" | "templates" | "schedule" | "demand" | "antibackflow" | "paircontrol";
type ViewMode = "chart"  | "table";

const STEEL = "#5B8AB4", TEAL = "#6FA3A0", BLUE = "#3E6E93", LINE = "var(--chart-grid)";
const tooltipStyle = { background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-line)", borderRadius: 8, fontSize: 11, color: "var(--tooltip-ink)", padding: "8px 10px" };
const ax = { tickLine: false, axisLine: false, tick: { fill: "#6B7280", fontSize: 10 } };

// ── Anti-backflow view ─────────────────────────────────────────────────────────
function AntiBackflowView({ stationId }: { stationId: string }) {
  const today = istDate();
  const [date,       setDate]       = useState(today);
  const [searchDate, setSearchDate] = useState(today);
  const [meterId,    setMeterId]    = useState("");
  const [viewMode,   setViewMode]   = useState<ViewMode>("chart");
  const [searched,   setSearched]   = useState(false);

  // The utility meters on the gateway, with their p1354 comms status.
  const meters = useBackflowMeters(stationId);

  // Anti-backflow data — only fetched after user clicks Search
  const { data, isLoading, isError, refetch } = useAntiBackflow(
    stationId,
    searchDate,
    meterId || undefined
  );

  const ticks = backflowTicks(data ?? { rows: [], upperLimitKw: null, lowerLimitKw: null });

  function handleSearch() { setSearchDate(date); setSearched(true); }
  function handleReset()  {
    setDate(today); setSearchDate(today); setMeterId(""); setSearched(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The armed limits are a live reading and need no date, so they show
          before a search rather than only after one. */}
      <AntiBackflowConfigStrip />

      {/* Controls */}
      <div className="surface-card p-4 flex items-center gap-3 flex-wrap">
        <span className="text-[11.5px] text-ink3 flex-shrink-0">Date:</span>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="filter-input h-8 text-[11.5px] w-[140px]"
        />

        {/* Only where the site has a meter fitted (fetchBackflowMeters). */}
        {!!meters.data?.length && (
          <>
            <span className="text-[11.5px] text-ink3 flex-shrink-0 ml-2">Meter:</span>
            <select
              value={meterId}
              onChange={e => setMeterId(e.target.value)}
              className="filter-input h-8 text-[11.5px] w-[180px]"
            >
              <option value="">All Meters</option>
              {meters.data.map(m => (
                <option key={m.meterId} value={m.meterId}>{m.name}{m.online === false ? " — Offline" : ""}</option>
              ))}
            </select>
          </>
        )}

        <button onClick={handleReset}  className="btn-outline"><RotateCcw size={12} />Reset</button>
        <button onClick={handleSearch} className="btn-primary"><Search    size={12} />Search</button>
        <button
          className="btn-outline"
          disabled={!searched || !data?.rows.length}
          onClick={() => data && downloadCsv(`anti-backflow-${searchDate}.csv`, [
            ["time_ist", "grid_power_kw", "battery_power_kw", "upper_limit_kw", "lower_limit_kw", "anti_backflow"],
            ...data.rows.map(r => [r.t, r.gridPowerKw ?? "", r.batteryPowerKw ?? "", data.upperLimitKw ?? "", data.lowerLimitKw ?? "",
              data.enabled === null ? "" : data.enabled ? "armed" : "disabled"]),
          ])}
        ><Download size={12} />Export</button>

        {/* Chart / Table toggle */}
        <div className="ml-auto flex items-center gap-0.5 bg-surface/80 ring-1 ring-line rounded-md p-0.5">
          <button
            onClick={() => setViewMode("chart")}
            className={["flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-colors",
              viewMode === "chart" ? "bg-accent/15 text-accent ring-1 ring-accent/20" : "text-muted hover:text-ink"].join(" ")}
          >
            <BarChart3 size={13} /> Chart
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={["flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-colors",
              viewMode === "table" ? "bg-accent/15 text-accent ring-1 ring-accent/20" : "text-muted hover:text-ink"].join(" ")}
          >
            <Table2 size={13} /> Table
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="surface-card flex-1 overflow-hidden">
        {!searched ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-surface2 border border-line grid place-items-center text-3xl">📦</div>
            <p className="text-[13px] text-muted">Select A Date And Click Search</p>
          </div>
        ) : isLoading ? (
          <div className="p-5"><LoadingState rows={5} /></div>
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2">
            <p className="text-[13px] text-muted">No Readings For {searchDate}</p>
          </div>
        ) : viewMode === "chart" ? (
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <div className="w-1 h-5 rounded-full bg-accent" />
              <h3 className="text-[13px] font-semibold text-ink">Export Limit · {searchDate}</h3>
              <span className="text-[11px] text-muted ml-auto">
                {data.meterOnline === false ? "Grid meter offline (p1354 = 0) — grid power not drawn" : null}
                {data.meterOnline === false && data.enabled === false ? " · " : null}
                {data.enabled === false ? "The export limit is switched off — the limits below are what it would use" : null}
              </span>
            </div>
            <div style={{ position: "relative" }}>
            <AxisUnit unit="kW" />
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={data.rows} margin={PLOT_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
                {/* Real time across the chosen site day, so a gap in uploads takes
                    the room it took (it used to be one category per reading). */}
                <XAxis {...xAxis} {...timeAxisProps(data.rows, [parseIst(searchDate), parseIst(searchDate) + 86_400_000])} />
                <YAxis {...yAxis} ticks={ticks} domain={[ticks[0], ticks[ticks.length - 1]]} tickFormatter={tickLabel} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={timeTooltipLabel} formatter={(v: number) => [`${v} kW`]} />
                <Legend wrapperStyle={{ fontSize: 10.5, paddingTop: 8 }} iconType="line" iconSize={16} />
                {data.upperLimitKw != null && (
                  <ReferenceLine y={data.upperLimitKw} stroke={BLUE} strokeDasharray="5 3"
                    strokeOpacity={data.enabled === false ? 0.45 : 1}
                    label={{ value: `Upper ${data.upperLimitKw} kW${data.enabled === false ? " (Disabled)" : ""}`, position: "insideTopRight", fontSize: 10, fill: "#6B7280" }} />
                )}
                {data.lowerLimitKw != null && (
                  <ReferenceLine y={data.lowerLimitKw} stroke={BLUE} strokeDasharray="2 3"
                    strokeOpacity={data.enabled === false ? 0.45 : 1}
                    label={{ value: `Lower ${data.lowerLimitKw} kW`, position: "insideBottomRight", fontSize: 10, fill: "#6B7280" }} />
                )}
                <Line type="linear" dataKey="gridPowerKw"    name="Grid Power (kW)"    stroke={STEEL} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="linear" dataKey="batteryPowerKw" name="Battery Power (kW)" stroke={TEAL}  strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface2/40">
                  {["Time", "Grid Power (kW)", "Battery Power (kW)", "Upper Limit (kW)", "Lower Limit (kW)"].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.ts} className={`border-b border-line/40 last:border-none ${i % 2 === 0 ? "bg-surface2/15" : ""}`}>
                    <td className="py-2.5 px-4 font-mono text-ink3">{row.t}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-ink2">{row.gridPowerKw == null ? "—" : row.gridPowerKw.toFixed(1)}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-ink2">{row.batteryPowerKw == null ? "—" : row.batteryPowerKw.toFixed(1)}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-muted">{data.upperLimitKw ?? "—"}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-muted">{data.lowerLimitKw ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** Signed power around 0, wide enough to show both limits. */
function backflowTicks(d: { rows: { gridPowerKw: number | null; batteryPowerKw: number | null }[]; upperLimitKw: number | null; lowerLimitKw: number | null }) {
  const vals = d.rows.flatMap(r => [r.gridPowerKw, r.batteryPowerKw]).concat(d.upperLimitKw, d.lowerLimitKw)
    .filter((v): v is number => v != null).map(Math.abs);
  return symmetricTicks(Math.max(1, ...vals));
}

/**
 * What the cabinet is armed with, above the chart of what happened.
 *
 * The limits are real registers on ems_system. The chart below them is empty
 * and stays empty: it plots grid power, which comes from the utility meter,
 * and that meter reads 0.0 on all 43 of its registers because it is not
 * communicating. A flat zero drawn against a live threshold would say the site
 * never approached its export limit — a claim about the plant, not about a
 * dead instrument.
 */
function AntiBackflowConfigStrip() {
  const { data, isLoading } = useAntiBackflowConfig();
  if (isLoading || !data) return null;

  const kw = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} kW`);
  const armed = data.enabled;

  return (
    <div className="surface-card flex flex-wrap items-center gap-x-6 gap-y-2" style={{ padding: "10px var(--pad)" }}>
      <span className="card-eyebrow" style={{ margin: 0 }}>Configured On The Cabinet</span>
      <span className="text-[12.5px] font-semibold"
            style={{ color: armed === null ? "var(--muted)" : armed ? "var(--accent)" : "#C9A227" }}>
        {armed === null ? "Not Reported" : armed ? "Armed" : "Disabled"}
      </span>
      <span className="text-[11.5px] text-muted">Most Export Allowed {kw(data.upperLimitKw)}</span>
      <span className="text-[11.5px] text-muted">Target Floor {kw(data.lowerLimitKw)}</span>
    </div>
  );
}

/**
 * The dispatch schedule the cabinet is actually programmed with.
 *
 * Distinct from the policy templates beside it: a template is what somebody
 * intended, these registers are what the equipment will do tonight. An empty
 * slot is shown rather than hidden — "slot 3 is empty" and "slot 3 does not
 * exist" are different facts.
 */
function DeviceSchedulePanel() {
  const { data, isLoading } = useDeviceSchedule();
  if (isLoading) return <div className="p-5"><LoadingState rows={4} /></div>;
  if (!data) return null;

  const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);

  return (
    <div className="surface-card" style={{ padding: "var(--pad)", marginBottom: 12 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="card-eyebrow">On The Cabinet Now</p>
        <span className="text-[11px] text-muted">
          {data.programmedCount === 0
            ? `${data.slots.length} Slots, None Programmed`
            : `${data.programmedCount} Of ${data.slots.length} Slots Programmed`}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11.5px] text-muted">
        <span>Remote Control SOC Limits {data.socLimitEnabled === null ? "—" : data.socLimitEnabled ? "On" : "Off"}</span>
        <span>Charge Cutoff {pct(data.chargeCutoffSocPct)}</span>
        <span>Discharge Cutoff {pct(data.dischargeCutoffSocPct)}</span>
      </div>

      {data.programmedCount === 0 ? (
        <p className="text-[12px] text-ink3 mt-3 leading-relaxed">No Schedule Set</p>
      ) : (
        <div className="mt-3 grid gap-x-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {data.slots.filter((sl) => sl.programmed).map((sl) => (
            <div key={sl.index} className="flex justify-between gap-3 py-[5px] border-b border-line text-[11.5px]">
              <span className="text-muted">Slot {sl.index}</span>
              <span className="font-mono text-ink3">{sl.start}–{sl.end}</span>
              <span className="font-mono text-ink">{sl.activePowerKw?.toFixed(1)} kW</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A labelled register value, "—" when the register did not report. */
function Reading({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex justify-between gap-3 py-[5px] border-b border-line text-[11.5px]" title={title}>
      <span className="text-muted">{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}

const fmtKw   = (v: number | null, u = "kW") => (v == null ? "—" : `${v.toFixed(1)} ${u}`);
const fmtPct  = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const fmtOn   = (v: boolean | null) => (v == null ? "—" : v ? "On" : "Off");
/* Mode registers are shown as their raw code: the dictionary names the
   register but not its values, and a guessed word could say "auto" over a
   cabinet in manual. */
const fmtCode = (v: number | null) => (v == null ? "—" : `Code ${Math.round(v)}`);

/**
 * The set points the cabinet is running on, beside its timed schedule.
 *
 * Read from ems_system and the PCS of the selected cabinet. These are what
 * the EMS enforces when it is not taking orders from the remote block, so
 * the SOC cutoffs here are the ones that normally bite.
 */
function CabinetSetpointsPanel() {
  const { data, isLoading } = useCabinetSetpoints();
  const cabinet = useStrategyCabinet();
  if (isLoading) return <div className="p-5"><LoadingState rows={3} /></div>;
  if (!data) return null;

  return (
    <div className="surface-card" style={{ padding: "var(--pad)", marginBottom: 12 }}>
      <p className="card-eyebrow">
        Set Points On {cabinet.label ? bessLabel(cabinet.label) || cabinet.label : "The BESS"}
      </p>
      <div className="mt-2 grid gap-x-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <Reading label="Remote Mode"                 value={fmtCode(data.remoteMode)} />
        <Reading label="Manual / Auto Mode"          value={fmtCode(data.manualAutoMode)} />
        <Reading label="Manual Mode Control"         value={fmtCode(data.manualModeControl)} />
        <Reading label="Auto Mode Control"           value={fmtCode(data.autoModeControl)} />
        <Reading label="Charge/Discharge Control"    value={fmtCode(data.chargeDischargeControlMode)} />
        <Reading label="SOC Limits"                  value={fmtOn(data.socLimitEnabled)} />
        <Reading label="Charge Cutoff SOC"           value={fmtPct(data.chargeCutoffSocPct)} />
        <Reading label="Discharge Cutoff SOC"        value={fmtPct(data.dischargeCutoffSocPct)} />
        <Reading label="Manual Charge Setting"       value={fmtKw(data.manualChargeKw)} />
        <Reading label="Manual Discharge Setting"    value={fmtKw(data.manualDischargeKw)} />
        <Reading label="Auto Charge Planned"         value={fmtKw(data.autoChargePlannedKw)} />
        <Reading label="Auto Discharge Planned"      value={fmtKw(data.autoDischargePlannedKw)} />
        <Reading label="Charge Value Setting"        value={fmtKw(data.chargeValueKw)} />
        <Reading label="Discharge Value Setting"     value={fmtKw(data.dischargeValueKw)} />
        <Reading label="Remote Power Dispatch"       value={fmtKw(data.remoteDispatchKw)} />
        <Reading label="PCS Active Power Setting"    value={fmtKw(data.pcsActivePowerSettingKw)} />
        <Reading label="PCS Reactive Power Setting"  value={fmtKw(data.pcsReactivePowerSettingKvar, "kVar")} />
        <Reading label="Control Step"                value={fmtKw(data.controlStepKw)} />
        <Reading label="Control Cycle"               value={data.controlCycleS == null ? "—" : `${data.controlCycleS.toFixed(0)} s`} />
      </div>
      <p className="text-[11px] text-muted mt-2">
        Mode settings show the number the cabinet reports. Their meaning is set by the cabinet maker and is listed in its manual.
      </p>
    </div>
  );
}

/**
 * Demand management: the limiter's configuration on the selected cabinet.
 *
 * Only configuration. How close the site came to its demand needs grid power
 * from the utility meter, which is not communicating, over a day the backend
 * cannot return. That half is stated, not drawn.
 */
function DemandConfigPanel() {
  const { data, isLoading } = useDemandConfig();
  if (isLoading) return <LoadingState rows={3} />;
  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center py-16">
        <p className="text-[13px] text-muted">Demand Settings Not Reported</p>
      </div>
    );
  }

  const on = data.enabled;
  return (
    <div className="flex flex-col gap-3">
      <div className="surface-card" style={{ padding: "var(--pad)" }}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="card-eyebrow">Configured On The Cabinet</p>
          <span className="text-[12.5px] font-semibold"
                style={{ color: on === null ? "var(--muted)" : on ? "var(--accent)" : "#C9A227" }}>
            {on === null ? "Not Reported" : on ? "Demand Limit On" : "Demand Limit Off"}
          </span>
        </div>
        <div className="mt-2 grid gap-x-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          <Reading label="Demand Setting"   value={fmtKw(data.demandKw)} />
          <Reading label="Demand Limit"     value={fmtPct(data.limitPct)} />
          <Reading label="Ramp Rate Limit"  value={fmtOn(data.rateLimitEnabled)} />
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
const STRATEGY_NAV: { key: NavKey; label: string }[] = [
  { key: "controller",   label: "SOC Controller" },
  { key: "templates",    label: "Charge-Discharge Policy Template" },
  { key: "schedule",     label: "Charge-Discharge Policy" },
  { key: "paircontrol",  label: "Pair Control" },
  { key: "demand",       label: "Demand Management"      },
  { key: "antibackflow", label: "Export Limit (Anti-Backflow)" },
];

export function StrategyManagement({ stationId }: { stationId: string }) {
  const [activeNav, setActiveNav] = useState<NavKey>("controller");
  const activeLabel = STRATEGY_NAV.find(i => i.key === activeNav)?.label ?? "";

  return (
    <div className="page-fill" style={{ overflowY: "auto", paddingRight: 4, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Hero strip ──────────────────────────────────────────────── */}
      <PageHeader title="Strategy Management" info="The site's SOC controller, charge-discharge policy templates, demand management and anti-backflow limits for this power station." />

      {/* ── Numbered submenu + content ──────────────────────────────── */}
      <div className="ps-layout">
        <nav className="ps-submenu">
          {STRATEGY_NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveNav(item.key)}
              className={`ps-sm-item${activeNav === item.key ? " on" : ""}`}
              title={item.label}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="surface-card ps-panel">
          <div className="ps-panel-head">
            <h2>{activeLabel}</h2>
          </div>
          <div className="ps-panel-body">
            {activeNav === "controller" ? (
              <SocControllerView gatewayId={stationId} />
            ) : activeNav === "templates" ? (
              <PolicyTemplates stationId={stationId} />
            ) : activeNav === "schedule" ? (
              <>
                {/* What the cabinet is actually programmed with, above what
                    somebody planned. The two are different claims and the
                    screen previously only showed the second. */}
                <CabinetSetpointsPanel />
                <DeviceSchedulePanel />
                <PolicySchedule stationId={stationId} />
              </>
            ) : activeNav === "paircontrol" ? (
              <PairControlView gatewayId={stationId} />
            ) : activeNav === "demand" ? (
              <DemandConfigPanel />
            ) : (
              <AntiBackflowView stationId={stationId} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
