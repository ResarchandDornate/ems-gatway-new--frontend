/**
 * The plant key map — every telemetry signal on one gateway source, annotated.
 *
 * WHAT CHANGED. On UGX this file was 469 lines of *discovery*: list the
 * customer's devices, fetch each one's timeseries key list, then work out from
 * the shape of each key name what it measured, what unit it was in, which
 * inverter it belonged to and whether it was worth charting. None of that
 * survives the move, because none of it is guesswork any more:
 *
 *   what it measures   the gateway states the signal's unit, from the same
 *                      register dictionary that defines the address
 *   which thing it is  signals arrive already scoped to an asset — bms_1,
 *                      pcs_1, utility_meter — rather than pooled on a logger
 *   which are logged   the fast historian's profile is a known 63 signals,
 *                      not a property to be inferred from whether a key
 *                      happened to return points
 *
 * So this reads the snapshot and labels it. The PlantKeyMap shape is unchanged
 * — the dashboard, the power flow diagram, the energy twin and the widget
 * registry all read it, and none of them needed to know the backend moved.
 */

import { fetchSourceTelemetry, unitOf, type SourceTelemetry } from "@/lib/gateway";
import { activeProfile, tagToMetric, scaleForTag, type MetricId } from "../metrics";
import type { PlantKey, PlantKeyMap, KeyCategory } from "../types";

/* ── Asset identity ───────────────────────────────────────────────────────── */

/** Human name for an asset, used as the key's subcategory. */
const ASSET_LABEL: Record<string, string> = {
  bms_1: "BMS",
  pcs_1: "PCS",
  ems_system: "EMS Controller",
  utility_meter: "Grid Meter",
  liquid_cooling: "Liquid Cooling",
  fire_protection: "Fire Protection",
  dehumidifier: "Dehumidifier",
  io_module: "IO Module",
  remote_control: "Remote Control",
};

/**
 * The 63 signals the fast historian logs, as `"ASSET name"`.
 *
 * Imported rather than restated: gateway/signals.ts is generated from the
 * published profile CSV, and a second hand-maintained list here would be wrong
 * the first time the gateway changes its profile.
 */
import { SIGNALS } from "@/mobile_app_kunal_backend/gateway/signals";

const LOGGED = new Set(
  SIGNALS.map((s) => `${s.asset === "PCS" ? "pcs_1" : "bms_1"}.${s.name}`),
);

/* ── Categorisation ───────────────────────────────────────────────────────── */

/**
 * Which of the UI's twelve categories a signal belongs to.
 *
 * Asset first, then name. The order matters: every signal on the utility meter
 * is a grid measurement whatever it is called, and a name-first rule filed
 * `utility_meter.phase_a_voltage` under "voltage" alongside the PCS's, where
 * the grid panel could not find it.
 */
function categorise(asset: string, key: string): KeyCategory {
  if (asset === "utility_meter") {
    return /energy/.test(key) ? "energy" : "grid";
  }
  if (asset === "liquid_cooling" || asset === "dehumidifier") {
    return /temperature|temp/.test(key) ? "temperature" : "status";
  }
  if (asset === "fire_protection") return "status";

  if (/^soc|_soc|soh/.test(key)) return "battery";
  if (/energy|capacity/.test(key) && !/available|alarm/.test(key)) return "energy";
  if (/power/.test(key) && !/power_on|power_off|power_supply/.test(key)) return "power";
  if (/frequency/.test(key)) return "frequency";
  if (/voltage/.test(key)) return "voltage";
  if (/current/.test(key)) return "current";
  if (/temperature|temp/.test(key)) return asset === "bms_1" ? "battery" : "temperature";
  if (/status|state|mode|enable|control|command/.test(key)) return "status";
  return "other";
}

/** `total_active_power` → `Total Active Power`. */
function humanise(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Whether a signal is worth showing as a live reading.
 *
 * Everything on the snapshot is live by definition — the gateway polled it
 * seconds ago. The exclusions are the ones that are not *readings*: configured
 * setpoints, alarm limits and write-side control words, which are settings a
 * live-values panel should not present as measurements.
 */
function isRealtime(key: string): boolean {
  return !/_setting$|_limit|_alarm_value$|_control$|_command$|_dispatch$|time_sync_/.test(key);
}

/* ── Building the map ─────────────────────────────────────────────────────── */

function buildKeys(sourceId: string, t: SourceTelemetry): PlantKey[] {
  const profile = activeProfile();
  const out: PlantKey[] = [];

  for (const asset of Object.keys(t.signals).sort()) {
    const label = ASSET_LABEL[asset] ?? humanise(asset);
    for (const key of Object.keys(t.signals[asset]).sort()) {
      /* The profile binds paths as `signals.{asset}.{name}`, so that is the
         tag a metric lookup has to be asked about — the bare signal name is
         ambiguous across assets, and `total_active_power` exists on both the
         PCS and the utility meter meaning different things. */
      const tag = `signals.${asset}.${key}`;
      const metric = tagToMetric(profile, tag) as MetricId | undefined;

      out.push({
        key,
        /* Runtime asset id, which is what deviceTelemetry.service splits back
           apart and what /api/assets calls this thing. */
        deviceId: `${sourceId}_${asset}`,
        deviceName: label,
        label: humanise(key),
        unit: unitOf(t, asset, key),
        category: categorise(asset, key),
        subcategory: label,
        metric,
        scale: scaleForTag(profile, tag),
        isRealtime: isRealtime(key),
        /* Charting is possible only where the historian logs it. This used to
           be a guess about whether a key "looked historic"; it is now a fact. */
        isHistoric: LOGGED.has(`${asset}.${key}`),
      });
    }
  }
  return out;
}

const byCat = (keys: PlantKey[], c: KeyCategory) => keys.filter((k) => k.category === c);

export async function getPlantKeyMap(stationId: string): Promise<PlantKeyMap> {
  const empty: PlantKeyMap = {
    all: [], byCategory: {}, byMetric: {},
    stationPowerKeys: [], perInverterPower: [], energyKeys: [], gridKeys: [],
    batteryKeys: [], wmsKeys: [], voltageKeys: [], currentKeys: [], performanceKeys: [],
  };
  if (!stationId) return empty;

  const t = await fetchSourceTelemetry(stationId);
  const all = buildKeys(stationId, t);

  const byCategory: PlantKeyMap["byCategory"] = {};
  for (const k of all) (byCategory[k.category] ??= []).push(k);

  const byMetric: PlantKeyMap["byMetric"] = {};
  for (const k of all) if (k.metric) (byMetric[k.metric] ??= []).push(k);

  return {
    all,
    byCategory,
    byMetric,
    /* The plant's headline power, in the order a caller should prefer them:
       the PCS's own total, then the EMS's aggregate of it. */
    stationPowerKeys: all.filter(
      (k) =>
        (k.deviceId.endsWith("_pcs_1") && k.key === "total_active_power") ||
        (k.deviceId.endsWith("_ems_system") && k.key === "energy_storage_power"),
    ),
    /* No PV inverters among the gateway's nine asset kinds. The site's Solis
       is real but lives outside this snapshot — see the northbound profile. */
    perInverterPower: [],
    energyKeys: byCat(all, "energy"),
    gridKeys: byCat(all, "grid"),
    batteryKeys: byCat(all, "battery"),
    /* No weather station on this gateway. The liquid cooling unit reports an
       outdoor temperature, which is an ambient reading and not a WMS: filing
       it here would put one thermometer under a heading the irradiance and
       wind widgets also read from, and they would render a plant with weather
       data it does not have. */
    wmsKeys: [],
    voltageKeys: byCat(all, "voltage"),
    currentKeys: byCat(all, "current"),
    /* CUF, performance ratio and yield are solar figures computed from
       irradiance. No irradiance, no performance keys. */
    performanceKeys: [],
  };
}
