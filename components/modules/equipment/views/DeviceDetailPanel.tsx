"use client";

import { useState, useMemo } from "react";
import { ArrowLeft, Wifi, WifiOff, Search, RefreshCw, Zap, BarChart2 } from "lucide-react";
import { useAssetSnapshot } from "@/hooks/useAssetTelemetry";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { PeriodSeries } from "@/components/charts/PeriodSeries";
import { historyTag } from "@/lib/api/services/pointsCentral.service";
import { signedTemp } from "@/lib/api/services/equipmentReadings.service";
import { LoadingState } from "@/components/shared/LoadingState";
import type { Device } from "@/lib/api/types";
import { deviceLabel, deviceTitle } from "@/lib/deviceNames";

// ── Chart constants (match app theme) ────────────────────────────────────────
const STEEL = "#5B8AB4";

// ── KPI slots, per asset kind ─────────────────────────────────────────────────
/*
  These were five SOLAR metrics — inverter power, lifetime generation, today's
  generation, performance ratio, CUF — resolved through the UGX metric
  profile. No asset on this site is an inverter, so all five read "—" on every
  device. They are now the registers each asset actually publishes, by the
  asset kind the id ends in (`external_ems_1_liquid_cooling` → liquid_cooling).
  A slot whose key the asset does not answer still renders a dash.
*/
type KpiSlot = { key: string; label: string; unit: string; desc: string };
const KPI_BY_KIND: Record<string, KpiSlot[]> = {
  pcs: [
    { key: "total_active_power",   label: "Active Power",   unit: "kW",  desc: "AC, − = Charging" },
    { key: "total_reactive_power", label: "Reactive Power", unit: "kVar", desc: "AC Total" },
    { key: "grid_frequency",       label: "Frequency",      unit: "Hz",  desc: "Grid" },
    { key: "dc_voltage",           label: "DC Voltage",     unit: "V",   desc: "Battery Side" },
    { key: "ac_cumulative_discharge_energy", label: "AC Discharged", unit: "kWh", desc: "Lifetime" },
  ],
  bms: [
    { key: "display_soc",                     label: "SOC",           unit: "%",  desc: "Displayed" },
    { key: "soh",                             label: "SOH",           unit: "%",  desc: "State Of Health" },
    { key: "cluster_total_voltage_collected", label: "Cluster Voltage", unit: "V", desc: "Total" },
    { key: "cluster_total_current",           label: "Cluster Current", unit: "A", desc: "− = Charging" },
    { key: "battery_max_temperature",         label: "Max Cell Temp", unit: "°C", desc: "Hottest Probe" },
  ],
  ems_system: [
    { key: "soc",                  label: "SOC",           unit: "%",  desc: "As The EMS Sees It" },
    { key: "energy_storage_power", label: "Storage Power", unit: "kW", desc: "− = Charging" },
    /* Was load_power, which the EMS derives from the meter and reads 0 here —
       shown as a measured "0.0 kW". Site load is on the dashboard's power flow
       (battery + solar). The cutoff is live and differs by cabinet (75 / 97 %). */
    { key: "charge_cutoff_soc_setting", label: "Charge Cutoff", unit: "%", desc: "SOC Limit" },
    { key: "demand",               label: "Demand",        unit: "kW", desc: "Configured Limit" },
  ],
  grid_meter: [
    { key: "total_active_power",          label: "Active Power", unit: "kW",  desc: "At The PCC" },
    { key: "frequency",                   label: "Frequency",    unit: "Hz",  desc: "Grid" },
    { key: "total_power_factor",          label: "Power Factor", unit: "",    desc: "Total" },
    { key: "forward_total_active_energy", label: "Import",       unit: "kWh", desc: "Cumulative" },
    { key: "reverse_total_active_energy", label: "Export",       unit: "kWh", desc: "Cumulative" },
  ],
  liquid_cooling: [
    { key: "outlet_water_temperature", label: "Outlet Water", unit: "°C",  desc: "Supply" },
    { key: "inlet_water_temperature",  label: "Inlet Water",  unit: "°C",  desc: "Return" },
    { key: "outdoor_temperature",      label: "Outdoor",      unit: "°C",  desc: "Ambient Probe" },
    { key: "inlet_water_pressure",     label: "Inlet Pressure",  unit: "Bar", desc: "" },
    { key: "outlet_water_pressure",    label: "Outlet Pressure", unit: "Bar", desc: "" },
  ],
  dehumidifier: [
    { key: "current_temperature", label: "Temperature", unit: "°C", desc: "Cabinet Air" },
    { key: "current_humidity",    label: "Humidity",    unit: "%",  desc: "Relative" },
  ],
  fire_protection: [
    { key: "temperature_value", label: "Panel Temp", unit: "°C", desc: "Detector Reading" },
  ],
};

const kindOf = (assetId: string) => /^external_ems_\d+_(.+)$/.exec(assetId)?.[1] ?? "";

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, unit, desc,
}: {
  label: string; value: number | null | undefined; unit: string; desc: string;
}) {
  const display =
    value == null ? "—" :
    unit === "%" ? value.toFixed(1) :
    unit === "kW" || unit === "kWh" ? value.toLocaleString("en-IN", { maximumFractionDigits: 1 }) :
    value.toFixed(2);
  /* The unit goes with the value: "— kW" reads as a measurement of nothing. */
  const shownUnit = value == null ? "" : unit;

  return (
    <div className="surface-card px-4 py-3 flex-1 min-w-[120px]">
      <div className="text-[11px] font-mono tracking-[1.3px] text-muted mb-1">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[22px] font-semibold text-ink leading-none">{display}</span>
        {shownUnit && <span className="text-[11px] text-muted font-mono">{shownUnit}</span>}
      </div>
      <div className="text-[10px] text-muted2 mt-0.5">{desc}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DeviceDetailPanelProps {
  device: Device;
  onBack: () => void;
}

export function DeviceDetailPanel({ device, onBack }: DeviceDetailPanelProps) {
  const [chartKey, setChartKey]   = useState("");
  const [paramSearch, setParamSearch] = useState("");

  /* One read for the whole asset — keys, units and latest values together. */
  const { data: snap, isLoading: snapLoading, isFetching: latestFetching } = useAssetSnapshot(device.id);
  const allKeys   = snap?.keys;
  const allLatest = snap?.latest;
  const latest    = allLatest;
  const keysLoading = snapLoading, allLatestLoading = snapLoading;

  const kpis = KPI_BY_KIND[kindOf(device.id)] ?? [];

  /* Anything numeric with a unit can be traced; for assets with no kW
     register (the cooling unit, the dehumidifier) that is what makes the
     chart usable at all. */
  const powerKeys = useMemo(
    () => allKeys?.filter((k) => !!k.unit) ?? [],
    [allKeys]
  );

  /* The selection, or the first KPI the asset answers, or the first
     chartable key. */
  const effectiveChartKey = useMemo(() => {
    if (chartKey && allKeys?.some((k) => k.key === chartKey)) return chartKey;
    return kpis.find((k) => allKeys?.some((a) => a.key === k.key))?.key
        ?? powerKeys[0]?.key
        ?? "";
  }, [allKeys, powerKeys, chartKey, kpis]);

  const seriesUnit = allKeys?.find((k) => k.key === effectiveChartKey)?.unit || "";
  const nav = usePeriod("day");
  const swipe = useSwipe(nav);

  const filteredKeys = useMemo(() => {
    if (!allKeys) return [];
    const q = paramSearch.toLowerCase();
    return q
      ? allKeys.filter((k) => k.key.toLowerCase().includes(q) || k.category.toLowerCase().includes(q))
      : allKeys;
  }, [allKeys, paramSearch]);

  // Group by category for table
  const grouped = useMemo(() => {
    const map: Record<string, typeof filteredKeys> = {};
    for (const k of filteredKeys) {
      (map[k.category] ??= []).push(k);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredKeys]);

  return (
    <div className="flex flex-col gap-4">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="surface-card px-5 py-3 flex items-center gap-4 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition-colors"
        >
          <ArrowLeft size={13} />
          Device List
        </button>

        <div className="w-px h-5 bg-line" />

        <div>
          <div className="text-[14px] font-semibold font-mono text-ink" title={deviceTitle(device.name)}>{deviceLabel(device.name)}</div>
          <div className="text-[11px] text-muted2 mt-0.5">{device.type}</div>
        </div>

        <div className="ml-1">
          {device.active ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono tracking-[1.2px] bg-good/10 text-good">
              <Wifi size={11} /> Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono tracking-[1.2px] bg-bad/10 text-bad">
              <WifiOff size={11} /> Inactive
            </span>
          )}
        </div>

        {/* The cabinet this asset belongs to, from its id. ownerName is the
            gateway UUID, which says nothing an operator can use. */}
        <div className="ml-auto text-[10.5px] text-muted2 font-mono hidden sm:block">
          {/^(external_ems_\d+)_/.exec(device.id)?.[1] ?? device.ownerName}
          {snap?.sampleTime && ` · ${new Date(snap.sampleTime).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })}`}
        </div>

        {latestFetching && (
          <RefreshCw size={12} className="text-muted animate-spin" />
        )}
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        {kpis.map((k) => (
          <KpiCard
            key={k.key}
            label={k.label}
            unit={k.unit}
            desc={k.desc}
            value={k.unit === "°C" ? signedTemp(latest?.[k.key] ?? null) : latest?.[k.key]}
          />
        ))}
      </div>

      {/* ── Chart ──────────────────────────────────────────────────── */}
      <div className="surface-card p-5 flex flex-col gap-4">
        {/* Chart controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <BarChart2 size={13} className="text-muted" />
            <span className="text-[12px] font-semibold text-ink">Trend</span>
          </div>

          {/* Key selector */}
          <select
            value={effectiveChartKey}
            onChange={(e) => setChartKey(e.target.value)}
            className="filter-input w-auto max-w-[240px] text-[11.5px]"
          >
            {effectiveChartKey && !powerKeys.some((k) => k.key === effectiveChartKey) && (
              <option value={effectiveChartKey}>{effectiveChartKey}</option>
            )}
            {powerKeys.map((k) => (
              <option key={k.key} value={k.key}>
                {k.key} ({k.unit})
              </option>
            ))}
          </select>

        </div>

        {/* Day / Week / Month / Year (PeriodNav). The point's history comes from
            its S2 point, or the fast stream for a PCS / BMS signal S2 lacks —
            historyTag picks; a Day is the readings, longer periods capsules. */}
        <PeriodNav state={nav} />
        <div {...swipe}>
          <PeriodSeries
            key={`${device.id}|${effectiveChartKey}`}
            tag={effectiveChartKey ? historyTag(device.id, effectiveChartKey) : null}
            label={effectiveChartKey}
            unit={seriesUnit}
            color={STEEL}
            period={nav.period}
            signed={/power/i.test(effectiveChartKey)}
          />
        </div>
      </div>

      {/* ── Parameters table ───────────────────────────────────────── */}
      <div className="surface-card overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-line flex items-center gap-3">
          <Zap size={13} className="text-muted" />
          <span className="text-[12px] font-semibold text-ink">All Parameters</span>
          <div className="relative ml-auto max-w-[220px] w-full">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search Keys…"
              value={paramSearch}
              onChange={(e) => setParamSearch(e.target.value)}
              className="filter-input w-full pl-7 text-[11.5px]"
            />
          </div>
        </div>

        {keysLoading || allLatestLoading ? (
          <div className="p-5"><LoadingState rows={4} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-muted font-mono tracking-[1.4px] bg-surface2/30 border-b border-line">
                  <th className="px-5 py-2.5 font-semibold w-[200px]">Parameter Key</th>
                  <th className="px-4 py-2.5 font-semibold w-[120px]">Category</th>
                  <th className="px-4 py-2.5 font-semibold w-[60px]">Unit</th>
                  <th className="px-5 py-2.5 font-semibold text-right">Latest Value</th>
                  <th className="px-4 py-2.5 font-semibold w-[80px] text-center">Chart</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([category, keys]) => (
                  <>
                    {/* Category row */}
                    <tr key={`cat-${category}`} className="bg-surface2/20 border-t border-line">
                      <td colSpan={5} className="px-5 py-1.5 text-[11px] font-mono tracking-[1.4px] text-accent/80 font-semibold">
                        {category}
                      </td>
                    </tr>
                    {keys.map((k) => {
                      const raw = /°C|℃/.test(k.unit ?? "") ? signedTemp(allLatest?.[k.key] ?? null) : allLatest?.[k.key];
                      const display =
                        raw == null ? "—" :
                        k.unit === "%" ? raw.toFixed(1) + " %" :
                        k.unit === "kW" || k.unit === "kWh" ? raw.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + ` ${k.unit}` :
                        k.unit === "V" || k.unit === "A" || k.unit === "Hz" ? raw.toFixed(2) + ` ${k.unit}` :
                        raw.toString();

                      const isSelected = effectiveChartKey === k.key;

                      return (
                        <tr
                          key={k.key}
                          className="border-t border-line hover:bg-surface2/30 transition-colors"
                        >
                          <td className="px-5 py-2.5">
                            <code className="text-[11.5px] font-mono text-ink2">{k.key}</code>
                          </td>
                          <td className="px-4 py-2.5 text-muted text-[11px]">{category}</td>
                          <td className="px-4 py-2.5 font-mono text-[11px] text-muted2">
                            {k.unit || "—"}
                          </td>
                          <td className="px-5 py-2.5 text-right font-mono font-semibold text-ink">
                            {display}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {!!k.unit && (
                              <button
                                onClick={() => setChartKey(k.key)}
                                className={[
                                  "px-2 py-0.5 rounded text-[11px] font-mono tracking-[1px] transition-colors",
                                  isSelected
                                    ? "bg-accent/20 text-accent"
                                    : "text-muted hover:text-ink hover:bg-surface2",
                                ].join(" ")}
                              >
                                {isSelected ? "Shown" : "Plot"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
