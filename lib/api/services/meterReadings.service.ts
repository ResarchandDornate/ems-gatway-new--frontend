"use client";

/**
 * A SECURE energy meter (S2 solar_meter / load_meter), for the Equipment meter tabs.
 *
 * One asset per substream (solar_meter_1 / load_meter_1). The general route returns the raw
 * signal keys (voltage_a_v, active_energy_import_kwh, …); the per-signal metadata the writer
 * adds (_q / _rsid / _obs_utc / _src_utc / _age_ms) is dropped here. Anything the meter did not
 * publish stays null, which the renderer draws as a dash.
 */
import { fetchGeneral, type GeneralRecord } from "@/lib/central";

const META = /_(q|rsid|obs_utc|src_utc|age_ms)$/;   // writer-added companion fields, not readings

export interface MeterReadings {
  present: boolean;
  capturedTs: number | null;
  assetId: string | null;
  signals: Record<string, number | null>;
}

export async function fetchMeterReadings(gatewayId: string, substream: string): Promise<MeterReadings> {
  const rows = gatewayId
    ? await fetchGeneral(gatewayId, { substream, limit: 1000 }).catch(() => [] as GeneralRecord[])
    : [];

  /* Newest first, so the first sighting of a signal is its current value. */
  const signals: Record<string, number | null> = {};
  const seen = new Set<string>();
  let ts: number | null = null;
  let assetId: string | null = null;
  for (const r of rows) {
    if (!r.signal || seen.has(r.signal) || META.test(r.signal)) continue;
    seen.add(r.signal);
    const n = r.value == null ? null : Number(r.value);
    signals[r.signal] = n != null && Number.isFinite(n) ? n : null;
    if (assetId == null && r.asset_id) assetId = r.asset_id;
    const t = Date.parse(r.sample_time_utc ?? "");
    if (!Number.isNaN(t)) ts = ts == null ? t : Math.max(ts, t);
  }
  return { present: seen.size > 0, capturedTs: ts, assetId, signals };
}
