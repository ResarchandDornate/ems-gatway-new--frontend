/**
 * Canonical metric registry.
 *
 * This is the vocabulary the frontend speaks. Components and hooks refer to
 * these ids ("bank.voltage", "pcs.activePower") and never to vendor tags.
 * Swapping backends means writing a new profile, not touching the UI.
 *
 * Units here are CANONICAL: whatever the source publishes, the resolver
 * converts into this unit before the value reaches the UI.
 */

import type { MetricSpec } from "./types";

export const METRICS = {
  // ── Bank / stack ───────────────────────────────────────────────────────────
  "bank.voltage":        { unit: "V",   label: "Bank Voltage" },
  "bank.current":        { unit: "A",   label: "Bank Current", signed: true },
  "bank.power":          { unit: "kW",  label: "Bank Power", signed: true },
  "bank.soc":            { unit: "%",   label: "Bank SOC" },
  "bank.soh":            { unit: "%",   label: "Bank SOH" },
  "bank.cellVoltMax":    { unit: "mV",  label: "Max Cell Voltage" },
  "bank.cellVoltMin":    { unit: "mV",  label: "Min Cell Voltage" },
  "bank.cellVoltAvg":    { unit: "mV",  label: "Avg Cell Voltage" },
  "bank.cellTempMax":    { unit: "°C",  label: "Max Cell Temperature" },
  "bank.cellTempMin":    { unit: "°C",  label: "Min Cell Temperature" },
  "bank.cellTempAvg":    { unit: "°C",  label: "Avg Cell Temperature" },
  "bank.chargeableKwh":  { unit: "kWh", label: "Chargeable Energy" },
  "bank.dischargeableKwh": { unit: "kWh", label: "Dischargeable Energy" },
  "bank.todayChargeKwh":    { unit: "kWh", label: "Today Charge" },
  "bank.todayDischargeKwh": { unit: "kWh", label: "Today Discharge" },
  "bank.lifetimeChargeKwh":    { unit: "kWh", label: "Lifetime Charge" },
  "bank.lifetimeDischargeKwh": { unit: "kWh", label: "Lifetime Discharge" },
  "bank.stateOfEnergy":     { unit: "%",   label: "State of Energy" },
  "bank.sohMin":            { unit: "%",   label: "Worst Cell SOH" },
  "bank.cellSocAvg":        { unit: "%",   label: "Avg Cell SOC" },
  "bank.monthlyChargeKwh":    { unit: "kWh", label: "Month-to-date Charge" },
  "bank.monthlyDischargeKwh": { unit: "kWh", label: "Month-to-date Discharge" },
  "bank.chargePowerLimit":    { unit: "kW", label: "Charge Power Limit" },
  "bank.dischargePowerLimit": { unit: "kW", label: "Discharge Power Limit" },
  // arrposres / arrnegres — bank-level counterparts of the per-rack reserve
  // registers. Unit undocumented, so the raw value is surfaced unconverted.
  "bank.chargeReserve":       { unit: "", label: "Bank Charge Reserve (raw)" },
  "bank.dischargeReserve":    { unit: "", label: "Bank Discharge Reserve (raw)" },
  "bank.connectedRacks":  { unit: "count", label: "Connected Racks" },
  "bank.totalRacks":      { unit: "count", label: "Total Racks" },
  "bank.chgDsgState":     { unit: "enum",  label: "Charge/Discharge State" },
  // Stack-level index registers: which rack and which cell/probe within it
  // holds the pack extreme. Published throughout, never previously read.
  "bank.maxVoltRackNo":  { unit: "count", label: "Max Cell Voltage Rack Number" },
  "bank.maxVoltCellNo":  { unit: "count", label: "Max Cell Voltage Number" },
  "bank.minVoltRackNo":  { unit: "count", label: "Min Cell Voltage Rack Number" },
  "bank.minVoltCellNo":  { unit: "count", label: "Min Cell Voltage Number" },
  "bank.maxTempRackNo":  { unit: "count", label: "Max Temperature Rack Number" },
  "bank.maxTempProbeNo": { unit: "count", label: "Max Temperature Probe Number" },
  "bank.minTempRackNo":  { unit: "count", label: "Min Temperature Rack Number" },
  "bank.minTempProbeNo": { unit: "count", label: "Min Temperature Probe Number" },

  // ── Rack / cluster ─────────────────────────────────────────────────────────
  "rack.voltage":      { unit: "V",  label: "Rack Voltage" },
  "rack.current":      { unit: "A",  label: "Rack Current", signed: true },
  "rack.soc":          { unit: "%",  label: "Rack SOC" },
  "rack.soh":          { unit: "%",  label: "Rack SOH" },
  "rack.cellVoltMax":  { unit: "mV", label: "Rack Max Cell Voltage" },
  "rack.cellVoltMin":  { unit: "mV", label: "Rack Min Cell Voltage" },
  "rack.cellVoltAvg":  { unit: "mV", label: "Rack Avg Cell Voltage" },
  "rack.cellVoltDiff": { unit: "mV", label: "Rack Cell Voltage Spread" },
  "rack.cellTempMax":  { unit: "°C", label: "Rack Max Cell Temperature" },
  "rack.cellTempMin":  { unit: "°C", label: "Rack Min Cell Temperature" },
  "rack.tempDiff":     { unit: "°C", label: "Rack Max Temp Difference" },
  "rack.cellTempAvg":  { unit: "°C", label: "Rack Avg Cell Temperature" },
  "rack.sohAvg":       { unit: "%",  label: "Rack Avg SOH" },
  "rack.power":        { unit: "kW", label: "Rack Power", signed: true },
  "rack.runState":     { unit: "enum", label: "Rack Run State" },
  "rack.contactorState": { unit: "enum", label: "Contactor State" },
  // Per-rack registers the firmware added alongside the rack split. The bank
  // has no equivalent any more — the stack-level energy counters stopped being
  // published, so these are the only source for per-rack throughput.
  "rack.stateOfEnergy":       { unit: "%",   label: "Rack State of Energy" },
  "rack.socAvg":              { unit: "%",   label: "Rack Avg Cell SOC" },
  "rack.sohMin":              { unit: "%",   label: "Rack Min SOH" },
  "rack.sohMax":              { unit: "%",   label: "Rack Max SOH" },
  "rack.todayChargeKwh":      { unit: "kWh", label: "Rack Charge Today" },
  "rack.todayDischargeKwh":   { unit: "kWh", label: "Rack Discharge Today" },
  "rack.lifetimeChargeKwh":   { unit: "kWh", label: "Rack Lifetime Charge" },
  "rack.lifetimeDischargeKwh":{ unit: "kWh", label: "Rack Lifetime Discharge" },
  "rack.prechargeVoltage":    { unit: "V",   label: "Rack Precharge Voltage" },
  // cluposres / clunegres. The register unit is not documented in UGX v1.0 and
  // the observed value is a flat 20000, so no unit is asserted here.
  "rack.chargeReserve":       { unit: "",    label: "Rack Charge Reserve (raw)" },
  "rack.dischargeReserve":    { unit: "",    label: "Rack Discharge Reserve (raw)" },
  "rack.arrayNo":             { unit: "count", label: "Rack Array Number" },
  "rack.clusterNo":           { unit: "count", label: "Rack Cluster Number" },
  "rack.pcsActivePower":      { unit: "kW",  label: "Rack PCS Active Power", signed: true },
  // Index registers — which cell/probe holds the rack extreme. These populate
  // the "Max Cell Voltage ID" style fields that currently render a placeholder.
  "rack.maxVoltCellNo":  { unit: "count", label: "Rack Max Cell Voltage Number" },
  "rack.minVoltCellNo":  { unit: "count", label: "Rack Min Cell Voltage Number" },
  "rack.maxTempProbeNo": { unit: "count", label: "Rack Max Temp Probe Number" },
  "rack.minTempProbeNo": { unit: "count", label: "Rack Min Temp Probe Number" },
  "rack.maxSohCellNo":   { unit: "count", label: "Rack Max SOH Cell Number" },
  "rack.minSohCellNo":   { unit: "count", label: "Rack Min SOH Cell Number" },
  // PCS-reported counters, published per rack. Distinct from the BMS-reported
  // rack.lifetime*/today* registers above and not interchangeable with them.
  "rack.pcsLifetimeChargeKwh":    { unit: "kWh", label: "Rack PCS Lifetime Charge" },
  "rack.pcsLifetimeDischargeKwh": { unit: "kWh", label: "Rack PCS Lifetime Discharge" },
  "rack.pcsMonthlyChargeKwh":     { unit: "kWh", label: "Rack PCS Month-to-date Charge" },
  "rack.pcsMonthlyDischargeKwh":  { unit: "kWh", label: "Rack PCS Month-to-date Discharge" },
  /** PCS controller clock, not a measurement — surfaced for comms diagnostics. */
  "rack.pcsTime":                 { unit: "",    label: "Rack PCS Timestamp" },

  // ── Cells (array metrics) ──────────────────────────────────────────────────
  "cell.voltages":     { unit: "mV", label: "Cell Voltages", array: true },
  "cell.temperatures": { unit: "°C", label: "Cell Temperatures", array: true },
  "cell.socs":         { unit: "%",  label: "Cell SOCs", array: true },
  "cell.sohs":         { unit: "%",  label: "Cell SOHs", array: true },
  /** Busbar pole probes — a separate sensor set from the per-cell probes. */
  "cell.poleTemperatures": { unit: "°C", label: "Pole Temperatures", array: true },

  // ── PCS ────────────────────────────────────────────────────────────────────
  "pcs.activePower":    { unit: "kW",   label: "Active Power", signed: true },
  "pcs.reactivePower":  { unit: "kVar", label: "Reactive Power", signed: true },
  "pcs.apparentPower":  { unit: "kVA",  label: "Apparent Power" },
  "pcs.powerFactor":    { unit: "",     label: "Power Factor", signed: true },
  "pcs.frequency":      { unit: "Hz",   label: "Grid Frequency" },
  "pcs.lineVoltageAB":  { unit: "V",    label: "AB Line Voltage" },
  "pcs.lineVoltageBC":  { unit: "V",    label: "BC Line Voltage" },
  "pcs.lineVoltageCA":  { unit: "V",    label: "CA Line Voltage" },
  "pcs.currentA":       { unit: "A",    label: "Phase A Current" },
  "pcs.currentB":       { unit: "A",    label: "Phase B Current" },
  "pcs.currentC":       { unit: "A",    label: "Phase C Current" },
  "pcs.dcPower":        { unit: "kW",   label: "DC Power", signed: true },
  "pcs.dcVoltage":      { unit: "V",    label: "DC Bus Voltage" },
  "pcs.dcCurrent":      { unit: "A",    label: "DC Bus Current", signed: true },
  "pcs.igbtTempA":      { unit: "°C",   label: "IGBT-A Temperature" },
  "pcs.igbtTempB":      { unit: "°C",   label: "IGBT-B Temperature" },
  "pcs.igbtTempC":      { unit: "°C",   label: "IGBT-C Temperature" },
  "pcs.cabinetTemp":    { unit: "°C",   label: "Cabinet Temperature" },
  "pcs.operatingState": { unit: "enum", label: "PCS Operating State" },

  // ── Environment / auxiliaries ──────────────────────────────────────────────
  "chiller.outletTemp":     { unit: "°C",  label: "Outlet Water Temperature" },
  "chiller.returnTemp":     { unit: "°C",  label: "Return Water Temperature" },
  "chiller.outletPressure": { unit: "Bar", label: "Outlet Water Pressure" },
  "chiller.returnPressure": { unit: "Bar", label: "Return Water Pressure" },
  "chiller.ambientTemp":    { unit: "°C",  label: "Chiller Ambient Temperature" },
  "chiller.commFault":      { unit: "bool", label: "Chiller Comm Fault" },
  "hvac.indoorTemp":        { unit: "°C",  label: "Indoor Temperature" },
  "hvac.humidity":          { unit: "%",   label: "Indoor Humidity" },
  "fire.alarmLevel1":       { unit: "bool", label: "Fire Alarm Level 1" },
  "fire.alarmLevel2":       { unit: "bool", label: "Fire Alarm Level 2" },
  "meter.activePowerTotal": { unit: "kW",   label: "Meter Active Power (Pt)", signed: true },
  "meter.frequency":        { unit: "Hz",   label: "Meter Frequency" },

  // ── Site / plant level ─────────────────────────────────────────────────────
  // Whole-station aggregates and per-inverter generation, as shown on the Live
  // Plant and dashboard screens. Distinct from pcs.* which is per-cabinet.
  "site.solarPower":        { unit: "kW",  label: "Station Solar Power", signed: true },
  "site.inverterPower":     { unit: "kW",  label: "Inverter Power", signed: true },
  "site.gridPower":         { unit: "kW",  label: "Grid Power", signed: true },
  "site.loadPower":         { unit: "kW",  label: "Load Power" },
  "site.gridImportKwh":     { unit: "kWh", label: "Grid Import Energy" },
  "site.gridExportKwh":     { unit: "kWh", label: "Grid Export Energy" },
  "site.dailyGenerationKwh":    { unit: "kWh", label: "Today's Generation" },
  "site.lifetimeGenerationKwh": { unit: "kWh", label: "Lifetime Generation" },
  "site.ratedCapacityKwh":  { unit: "kWh", label: "Rated Capacity" },

  // ── Weather station (WMS) ──────────────────────────────────────────────────
  "wms.irradiance":         { unit: "",   label: "Irradiance (W/m²)" },
  "wms.irradiationDaily":   { unit: "",   label: "Daily Irradiation (kWh/m²)" },
  "wms.moduleTemp":         { unit: "°C", label: "Module Temperature" },
  "wms.ambientTemp":        { unit: "°C", label: "Ambient Temperature" },
  "wms.windSpeed":          { unit: "",   label: "Wind Speed (m/s)" },
  "wms.windDirection":      { unit: "deg", label: "Wind Direction" },
  "wms.humidity":           { unit: "%",  label: "Relative Humidity" },

  // ── Performance / status ───────────────────────────────────────────────────
  "perf.cuf":               { unit: "%", label: "Capacity Utilisation Factor" },
  "perf.performanceRatio":  { unit: "%", label: "Performance Ratio" },
  "perf.runHours":          { unit: "",  label: "Run Hours" },
} as const satisfies Record<string, MetricSpec>;

export type MetricId = keyof typeof METRICS;

export function isMetricId(id: string): id is MetricId {
  return id in METRICS;
}
