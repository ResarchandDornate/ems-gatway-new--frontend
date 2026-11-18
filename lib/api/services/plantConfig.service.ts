/**
 * Plant configuration — the topology of one gateway source.
 *
 * On UGX this was read from a `device_config` server attribute the data logger
 * carried: a JSON blob listing every inverter, meter, transformer and PLC that
 * had been commissioned onto it. A gateway has no such attribute, and it does
 * not need one — its asset list *is* the topology. What was configuration
 * there is discovery here, and discovery cannot drift out of date.
 *
 * READ-ONLY. Cached with staleTime: Infinity by the hook, which is still right:
 * an asset list changes when somebody commissions hardware, not when a plant
 * cycles.
 */

import { getAssets, fetchSourceTelemetry } from "@/lib/gateway";
import type { PlantConfig, PlantAsset, PlantFeatures } from "../types";

/** Assets that are metering devices rather than power-conversion equipment. */
const METER_ASSETS = new Set(["utility_meter"]);
/** Assets that are the BESS itself. */
const BESS_ASSETS = new Set(["bms_1", "pcs_1"]);

function toAsset(index: number, baseId: string, displayName: string): PlantAsset {
  return {
    index,
    type: METER_ASSETS.has(baseId) ? "meter" : BESS_ASSETS.has(baseId) ? "inv" : "omd",
    subType: baseId,
    /* The gateway does not publish a manufacturer for its assets. Left blank
       rather than filled with the vendor name from the dictionary's
       `source_display_name`, which names the EMS controller, not the device. */
    oem: "",
    make: displayName,
    /* Modbus, over the serial ports the gateway names in its own
       configuration. The transport is knowable; the port is not, from here. */
    mode: "Modbus",
    slaveId: index,
    monitor: true,
  };
}

export async function getPlantConfig(
  stationId: string,
  _deviceId?: string,
): Promise<PlantConfig> {
  const empty: PlantConfig = {
    customerId: stationId, deviceId: "", gridxId: "", version: 0,
    features: emptyFeatures(),
    inverters: [], meters: [], transformers: [], plcs: [],
    wms: false, hasBess: false,
    derivedInstalledKw: 0, derivedInstalledKwh: 0, raw: [],
  };
  if (!stationId) return empty;

  const [assetsRes, telemetry] = await Promise.all([
    getAssets(stationId),
    fetchSourceTelemetry(stationId).catch(() => undefined),
  ]);

  const raw = (assetsRes.data.assets ?? []).map((a, i) =>
    toAsset(i + 1, String(a.base_asset_id ?? a.asset_id ?? ""), String(a.display_name ?? "")),
  );

  const pcsSignals = telemetry?.signals["pcs_1"] ?? {};

  return {
    customerId: stationId,
    /* The source is both. There is no logger beneath it to name separately. */
    deviceId: stationId,
    gridxId: stationId,
    version: 1,
    features: readFeatures(telemetry?.signals["ems_system"] ?? {}),
    inverters: raw.filter((a) => a.type === "inv"),
    meters: raw.filter((a) => a.type === "meter"),
    /* No transformer or PLC assets among the gateway's nine kinds. */
    transformers: [],
    plcs: [],
    /* No weather station. The liquid cooling unit's outdoor temperature is an
       ambient reading, not a WMS, and claiming otherwise would light up
       irradiance and wind widgets over a plant that measures neither. */
    wms: false,
    hasBess: raw.some((a) => BESS_ASSETS.has(a.subType)),
    /* Measured, not derived from a unit count. The PCS states its own rating,
       which is the figure the old `derivedInstalledKw` was approximating. */
    derivedInstalledKw: typeof pcsSignals["rated_power"] === "number" ? pcsSignals["rated_power"]! : 0,
    /* No rated-capacity register anywhere in the dictionary. 0 means unknown,
       and overlay/stations.ts is where a real figure is written down. */
    derivedInstalledKwh: 0,
    raw,
  };
}

function emptyFeatures(): PlantFeatures {
  return {
    monitorOnly: true,
    dgSync: { enabled: false, capacityKva: 0, thresholdPct: 0 },
    exportControl: { enabled: false, sanctionLoadKw: 0, thresholdPct: 0 },
    exportAllow: { enabled: false },
  };
}

/**
 * Site-level control features, read from the EMS controller.
 *
 * `anti_reverse_flow_enable` is genuine export control and is the same feature
 * the UGX config called `exportControl` — it is enabled or not, and carries an
 * upper limit in kW. There is no DG synchronisation on this plant: the gateway
 * publishes no generator asset and no sync register, so that half stays off.
 *
 * `monitorOnly` is true when nothing is enabled, which matches what the old
 * attribute meant: a plant this app watches but does not shape.
 */
function readFeatures(ems: Record<string, number | null>): PlantFeatures {
  const exportEnabled = ems["anti_reverse_flow_enable"] === 1;
  const demandEnabled = ems["demand_enable"] === 1;

  return {
    monitorOnly: !exportEnabled && !demandEnabled,
    dgSync: { enabled: false, capacityKva: 0, thresholdPct: 0 },
    exportControl: {
      enabled: exportEnabled,
      sanctionLoadKw: ems["anti_reverse_flow_power_upper_limit_setting"] ?? 0,
      thresholdPct: ems["demand_limit_percentage"] ?? 0,
    },
    /* Anti-reverse-flow enabled means export is being actively suppressed, so
       export is allowed exactly when it is off. Reading the same register
       twice with opposite senses is deliberate: the two fields answer
       different questions and a plant with no limiter is a plant that may
       export. */
    exportAllow: { enabled: !exportEnabled },
  };
}
