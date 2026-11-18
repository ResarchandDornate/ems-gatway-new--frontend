"use client";

/** Em dash for any register the device does not publish. */
const DASH = "—";

import { useState } from "react";
import { useCabinetDetail, usePcsData, useBmsData, useClusterData, useCellData, useEquipmentReadings } from "@/hooks/useEquipment";
import { SITE_TZ } from "@/lib/api/time";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState }   from "@/components/shared/ErrorState";
import type { WaterChillerInfo } from "@/lib/api/types";
import type { Cabinet, Pile, CellData } from "@/lib/api/types";
import { BatteryCellMap } from "../cellmap/BatteryCellMap";
import { PcsView }         from "./PcsView";
import { BmsView }         from "./BmsView";
import { ChillerView }     from "./ChillerView";
import { EnvironmentView } from "./EnvironmentView";
import { SubMeterView }    from "./SubMeterView";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  useColorThresholds, defaultThresholds, thresholdToColor, thresholdGradientCss,
  type ColorThresholds,
} from "@/hooks/useColorThresholds";
import { useNow } from "@/hooks/useNow";
import { describeTelemetry } from "@/lib/freshness";

/*
  The equipment in a cabinet, each tab named for a real thing an operator can
  walk up to.

  Battery System, Battery Cluster and Cell are commented out. The first two were
  aggregates of what BMS already reports, and Cell existed to carry the thermal
  map — which now lives inside BMS, where the min and max temperatures printed
  beside it give it its scale. Their tab components (BatterySystemTab,
  ClusterTab, CellTab) are untouched further down this file; restoring any of
  them is this list plus its render line at the bottom.
*/
type EssTab = "ESS Cabinet" | "PCS" | "BMS" | "Chiller" | "Environment" | "Sub Meter";
const ESS_TABS: EssTab[] = ["ESS Cabinet", "PCS", "BMS", "Chiller", "Environment", "Sub Meter"];
// Retired: "Battery System" | "Battery Cluster" | "Cell"

// ── Shared helpers ─────────────────────────────────────────────────────────────
const TEAL = "var(--accent)";

/** Section header inside a panel, with an optional right-aligned slot for a chip */
function SectionBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="eq-section">
      <span className="eq-section-title">{title}</span>
      {right}
    </div>
  );
}

/**
 * How old the displayed readings are, straight from the device clock.
 *
 * This is deliberately loud when stale. The values on these panels are always
 * *something* — UGX serves the last stored point forever — so without this the
 * only honest signal that a machine went quiet is invisible.
 */
function FreshnessChip({ ts, now }: { ts: number | null | undefined; now: number | null }) {
  const { state, label } = describeTelemetry(ts, now);

  const tone =
    state === "live"  ? { color: "var(--green)", bg: "rgba(78, 141, 110,.12)" } :
    state === "stale" ? { color: "var(--amber)", bg: "rgba(156, 132, 74,.14)" } :
                        { color: "var(--muted)", bg: "rgba(127,127,127,.12)" };

  return (
    <span
      className="px-2 py-0.5 rounded text-[11px] font-mono tracking-[1px] whitespace-nowrap"
      style={{ color: tone.color, background: tone.bg }}
      title={
        state === "live"
          ? "Age of the reading itself, measured from the device's own timestamp."
          : "The device has not published since this time. The values shown are its last known state, not the current one."
      }
    >
      {state === "stale" ? `⚠ ${label}` : label}
    </span>
  );
}

/** Large value + small unit on same line, label below */
/**
 * Format a reading, or an em dash when the device did not report it.
 * Absent is not zero: a blank register must never render as a real measurement.
 */
function dash(v: number | null | undefined, digits = 1): string {
  return v == null ? "—" : v.toFixed(digits);
}

/** Power as the PCS and BMS tabs show it: + discharging, − charging. */
function signedKw(v: number | null | undefined, digits = 1): string {
  if (v == null) return DASH;
  const r = Number(v.toFixed(digits));
  return r === 0 ? (0).toFixed(digits) : `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(digits)}`;
}

/** Difference of two readings — "—" unless both sides are present. */
function dashDiff(a: number | null | undefined, b: number | null | undefined, digits = 1): string {
  return a == null || b == null ? "—" : (a - b).toFixed(digits);
}

function KpiVal({ value, unit, label }: { value: React.ReactNode; unit: string; label: string }) {
  return (
    <div className="px-4 py-3 border-r border-line/40 last:border-none">
      <div className="flex items-baseline gap-1 leading-none">
        <span className="text-[22px] font-semibold text-ink tracking-tight">{value}</span>
        <span className="text-[11px] text-muted">{unit}</span>
      </div>
      <div className="text-[10.5px] text-ink3 mt-1.5">{label}</div>
    </div>
  );
}

/** Comm status row item */
function CommRow({ label, status, at }: { label: string; status: string; at?: number | null }) {
  /* "normal" / "abnormal" / "offline" from the cabinet service, or the
     shared verdict ("Online" / "Offline" / "Communication Lost"). */
  const s = status.toLowerCase();
  const ok = s === "normal" || s === "online";
  const lost = s === "abnormal" || s === "communication lost";
  return (
    <div className="px-4 py-3 border-b border-line/40 last:border-none">
      <div className={`text-[15px] font-semibold mb-1 ${ok ? "text-good" : lost ? "text-bad" : "text-muted"}`}>
        {ok ? "● Online" : lost ? "● Communication Lost" : "Offline"}
      </div>
      <div className="text-[10.5px] text-ink3">
        {label}
        {at != null && <> · Captured {new Date(at).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })}</>}
      </div>
    </div>
  );
}

// ── Water Chiller card (reusable for 1 or N chillers) ─────────────────────────
function WaterChillerCard({ w, title = "Liquid Cooling" }: {
  w: WaterChillerInfo;
  title?: string;
}) {
  /* Every reading is nullable now. A register the unit does not publish —
     pump speed has none on any asset — renders as a dash, and its unit is
     dropped with it: "— °c" reads as a measurement of nothing, while a bare
     dash reads as absent. Ambient is the unit's outdoor probe (p1169). */
  const n = (v: number | null, dp = 1) => (v == null ? DASH : v.toFixed(dp));
  const u = (v: number | null, unit: string) => (v == null ? "" : unit);

  return (
    <div>
      <SectionBar title={title} />
      <div className="grid grid-cols-3">
        <KpiVal value={<span className="text-[14px]" style={{color:TEAL}}>{w.tmsStatus === "auto" ? "Auto Mode" : w.tmsStatus}</span>} unit="" label="Cooling Mode" />
        <KpiVal value={n(w.outletTempC)}      unit={u(w.outletTempC, "°C")}      label="Outlet Temp" />
        <KpiVal value={n(w.inletTempC)}       unit={u(w.inletTempC, "°C")}       label="Inlet Temp" />
        <KpiVal value={n(w.ambientTempC)}     unit={u(w.ambientTempC, "°C")}     label="Outdoor Temp" />
        <KpiVal value={n(w.inletPressureBar)} unit={u(w.inletPressureBar, "Bar")} label="Inlet Pressure" />
        <KpiVal value={n(w.outletPressureBar)} unit={u(w.outletPressureBar, "Bar")} label="Outlet Pressure" />
      </div>
    </div>
  );
}

// ── ESS Cabinet tab ────────────────────────────────────────────────────────────
function EssCabinetTab({ cabinetId, stationId }: { cabinetId: string; stationId: string }) {
  const { data, isLoading, isError, refetch } = useCabinetDetail(cabinetId, stationId);
  /* The chiller block reads the Chiller tab's own query — same snapshot, same
     point-read fill and same mode decode — so the two can never disagree. */
  const { data: rd } = useEquipmentReadings(stationId, cabinetId);
  if (isLoading) return <div className="p-5"><LoadingState rows={4} /></div>;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const c = data.commStatus, o = data.operationInfo;
  const C = rd?.assets.includes("liquid_cooling") ? rd.chiller : null;
  const chillers: WaterChillerInfo[] = C ? [{
    tmsStatus: C.workMode,
    outletTempC: C.outletTempC,
    inletTempC: C.inletTempC,
    ambientTempC: C.outdoorTempC,
    inletPressureBar: C.inletPressureBar,
    outletPressureBar: C.outletPressureBar,
    compressorSpeedRpm: C.compressorAHz,
    pumpSpeedRpm: null,
  }] : [];

  return (
    <div className="eq-card">
      {/* Top row: Comm Status | Operation Info | (first chiller or empty) */}
      <div className={`grid grid-cols-1 divide-y md:divide-y-0 md:divide-x divide-line/40 ${chillers.length > 0 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {/* Comm Status */}
        <div>
          <SectionBar title="Communication" />
          <CommRow label="Site Gateway Link" status={c.edgeController} />
          {/* PCS and BMS: the same verdict and capture time as their own tabs. */}
          <CommRow label="PCS (Inverter) Link" status={rd?.comm.pcs.state ?? c.pcs} at={rd?.comm.pcs.at} />
          <CommRow label="BMS (Battery) Link" status={rd?.comm.bms.state ?? c.bms} at={rd?.comm.bms.at} />
        </div>

        {/* Operation Info */}
        <div>
          <SectionBar title="Operation Info" />
          <div className="grid grid-cols-2">
            <KpiVal value={<span className="text-[17px] capitalize">{o.chargeDischargeStatus}</span>} unit="" label="Charge/Discharge Status" />
            <KpiVal value={signedKw(o.realtimePowerKw)} unit={o.realtimePowerKw != null ? "kW" : ""}  label="Real-Time Power" />
            <KpiVal value={dash(o.socPct, 1)}                       unit={o.socPct != null ? "%" : ""}   label="SOC" />
            <KpiVal value={o.realtimeCapacityKwh != null ? o.realtimeCapacityKwh.toFixed(0) : DASH} unit={o.realtimeCapacityKwh != null ? "kWh" : ""} label="Stored Energy" />
          </div>
        </div>

        {/* First Water Chiller (if any) */}
        {chillers.length > 0 && (
          <WaterChillerCard
            w={chillers[0]}
            title={chillers.length > 1 ? "Water Chiller 1" : "Water Chiller Info"}
          />
        )}
      </div>

      {/* Additional chillers (index 1+) — each gets its own full-width row */}
      {chillers.slice(1).map((w, i) => (
        <div key={i + 1} className="border-t border-line/40">
          <WaterChillerCard w={w} title={`Water Chiller ${i + 2}`} />
        </div>
      ))}
    </div>
  );
}

// ── PCS tab ────────────────────────────────────────────────────────────────────
function PcsTab({ cabinetId, stationId, invN }: { cabinetId: string; stationId: string; invN: number }) {
  const { data, isLoading, isError, refetch } = usePcsData(cabinetId, stationId, invN);
  if (isLoading) return <div className="p-5"><LoadingState rows={4} /></div>;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  // A BESS device reports SOC; a solar inverter reports efficiency. Label the
  // temperature register for whichever family actually produced the reading.
  const isBess = data.socPct != null;

  return (
    <div className="eq-card flex flex-col gap-px">

      {/* Row 1: Status Info | Temp Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-line/40">

        {/* Status Info */}
        <div>
          <SectionBar title="Status Info" />
          <div className="grid grid-cols-2">
            <KpiVal value={data.runState || "—"} unit="" label="PCS Status" />
            <KpiVal value={DASH} unit="" label="PCS Mode" />
            <KpiVal value={DASH} unit="" label="DC Contactor" />
            <KpiVal value={DASH} unit="" label="AC Contactor" />
          </div>
        </div>

        {/* Temp Info */}
        <div>
          <SectionBar title="Temp Info" />
          <div className="grid grid-cols-3">
            <KpiVal
              value={dash(data.temperature, 1)}
              unit={data.temperature != null ? "°C" : ""}
              label={isBess ? "Max Battery Temp" : "Ambient Temp"}
            />
            <KpiVal value={DASH} unit="" label="Cabinet Temp" />
            <div /> {/* spacer */}
            <KpiVal value={DASH} unit="" label="IGBT-A Temp" />
            <KpiVal value={DASH} unit="" label="IGBT-B Temp" />
            <KpiVal value={DASH} unit="" label="IGBT-C Temp" />
          </div>
        </div>
      </div>

      {/* Row 2: AC Side Info */}
      <div>
        <SectionBar title="AC Side Info" />
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-10">
          <KpiVal value={dash(data.acVoltageV, 1)} unit={data.acVoltageV != null ? "V" : ""} label="AB Voltage" />
          <KpiVal value={DASH} unit="" label="BC Voltage" />
          <KpiVal value={DASH} unit="" label="AC Voltage" />
          <KpiVal value={dash(data.acCurrentA, 1)} unit={data.acCurrentA != null ? "A" : ""} label="Phase A Current" />
          <KpiVal value={DASH} unit="" label="Phase B Current" />
          <KpiVal value={DASH} unit="" label="Phase C Current" />
          <KpiVal value={dash(data.activePowerKw, 1)} unit={data.activePowerKw != null ? "kW" : ""} label="Active Power" />
          <KpiVal value={dash(data.reactivePowerKvar, 1)} unit={data.reactivePowerKvar != null ? "kVar" : ""} label="Reactive Power" />
          <KpiVal
            value={data.activePowerKw != null && data.reactivePowerKvar != null
              ? Math.sqrt(data.activePowerKw ** 2 + data.reactivePowerKvar ** 2).toFixed(1)
              : DASH}
            unit={data.activePowerKw != null && data.reactivePowerKvar != null ? "kVA" : ""}
            label="Apparent Power" />
          {isBess
            ? <KpiVal value={data.socPct != null ? data.socPct.toFixed(1) : "—"} unit="%" label="SOC" />
            : <KpiVal value={data.efficiency != null ? data.efficiency.toFixed(2) : "—"} unit={data.efficiency != null ? "%" : ""} label="Efficiency" />}
        </div>
      </div>

      {/* Row 3: DC Side Info */}
      <div>
        <SectionBar title="DC Side Info" />
        <div className="grid grid-cols-3">
          <KpiVal value={dash(data.dcVoltageV, 1)} unit={data.dcVoltageV != null ? "V" : ""}  label="DC Voltage" />
          <KpiVal value={dash(data.dcCurrentA, 1)} unit={data.dcCurrentA != null ? "A" : ""}  label="DC Current" />
          <KpiVal value={dash(data.dcPowerKw, 1)}  unit={data.dcPowerKw != null ? "kW" : ""} label="DC Power" />
        </div>
      </div>
    </div>
  );
}

// ── BMS tab ────────────────────────────────────────────────────────────────────
function BmsTab({ pile, stationId }: { pile: Pile; stationId: string }) {
  const { data, isLoading, isError, refetch } = useBmsData(pile.id, stationId);
  const now = useNow();
  if (isLoading) return <div className="p-5"><LoadingState rows={4} /></div>;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const STATUSES = ["Charging", "Discharging", "Standby", "Shutdown"];

  // With stale data the adapter reports "unknown", so none of the four lamps
  // light up — correct, but silent. The banner says why.
  const freshness = describeTelemetry(data.telemetryTs, now);

  return (
    <div className="eq-card flex flex-col gap-px">

      {freshness.state === "stale" && (
        <div
          className="px-4 py-2 text-[11.5px] flex items-center gap-2"
          style={{ background: "rgba(156, 132, 74,.08)", color: "var(--amber)" }}
        >
          <span className="font-semibold">Not live.</span>
          <span className="text-ink3">
            This device last reported {freshness.age} ago — the readings below are its last
            known state, not the current one.
          </span>
        </div>
      )}

      {/* Row 1: System Status | System Information | SOC */}
      <div
        className="grid grid-cols-1 md:grid-cols-[180px_1fr_160px] divide-y md:divide-y-0 md:divide-x divide-line/40"
        style={freshness.state === "stale" ? { opacity: 0.55 } : undefined}
      >

        {/* System Status */}
        <div>
          <SectionBar title="System Status" />
          <div className="px-4 py-3 space-y-2.5">
            {STATUSES.map(s => {
              const active = data.systemStatus.toLowerCase() === s.toLowerCase();
              return (
                <div key={s} className="flex items-center gap-2.5">
                  <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${active ? "border-accent bg-accent" : "border-line2"}`} />
                  <span className={`text-[12px] ${active ? "text-accent font-semibold" : "text-ink3"}`}>{s}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* System Information */}
        <div>
          <SectionBar title="System Information" />
          <div className="grid grid-cols-3 gap-px p-3">
            {[
              [`Total Battery Voltage:  ${dash(data.totalVoltageV, 2)} V`],
              [`Total Battery Current:  ${dash(data.totalCurrentA, 2)} A`],
              [`Total Power:  ${signedKw(data.totalPowerKw, 2)} kW`],
              [`Max Temperature Difference:  ${dashDiff(data.maxCellTempC, data.minCellTempC, 2)} °C`],
              [`Max Cell Voltage Difference:  ${dashDiff(data.maxCellVoltageM, data.minCellVoltageMv, 0)} mV`],
            ].map((item, i) => (
              <div key={i} className="border border-line/40 rounded px-3 py-2 text-[11.5px] text-ink2 bg-surface2/20">
                {item[0]}
              </div>
            ))}
          </div>
        </div>

        {/* SOC */}
        <div>
          <SectionBar title="SOC" />
          <div className="flex flex-col items-center justify-center py-4 px-2">
            {/* Battery icon */}
            <div className="relative w-10 h-20 border-2 border-line2 rounded-lg overflow-hidden mb-2">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-3 h-1.5 bg-line2 rounded-t" />
              <div className="absolute bottom-0 left-0 right-0 rounded-b bg-gradient-to-t from-accent to-accent"
                style={{ height: `${data.socPct ?? 0}%`, boxShadow: "0 0 8px rgba(91, 138, 180,.55)" }} />
            </div>
            <span className="text-[20px] font-semibold text-ink">{dash(data.socPct, 2)}</span>
            <span className="text-[11px] text-muted">%</span>
          </div>
        </div>
      </div>

      {/* Battery Information */}
      <div>
        <SectionBar title="Battery Information" />
        {([
          [
            [`Max Cell Temperature: ${dash(data.maxCellTempC, 2)} °C`, `Max Temp Cell ID: ${dash(data.maxTempProbeNo, 0)}`, `Min Cell Temperature: ${dash(data.minCellTempC, 2)} °C`, `Min Temp Cell ID: ${dash(data.minTempProbeNo, 0)}`],
          ],
          [
            [`Max Cell Voltage: ${dash(data.maxCellVoltageM, 2)} mV`, `Max Cell Voltage ID: ${dash(data.maxVoltCellNo, 0)}`, `Min Cell Voltage: ${dash(data.minCellVoltageMv, 2)} mV`, `Min Cell Voltage ID: ${dash(data.minVoltCellNo, 0)}`],
          ],
        ] as string[][][]).map((row, ri) => (
          <div key={ri} className="grid grid-cols-4 gap-px border-t border-line/40">
            {row[0].map((cell, ci) => (
              <div key={ci} className="border border-line/40 rounded mx-1 my-1 px-3 py-2 text-[11.5px] text-ink2 bg-surface2/20">
                {cell}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Battery Cluster tab ────────────────────────────────────────────────────────
function ClusterTab({ pile, stationId }: { pile: Pile; stationId: string }) {
  const { data, isLoading, isError, refetch } = useClusterData(pile.id, stationId);
  if (isLoading) return <div className="p-5"><LoadingState rows={3} /></div>;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  // Use first rack for display
  const rack = data[0];
  if (!rack) return <ErrorState onRetry={() => refetch()} />;
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  return (
    <div className="eq-card flex flex-col gap-px">

      {/* Overall Info */}
      <div>
        <SectionBar title="Overall Info" />
        <div className="grid grid-cols-2 md:grid-cols-4 md:divide-x divide-line/40">
          <KpiVal value={dash(rack.voltage)} unit="V"  label="Voltage" />
          <KpiVal value={dash(rack.current)} unit="A"  label="Current" />
          <KpiVal value={dash(rack.soc)}     unit="%"  label="SOC" />
          <KpiVal value={dash(rack.soh)}     unit={rack.soh != null ? "%" : ""}  label="SOH" />
        </div>
      </div>

      {/* Voltage Info */}
      <div className="border-t border-line/40">
        <SectionBar title="Voltage Info" />
        <div className="grid grid-cols-2 md:grid-cols-4 md:divide-x divide-line/40">
          <KpiVal value={dash(rack.maxCellVolt, 0)} unit="mV" label="Max Cell Voltage" />
          <KpiVal value={dash(rack.maxVoltCellNo, 0)} unit=""  label="Max Cell Num" />
          <KpiVal value={dash(rack.minCellVolt, 0)} unit="mV" label="Min Cell Voltage" />
          <KpiVal value={dash(rack.minVoltCellNo, 0)} unit=""  label="Min Cell Num" />
        </div>
        <div className="px-4 py-2 border-t border-line/40">
          <p className="text-[11.5px] text-ink3 mb-2">Cell Voltage Curve（{now}）</p>
          <div className="h-[140px] flex items-center justify-center text-[12px] text-muted">+ No Data</div>
        </div>
      </div>

      {/* Temp Info */}
      <div className="border-t border-line/40">
        <SectionBar title="Temp Info" />
        <div className="grid grid-cols-2 md:grid-cols-4 md:divide-x divide-line/40">
          <KpiVal value={dash(rack.maxCellTemp)} unit="°C" label="Max Temp" />
          <KpiVal value={dash(rack.maxTempProbeNo, 0)} unit="" label="Max Temp Num" />
          <KpiVal value={dash(rack.minCellTemp)} unit="°C" label="Min Temp" />
          <KpiVal value={dash(rack.minTempProbeNo, 0)} unit="" label="Min Temp Num" />
        </div>
        <div className="px-4 py-2 border-t border-line/40">
          <p className="text-[11.5px] text-ink3 mb-2">Temp Curve（{now}）</p>
          <div className="h-[100px] flex items-center justify-center text-[12px] text-muted">+ No Data</div>
        </div>
      </div>
    </div>
  );
}

// ── Battery System tab (unified: Stack → Pack → Cell → System) ────────────────
function BatterySystemTab({ pile, cabinetId, stationId }: { pile: Pile; cabinetId: string; stationId: string }) {
  const { data: bms,     isLoading: bmsLoading     } = useBmsData(pile.id, stationId);
  const { data: racks,   isLoading: racksLoading    } = useClusterData(pile.id, stationId);
  const { data: cells,   isLoading: cellsLoading    } = useCellData(pile.racks[0]?.id ?? "", stationId);
  const { data: cabinet, isLoading: cabinetLoading  } = useCabinetDetail(cabinetId, stationId);

  // Age of the readings, from the device's own timestamp — not from when we
  // polled. Every rack and cell on this tab comes from the same device, so one
  // age describes the whole screen.
  const now = useNow();
  const freshness = describeTelemetry(bms?.telemetryTs, now);
  const stale = freshness.state === "stale";

  const loading = bmsLoading || racksLoading || cellsLoading || cabinetLoading;
  if (loading) return <div className="p-5"><LoadingState rows={6} /></div>;

  // ── Section 1: STACK ──────────────────────────────────────────────────────
  const stackSoc   = bms?.socPct ?? null;
  const stackVolt  = bms?.totalVoltageV ?? null;
  const stackCurr  = bms?.totalCurrentA ?? null;
  const stackPower = bms?.totalPowerKw ?? null;
  const maxCellV   = bms?.maxCellVoltageM ?? null;
  const minCellV   = bms?.minCellVoltageMv ?? null;
  const maxTemp    = bms?.maxCellTempC ?? null;
  const bankSoh    = bms?.sohPct ?? null;
  const avgCellV   = bms?.avgCellVoltageMv ?? null;
  const avgTempC   = bms?.avgCellTempC ?? null;
  const minTemp    = bms?.minCellTempC ?? null;
  const systemStatus = bms?.systemStatus ?? "—";

  // ── Section 2: PACKS ─────────────────────────────────────────────────────
  // The rack and cell adapters carry no clock of their own — every register
  // here comes off the same device as the stack, so the stack's reading time
  // dates them too. Rows are kept and their values emptied rather than the
  // table being dropped: the pack layout is still the useful information when
  // a pile is quiet, and each cell already renders null as an em dash.
  const rackRows = (racks ?? []).map((r) =>
    stale
      ? { ...r, voltage: null, current: null, soc: null,
          maxCellTemp: null, minCellTemp: null, maxCellVolt: null, minCellVolt: null }
      : r
  );
  const cellRows = (cells ?? []).map((c) =>
    stale ? { ...c, voltMv: null, tempC: null } : c
  );

  // ── Section 4: SYSTEM ────────────────────────────────────────────────────
  const op = cabinet?.operationInfo;
  const cs = cabinet?.commStatus;

  return (
    <div className="flex flex-col gap-4">

      {/* ── 1. STACK LEVEL ─────────────────────────────────────────────── */}
      <div className="eq-card">
        <SectionBar
          title="Stack Level — Battery System Overview"
          right={<FreshnessChip ts={bms?.telemetryTs} now={now} />}
        />

        {/* Stale data still gets shown — it is the last known state and often the
            thing you want after an outage — but it must not read as current. */}
        {stale && (
          <div
            className="px-4 py-2 text-[11.5px] flex items-center gap-2 border-b border-line/40"
            style={{ background: "rgba(156, 132, 74,.08)", color: "var(--amber)" }}
          >
            <span className="font-semibold">Not live.</span>
            <span className="text-ink3">
              This device last reported {freshness.age} ago — the readings below are its last
              known state, not the current one.
            </span>
          </div>
        )}

        <div
          className="grid grid-cols-1 md:grid-cols-[180px_1fr] divide-y md:divide-y-0 md:divide-x divide-line/40"
          style={stale ? { opacity: 0.55 } : undefined}
        >

          {/* SOC battery icon */}
          <div className="flex flex-col items-center justify-center py-6 px-4 gap-2">
            <div className="relative w-12 h-24 border-2 border-line2 rounded-lg overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-4 h-2 bg-line2 rounded-t" />
              <div
                className="absolute bottom-0 left-0 right-0 rounded-b bg-gradient-to-t from-accent to-accent"
                style={{ height: stackSoc != null ? `${stackSoc}%` : "0%", boxShadow: "0 0 10px rgba(91, 138, 180,.5)" }}
              />
            </div>
            <div className="text-center">
              <div className="text-[26px] font-bold text-ink leading-none">{stackSoc != null ? stackSoc.toFixed(1) : "—"}</div>
              <div className="text-[12px] text-muted font-mono">% SOC</div>
            </div>
            <div
              className={[
                "mt-1 px-2 py-0.5 rounded text-[11px] font-mono tracking-[1px]",
                systemStatus.toLowerCase() === "charging"     ? "bg-good/10 text-good" :
                systemStatus.toLowerCase() === "discharging"  ? "bg-accent/10 text-accent" :
                "bg-surface2 text-muted",
              ].join(" ")}
            >
              {/* "unknown" is what the adapter reports when the reading is too old
                  to describe the present. Spelling it "No Signal" keeps it from
                  being read as a fifth operating mode. */}
              {systemStatus === "unknown" ? "No Signal" : systemStatus}
            </div>
          </div>

          {/* Stack KPI grid */}
          <div className="grid grid-cols-4">
            <KpiVal value={stackVolt  != null ? stackVolt.toFixed(1)            : "—"} unit="V"   label="Stack Voltage" />
            <KpiVal value={stackCurr  != null ? stackCurr.toFixed(1)            : "—"} unit="A"   label="Stack Current" />
            <KpiVal value={signedKw(stackPower)} unit="kW"  label="Stack Power" />
            <KpiVal value={dash(bankSoh)} unit={bankSoh != null ? "%" : ""} label="SOH" />
            <KpiVal value={maxCellV != null ? maxCellV.toFixed(0) : "—"} unit="mV" label="Max Cell Volt" />
            <KpiVal value={minCellV != null ? minCellV.toFixed(0) : "—"} unit="mV" label="Min Cell Volt" />
            <KpiVal value={maxCellV != null && minCellV != null ? (maxCellV - minCellV).toFixed(0) : "—"} unit="mV" label="Cell Volt Spread" />
            <KpiVal value={dash(avgCellV, 0)} unit={avgCellV != null ? "mV" : ""} label="Avg Cell Volt" />
            <KpiVal value={maxTemp != null ? maxTemp.toFixed(1) : "—"} unit="°C" label="Max Cell Temp" />
            <KpiVal value={minTemp != null ? minTemp.toFixed(1) : "—"} unit="°C" label="Min Cell Temp" />
            <KpiVal value={maxTemp != null && minTemp != null ? (maxTemp - minTemp).toFixed(1) : "—"} unit="°C" label="Temp Spread" />
            <KpiVal value={dash(avgTempC)} unit={avgTempC != null ? "°C" : ""} label="Avg Temp" />
          </div>
        </div>
      </div>

      {/* ── 2. PACK LEVEL ──────────────────────────────────────────────── */}
      <div className="eq-card">
        {/* Same device, same timestamp — the rack rows are exactly as stale as
            the stack figures above, so they carry the same marker. */}
        <SectionBar
          title="Pack Level — Rack / Battery Cluster Summary"
          right={<FreshnessChip ts={bms?.telemetryTs} now={now} />}
        />
        {rackRows.length === 0 ? (
          <div className="p-5 text-[12px] text-muted">No Rack Data Available</div>
        ) : (
          <div className="overflow-x-auto" style={stale ? { opacity: 0.55 } : undefined}>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left bg-surface2/30 border-b border-line text-[11px] font-mono tracking-[1.3px] text-muted">
                  {["Rack #", "Voltage (V)", "Current (A)", "SOC (%)", "Max Temp (°C)", "Min Temp (°C)", "Max Cell V (mV)", "Min Cell V (mV)", "Spread (mV)", "Status"].map(h => (
                    <th key={h} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rackRows.map((rack, i) => {
                  // Health needs both ends of the spread; without them the
                  // verdict is unknown rather than "good".
                  const spread = rack.maxCellVolt == null || rack.minCellVolt == null
                    ? null : rack.maxCellVolt - rack.minCellVolt;
                  const health = spread == null ? "unknown"
                    : spread <= 10 ? "good" : spread <= 30 ? "warn" : "bad";
                  return (
                    <tr key={i} className="border-t border-line/40 hover:bg-surface2/20 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-ink2">R{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{dash(rack.voltage)}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{dash(rack.current)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-surface2 rounded-full overflow-hidden">
                            <div className="h-full bg-accent rounded-full" style={{ width: `${rack.soc ?? 0}%` }} />
                          </div>
                          <span className="font-mono text-ink tabular-nums">{rack.soc == null ? "—" : `${rack.soc}%`}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{dash(rack.maxCellTemp)}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{dash(rack.minCellTemp)}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{dash(rack.maxCellVolt, 0)}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{dash(rack.minCellVolt, 0)}</td>
                      <td className="px-4 py-2.5">
                        <span className={[
                          "font-mono tabular-nums",
                          health === "unknown" ? "text-muted"
                            : health === "good" ? "text-good"
                            : health === "warn" ? "text-accent" : "text-bad",
                        ].join(" ")}>{dash(spread, 0)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                          health === "unknown" ? "bg-surface2 text-muted"
                            : health === "good" ? "bg-good/10 text-good"
                            : health === "warn" ? "bg-accent/10 text-accent" : "bg-bad/10 text-bad"
                        }`}>
                          {health === "unknown" ? "—"
                            : health === "good" ? "Normal" : health === "warn" ? "Caution" : "Alert"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 3. CELL LEVEL ──────────────────────────────────────────────── */}
      <div className="eq-card">
        <SectionBar title="Cell Level — 3D Cell Map" />
        {cellRows.length > 0
          ? (
            <BatteryCellMap
              cells={cellRows}
              mode="temperature"
              rackSoc={racks?.[0]?.soc ?? null}
              height={400}
            />
          )
          : (
            <div className="p-5 text-[12px] text-muted">
              No cell data available.
              <span className="block mt-1 text-[11px] text-ink3">
                This rack reports pack-level figures but publishes no per-cell
                registers, so there is nothing to map.
              </span>
            </div>
          )
        }
      </div>

      {/* ── 4. SYSTEM STATUS ───────────────────────────────────────────── */}
      <div className="eq-card">
        <SectionBar title="System — Operation & Communication Status" />
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-line/40">

          {/* Operation Info */}
          <div>
            <div className="px-4 py-2 border-b border-line/40">
              <span className="text-[11px] font-mono tracking-[1.2px] text-muted">Operation Info</span>
            </div>
            <div className="grid grid-cols-2">
              <KpiVal
                value={<span className="text-[15px] capitalize">{op?.chargeDischargeStatus ?? "—"}</span>}
                unit="" label="Charge/Discharge Status"
              />
              <KpiVal value={signedKw(op?.realtimePowerKw)} unit={op?.realtimePowerKw != null ? "kW" : ""}  label="Real-Time Power" />
              <KpiVal value={dash(op?.socPct, 1)}                                  unit={op?.socPct != null ? "%" : ""}   label="SOC" />
              <KpiVal
                value={op?.realtimeCapacityKwh != null ? op.realtimeCapacityKwh.toFixed(0) : DASH}
                unit={op?.realtimeCapacityKwh != null ? "kWh" : ""} label="Usable Capacity"
              />
            </div>
          </div>

          {/* Comm Status */}
          <div>
            <div className="px-4 py-2 border-b border-line/40">
              <span className="text-[11px] font-mono tracking-[1.2px] text-muted">Communication Status</span>
            </div>
            <CommRow label="Site Gateway"     status={cs?.edgeController ?? "—"} />
            <CommRow label="PCS"              status={cs?.pcs ?? "—"} />
            <CommRow label="BMS"              status={cs?.bms ?? "—"} />
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Cell heatmap helpers ───────────────────────────────────────────────────────

/**
 * Popover letting the user set the five colour breakpoints themselves —
 * e.g. "below 3100 mV is critical, 3250–3450 is nominal, 3350 is perfect" —
 * rather than the heatmap inventing a red-to-green spread from whatever the
 * current batch's min/max happens to be.
 */
/**
 * Always-visible panel — not a hidden popover — so the person reading the
 * heatmap can see and change what counts as red at a glance. "Critical"
 * here is entirely the user's call: nothing defaults to red just because it
 * is the lowest or highest reading in the current batch.
 */
function ThresholdEditor({
  thresholds, onChange, onReset, unit,
}: {
  thresholds: ColorThresholds;
  onChange: (t: ColorThresholds) => void;
  onReset: () => void;
  unit: string;
}) {
  const FIELDS: { key: keyof ColorThresholds; label: string; hint: string }[] = [
    { key: "critLow",  label: "Critical Below", hint: "critical low"  },
    { key: "nomLow",   label: "Nominal From",   hint: "nominal low"   },
    { key: "perfect",  label: "Perfect At",     hint: "target"        },
    { key: "nomHigh",  label: "Nominal To",     hint: "nominal high"  },
    { key: "critHigh", label: "Critical Above", hint: "critical high" },
  ];
  const ascending = FIELDS.every(
    (f, i) => i === 0 || thresholds[FIELDS[i - 1].key] <= thresholds[f.key]
  );

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface2/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-mono tracking-[1.2px] text-ink3">
          Choose What Counts As Critical ({unit})
        </span>
        <button onClick={onReset} className="text-[11px] text-accent hover:text-accent font-medium">
          Reset To This Batch
        </button>
      </div>
      <div className="h-3 rounded-sm mb-4" style={{ background: thresholdGradientCss(thresholds) }} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {FIELDS.map(f => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-[10px] text-muted whitespace-nowrap">{f.label}</span>
            <input
              type="number"
              value={thresholds[f.key]}
              onChange={e => onChange({ ...thresholds, [f.key]: Number(e.target.value) })}
              className="w-full h-8 px-2 bg-surface border border-line rounded text-[12px] text-ink outline-none focus:border-accent"
              title={f.hint}
            />
          </label>
        ))}
      </div>
      {!ascending && (
        <p className="text-[10px] text-amber-400 mt-3 leading-snug">
          Values should ascend left to right: Critical below → Nominal from → Perfect at → Nominal to → Critical above.
        </p>
      )}
    </div>
  );
}

function CellHeatmap({ cells }: { cells: CellData[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [mouse, setMouse]     = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Voltage stats — cells with no reading are excluded rather than counted as 0,
  // which would drag the average down and stretch the colour scale to zero.
  const voltages = cells.map(c => c.voltMv).filter((v): v is number => v != null);
  const minV = voltages.length ? Math.min(...voltages) : 0;
  const maxV = voltages.length ? Math.max(...voltages) : 0;
  const avgV = voltages.length ? Math.round(voltages.reduce((s, v) => s + v, 0) / voltages.length) : 0;
  const spread = maxV - minV;

  // User-chosen colour ranges, persisted across sessions and racks. Seeded
  // from this batch's own spread on first use — not an invented voltage spec
  // for hardware this app has no authority to characterise — but once the
  // user edits or a saved value exists, that takes over.
  const { thresholds, setThresholds, reset } =
    useColorThresholds("EMS_CELL_VOLT_THRESHOLDS", defaultThresholds(minV, maxV, avgV));

  // Histogram: 1 mV buckets capped at 10 buckets for readability
  const rawSpread = spread || 1;
  const bucketSize = Math.max(1, Math.ceil(rawSpread / 10));
  const bucketBase = minV;
  const numBuckets = Math.ceil((maxV - bucketBase) / bucketSize) + 1;
  const buckets = Array.from({ length: numBuckets }, (_, i) => ({
    mv: bucketBase + i * bucketSize,
    count: 0,
  }));
  voltages.forEach(v => {
    const idx = Math.min(Math.floor((v - bucketBase) / bucketSize), buckets.length - 1);
    if (buckets[idx]) buckets[idx].count++;
  });
  const bucketMax = Math.max(...buckets.map(b => b.count), 1);

  const COLS = 24;
  const hovCell = hovered !== null ? cells[hovered] : null;

  return (
    <div className="p-4 flex gap-5 flex-wrap" style={{ position: "relative" }}>

      {/* ── Floating cursor tooltip ─────────────────────────────────────── */}
      {hovCell !== null && (
        <div
          className="pointer-events-none fixed z-50 px-3 py-2 rounded-lg text-[12px] font-mono border shadow-xl"
          style={{
            left: mouse.x + 14,
            top:  mouse.y - 10,
            background: "var(--tooltip-bg)",
            border: "1px solid var(--tooltip-line)",
            color: "var(--tooltip-ink)",
            whiteSpace: "nowrap",
          }}
        >
          <div className="text-[11px] text-muted tracking-[1.2px] mb-1">
            Cell {hovered! + 1}
          </div>
          <div className="flex gap-3">
            <span>
              <span className="text-[15px] font-semibold text-ink">{dash(hovCell.voltMv, 0)}</span>
              <span className="text-muted ml-1">mV</span>
            </span>
            <span className="text-line">|</span>
            {/* Per-cell temperature, not SOC — the BMS publishes a real probe per
                cell, whereas every per-cell SOC register just repeats rack SOC. */}
            <span>
              <span className="text-[15px] font-semibold text-ink">{dash(hovCell.tempC, 1)}</span>
              <span className="text-muted ml-1">°C</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Left: grid ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Legend bar */}
        <div className="mb-3">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-muted tracking-[1.2px]">Voltage</span>
            <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ background: thresholdGradientCss(thresholds) }} />
            <span className="text-[11px] font-mono text-ink3 ml-1 bg-surface2 px-2 py-0.5 rounded">
              {cells.length} CELLS
            </span>
          </div>
          {/* Threshold ticks under the gradient — what each colour means */}
          <div className="flex justify-between mt-1 px-0.5">
            <span className="text-[9px] font-mono" style={{ color: thresholdToColor(thresholds.critLow, thresholds) }}>{thresholds.critLow}</span>
            <span className="text-[9px] font-mono" style={{ color: thresholdToColor(thresholds.nomLow, thresholds) }}>{thresholds.nomLow}</span>
            <span className="text-[9px] font-mono" style={{ color: thresholdToColor(thresholds.perfect, thresholds) }}>{thresholds.perfect} mV</span>
            <span className="text-[9px] font-mono" style={{ color: thresholdToColor(thresholds.nomHigh, thresholds) }}>{thresholds.nomHigh}</span>
            <span className="text-[9px] font-mono" style={{ color: thresholdToColor(thresholds.critHigh, thresholds) }}>{thresholds.critHigh}</span>
          </div>
        </div>

        {/* Cell grid */}
        <div
          className="grid gap-0.5 select-none"
          style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
          onMouseMove={e => setMouse({ x: e.clientX, y: e.clientY })}
        >
          {cells.map((cell, i) => {
            // No reading → neutral swatch, so a missing cell is visibly missing
            // rather than rendered at the bottom of the colour scale.
            const color = cell.voltMv == null
              ? "var(--surface3)"
              : thresholdToColor(cell.voltMv, thresholds);
            const isHov = hovered === i;
            return (
              <div
                key={cell.cellId}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className="aspect-square rounded-[2px] cursor-crosshair transition-transform"
                style={{
                  background: color,
                  outline: isHov ? "2px solid #fff" : undefined,
                  transform: isHov ? "scale(1.25)" : undefined,
                  zIndex: isHov ? 10 : undefined,
                  position: "relative",
                }}
              />
            );
          })}
        </div>

        {/* Range editor — permanently visible, not a hidden popover, so the
            person reading the heatmap can see and change what "red" means
            without hunting for a settings icon. */}
        <ThresholdEditor
          thresholds={thresholds}
          onChange={setThresholds}
          onReset={reset}
          unit="mV"
        />
      </div>

      {/* ── Right: stats + histogram ────────────────────────────────────── */}
      <div className="w-52 flex flex-col gap-3 shrink-0">
        {/* KPI stats */}
        {[
          { label: "AVG CELL VOLT", value: `${avgV}`, unit: "mV" },
          { label: "MIN CELL VOLT", value: `${minV}`, unit: "mV" },
          { label: "MAX CELL VOLT", value: `${maxV}`, unit: "mV" },
          { label: "VOLT SPREAD",   value: `${spread}`, unit: "mV" },
        ].map(s => (
          <div key={s.label} className="bg-surface2/60 rounded-md px-3 py-2">
            <div className="text-[11px] font-mono tracking-[1.2px] text-muted mb-0.5">{s.label}</div>
            <div className="flex items-baseline gap-1">
              <span className="text-[20px] font-semibold text-ink leading-none">{s.value}</span>
              <span className="text-[10px] text-muted font-mono">{s.unit}</span>
            </div>
          </div>
        ))}

        {/* Voltage distribution histogram */}
        <div className="bg-surface2/60 rounded-md px-3 py-3 flex-1">
          <div className="text-[11px] font-mono tracking-[1.2px] text-muted mb-3">
            Distribution
          </div>
          {/* Bars */}
          <div className="flex items-end gap-1" style={{ height: 96 }}>
            {buckets.map((b, i) => {
              const barH = Math.round((b.count / bucketMax) * 80);
              const color = thresholdToColor(b.mv + bucketSize / 2, thresholds);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  {/* Count label on hover */}
                  <div
                    className="absolute bottom-full mb-0.5 text-[9px] font-mono text-ink bg-surface2 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {b.count}
                  </div>
                  <div
                    className="w-full rounded-t-sm"
                    style={{
                      height: barH > 0 ? barH : (b.count > 0 ? 2 : 0),
                      background: color,
                    }}
                  />
                  {/* mV label */}
                  <div
                    className="text-[8px] font-mono text-muted"
                    style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", lineHeight: 1 }}
                  >
                    {b.mv}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[9px] font-mono text-muted text-center">
            {cells.length} Cells · {bucketSize} mV / Bucket
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Cell tab ───────────────────────────────────────────────────────────────────
function CellTab({ cabinet, pile, stationId }: { cabinet: Cabinet; pile: Pile; stationId: string }) {
  const rack = pile.racks[0];
  const rackId = rack?.id ?? "";
  const { data, isLoading, isError, refetch } = useCellData(rackId, stationId);
  // Rack SOC, for the one thing the cell map cannot show per-cell: UGX mirrors
  // rack SOC into every per-cell register, so this is the finest granularity
  // that actually exists. Same query the Battery Cluster tab already runs, so
  // react-query serves it from cache.
  const { data: racks } = useClusterData(pile.id, stationId);
  const rackSoc = racks?.find(r => r.rackId === rackId)?.soc ?? null;
  const [viewMode, setViewMode] = useState<"table"|"bar"|"heatmap"|"thermal3d">("thermal3d");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  if (isLoading) return <div className="p-5"><LoadingState rows={6} /></div>;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const total = data.length;
  const pages = Math.ceil(total / pageSize);
  const pageData = data.slice((page-1)*pageSize, page*pageSize);
  // Path is built from the live device tree, not a fixed template
  const selectorLabel = [cabinet.name, pile.name, rack?.name].filter(Boolean).join(" – ");

  return (
    <div className="eq-card">
      {/* Selector + toggle */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-surface2/30">
        <div className="filter-input bg-surface2 text-ink2 text-[11.5px] h-7 flex items-center px-3 w-fit min-w-[300px]">
          {selectorLabel}
        </div>
        <div className="flex items-center gap-0.5 bg-surface ring-1 ring-line rounded p-0.5 ml-4">
          <button onClick={() => setViewMode("thermal3d")}
            className={["px-3 py-1 rounded text-[11.5px] font-medium transition-colors",
              viewMode==="thermal3d" ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"].join(" ")}>
            3D Thermal
          </button>
          <button onClick={() => setViewMode("heatmap")}
            className={["px-3 py-1 rounded text-[11.5px] font-medium transition-colors",
              viewMode==="heatmap" ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"].join(" ")}>
            Heatmap
          </button>
          <button onClick={() => setViewMode("bar")}
            className={["px-3 py-1 rounded text-[11.5px] font-medium transition-colors",
              viewMode==="bar" ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"].join(" ")}>
            Bar Chart
          </button>
          <button onClick={() => setViewMode("table")}
            className={["px-3 py-1 rounded text-[11.5px] font-medium transition-colors",
              viewMode==="table" ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"].join(" ")}>
            Table
          </button>
        </div>
      </div>

      {/* Table view */}
      {viewMode === "table" && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface2/40">
                {["Cell Num","Voltage/mV","Temp/°C","SOH/%"].map(h=>(
                  <th key={h} className="text-left py-3 px-5 text-[11px] text-ink3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.map((cell, i) => (
                <tr key={cell.cellId} className="border-b border-line/40 last:border-none hover:bg-surface2/30 transition-colors">
                  <td className="py-3 px-5 text-ink2">{(page-1)*pageSize + i + 1}</td>
                  <td className="py-3 px-5 font-mono tabular-nums text-ink2">{cell.voltMv ?? "--"}</td>
                  <td className="py-3 px-5 font-mono tabular-nums text-ink2">{cell.tempC ?? "--"}</td>
                  <td className="py-3 px-5 font-mono tabular-nums text-muted">--</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bar chart view */}
      {viewMode === "bar" && (() => {
        const chartData = data.map((cell, i) => ({
          name: `${i + 1}`,
          voltage: cell.voltMv,
          temp:    cell.tempC,
        }));
        const voltages = data.map(c => c.voltMv).filter((v): v is number => v != null);
        const avgVolt  = voltages.length
          ? Math.round(voltages.reduce((s, v) => s + v, 0) / voltages.length)
          : 0;
        const ax = { tickLine: false, axisLine: false, tick: { fill: "#6B7280", fontSize: 10 } };
        const LINE = "var(--chart-grid)";
        const tooltipStyle = { background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-line)", borderRadius: 8, fontSize: 11, color: "var(--tooltip-ink)", padding: "8px 10px" };
        return (
          <div className="p-4 flex flex-col gap-6">
            {/* Voltage chart */}
            <div>
              <p className="text-[11px] font-mono tracking-[1.2px] text-muted font-semibold mb-3">Cell Voltage (mV)</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }} barSize={total > 32 ? 6 : 12}>
                  <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
                  <XAxis dataKey="name" {...ax} label={{ value: "Cell #", position: "insideBottom", offset: -2, fill: "#6B7280", fontSize: 10 }} />
                  <YAxis {...ax} domain={["auto", "auto"]} tickFormatter={v => `${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} mV`, "Voltage"]} />
                  <ReferenceLine y={avgVolt} stroke="#5B8AB4" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: `Avg ${avgVolt}`, fill: "#5B8AB4", fontSize: 10, position: "right" }} />
                  <Bar dataKey="voltage" name="Voltage (mV)" fill="#6FA3A0" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Temperature chart. This was a per-cell SOC chart, but the BMS
                mirrors rack SOC into every per-cell register, so it plotted one
                flat line at the rack value. Cell temperature is a real probe. */}
            <div>
              <p className="text-[11px] font-mono tracking-[1.2px] text-muted font-semibold mb-3">Cell Temperature (°C)</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -10, bottom: 0 }} barSize={total > 32 ? 6 : 12}>
                  <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
                  <XAxis dataKey="name" {...ax} label={{ value: "Cell #", position: "insideBottom", offset: -2, fill: "#6B7280", fontSize: 10 }} />
                  <YAxis {...ax} domain={["auto", "auto"]} tickFormatter={v => `${v}°`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} °C`, "Temperature"]} />
                  <Bar dataKey="temp" name="Temperature (°C)" fill="#5B8AB4" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* 3D thermal view — same `data` the other three modes render. */}
      {viewMode === "thermal3d" && (
        <BatteryCellMap cells={data} mode="temperature" rackSoc={rackSoc} />
      )}

      {/* Heatmap view */}
      {viewMode === "heatmap" && <CellHeatmap cells={data} />}

      {/* Pagination footer — table mode only */}
      {viewMode === "table" && <div className="px-4 py-3 border-t border-line flex items-center gap-3 flex-wrap">
        <span className="text-[12px] text-muted mr-auto">Total {total} Items</span>
        <select value={pageSize} onChange={() => {}} className="h-7 px-2 bg-surface border border-line rounded text-[11.5px] text-ink2 outline-none">
          <option value={10}>10 / Page</option>
        </select>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page<=1}
            className="w-7 h-7 grid place-items-center rounded hover:bg-surface2 text-ink3 disabled:opacity-30 text-[12px]">‹</button>
          {Array.from({length:Math.min(pages,5)},(_,i)=>i+1).map(p=>(
            <button key={p} onClick={()=>setPage(p)}
              className={["w-7 h-7 grid place-items-center rounded text-[12px] font-medium transition-colors",
                p===page?"bg-accent/15 text-accent":"hover:bg-surface2 text-ink3"].join(" ")}>
              {p}
            </button>
          ))}
          {pages > 5 && <><span className="text-muted px-1">…</span>
            <button onClick={()=>setPage(pages)}
              className="w-7 h-7 grid place-items-center rounded text-[12px] hover:bg-surface2 text-ink3">{pages}</button>
          </>}
          <button onClick={() => setPage(p=>Math.min(pages,p+1))} disabled={page>=pages}
            className="w-7 h-7 grid place-items-center rounded hover:bg-surface2 text-ink3 disabled:opacity-30 text-[12px]">›</button>
        </div>
      </div>}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────
export function EssCabinetView({ cabinet, stationId }: { cabinet: Cabinet; stationId: string }) {
  const [tabPick,      setActiveTab]    = useState<EssTab>("ESS Cabinet");
  /* Sub Meter only where the gateway carries a sub-meter asset — none does on
     this site; the tab appears on its own for a site that has one. */
  const { data: rd } = useEquipmentReadings(stationId, cabinet.id);
  const hasSubMeter = !!rd?.assets.some((a) => /sub_?meter/i.test(a));
  const tabs = ESS_TABS.filter((t) => t !== "Sub Meter" || hasSubMeter);
  const activeTab: EssTab = tabs.includes(tabPick) ? tabPick : "ESS Cabinet";
  const [selectedPileId, setSelectedPileId] = useState<string>(cabinet.piles[0]?.id ?? "");

  const pile = cabinet.piles.find(p => p.id === selectedPileId) ?? cabinet.piles[0];
  // Parse invN from synthetic pile ID: "${deviceId}-p${invN}"
  const invN = parseInt(pile?.id.match(/-p(\d+)$/)?.[1] ?? "1", 10);
  const multiPile = cabinet.piles.length > 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Pile / Inverter selector — only shown when cabinet has multiple inverters */}
      {multiPile && (
        <div className="eq-card px-4 py-2.5 flex items-center gap-3">
          <span className="text-[11.5px] text-ink3 shrink-0">Inverter</span>
          <div className="flex flex-wrap gap-1.5">
            {cabinet.piles.map(p => {
              const n = parseInt(p.id.match(/-p(\d+)$/)?.[1] ?? "1", 10);
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedPileId(p.id)}
                  className={[
                    "px-3 py-1 rounded text-[11.5px] font-medium transition-colors border",
                    p.id === selectedPileId
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-line text-ink3 hover:text-ink hover:bg-surface2",
                  ].join(" ")}
                >
                  Inv {n}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="eq-card">
        <div className={`grid grid-cols-3 ${tabs.length === 6 ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={[
                "py-3 text-[12.5px] font-medium transition-all border-b-2",
                activeTab === t
                  ? "text-ink border-accent bg-accent/[.05]"
                  : "text-ink3 border-transparent hover:text-ink hover:bg-surface2",
              ].join(" ")}
            >
              {t}
            </button>
          ))}
        </div>
      </div>


      {/* Tab content — all tabs respect the selected pile/inverter */}
      {activeTab === "ESS Cabinet"  && <EssCabinetTab cabinetId={cabinet.id} stationId={stationId} />}
      {/* cabinet.id is the cabinet's source (`external_ems_1`). Passed so every
          tab describes the cabinet the drill-down shows — without it these four
          followed the global unit picker instead, and could disagree with the
          ESS Cabinet tab on which BESS they were reading. */}
      {activeTab === "PCS"          && <PcsView         stationId={stationId} sourceId={cabinet.id} />}
      {activeTab === "BMS"          && <BmsView         stationId={stationId} sourceId={cabinet.id} />}
      {activeTab === "Chiller"      && <ChillerView     stationId={stationId} sourceId={cabinet.id} />}
      {activeTab === "Environment"  && <EnvironmentView stationId={stationId} sourceId={cabinet.id} />}
      {/*
        Sub Meter, named as such. This tab briefly rendered MeterDataView, which
        is the SITE meter — station-level time-of-use buckets — and putting that
        under a cabinet tab claimed a per-cabinet scope those figures do not have.
        The site meter keeps its own home in the sidebar's Main Electricity Meter
        Data. The screen itself carries the banner explaining that no sub-meter
        register exists yet.
      */}
      {activeTab === "Sub Meter"    && <SubMeterView />}

      {/* Retired tabs — components still defined above, restore with the list at the top.
      {activeTab === "Battery System"   && pile && <BatterySystemTab pile={pile} cabinetId={cabinet.id} stationId={stationId} />}
      {activeTab === "Battery Cluster" && pile && <ClusterTab  pile={pile} stationId={stationId} />}
      {activeTab === "Cell"            && pile && <CellTab      cabinet={cabinet} pile={pile} stationId={stationId} />}
      */}
    </div>
  );
}
