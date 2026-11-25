/**
 * Per-asset telemetry browsing, from the NorthBound EMS Gateway.
 *
 * A "device id" here is a runtime asset id — `external_ems_1_bms_1` — which is
 * what `/api/assets` returns and what devices.service hands the UI. The source
 * is the part before the base asset id, and is recovered from it rather than
 * threaded through every call signature.
 *
 * LIVE AND HISTORICAL ARE NOT THE SAME SURFACE on this backend, and that is
 * the one thing to understand before changing anything here:
 *
 *   latest   every signal the asset publishes — 761 on the BMS, 270 on the
 *            PCS, 1,422 per source in total. Read from /api/telemetry.
 *   history  the 63 signals the fast historian logs, aggregated into six
 *            series: power, SOC, cell temperature and cell spread.
 *
 * So a key can be readable now and have no past. `fetchDeviceSeries` says so
 * by returning an empty series rather than an error — the panel renders its
 * own "no history" state — and `fetchDeviceKeys` marks which is which, so the
 * UI can offer a chart only where there is something to chart.
 */

import { fetchSourceTelemetry, unitOf, getSeries } from "@/lib/gateway";
import {
  fetchGeneral, fetchFastBess, numeric, reading,
  type GeneralRecord, type FastBessSample,
} from "@/lib/central";
import { istMidnight } from "@/lib/api/time";

export interface TelemetryKey {
  key: string;
  unit: string;
  category: string;
  /** True when the fast historian logs this signal and a chart is possible. */
  historical?: boolean;
}

export interface TelemetryPoint {
  t: string;
  ts: number;
  value: number;
}

export interface TelemetrySeries {
  key: string;
  unit: string;
  points: TelemetryPoint[];
  /**
   * Set when the key is live-readable but not logged. The panel shows this
   * instead of an empty chart that looks like an outage.
   */
  note?: string;
}

export interface LatestValues {
  [key: string]: number | null;
}

export type TimeRange = "1H" | "TODAY";

/* ── Splitting a runtime asset id ─────────────────────────────────────────── */

/**
 * `external_ems_1_bms_1` → source `external_ems_1`, asset `bms_1`.
 *
 * Matched against the known base asset ids rather than split on the last
 * underscore, because both halves contain underscores and several base ids end
 * in a digit — `external_ems_1_bms_1` splits at exactly the wrong place under
 * any positional rule, which is how the utility meter ended up keyed as
 * `grid_meter` against a base id of `utility_meter`.
 */
const BASE_ASSETS = [
  "bms_1", "pcs_1", "ems_system", "utility_meter", "liquid_cooling",
  "fire_protection", "dehumidifier", "io_module", "remote_control",
];

function splitAssetId(assetId: string): { sourceId: string; asset: string } {
  for (const base of BASE_ASSETS) {
    if (assetId.endsWith(`_${base}`)) {
      return { sourceId: assetId.slice(0, -(base.length + 1)), asset: base };
    }
  }
  /* An asset kind this build has not seen. The gateway names runtime ids
     `{source}_{something}`, and the source always starts `external_ems_`, so
     the prefix is recoverable even when the suffix is not recognised. */
  const m = /^(external_ems_\d+)_(.+)$/.exec(assetId);
  return m ? { sourceId: m[1], asset: m[2] } : { sourceId: assetId, asset: "" };
}

/* ── What the historian can actually draw ─────────────────────────────────── */

/**
 * Signal → which column of the aggregated history series answers it.
 *
 * The series is [t, meanKw, minKw, maxKw, meanSoc, maxCellTemp, maxSpreadMv,
 * chargedKwh, dischargedKwh]. Only signals that map onto one of those six
 * measurements have a past; everything else is live-only.
 *
 * Deliberately short. It would be easy to map `phase_a_voltage` onto the mean
 * power column and call it close enough — it is not, and a chart that plots one
 * quantity under another quantity's name is worse than a chart that says it has
 * no data.
 */
const SERIES_COLUMN: Record<string, 1 | 4 | 5 | 6> = {
  // Power, kW
  total_active_power: 1,
  charge_discharge_power: 1,
  energy_storage_power: 1,
  // SOC, %
  display_soc: 4,
  soc: 4,
  slave_soc: 4,
  // Max cell temperature, °C
  battery_max_temperature: 5,
  // Max cell voltage spread, mV
  max_min_cell_voltage_diff: 6,
};

/** Coarse grouping for the key browser's sections. */
function categoryOf(key: string): string {
  if (/soc|soh/.test(key)) return "Battery";
  if (/temperature|temp/.test(key)) return "Temperature";
  if (/voltage|current/.test(key)) return "Electrical";
  if (/power|energy|frequency|factor/.test(key)) return "Power";
  if (/alarm|fault|warning|protect/.test(key)) return "Fault & Alarm";
  if (/status|state|mode|enable|control/.test(key)) return "Status";
  if (/pressure|water|cooling|heating|humidity/.test(key)) return "Thermal";
  return "Other";
}

/* ── Service functions ────────────────────────────────────────────────────── */

export async function fetchDeviceKeys(deviceId: string): Promise<TelemetryKey[]> {
  const { sourceId, asset } = splitAssetId(deviceId);
  if (!sourceId || !asset) return [];

  const t = await fetchSourceTelemetry(sourceId);
  const signals = t.signals[asset] ?? {};

  return Object.keys(signals)
    .sort()
    .map((key) => ({
      key,
      /* The gateway's own unit, from the register dictionary. */
      unit: unitOf(t, asset, key),
      category: categoryOf(key),
      historical: key in SERIES_COLUMN,
    }));
}

export async function fetchDeviceLatest(
  deviceId: string, keys: string[],
): Promise<LatestValues> {
  if (!keys.length) return {};
  const { sourceId, asset } = splitAssetId(deviceId);
  if (!sourceId || !asset) return {};

  const t = await fetchSourceTelemetry(sourceId);
  const signals = t.signals[asset] ?? {};

  const latest: LatestValues = {};
  for (const k of keys) {
    /* `?? null` and not `?? 0`: a signal the snapshot did not carry, and one
       whose quality was not good, both belong on screen as a dash. */
    latest[k] = signals[k] ?? null;
  }
  return latest;
}

const hm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

export async function fetchDeviceSeries(
  deviceId: string, key: string, range: TimeRange,
): Promise<TelemetrySeries> {
  const { sourceId, asset } = splitAssetId(deviceId);
  const t = sourceId ? await fetchSourceTelemetry(sourceId).catch(() => undefined) : undefined;
  const unit = unitOf(t, asset, key);

  const column = SERIES_COLUMN[key];
  if (!column) {
    return {
      key, unit, points: [],
      note:
        "This signal is read live but is not logged. The gateway's fast " +
        "historian records 63 of the 1,422 signals it polls, and this is not " +
        "one of them.",
    };
  }

  const now = Date.now();
  let from: number;
  let points: number;
  if (range === "1H") {
    from = now - 3_600_000;
    points = 120;
  } else {
    from = istMidnight(typeof now === "number" ? now : new Date(now).getTime());
    points = 288;
  }

  const r = await getSeries({
    sourceId, bessId: "", fromEpochMs: from, toEpochMs: now, points, nowMs: now,
  });

  return {
    key,
    unit,
    points: r.data.points
      .map((p) => ({ ts: p[0], value: p[column] }))
      /* A null is a bucket with no rows. Dropped, never plotted as zero. */
      .filter((p): p is { ts: number; value: number } => p.value != null)
      .map((p) => ({ ts: p.ts, t: hm(p.ts), value: p.value })),
  };
}

/* ══ Central backend ═════════════════════════════════════════════════════════

   Everything above reads lib/gateway — the NorthBound public API, which now
   answers 503 — and keys on NorthBound runtime ids (`external_ems_1_bms_1`).
   It is left untouched because the History page still calls fetchDeviceKeys
   with those ids. The Device List hands out CENTRAL asset ids
   (`external_ems_1_bms`, `external_ems_1_grid_meter`), and against those every
   function above answered nothing: the detail panel's KPIs, chart and
   parameter table were blank for all eighteen assets.

   The readers below are the central equivalents, for the Device List's detail
   panel only:

     latest   S2, the asset's substream, newest row per signal — every point
              the asset publishes, with the backend's own unit and category.
              For the PCS and BMS, S1's 63 signals are merged on top: they are
              one second old instead of one snapshot old, and about thirty of
              them (cell extremes, cluster current, SOH …) exist ONLY on S1.
   history   The same point, point-filtered: ~35 minutes on S2, ~16 minutes
              (1,000 x 1 Hz) on S1. No range query exists on either stream, so
              the window is measured off the rows and never labelled as an
              hour or a day.
   ════════════════════════════════════════════════════════════════════════════ */

/** `external_ems_1_grid_meter` → the substream S2 files it under. */
const SUBSTREAM_OF: Record<string, string> = {
  pcs: "pcs_extended",
  bms: "bms_extended",
  grid_meter: "solar_inverter",   // grid MFM + combiner box land in solar_inverter (combiner_box_meter is empty)
};

function splitCentral(assetId: string): { sourceId: string; kind: string; substream: string } | null {
  const m = /^(external_ems_\d+)_(.+)$/.exec(assetId);
  if (!m) return null;
  return { sourceId: m[1], kind: m[2], substream: SUBSTREAM_OF[m[2]] ?? m[2] };
}

/** S2's category word → the key browser's section. */
const CATEGORY_LABEL: Record<string, string> = {
  fault_alarm: "Fault & Alarm", soc_soh: "Battery", temperature: "Temperature",
  voltage: "Electrical", current: "Electrical", power: "Power", energy: "Energy",
  status: "Status", io: "I/O", humidity: "Thermal", insulation: "Insulation",
  general: "General",
};

/** Which S1 group carries this asset's fast signals, if any. */
const s1Group = (kind: string): "pcs_values" | "bms_values" | null =>
  kind === "pcs" ? "pcs_values" : kind === "bms" ? "bms_values" : null;

export interface AssetSnapshot {
  keys: TelemetryKey[];
  latest: LatestValues;
  /** When the newest row was sampled, from the device side. */
  sampleTime: string | null;
}

async function s1For(gatewayId: string, sourceId: string): Promise<FastBessSample | undefined> {
  const rows = await fetchFastBess(gatewayId, { limit: 20 }).catch(() => [] as FastBessSample[]);
  return rows.find((r) => r.source_id === sourceId);
}

export async function fetchAssetSnapshot(gatewayId: string, assetId: string): Promise<AssetSnapshot> {
  const empty: AssetSnapshot = { keys: [], latest: {}, sampleTime: null };
  const at = splitCentral(assetId);
  if (!gatewayId || !at) return empty;
  const group = s1Group(at.kind);

  const [rows, s1] = await Promise.all([
    fetchGeneral(gatewayId, { substream: at.substream, limit: 1000 }).catch(() => [] as GeneralRecord[]),
    group ? s1For(gatewayId, at.sourceId) : Promise.resolve(undefined),
  ]);

  const keys = new Map<string, TelemetryKey>();
  const latest: LatestValues = {};
  let sampleTime: string | null = null;

  for (const r of rows) {                       // newest first
    if (r.asset_id !== assetId || !r.signal || keys.has(r.signal)) continue;
    sampleTime ??= r.sample_time_utc;
    keys.set(r.signal, {
      key: r.signal,
      unit: r.unit ?? "",
      category: (r.category && CATEGORY_LABEL[r.category]) || categoryOf(r.signal),
      historical: true,
    });
    latest[r.signal] = r.quality && r.quality !== "good" ? null : numeric(r);
  }

  if (group && s1) {
    for (const name of Object.keys(s1.data?.[group] ?? {})) {
      latest[name] = reading(s1, group, name);
      if (!keys.has(name)) {
        keys.set(name, { key: name, unit: "", category: categoryOf(name), historical: true });
      }
    }
    sampleTime = s1.sample_time_utc ?? sampleTime;
  }

  return {
    keys: [...keys.values()].sort((a, b) => a.key.localeCompare(b.key)),
    latest,
    sampleTime,
  };
}

const hms = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * One signal's recent history for one asset.
 *
 * S1 when the asset is a PCS or BMS and S1 carries the signal — 1 Hz and the
 * only source for the S1-only signals — otherwise S2 by point id.
 */
export async function fetchAssetSeries(
  gatewayId: string, assetId: string, key: string,
): Promise<TelemetrySeries> {
  const at = splitCentral(assetId);
  if (!gatewayId || !at || !key) return { key, unit: "", points: [] };
  const group = s1Group(at.kind);

  if (group) {
    const probe = await fetchFastBess(gatewayId, { limit: 20 }).catch(() => [] as FastBessSample[]);
    const mine = probe.find((r) => r.source_id === at.sourceId);
    if (mine && key in (mine.data?.[group] ?? {})) {
      const rows = await fetchFastBess(gatewayId, { limit: 1000, bessId: mine.bess_id })
        .catch(() => [] as FastBessSample[]);
      const points = rows
        .filter((r) => r.source_id === at.sourceId)
        .map((r) => ({ ts: Date.parse(r.sample_time_utc ?? ""), value: reading(r, group, key) }))
        .filter((p): p is { ts: number; value: number } => !Number.isNaN(p.ts) && p.value != null)
        .sort((a, b) => a.ts - b.ts)
        .map((p) => ({ ...p, t: hms(p.ts) }));
      return { key, unit: "", points };
    }
  }

  /* S2: the point id is shared by both cabinets, so it is looked up from the
     asset's own rows and the series is filtered back to this asset. */
  const snap = await fetchGeneral(gatewayId, { substream: at.substream, limit: 1000 })
    .catch(() => [] as GeneralRecord[]);
  const row = snap.find((r) => r.asset_id === assetId && r.signal === key);
  if (!row?.point_id) {
    return { key, unit: "", points: [], note: "This asset published no rows for this signal in the backend's window." };
  }
  const rows = await fetchGeneral(gatewayId, { pointId: row.point_id, limit: 1000 })
    .catch(() => [] as GeneralRecord[]);
  const points = rows
    .filter((r) => r.asset_id === assetId && (!r.quality || r.quality === "good"))
    .map((r) => ({ ts: Date.parse(r.sample_time_utc ?? ""), value: numeric(r) }))
    .filter((p): p is { ts: number; value: number } => !Number.isNaN(p.ts) && p.value != null)
    .sort((a, b) => a.ts - b.ts)
    .map((p) => ({ ...p, t: hms(p.ts) }));
  return { key, unit: row.unit ?? "", points };
}
