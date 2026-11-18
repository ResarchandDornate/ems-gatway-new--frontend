"use client";

import { useState } from "react";
import { useWaterChiller, useFireProtection, useBmsSubDeviceList, usePcsSubDeviceList } from "@/hooks/useEquipment";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState }   from "@/components/shared/ErrorState";
import { EmptyState }   from "@/components/shared/EmptyState";

type SubTab = "PCS" | "BMS" | "Water Chiller" | "Fire Protection";

function StatusChip({ status }: { status: "normal" | "abnormal" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${status === "normal" ? "text-good" : "text-bad"}`}>
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${status === "normal" ? "bg-good" : "bg-bad"}`}
        style={{ boxShadow: status === "normal" ? "0 0 6px #4E8D6E" : "0 0 6px #A8505E" }}
      />
      {status === "normal" ? "Normal" : "Abnormal"}
    </span>
  );
}

// ── 3-col field grid row ──────────────────────────────────────────────────────
// Each row: [label, value] × 3
function FieldRow({ cols }: { cols: [string, string][] }) {
  return (
    <div className="grid grid-cols-3 border-b border-line/40 last:border-none">
      {cols.map(([label, value], i) => (
        <div key={i} className={`flex items-center justify-between px-4 py-2.5 ${i < cols.length - 1 ? "border-r border-line/40" : ""}`}>
          <span className="text-[11.5px] text-ink3">{label}</span>
          <span className="text-[12px] font-mono text-ink2 ml-3">{value}</span>
        </div>
      ))}
      {/* Fill empty cells if cols.length < 3 */}
      {cols.length < 3 && Array.from({ length: 3 - cols.length }).map((_, i) => (
        <div key={`empty-${i}`} />
      ))}
    </div>
  );
}

const fmt = (v: number | null, unit: string) => v !== null ? `${v.toFixed(2)} ${unit}` : `-- ${unit}`;

// ── PCS sub-device tab ────────────────────────────────────────────────────────
function PcsTab({ stationId }: { stationId: string }) {
  const { data, isLoading, isError, refetch } = usePcsSubDeviceList(stationId);
  if (isLoading) return <LoadingState rows={6} />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-3">
      {(data ?? []).map(pcs => (
        <div key={pcs.pileId} className="surface-card overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 bg-surface2 border-b border-line">
            <span className="text-[12px] font-semibold text-ink">{pcs.cabinetPath}</span>
            <StatusChip status={pcs.status} />
          </div>

          {/* 3-panel row */}
          <div className="grid grid-cols-3 divide-x divide-line border-b border-line">

            {/* Status Information */}
            <div className="px-4 py-4">
              <p className="text-[11px] font-mono tracking-[1.4px] text-muted font-semibold mb-3">Status Information</p>
              {[
                ["PCS Operation Status", pcs.pcsOperationStatus],
                ["PCS Operation Mode",   pcs.pcsOperationMode],
                ["DC Contactor Status",  pcs.dcContactorStatus],
                ["AC Contactor Status",  pcs.acContactorStatus],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between items-baseline py-1.5 border-b border-line/30 last:border-none">
                  <span className="text-[11px] text-ink3">{label}</span>
                  <span className={`text-[11.5px] font-mono ml-2 ${value === "Shutdown" ? "text-bad" : value === "Open" ? "text-warn" : "text-ink2"}`}>{value}</span>
                </div>
              ))}
            </div>

            {/* Temperature Information */}
            <div className="px-4 py-4">
              <p className="text-[11px] font-mono tracking-[1.4px] text-muted font-semibold mb-3">Temperature Information</p>
              {[
                ["Ambient Temperature", pcs.ambientTempC != null ? `${pcs.ambientTempC.toFixed(2)} °C` : "—"],
                ["Cabinet Temperature", pcs.cabinetTempC != null ? `${pcs.cabinetTempC.toFixed(2)} °C` : "—"],
                ["IGBT-A Temperature",  pcs.igbtATempC !== null ? `${pcs.igbtATempC.toFixed(2)} °C` : "—"],
                ["IGBT-B Temperature",  pcs.igbtBTempC !== null ? `${pcs.igbtBTempC.toFixed(2)} °C` : "—"],
                ["IGBT-C Temperature",  pcs.igbtCTempC !== null ? `${pcs.igbtCTempC.toFixed(2)} °C` : "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between items-baseline py-1.5 border-b border-line/30 last:border-none">
                  <span className="text-[11px] text-ink3">{label}</span>
                  <span className="text-[11.5px] font-mono text-ink2 ml-2">{value}</span>
                </div>
              ))}
            </div>

            {/* DC Side Information */}
            <div className="px-4 py-4">
              <p className="text-[11px] font-mono tracking-[1.4px] text-muted font-semibold mb-3">DC Side Information</p>
              {[
                ["DC Voltage", fmt(pcs.dcVoltageV,  "V")],
                ["DC Current", fmt(pcs.dcCurrentA,  "A")],
                ["DC Power",   fmt(pcs.dcPowerKw,   "kW")],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between items-baseline py-1.5 border-b border-line/30 last:border-none">
                  <span className="text-[11px] text-ink3">{label}</span>
                  <span className="text-[11.5px] font-mono text-ink2 ml-2">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AC Side Information — full width 3-col grid */}
          <div>
            <div className="px-4 py-2 bg-surface2/50 border-b border-line">
              <p className="text-[11px] font-mono tracking-[1.4px] text-muted font-semibold">AC Side Information</p>
            </div>
            {([
              [
                ["AB Line Voltage", fmt(pcs.abLineVoltageV,   "V")],
                ["BC Line Voltage", fmt(pcs.bcLineVoltageV,   "V")],
                ["AC Line Voltage", fmt(pcs.acLineVoltageV,   "V")],
              ],
              [
                ["Phase A Current", fmt(pcs.phaseACurrentA,  "A")],
                ["Phase B Current", fmt(pcs.phaseBCurrentA,  "A")],
                ["Phase C Current", fmt(pcs.phaseCCurrentA,  "A")],
              ],
              [
                ["Active Power",    fmt(pcs.activePowerKw,   "kW")],
                ["Reactive Power",  fmt(pcs.reactivePowerKvar, "kW")],
                ["Apparent Power",  fmt(pcs.apparentPowerKva, "kW")],
              ],
              [
                ["Power Factor", pcs.powerFactor !== null ? `${pcs.powerFactor.toFixed(2)}` : "—"],
                ["", ""],
                ["", ""],
              ],
            ] as [string, string][][]).map((row, ri) => (
              <div key={ri} className="grid grid-cols-3 divide-x divide-line/40 border-t border-line/40">
                {row.map(([label, value], ci) => (
                  <div key={ci} className="flex justify-between items-baseline px-4 py-2.5">
                    <span className="text-[11px] text-ink3">{label}</span>
                    {label && <span className="text-[11.5px] font-mono text-ink2 ml-2">{value}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── BMS sub-device tab ────────────────────────────────────────────────────────
function BmsTab({ stationId }: { stationId: string }) {
  const { data, isLoading, isError, refetch } = useBmsSubDeviceList(stationId);
  if (isLoading) return <LoadingState rows={6} />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  const STATUSES = ["Charging", "Discharging", "Standby", "Shutdown"] as const;

  return (
    <div className="flex flex-col gap-3">
      {(data ?? []).map(bms => (
        <div key={bms.pileId} className="surface-card overflow-hidden">

          {/* Cabinet header */}
          <div className="flex items-center justify-between px-5 py-3 bg-surface2 border-b border-line">
            <span className="text-[12px] font-semibold text-ink">{bms.cabinetPath}</span>
            <StatusChip status={bms.status} />
          </div>

          {/* 3-panel row: System Status | System Information | SOC */}
          <div className="grid grid-cols-[200px_1fr_160px] border-b border-line divide-x divide-line">

            {/* System Status */}
            <div className="px-4 py-4">
              <p className="text-[11px] font-mono tracking-[1.4px] text-muted font-semibold mb-3">System Status</p>
              <div className="space-y-2.5">
                {STATUSES.map(s => {
                  const active = bms.systemStatus.toLowerCase() === s.toLowerCase();
                  return (
                    <div key={s} className="flex items-center gap-2.5">
                      <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${active ? "bg-accent border-accent" : "border-line2 bg-transparent"}`} />
                      <span className={`text-[12px] ${active ? "text-accent font-semibold" : "text-ink3"}`}>{s}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* System Information */}
            <div className="px-4 py-4">
              <p className="text-[11px] font-mono tracking-[1.4px] text-muted font-semibold mb-3">System Information</p>
              <div className="grid grid-cols-2 gap-x-6">
                {[
                  ["Total Battery Voltage", bms.totalVoltageV != null ? `${bms.totalVoltageV.toFixed(1)} V` : "—"],
                  ["Total Battery Current", `${bms.totalCurrentA.toFixed(1)} A`],
                  ["Total Power",           `${Math.abs(bms.totalPowerKw).toFixed(1)} kW`],
                  ["Max Temp Difference",   `${bms.maxTempDiffC.toFixed(1)} °C`],
                  ["Max Cell Volt Diff",    `${bms.maxCellVoltageDiffMv.toFixed(0)} mV`],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between items-baseline py-1.5 border-b border-line/30 last:border-none">
                    <span className="text-[11px] text-ink3">{label as string}</span>
                    <span className="text-[11.5px] font-mono text-ink2 ml-2">{value as string}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* SOC */}
            <div className="px-4 py-4 flex flex-col items-center justify-center">
              <p className="text-[11px] font-mono tracking-[1.4px] text-muted font-semibold mb-3">SOC</p>
              {/* Battery icon */}
              <div className="relative w-12 h-24 border-2 border-line2 rounded-lg overflow-hidden mb-2">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-1.5 bg-line2 rounded-t-sm" />
                <div
                  className="absolute bottom-0 left-0 right-0 rounded-b-md bg-gradient-to-t from-accent to-accent transition-all"
                  style={{ height: `${bms.socPct ?? 0}%`, boxShadow: "0 0 8px rgba(91, 138, 180,.5)" }}
                />
              </div>
              <span className="text-[22px] font-semibold text-accent leading-none">{bms.socPct?.toFixed(1) ?? "—"}</span>
              <span className="text-[11px] text-muted">%</span>
            </div>
          </div>

          {/* Battery Information */}
          <div>
            <div className="px-4 py-2 bg-surface2/50 border-b border-line">
              <p className="text-[11px] font-mono tracking-[1.4px] text-muted font-semibold">Battery Information</p>
            </div>
            {([
              [
                ["Max Cell Temperature", `${bms.maxCellTempC.toFixed(1)} °C`],
                ["Max Temp Cell ID",     bms.maxTempCellId],
                ["Min Cell Temperature", `${bms.minCellTempC.toFixed(1)} °C`],
                ["Min Temp Cell ID",     bms.minTempCellId],
              ],
              [
                ["Max Cell Voltage",    `${bms.maxCellVoltageMv} mV`],
                ["Max Cell Voltage ID", bms.maxCellVoltageId],
                ["Min Cell Voltage",    `${bms.minCellVoltageMv} mV`],
                ["Min Cell Voltage ID", bms.minCellVoltageId],
              ],
              [
                ["Max Cell SOC",    bms.maxCellSocPct != null ? `${bms.maxCellSocPct.toFixed(1)} %` : "—"],
                ["Max SOC Cell ID", bms.maxSocCellId],
                ["Min Cell SOC",    bms.minCellSocPct != null ? `${bms.minCellSocPct.toFixed(1)} %` : "—"],
                ["Min SOC Cell ID", bms.minSocCellId],
              ],
            ] as [string, string][][]).map((row, ri) => (
              <div key={ri} className="grid grid-cols-4 divide-x divide-line/40 border-t border-line/40">
                {row.map(([label, value]) => (
                  <div key={label} className="px-3 py-2.5">
                    <div className="text-[10px] text-muted mb-0.5">{label}</div>
                    <div className="text-[12px] font-mono text-ink2">{value}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Water Chiller tab ─────────────────────────────────────────────────────────
function WaterChillerTab({ stationId }: { stationId: string }) {
  const { data, isLoading, isError, refetch } = useWaterChiller(stationId);
  if (isLoading) return <LoadingState rows={4} />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-3">
      {(data ?? []).map(c => (
        <div key={c.cabinetId} className="surface-card overflow-hidden">
          {/* Cabinet header */}
          <div className="flex items-center justify-between px-5 py-3 bg-surface2 border-b border-line">
            <span className="text-[12px] font-semibold text-ink">{c.cabinetName}</span>
            <StatusChip status={c.status} />
          </div>

          {/* 3-column field grid.
              Every reading is nullable: ambient temperature and pump speed have
              no register on any asset, so they render as a bare dash rather
              than "0.00 °C", which would read as a measurement. */}
          <FieldRow cols={[
            ["TMS Working Status",    c.tmsWorkingStatus || "—"],
            ["Outlet Water Temp",     unitOrDash(c.outletWaterTempC, "°C")],
            ["Return Water Temp",     unitOrDash(c.returnWaterTempC, "°C")],
          ]} />
          <FieldRow cols={[
            ["Ambient Temperature",   unitOrDash(c.ambientTempC, "°C")],
            ["Return Water Pressure", unitOrDash(c.returnWaterPressureBar, "bar")],
            ["Supply Water Pressure", unitOrDash(c.supplyWaterPressureBar, "bar")],
          ]} />
          <FieldRow cols={[
            /* Hz, not rpm: a frequency is what the unit reports. */
            ["Compressor Freq",       unitOrDash(c.compressorSpeedRpm, "Hz")],
            ["Water Pump Speed",      unitOrDash(c.waterPumpSpeedRpm, "rpm", 0)],
          ]} />
        </div>
      ))}
    </div>
  );
}

// ── Fire Protection tab ───────────────────────────────────────────────────────
function FireProtectionTab({ stationId }: { stationId: string }) {
  const { data, isLoading, isError, refetch } = useFireProtection(stationId);
  if (isLoading) return <LoadingState rows={1} />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  return (
    <div className="flex flex-wrap gap-3">
      {(data ?? []).map(fp => (
        <div
          key={fp.cabinetId}
          className="surface-card flex items-center justify-between gap-8 px-4 py-3 border border-line/80"
          style={{ minWidth: "360px" }}
        >
          <span className="text-[12px] font-medium text-ink leading-tight">{fp.cabinetName}</span>
          <StatusChip status={fp.status} />
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
/** `25.1` → "25.10 °C"; null → a bare dash, with the unit dropped too. */
function unitOrDash(v: number | null, unit: string, dp = 2): string {
  return v == null ? "—" : `${v.toFixed(dp)} ${unit}`;
}

export function SubDeviceView({ stationId }: { stationId: string }) {
  // Pre-fetch all sub-device lists to decide which tabs to show.
  // These share the same React Query cache keys as the inner tab components,
  // so there is no double network call.
  const pcs          = usePcsSubDeviceList(stationId);
  const bms          = useBmsSubDeviceList(stationId);
  const waterChiller = useWaterChiller(stationId);
  const fireProt     = useFireProtection(stationId);

  const ALL_TABS: { key: SubTab; hasData: boolean }[] = [
    { key: "PCS",             hasData: (pcs.data?.length          ?? 0) > 0 },
    { key: "BMS",             hasData: (bms.data?.length          ?? 0) > 0 },
    { key: "Water Chiller",   hasData: (waterChiller.data?.length ?? 0) > 0 },
    { key: "Fire Protection", hasData: (fireProt.data?.length     ?? 0) > 0 },
  ];

  const isAnyLoading = pcs.isLoading || bms.isLoading || waterChiller.isLoading || fireProt.isLoading;
  const availableTabs: SubTab[] = ALL_TABS.filter(t => t.hasData).map(t => t.key);

  const [activeTab, setActiveTab] = useState<SubTab | null>(null);
  // Resolve active tab: use stored value if still available, else first available tab
  const resolvedTab: SubTab | null = activeTab && availableTabs.includes(activeTab)
    ? activeTab
    : (availableTabs[0] ?? null);

  if (isAnyLoading) return <LoadingState rows={4} />;

  if (availableTabs.length === 0) {
    return <EmptyState title="No Sub-Devices Found" description="No PCS, BMS, Water Chiller, or Fire Protection devices are configured for this station." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar — only renders tabs that have real data */}
      <div className="surface-card p-1 flex items-center gap-1 w-fit">
        {availableTabs.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={[
              "px-4 py-2 rounded-lg text-[12.5px] font-medium transition-all",
              resolvedTab === t
                ? "bg-accent/15 text-accent ring-1 ring-accent/25"
                : "text-ink3 hover:text-ink hover:bg-surface2",
            ].join(" ")}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {resolvedTab === "Water Chiller"   && <WaterChillerTab   stationId={stationId} />}
      {resolvedTab === "Fire Protection" && <FireProtectionTab stationId={stationId} />}
      {resolvedTab === "PCS"             && <PcsTab            stationId={stationId} />}
      {resolvedTab === "BMS"             && <BmsTab            stationId={stationId} />}
    </div>
  );
}
