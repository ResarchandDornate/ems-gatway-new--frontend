"use client";

/**
 * The site's PV combiner box (S2 solar_inverter / HopeCombox), for the Solar tab.
 *
 * This gateway has no Solis inverter — the /solis stream the tab first read is
 * empty — so PV arrives as the combiner's own registers instead: array state,
 * AC output, today's and lifetime yield, and the PCC meter beside it. Signal
 * names are the normalised (prefix-stripped) ones the general route returns, so
 * `hopecombox__daily_yield` is read here as `daily_yield`. Anything the combiner
 * does not publish stays null, which the renderer draws as a dash.
 */
import { fetchGeneral, type GeneralRecord } from "@/lib/central";

const ASSET = "solar_plant";

export interface SolarReadings {
  /** False when the combiner reported nothing, so the tab can say so. */
  present: boolean;
  capturedTs: number | null;
  arrayRunning: boolean | null;
  onGrid: boolean | null;
  faulted: boolean | null;
  acActiveKw: number | null;
  acReactiveKvar: number | null;
  onGridActiveKw: number | null;
  dailyYieldKwh: number | null;
  lifetimeYieldKwh: number | null;
  feedInKwh: number | null;
  purchasedKwh: number | null;
  meter: {
    online: boolean | null;
    frequencyHz: number | null;
    phaseVoltageV: number | null;
    lineVoltageV: number | null;
    currentA: number | null;
    apparentKva: number | null;
    reactiveKvar: number | null;
    powerFactor: number | null;
    pccExportKw: number | null;
    /** Meter active power per phase, A/B/C. */
    phaseKw: [number | null, number | null, number | null];
  };
}

export async function fetchSolarReadings(gatewayId: string): Promise<SolarReadings> {
  const rows = gatewayId
    ? await fetchGeneral(gatewayId, { substream: "solar_inverter", limit: 1000 }).catch(() => [] as GeneralRecord[])
    : [];

  /* Newest first, so the first sighting of a signal is its current value. */
  const flat: Record<string, number | null> = {};
  const seen = new Set<string>();
  let ts: number | null = null;
  for (const r of rows) {
    if (r.asset_id !== ASSET || !r.signal || seen.has(r.signal)) continue;
    seen.add(r.signal);
    const n = r.value == null ? null : Number(r.value);
    flat[r.signal] = n != null && Number.isFinite(n) ? n : null;
    const t = Date.parse(r.sample_time_utc ?? "");
    if (!Number.isNaN(t)) ts = ts == null ? t : Math.max(ts, t);
  }

  const g = (k: string): number | null => flat[k] ?? null;
  /* A 1/0 register as a flag; a signal that did not arrive stays unknown. */
  const flag = (k: string): boolean | null => (flat[k] == null ? null : flat[k] === 1);

  return {
    present: seen.size > 0,
    capturedTs: ts,
    arrayRunning: flag("inverter_array_operating_state_on_off"),
    onGrid: flag("on_grid"),
    faulted: flag("fault") ?? flag("inverter_array_fault_state_or"),
    acActiveKw: g("ac_active_power"),
    acReactiveKvar: g("ac_reactive_power"),
    onGridActiveKw: g("on_grid_active_power"),
    dailyYieldKwh: g("daily_yield"),
    lifetimeYieldKwh: g("total_yield"),
    feedInKwh: g("total_feed_in_energy") ?? g("total_export_energy_kwh"),
    purchasedKwh: g("total_purchased_energy_from_grid") ?? g("total_grid_import_energy_kwh"),
    meter: {
      online: flag("meter_communication_status"),
      frequencyHz: g("grid_frequency_hz"),
      phaseVoltageV: g("grid_phase_voltage_v"),
      lineVoltageV: g("grid_line_voltage_v"),
      currentA: g("grid_average_current_a"),
      apparentKva: g("grid_apparent_power_kva"),
      reactiveKvar: g("grid_reactive_power_kvar"),
      powerFactor: g("meter_power_factor"),
      pccExportKw: g("pcc_export_power_kw"),
      phaseKw: [g("meter_a_phase_active_power"), g("meter_b_phase_active_power"), g("meter_c_phase_active_power")],
    },
  };
}
