/**
 * NorthBound EMS Gateway profile — the backend this app runs on.
 *
 * Point names come from the Telemetry Data Dictionary of 10 August 2026, which
 * resolves both EMS sources (`external_ems_1`, `external_ems_2`) across nine
 * assets and 2,844 definitions. Names are verified against the deployed build
 * `0.10.0-operator-control`, not against the inventory — the two disagree, and
 * the deployed build wins (see docs/gateway-findings-2026-09-03.md).
 *
 * PAYLOAD SHAPE: nested, two levels, resolved against the flattened snapshot
 * that lib/gateway/fetch.ts produces:
 *
 *     signals.{base_asset_id}.{signal_name}
 *
 * The raw `/api/telemetry` envelope is keyed by *runtime* asset id
 * (`external_ems_1_grid_meter`) while its nodes carry a different *base* id
 * (`utility_meter`); flattening by base id is what makes one profile serve both
 * sources, and it is why paths here name `utility_meter` and not a source.
 *
 * NO SCALE FACTORS, deliberately. The gateway decodes registers itself and
 * publishes `{ value, raw, quality }` — `phase_a_voltage` arrives as 228.6, not
 * as the raw 2286. The Kinetics profile beside this one carries 0.1 factors
 * throughout because it was written against a register catalogue rather than
 * against a decoding gateway; copying its factors here would divide every
 * reading on the site by ten.
 *
 * WHAT IS UNMAPPED, and why it is stated rather than omitted: the rack and cell
 * families have no source on this build at all. `/api/bms/racks` and its three
 * siblings return FastAPI's own 404 — byte-identical to a route invented for
 * the test — and the gateway's OpenAPI declares 58 paths with no `rack`,
 * `cell`, `module` or `cluster` among them. The battery is one aggregate asset.
 * Binding those metrics to bank-level figures would make a per-rack view that
 * is not one, so they are declared unmapped with the reason attached and the
 * audit report says so.
 */

import type { Profile } from "../types";

const B = "signals.bms_1.";
const P = "signals.pcs_1.";
const E = "signals.ems_system.";
const M = "signals.utility_meter.";
const C = "signals.liquid_cooling.";
const F = "signals.fire_protection.";
const D = "signals.dehumidifier.";

/**
 * Why every *rack* metric is absent.
 *
 * The battery is one cluster and says so. The Telemetry Data Dictionary of
 * 10 August 2026 lists exactly one set of cluster registers per BMS —
 * `cluster_total_voltage_collected`, `cluster_total_current`,
 * `cluster_internal_soc`, `battery_cluster_internal_resistance` — with no
 * numbered `rack_N`/`cluster_N` family anywhere in the 761 points on bms_1.
 * So there is no *second* rack to report, and the per-rack metrics stay
 * unmapped: `rack.*` exists to distinguish one rack from another, and a
 * profile that answered them from the cluster aggregate would be reporting a
 * comparison it cannot make.
 *
 * This no longer covers the CELLS. See the cell block below — 260 per-cell
 * voltages and 160 per-probe temperatures are published in the telemetry
 * snapshot, and were unmapped here on the strength of `/api/bms/*` returning
 * 404. That 404 is real and is about a *route*; the cells were never behind
 * it. They are at `assets.{source}_bms_1.signals.cell_voltage_N.value`, which
 * is the same snapshot every other binding in this file reads.
 */
const NO_RACKS =
  "the deployed gateway exposes the battery as a single cluster — the " +
  "dictionary lists one set of cluster registers per BMS and no numbered " +
  "rack family, so there is no second rack to report against";

export const NORTHBOUND_PROFILE: Profile = {
  id: "northbound",
  label: "NorthBound EMS Gateway (ems-api.unityess.cloud)",
  shape: "nested",
  bindings: {
    // ── Bank / pack ──────────────────────────────────────────────────────────
    "bank.voltage":     { kind: "field", path: B + "cluster_total_voltage_collected" },
    "bank.current":     {
      kind: "field", path: B + "cluster_total_current",
      /* The Hall-effect sampling current is the same measurement taken a
         different way, and is what this BMS publishes when the cluster total
         reads bad. */
      fallbacks: [B + "can_hall_sampling_current"],
    },
    "bank.power": {
      kind: "derived", from: ["bank.voltage", "bank.current"],
      compute: ([v, i]) => (v == null || i == null ? null : (v * i) / 1000),
      note: "no measured DC power register on the BMS; pcs.dcPower is the measured alternative",
    },
    "bank.soc":         { kind: "field", path: B + "display_soc" },
    "bank.soh":         { kind: "field", path: B + "soh" },
    "bank.cellVoltMax": { kind: "field", path: B + "cell_max_voltage" },
    "bank.cellVoltMin": { kind: "field", path: B + "cell_min_voltage" },
    "bank.cellTempMax": { kind: "field", path: B + "battery_max_temperature" },
    "bank.cellTempMin": { kind: "field", path: B + "battery_min_temperature" },
    "bank.cellTempAvg": { kind: "field", path: B + "average_temperature" },
    "bank.chgDsgState": { kind: "field", path: B + "charge_discharge_status" },
    "bank.lifetimeChargeKwh":    {
      kind: "field", path: P + "ac_cumulative_charge_energy",
      fallbacks: [B + "total_cumulative_charge_capacity"],
    },
    "bank.lifetimeDischargeKwh": {
      kind: "field", path: P + "ac_cumulative_discharge_energy",
      fallbacks: [B + "total_cumulative_discharge_capacity"],
    },
    "bank.monthlyChargeKwh":     { kind: "field", path: B + "monthly_cumulative_charge_energy" },
    "bank.monthlyDischargeKwh":  { kind: "field", path: B + "monthly_cumulative_discharge_energy" },
    "bank.chargePowerLimit":     {
      kind: "field", path: P + "bms_available_charge_power",
      fallbacks: [P + "available_charge_power", E + "total_available_charge_power"],
    },
    "bank.dischargePowerLimit":  {
      kind: "field", path: P + "bms_available_discharge_power",
      fallbacks: [P + "available_discharge_power", E + "total_available_discharge_power"],
    },
    /* The BMS publishes the pack average directly. This was declared unmapped
       on the reasoning that pack volts over a cell count needs a cell count
       nobody publishes — true, and beside the point: `cell_average_voltage` is
       a register of its own and is in the dictionary. */
    "bank.cellVoltAvg": { kind: "field", path: B + "cell_average_voltage" },
    /* Which cell and which probe hold the pack extremes. Index registers, not
       measurements — the id is the cell's position in the 260-register block,
       so it indexes cell.voltages directly. */
    "bank.maxVoltCellNo":  { kind: "field", path: B + "cell_max_voltage_id" },
    "bank.minVoltCellNo":  { kind: "field", path: B + "cell_min_voltage_id" },
    "bank.maxTempProbeNo": { kind: "field", path: B + "battery_max_temperature_id" },
    "bank.minTempProbeNo": { kind: "field", path: B + "battery_min_temperature_id" },
    "bank.connectedRacks": { kind: "unmapped", reason: NO_RACKS },
    "bank.totalRacks":     { kind: "unmapped", reason: NO_RACKS },

    // ── Rack and cell ────────────────────────────────────────────────────────
    "rack.voltage":      { kind: "unmapped", reason: NO_RACKS },
    "rack.current":      { kind: "unmapped", reason: NO_RACKS },
    "rack.soc":          { kind: "unmapped", reason: NO_RACKS },
    "rack.soh":          { kind: "unmapped", reason: NO_RACKS },
    "rack.cellVoltMax":  { kind: "unmapped", reason: NO_RACKS },
    "rack.cellVoltMin":  { kind: "unmapped", reason: NO_RACKS },
    "rack.cellVoltDiff": { kind: "unmapped", reason: NO_RACKS },
    "rack.cellTempMax":  { kind: "unmapped", reason: NO_RACKS },
    "rack.cellTempMin":  { kind: "unmapped", reason: NO_RACKS },
    "rack.tempDiff":     { kind: "unmapped", reason: NO_RACKS },
    "rack.runState":     { kind: "unmapped", reason: NO_RACKS },

    /* ── Cells ──────────────────────────────────────────────────────────────
       260 cell voltages and 160 temperature probes, gathered out of the
       snapshot into one array each.

       `count` is the register BLOCK, not a count of sensors, and the two are
       not assumed equal — `zeroPadded` trims the unread tail, so a pack wired
       with fewer cells shortens the array on its own instead of drawing dead
       cells at 0 mV. On the commissioned site the block is very nearly full:
       the 20 h reference capture has the pack at 849–871 V against cells of
       3270–3366 mV, which puts 259.4 cells in series, so essentially all 260
       registers carry a real cell.

       Trimming only the TAIL is deliberate and is the resolver's rule, not
       this profile's: a zero in the MIDDLE of the block is a failed sensor and
       has to stay visible. Shortening the pack around it would hide the one
       reading somebody needs to see.

       No scale. The dictionary gives factor 1.0 and units of mV and degC for
       both families, which are already the canonical units in the registry. */
    "cell.voltages": {
      kind: "array",
      path: B + "cell_voltage",
      expand: { keyTemplate: B + "cell_voltage_{n}", count: 260 },
      zeroPadded: true,
    },
    "cell.temperatures": {
      kind: "array",
      path: B + "battery_temperature",
      expand: { keyTemplate: B + "battery_temperature_{n}", count: 160 },
      zeroPadded: true,
    },
    /* There is no per-cell SOC on this BMS. Unlike the two above, this one was
       checked rather than inferred: the dictionary has no `cell_soc_N` family
       at all, and `cluster_internal_soc` is a pack figure. Leave the column
       empty; do not spread pack SOC across 260 cells to fill it. */
    "cell.socs": {
      kind: "unmapped",
      reason: "no per-cell SOC register — the dictionary lists no cell_soc_N family on bms_1",
    },
    /* Busbar pole probes. `hv_box_temperature_1..4` is the nearest thing the
       BMS publishes and it is not the same sensor set: four HV-box connector
       probes, not per-module pole temperatures. Bound to the wrong four
       readings this would look right and mean something else. */
    "cell.poleTemperatures": {
      kind: "unmapped",
      reason: "no pole-temperature family; hv_box_temperature_1..4 are HV-box connector probes, a different sensor set",
    },

    // ── PCS ──────────────────────────────────────────────────────────────────
    "pcs.activePower":   { kind: "field", path: P + "total_active_power" },
    "pcs.reactivePower": { kind: "field", path: P + "total_reactive_power" },
    "pcs.apparentPower": { kind: "field", path: P + "total_apparent_power" },
    "pcs.powerFactor":   { kind: "field", path: P + "total_power_factor" },
    "pcs.frequency":     { kind: "field", path: P + "grid_frequency" },
    /* This PCS publishes PHASE voltages; the metric is a LINE voltage.
       × √3 holds exactly for a balanced three-phase system and is the standard
       conversion — done here, once, rather than in each screen that reads it. */
    "pcs.lineVoltageAB": { kind: "field", path: P + "phase_a_voltage", scale: Math.sqrt(3) },
    "pcs.lineVoltageBC": { kind: "field", path: P + "phase_b_voltage", scale: Math.sqrt(3) },
    "pcs.lineVoltageCA": { kind: "field", path: P + "phase_c_voltage", scale: Math.sqrt(3) },
    "pcs.currentA":      { kind: "field", path: P + "phase_a_current" },
    "pcs.currentB":      { kind: "field", path: P + "phase_b_current" },
    "pcs.currentC":      { kind: "field", path: P + "phase_c_current" },
    "pcs.dcPower":       { kind: "field", path: P + "dc_power", fallbacks: [P + "dc_power_2"] },
    "pcs.dcVoltage":     { kind: "field", path: P + "dc_voltage", fallbacks: [P + "pcs_total_dc_voltage"] },
    "pcs.dcCurrent":     { kind: "field", path: P + "dc_current" },
    /* Per-phase power-stage probes. The metric is named for the IGBT and the
       gateway names it for the phase; it is the same sensor. */
    "pcs.igbtTempA":     { kind: "field", path: P + "phase_a_temperature" },
    "pcs.igbtTempB":     { kind: "field", path: P + "phase_b_temperature" },
    "pcs.igbtTempC":     { kind: "field", path: P + "phase_c_temperature" },
    "pcs.cabinetTemp":   { kind: "field", path: P + "cavity_temperature", fallbacks: [P + "heat_sink_temperature"] },
    "pcs.operatingState": { kind: "field", path: P + "running_status_2" },

    // ── Liquid cooling ───────────────────────────────────────────────────────
    "chiller.outletTemp":     { kind: "field", path: C + "outlet_water_temperature" },
    "chiller.returnTemp":     { kind: "field", path: C + "inlet_water_temperature" },
    "chiller.outletPressure": { kind: "field", path: C + "outlet_water_pressure" },
    "chiller.returnPressure": { kind: "field", path: C + "inlet_water_pressure" },
    "chiller.ambientTemp":    { kind: "field", path: C + "outdoor_temperature" },
    "chiller.commFault":      { kind: "field", path: C + "meter_communication_fault" },

    // ── Cabinet environment ──────────────────────────────────────────────────
    "hvac.indoorTemp": { kind: "field", path: D + "current_temperature" },
    "hvac.humidity":   { kind: "field", path: D + "current_humidity" },
    "fire.alarmLevel1": { kind: "field", path: F + "di6h" },               // Fire Alarm L1 (backend key)
    "fire.alarmLevel2": { kind: "field", path: F + "di4h" },               // Fire Alarm L2 (backend key)

    // ── Utility meter ────────────────────────────────────────────────────────
    "meter.activePowerTotal": { kind: "field", path: M + "total_active_power" },
    "meter.frequency":        { kind: "field", path: M + "frequency" },

    // ── Site ─────────────────────────────────────────────────────────────────
    /* All four are new. UGX published no site load at all, and grid power was
       inferred from a meter key that sometimes carried inverter power instead. */
    "site.gridPower":    {
      kind: "field", path: E + "grid_current_total_power",
      fallbacks: [M + "total_active_power", E + "metering_current_total_power"],
    },
    "site.loadPower":    { kind: "field", path: E + "load_power" },
    "site.gridImportKwh": { kind: "field", path: M + "forward_total_active_energy" },
    "site.gridExportKwh": { kind: "field", path: M + "reverse_total_active_energy" },
    /* Solar is real on this site — a Solis inverter producing 57.81 kW when it
       was found — but it is published at /api/solis/status, outside the
       telemetry snapshot this profile resolves against. Unmapped rather than
       absent, so the audit report distinguishes "this plant has none" from
       "this profile does not reach it". */
    "site.solarPower": {
      kind: "unmapped",
      reason: "published at /api/solis/status, which is outside the /api/telemetry snapshot",
    },
    "site.inverterPower": {
      kind: "unmapped",
      reason: "published at /api/solis/status, which is outside the /api/telemetry snapshot",
    },
    "site.ratedCapacityKwh": {
      kind: "unmapped",
      reason: "no rated-capacity register anywhere in the 2,844-point dictionary; set installedCapacity in overlay/stations.ts",
    },
  },
};
