/**
 * Kinetics BESS Gateway profile — the TARGET backend.
 *
 * Point keys, addresses, scales and absences are taken from
 * docs/kinetics-tag-mapping.md and docs/kinetics-telemetry-catalog.csv
 * (extracted from the Phase 1.6 data dictionary — 1012 definitions).
 *
 * Payload shape: nested. Paths follow the dictionary's canonical envelope
 *   assets.{asset_id}.telemetry.{point_key}   (resolver unwraps `.value`)
 * with placeholders { bank, rack, pcs } supplied per read. If the live
 * gateway returns a flatter shape, only `shape` + path prefixes change here —
 * nothing in the UI or resolver moves.
 *
 * Scales are RAW-REGISTER scales: the gateway catalogs raw Modbus values
 * (bank_voltage 7482 -> 748.2 V). If a sample response proves values arrive
 * pre-scaled, delete the scale factors here — again, only here.
 */

import type { Profile } from "../types";

const B = "assets.{bank}.telemetry.";
const R = "assets.{rack}.telemetry.";
const P = "assets.{pcs}.telemetry.";
const E = "assets.bms_environment.telemetry.";

export const KINETICS_PROFILE: Profile = {
  id: "kinetics",
  label: "Kinetics BESS Gateway (Phase 1.6)",
  shape: "nested",
  bindings: {
    // ── Bank / stack ─────────────────────────────────────────────────────────
    "bank.voltage":        { kind: "field", path: B + "bank_voltage", scale: 0.1 },      // 0x2001
    "bank.current":        { kind: "field", path: B + "ibank", scale: 0.1 },             // 0x2002 S32
    "bank.power":          {
      kind: "derived", from: ["bank.voltage", "bank.current"],
      compute: ([v, i]) => (v == null || i == null ? null : (v * i) / 1000),
      note: "no measured bank power register (mapping doc §9.1) — V×I until gateway confirms a computed field; pcs.dcPower is the measured alternative",
    },
    "bank.soc":            { kind: "field", path: B + "soc", scale: 0.1 },               // 0x2004
    "bank.soh":            { kind: "field", path: B + "bank_soh", scale: 0.1 },          // 0x2005
    "bank.cellVoltMax":    { kind: "field", path: B + "vcell_max" },                     // 0x2010, already mV
    "bank.cellVoltMin":    { kind: "field", path: B + "vcell_min" },                     // 0x2014
    "bank.cellVoltAvg":    { kind: "field", path: B + "vavg" },                          // 0x2015
    "bank.cellTempMax":    { kind: "field", path: B + "tcell_max", scale: 0.1 },         // 0x2019 S16
    "bank.cellTempMin":    { kind: "field", path: B + "tcell_min", scale: 0.1 },         // 0x201D
    "bank.cellTempAvg":    { kind: "field", path: B + "tavg", scale: 0.1 },              // 0x201E
    "bank.chargeableKwh":  { kind: "field", path: B + "echg_avl" },                      // 0x2007, measured
    "bank.dischargeableKwh": { kind: "field", path: B + "edsg_avl" },                    // 0x2008
    "bank.todayChargeKwh":    { kind: "field", path: B + "bank_today_chg_energy" },      // 0x2029, direct kWh
    "bank.todayDischargeKwh": { kind: "field", path: B + "bank_today_dsg_energy" },      // 0x2028
    "bank.chargePowerLimit":    { kind: "field", path: B + "bank_chgable_power" },       // 0x2027
    "bank.dischargePowerLimit": { kind: "field", path: B + "bank_dsgable_power" },       // 0x2026
    "bank.connectedRacks":  { kind: "field", path: B + "grid_connect_clu_num" },         // 0x2023
    "bank.totalRacks":      { kind: "field", path: B + "system_total_racks" },           // 0x2024
    "bank.chgDsgState":     { kind: "field", path: B + "chg_dsg_state" },                // 0x1032 — direct register, not derived

    // ── Rack ─────────────────────────────────────────────────────────────────
    "rack.voltage":      { kind: "field", path: R + "vrack", scale: 0.1 },               // 0x0231 S16
    "rack.current":      { kind: "field", path: R + "irack", scale: 0.1 },               // 0x0232 S16
    "rack.soc":          { kind: "field", path: R + "soc", scale: 0.1 },                 // 0x0227 ‰ -> % (mapping doc §3)
    "rack.soh":          { kind: "field", path: R + "soh", scale: 0.1 },                 // 0x0228 ‰ -> %
    "rack.cellVoltMax":  { kind: "field", path: R + "vcell_max" },                       // 0x0210, mV
    "rack.cellVoltMin":  { kind: "field", path: R + "vcell_min" },                       // 0x0214
    "rack.cellVoltAvg":  { kind: "field", path: R + "vcell_avg" },                       // 0x0219
    "rack.cellVoltDiff": { kind: "field", path: R + "vcell_diff" },                      // 0x0218 — direct register
    "rack.cellTempMax":  { kind: "field", path: R + "tcell_max", scale: 0.1 },           // 0x021A
    "rack.cellTempMin":  { kind: "field", path: R + "tcell_min", scale: 0.1 },           // 0x021E
    "rack.tempDiff":     { kind: "field", path: R + "max_bat_temp_diff", scale: 0.1 },   // 0x0229 — direct register
    "rack.runState":       { kind: "field", path: R + "bcu_run_state" },                 // 0x0019
    "rack.contactorState": { kind: "field", path: R + "contactor_state" },               // 0x001F bitfield

    // ── Cells ────────────────────────────────────────────────────────────────
    "cell.voltages":     { kind: "array", path: R + "vcell" },                           // 0x1401, native array, mV
    "cell.temperatures": { kind: "array", path: R + "tcell", scale: 0.1 },               // 0x1801, per-cell (not per-pole)
    "cell.socs":         { kind: "unmapped", reason: "no per-cell SOC register exists in this protocol (mapping doc §4) — remove the column, do not fabricate" },

    // ── PCS ──────────────────────────────────────────────────────────────────
    "pcs.activePower":   { kind: "field", path: P + "grid_active_power", scale: 0.1 },   // 0x110D S16
    "pcs.reactivePower": { kind: "field", path: P + "grid_reactive_power", scale: 0.1 }, // 0x110E — signed, replaces √(S²−P²)
    "pcs.apparentPower": { kind: "field", path: P + "grid_apparent_power", scale: 0.1 }, // 0x110F
    "pcs.powerFactor":   { kind: "field", path: P + "power_factor", scale: 0.001 },      // 0x110B — measured, replaces P/S
    "pcs.frequency":     { kind: "field", path: P + "grid_frequency", scale: 0.01 },     // 0x110C
    "pcs.lineVoltageAB": { kind: "field", path: P + "grid_ab_voltage", scale: 0.1 },     // 0x1105 — direct LL, no ×√3
    "pcs.lineVoltageBC": { kind: "field", path: P + "grid_bc_voltage", scale: 0.1 },     // 0x1106
    "pcs.lineVoltageCA": { kind: "field", path: P + "grid_ca_voltage", scale: 0.1 },     // 0x1107
    "pcs.currentA":      { kind: "field", path: P + "grid_a_current", scale: 0.1 },      // 0x1108
    "pcs.currentB":      { kind: "field", path: P + "grid_b_current", scale: 0.1 },      // 0x1109
    "pcs.currentC":      { kind: "field", path: P + "grid_c_current", scale: 0.1 },      // 0x110A
    "pcs.dcPower":       { kind: "field", path: P + "dc_power", scale: 0.1 },            // 0x1104 — battery-side power
    "pcs.dcVoltage":     { kind: "field", path: P + "dc_bus_voltage", scale: 0.1 },      // 0x1100 — was hardcoded 0
    "pcs.dcCurrent":     { kind: "field", path: P + "dc_bus_current", scale: 0.1 },      // 0x1101 — was hardcoded 0
    "pcs.igbtTempA":     { kind: "field", path: P + "igbt_a_temperature", scale: 0.1 },  // 0x1110 — was null
    "pcs.igbtTempB":     { kind: "field", path: P + "igbt_b_temperature", scale: 0.1 },  // 0x1111
    "pcs.igbtTempC":     { kind: "field", path: P + "igbt_c_temperature", scale: 0.1 },  // 0x1112
    "pcs.cabinetTemp":   { kind: "field", path: P + "cabinet_temperature", scale: 0.1 }, // 0x1113
    "pcs.operatingState": { kind: "field", path: P + "operating_state" },                // 0x1200 — numeric enum; labels pending vendor doc

    // ── Environment ──────────────────────────────────────────────────────────
    "chiller.outletTemp":     { kind: "field", path: E + "liquidcool_1_6", scale: 0.1 },   // 0x0669
    "chiller.returnTemp":     { kind: "field", path: E + "liquidcool_1_7", scale: 0.1 },   // 0x066A
    "chiller.outletPressure": { kind: "field", path: E + "liquidcool_1_8", scale: 0.01 },  // 0x066B
    "chiller.returnPressure": { kind: "field", path: E + "liquidcool_1_9", scale: 0.01 },  // 0x066C
    "chiller.ambientTemp":    { kind: "field", path: E + "liquidcool_1_10", scale: 0.1 },  // 0x066D
    "chiller.commFault":      { kind: "field", path: E + "liquid_cooling_comm_fault" },    // 0x0601
    "hvac.indoorTemp":        { kind: "field", path: E + "aircond_1_10", scale: 0.1 },     // 0x068F
    "hvac.humidity":          { kind: "field", path: E + "aircond_1_11" },                 // 0x0690
    "fire.alarmLevel1":       { kind: "field", path: E + "di6h" },                         // 0x0609
    "fire.alarmLevel2":       { kind: "field", path: E + "di4h" },                         // 0x0607
    "meter.activePowerTotal": { kind: "field", path: E + "essmeter_1_14" },                // 0x0636 Pt
    "meter.frequency":        { kind: "field", path: E + "essmeter_1_27" },                // 0x0650 F
  },
};
