/**
 * SCADA browsing — sites, their assets, and a series for any one signal.
 *
 * The SCADA *page* is parked: it was a device-and-tag browser built on UGX's
 * flat key surface, and the gateway's equivalent is the Equipment page, which
 * already reads assets and their signals with units attached. This module
 * survives the parking because two things outside that page import it — the
 * dashboard's Power Overview chart and StationContext — and both want the same
 * two answers it has always given: which assets does this site have, and what
 * has this signal been doing.
 *
 * Everything here is the gateway. `ugxFetch` and the customer tier it walked
 * are gone; a site is a source, a device is an asset, and a series comes from
 * the fast historian through the same aggregating route the History page uses.
 */

import { getSources, fetchSourceTelemetry, unitOf, getSeries } from "@/lib/gateway";
import { overlayFor } from "../overlay/stations";

/**
 * Assets pinned into the picker regardless of what the source reports.
 *
 * Carried over as a mechanism, not as data: the UGX build used it for a test
 * device that had no customer and would otherwise have been unreachable. The
 * gateway scopes assets to sources properly, so this is normally empty — it is
 * kept because a field engineer chasing an asset the summary has stopped
 * listing still needs a way to reach it.
 */
const PINNED_ASSET_IDS = (process.env.NEXT_PUBLIC_SCADA_PINNED_DEVICE_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export interface ScadaSite {
  customerId: string;
  name: string;
  location: string;
}

export interface ScadaDevice {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

export interface ScadaParameter {
  key: string;
  label: string;
  value: number | string | null;
  unit: string;
  category: string;
}

const humanise = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ── Sites ────────────────────────────────────────────────────────────────── */

export async function fetchScadaSites(): Promise<ScadaSite[]> {
  const r = await getSources();
  return (r.data.sources as { source_id?: string; display_name?: string | null }[])
    .filter((s) => s.source_id)
    .map((s) => {
      const id = s.source_id!;
      const ov = overlayFor(id);
      return {
        customerId: id,
        name: ov.powerStationName ?? s.display_name ?? id,
        /* The gateway publishes no address; the overlay is where one goes. */
        location: ov.stationLocation ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ── Assets ───────────────────────────────────────────────────────────────── */

export async function fetchScadaDevices(sourceId: string): Promise<ScadaDevice[]> {
  if (!sourceId) return [];

  /* Read from the telemetry snapshot rather than /api/assets, because this
     list feeds a picker whose next action is to read signals: an asset that is
     configured but absent from the snapshot has nothing to show, and listing
     it leads straight to an empty panel. */
  const t = await fetchSourceTelemetry(sourceId);

  const devices = t.assets.map((asset) => ({
    id: `${sourceId}_${asset}`,
    name: humanise(asset),
    type: asset.replace(/_\d+$/, ""),
    active: true,
  }));

  for (const pinned of PINNED_ASSET_IDS) {
    if (!devices.some((d) => d.id === pinned)) {
      devices.push({ id: pinned, name: pinned, type: "pinned", active: false });
    }
  }
  return devices;
}

/* ── Signals ──────────────────────────────────────────────────────────────── */

/** `external_ems_1_bms_1` → source and asset. */
function split(deviceId: string): { sourceId: string; asset: string } {
  const m = /^(external_ems_\d+)_(.+)$/.exec(deviceId);
  return m ? { sourceId: m[1], asset: m[2] } : { sourceId: deviceId, asset: "" };
}

export async function fetchScadaKeys(deviceId: string): Promise<string[]> {
  const { sourceId, asset } = split(deviceId);
  if (!sourceId || !asset) return [];
  const t = await fetchSourceTelemetry(sourceId);
  return Object.keys(t.signals[asset] ?? {}).sort();
}

export async function fetchScadaLatest(
  deviceId: string, keys: string[],
): Promise<ScadaParameter[]> {
  const { sourceId, asset } = split(deviceId);
  if (!sourceId || !asset) return [];

  const t = await fetchSourceTelemetry(sourceId);
  const signals = t.signals[asset] ?? {};
  const wanted = keys.length ? keys : Object.keys(signals).sort();

  return wanted.map((key) => ({
    key,
    label: humanise(key),
    /* null, not 0 — the gateway published no good read for it. */
    value: signals[key] ?? null,
    unit: unitOf(t, asset, key),
    category: asset,
  }));
}

export interface ScadaSeriesPoint {
  ts: number;
  t: string;
  value: number;
}

/**
 * Which column of the aggregated history series answers a signal.
 *
 * The same six the rest of the app can chart, and the same reasoning: the fast
 * historian logs 63 of the 1,422 signals the gateway polls, and only the
 * measurements below survive bucketing as themselves. A signal not on this
 * list returns an empty series rather than a plausible-looking line drawn from
 * a different quantity.
 */
const SERIES_COLUMN: Record<string, 1 | 4 | 5 | 6> = {
  total_active_power: 1,
  charge_discharge_power: 1,
  energy_storage_power: 1,
  display_soc: 4,
  soc: 4,
  battery_max_temperature: 5,
  max_min_cell_voltage_diff: 6,
};

const label = (ms: number, rangeMs: number) =>
  rangeMs <= 48 * 3_600_000
    ? new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })
    : new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit" });

export async function fetchScadaSeries(
  deviceId: string, key: string, startTs: number, endTs: number,
): Promise<ScadaSeriesPoint[]> {
  const column = SERIES_COLUMN[key];
  if (!column) return [];

  const { sourceId } = split(deviceId);
  const rangeMs = endTs - startTs;
  if (!(rangeMs > 0)) return [];

  /* ~200 points, whatever the span. The server derives the bucket from the
     count, so the old interval ladder — 1 min, 5 min, 15 min, 1 hr, 6 hr — is
     no longer this module's arithmetic to get right. */
  const r = await getSeries({
    sourceId, bessId: "", fromEpochMs: startTs, toEpochMs: endTs, points: 200, nowMs: Date.now(),
  });

  return r.data.points
    .map((p) => ({ ts: p[0], value: p[column] }))
    .filter((p): p is { ts: number; value: number } => p.value != null)
    .map((p) => ({ ts: p.ts, t: label(p.ts, rangeMs), value: p.value }));
}
