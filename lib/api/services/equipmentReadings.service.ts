/**
 * Live readings for the Equipment screens.
 *
 * This replaces components/modules/equipment/placeholders.ts, which held 296
 * lines of invented literals — 410.9 V line voltage, 50.03 Hz, 16,079 kWh
 * lifetime charge, and twenty-four fault bits all hardcoded to green. Nothing
 * on screen distinguished them from measurements. They were written so the
 * layouts could be signed off before there was a backend; there is one now.
 *
 * Every figure below comes from the gateway's telemetry snapshot, and every
 * one that the gateway does not publish is `null` — which the renderers
 * already draw as a dash, because the placeholder types were nullable from the
 * start.
 *
 * FAULT LISTS ARE DERIVED, NOT ENUMERATED. The old file listed fault labels by
 * hand, which is a list that silently goes stale the first time the vendor adds
 * a register. Here they are read out of the asset's own signal set: a signal
 * whose name says fault or alarm, that carries no engineering unit, and whose
 * value is 0 or 1. The unit test is what separates a bit from a configured
 * threshold — `battery_pack_over_voltage_alarm_voltage_value` is a setpoint in
 * volts, not a fault, and counting it as one puts a red number on a healthy
 * plant. gateway/signals.ts documents the same split for the historian profile.
 */

/* Central backend. The shape is identical to the gateway's, deliberately —
   see sourceTelemetry.service.ts. Everything below is unchanged. */
import { COMM_LOST_MS } from "@/lib/alarms/commLost";
import {
  fetchSourceTelemetry, unitOf, type SourceTelemetry, type SignalMap,
} from "./sourceTelemetry.service";
import { fetchGeneral, fetchFastBess, signedMilli, wordSwapped, type GeneralRecord } from "@/lib/central";
import CATALOG_JSON from "@/lib/central/pointCatalog.json";

/* [device types, signal, unit, category] per point id — see pointsCentral.service. */
const CATALOG = CATALOG_JSON as unknown as { points: Record<string, [string[], string, string | null, string | null]> };
import type {
  PcsReadings, BmsReadings, ChillerReadings, EnvReadings, MeterReadings,
  OnlineState, PcsOperatingStatus, GridTie, BmsSystemStatus, ChargeState,
} from "@/components/modules/equipment/readings";

const PCS = "pcs_1";
const BMS = "bms_1";
const EMS = "ems_system";
const METER = "utility_meter";
const COOL = "liquid_cooling";
const FIRE = "fire_protection";
const DEHU = "dehumidifier";

/** While set, every signal a reader asks for and does not find — see fillMissing. */
let misses: Set<string> | null = null;

const get = (t: SourceTelemetry, asset: string, key: string): number | null => {
  const v = t.signals[asset]?.[key] ?? null;
  if (v == null && misses) misses.add(`${asset}|${key}`);
  return v;
};

/**
 * A signed 16-bit temperature register read as unsigned.
 *
 * The chiller's inlet–outlet difference read 6553.5 °C with 22.5 °C in and
 * 22.6 °C out: −0.1 stored as 65,535 and scaled ×0.1 unsigned. No temperature
 * on this plant reaches 3,276.7 °C (×0.1) or 32,767 °C (×1), so anything above
 * is the two's-complement wrap and is folded back; real readings pass through.
 */
export function signedTemp(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return v;
  if (v >= 32_768) return v - 65_536;
  if (v > 3_276.7) return Math.round((v - 6_553.6) * 10) / 10;
  return v;
}

/** A temperature signal, two's-complement wrap undone — see signedTemp. */
const temp = (t: SourceTelemetry, asset: string, key: string): number | null =>
  signedTemp(get(t, asset, key));

const first = (t: SourceTelemetry, asset: string, keys: string[]): number | null => {
  for (const k of keys) {
    const v = get(t, asset, k);
    if (v != null) return v;
  }
  return null;
};

const online = (t: SourceTelemetry, asset: string, keys: string[]): OnlineState =>
  first(t, asset, keys) === 1 ? "online" : "offline";

/* Abbreviations kept in capitals when a signal name becomes a label:
   hw_fault_ac_over_current → "HW Fault AC Over Current", fault_co → "Fault CO". */
const ACRONYMS = new Set([
  "hw", "sw", "ac", "dc", "bms", "ems", "pcs", "arm", "spi", "rtc", "sd", "io", "co", "ir",
  "can", "bau", "bmu", "hv", "lv", "pv", "igbt", "dsp", "ntc", "soc", "soh", "ups", "eeprom",
]);
/* Register shorthand spelt out, so a fault reads as a sentence and not a code:
   hw_fault_heat_sink_over_temp_fault → "Hardware Fault · Heat Sink Over Temperature",
   outdoor_fan_1_fault_lock → "Outdoor Fan 1 Fault (Latched)". */
const humanise = (s: string) => {
  const words = s.split("_").filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/\bTemp\b/g, "Temperature")
    .replace(/\bE Stop\b/g, "Emergency Stop")
    .replace(/\bComm\b/g, "Communication");
  return words
    .replace(/^HW Fault (.+?)(?: Fault)?$/, "Hardware Fault · $1")
    .replace(/^SW Fault (.+?)(?: Fault)?$/, "Software Fault · $1")
    .replace(/^SW Alarm (.+?)(?: Fault)?$/, "Software Alarm · $1")
    .replace(/ (Alarm|Fault) Lock$/, " $1 (Latched)")
    .replace(/ Lock$/, " (Latched)");
};

/**
 * The asset's fault and alarm bits, as {label, ok} rows.
 *
 * `ok` is true when the bit reads 0. A bit the gateway could not read comes
 * back null and is reported as NOT ok — an unreadable protection bit is not a
 * healthy one, and the previous behaviour of every row rendering green was the
 * exact failure mode this screen must not have.
 */
function faultRows(t: SourceTelemetry, asset: string): { label: string; ok: boolean }[] {
  const signals = t.signals[asset] ?? {};
  return Object.keys(signals)
    .filter((name) => {
      if (!/fault|alarm|protection/i.test(name)) return false;
      /* A threshold, not a bit: it carries an engineering unit and a name that
         says so. Excluded from the fault grid and shown among the settings. */
      if (unitOf(t, asset, name)) return false;
      if (/_value$|_limit(_|$)|_setting$|_diff$|_enable$/.test(name)) return false;
      /* A command pulse (fault_reset) or a plain state word (fire_protection_status)
         is not a fault: a reset in progress used to count as "1 active". */
      if (/reset/i.test(name)) return false;
      if (/_status$/.test(name) && !/fault|alarm/i.test(name)) return false;
      /* Only a reported 0 or 1. A flag that did not arrive (null) is unknown,
         not a fault — counting it raised "1 Active" on a healthy PCS. */
      const v = signals[name];
      return v === 0 || v === 1;
    })
    .sort()
    .map((name) => ({ label: humanise(name), ok: signals[name] === 0 }));
}

/* ── PCS ──────────────────────────────────────────────────────────────────── */

/* Line voltage from the two phase magnitudes either side of it, 120° apart:
   V_ab = √(Va² + Va·Vb + Vb²). One phase × √3 assumed the two were equal and
   labelled phase A's figure "AB". */
const lineV = (p: number | null, q: number | null) =>
  p == null || q == null ? null : Math.round(Math.sqrt(p * p + p * q + q * q) * 10) / 10;

function pcsStatus(t: SourceTelemetry): PcsOperatingStatus {
  if (get(t, PCS, "e_stop_input_status") === 1) return "fault";
  /* p0202 pcs_running_status is the converter's own state word: 2 = running
     (cabinet 2, carrying load), 0 = stopped (cabinet 1, at rest). Other codes
     are not documented yet and fall through to the flags. */
  const code = get(t, PCS, "pcs_running_status") ?? get(t, PCS, "running_status");
  if (code === 2) return "running";
  if (get(t, PCS, "shutdown_status") === 1) return "shutdown";
  if (get(t, PCS, "standby_status") === 1) return "standby";
  if (get(t, PCS, "running_status_2") === 1) return "running";
  if (code === 0) return "stopped";
  /* Not "standby" as a default. Standby is a state the PCS asserts, and
     inventing it for a converter that asserted nothing is how a shutdown unit
     reads as idle. */
  return "unknown";
}

function gridTie(t: SourceTelemetry): GridTie {
  if (get(t, PCS, "on_grid_status") === 1) return "grid-connected";
  if (get(t, PCS, "off_grid_status") === 1) return "off-grid";
  return "invalid";
}

const phase = (t: SourceTelemetry, asset: string, p: "a" | "b" | "c", label: string) => ({
  label,
  voltageV: get(t, asset, `phase_${p}_voltage`),
  currentA: get(t, asset, `phase_${p}_current`),
  activeKw: get(t, asset, `phase_${p}_active_power`),
  reactiveKvar: get(t, asset, `phase_${p}_reactive_power`),
  apparentKva: get(t, asset, `phase_${p}_apparent_power`),
  /* The PCS's own PF register disagrees with the P and S beside it (8 Oct
     2026: 0.47 against 1.1 kW / 3.5 kVA): it is read at a different instant
     inside the poll, and the load swings within seconds. P ÷ S of the row it
     sits in is the figure that row can vouch for. */
  powerFactor: asset === PCS
    ? ratioPf(get(t, asset, `phase_${p}_active_power`), get(t, asset, `phase_${p}_apparent_power`))
    : get(t, asset, `phase_${p}_power_factor`),
});

/* P ÷ S, signed with P (− charging), or null where S is too small to divide by
   at the registers' 0.1 resolution. */
function ratioPf(p: number | null, s: number | null): number | null {
  if (p == null || s == null || Math.abs(s) <= 0.5) return null;
  return Math.round(Math.max(-1, Math.min(1, p / Math.abs(s))) * 100) / 100;
}

const sum = (xs: (number | null)[]) =>
  xs.some((x) => x == null) ? null : Math.round(xs.reduce<number>((a, x) => a + (x as number), 0) * 100) / 100;

export function readPcs(t: SourceTelemetry, asOf: number | null = null): PcsReadings {
  const phases = [
    phase(t, PCS, "a", "Phase A"),
    phase(t, PCS, "b", "Phase B"),
    phase(t, PCS, "c", "Phase C"),
  ];
  /* Totals from the same snapshot as the phase rows. total_active_power is an
     S1-only signal, a second old where the rest are a snapshot old, so on a
     swinging load it neither matched the rows above it nor the DC power
     beside it (3.8 kW AC against 1.8 kW DC, 2.7 kW across the phases). */
  const totalActiveKw = sum(phases.map((x) => x.activeKw)) ?? get(t, PCS, "total_active_power");
  const totalApparentKva = get(t, PCS, "total_apparent_power");
  return {
    asOf,
    /* This PCS publishes phase voltages, not line voltages. × √3 is exact for a
       balanced three-phase system; the per-phase table beside it is what to
       read when the phases are not balanced. */
    lineVoltage: {
      /* The gateway's own line-to-line reading where it sends one (already
         line-to-line: not recomputed), else derived from the phase voltages. */
      ab: t.signals[PCS]?.ab_line_voltage ?? lineV(get(t, PCS, "phase_a_voltage"), get(t, PCS, "phase_b_voltage")),
      bc: t.signals[PCS]?.bc_line_voltage ?? lineV(get(t, PCS, "phase_b_voltage"), get(t, PCS, "phase_c_voltage")),
      ca: t.signals[PCS]?.ca_line_voltage ?? lineV(get(t, PCS, "phase_c_voltage"), get(t, PCS, "phase_a_voltage")),
    },
    phases,
    totalActiveKw,
    totalReactiveKvar: get(t, PCS, "total_reactive_power"),
    totalApparentKva,
    /* P/S where apparent power is published, else the PCS's own power factor. */
    totalPowerFactor: ratioPf(totalActiveKw, totalApparentKva) ?? get(t, PCS, "total_power_factor"),
    gridFrequencyHz: get(t, PCS, "grid_frequency"),
    dcPowerKw: first(t, PCS, ["dc_power", "dc_power_2"]),
    operatingStatus: pcsStatus(t),
    gridTie: gridTie(t),
    online: online(t, PCS, ["pcs_online_status"]),
    /* The dispatch setpoints live on the EMS controller, which is what issues
       them; the PCS carries only the percentage it was given. */
    manualChargeKw: get(t, EMS, "manual_charge_value_setting"),
    manualDischargeKw: get(t, EMS, "manual_discharge_value_setting"),
    dcHistoricalChargeKwh: get(t, PCS, "dc_cumulative_charge_energy"),
    dcHistoricalDischargeKwh: get(t, PCS, "dc_cumulative_discharge_energy"),
    acHistoricalChargeKwh: get(t, PCS, "ac_cumulative_charge_energy"),
    acHistoricalDischargeKwh: get(t, PCS, "ac_cumulative_discharge_energy"),
    faults: faultRows(t, PCS),
    temperatures: PCS_TEMPS.map(([key, label]) => ({ label, c: pcsTemp(temp(t, PCS, key), key) })),
    /* Live on pcs_extended / bms (8 Oct 2026) but not on the PCS tab before:
       the retired legacy tab's mode and contactor tiles were hard-coded "—". */
    mode: {
      operatingMode: get(t, PCS, "operating_mode_selection"),
      controlMode: get(t, PCS, "control_mode"),
      vfOffGrid: get(t, PCS, "vf_off_grid_status"),
      derating: get(t, PCS, "derating_flag"),
      deratingFactor: get(t, PCS, "derating_factor"),
      overloadDerating: get(t, PCS, "overload_derating"),
      positiveContactor: get(t, BMS, "positive_contact_status"),
      negativeContactor: get(t, BMS, "negative_contactor_status"),
      preChargeContactor: get(t, BMS, "pre_charge_contactor_status"),
    },
    dc: {
      totalV: get(t, PCS, "pcs_total_dc_voltage"),
      upperV: get(t, PCS, "pcs_capacitor_upper_dc_voltage"),
      lowerV: get(t, PCS, "pcs_capacitor_lower_dc_voltage"),
      leakageA: get(t, PCS, "leakage_current_value"),
      insulationKohm: get(t, PCS, "insulation_resistance_value"),
      neutralA: get(t, PCS, "phase_n_current_rms"),
    },
  };
}

/* Live on pcs_extended (checked 8 Oct 2026, ~31–46 °C). Not shown before: the
   PCS tab had no temperature card. */
const PCS_TEMPS: [string, string][] = [
  ["phase_a_temperature", "Phase A"],
  ["phase_b_temperature", "Phase B"],
  ["phase_c_temperature", "Phase C"],
  ["phase_n_temperature", "Phase N"],
  ["air_inlet_temperature", "Air Inlet"],
  ["air_outlet_temperature", "Air Outlet"],
  ["cavity_temperature", "Cavity"],
  ["heat_sink_temperature", "Heat Sink"],
  ["control_chip_junction_temperature", "Control Chip Junction"],
  ["communication_chip_junction_temperature", "Comms Chip Junction"],
];

/* heat_sink_temperature reads exactly 0.0 on a running converter whose other
   probes read ~40 °C — an unread register, not a frozen heat sink. */
const pcsTemp = (v: number | null, key: string): number | null =>
  key === "heat_sink_temperature" && v === 0 ? null : v;

/* ── BMS ──────────────────────────────────────────────────────────────────── */

function bmsSystemStatus(t: SourceTelemetry): BmsSystemStatus {
  switch (get(t, BMS, "system_status")) {
    case 0: return "normal";
    case 1: return "charge-disabled";
    case 2: return "discharge-disabled";
    case 3: return "standby";
    case 4: return "shutdown";
    /* Not "normal" by default: a status word that did not arrive, or a code
       the dictionary does not define, is not a healthy one. */
    default: return "unknown";
  }
}

/**
 * Past this many kW the sign of the PCS power IS the charge state. One rule for
 * every card (ESS Cabinet and BMS both use it), so they can never contradict:
 * the gateway's charging/discharging flags can lag its power by a sample, and
 * on 13 Nov 2026 the BMS card said "Idle" beside "Discharging +4.9 kW". Below
 * it, power is noise and the BMS's own flags decide.
 */
export const STATE_FROM_POWER_KW = 2;

function chargeState(t: SourceTelemetry): ChargeState {
  const p = get(t, PCS, "total_active_power");
  if (p != null && Math.abs(p) >= STATE_FROM_POWER_KW) return p > 0 ? "discharging" : "charging";
  switch (get(t, BMS, "charge_discharge_status")) {
    case 1: return "discharging";
    case 2: return "charging";
    default: return "idle";
  }
}

export function readBms(t: SourceTelemetry): BmsReadings {
  const maxT = temp(t, BMS, "battery_max_temperature");
  const minT = temp(t, BMS, "battery_min_temperature");

  return {
    /* Read off the PCS, not the BMS. bms_extended publishes no online_points —
       the PCS, chiller and dehumidifier each do, but the battery does not — so
       looking for one on bms_1 always missed, and online() maps a missing
       register to "offline". The result was a BMS reporting 862 V, 260 cell
       voltages and a live SOC while the panel above it said Offline.
       bms_online_status is the PCS's own view of the battery link, which is a
       real register and the right answer to this question. */
    online: online(t, PCS, ["bms_online_status"]),
    systemStatus: bmsSystemStatus(t),
    chargeState: chargeState(t),
    socPct: get(t, BMS, "display_soc"),
    sohPct: get(t, BMS, "soh"),
    totalVoltageV: get(t, BMS, "cluster_total_voltage_collected"),
    totalCurrentA: first(t, BMS, ["cluster_total_current", "can_hall_sampling_current"]),
    hvBoxMaxTempC: temp(t, BMS, "hv_box_max_temperature"),
    cellVoltageMv: (() => {
      const min = get(t, BMS, "cell_min_voltage");
      const max = get(t, BMS, "cell_max_voltage");
      /* `cell_average_voltage` is the BMS's own average, but it rides S2 while
         the extremes ride S1 a snapshot later, and on a moving pack it fell
         outside them (3354 mV under a 3359 mV minimum). Kept only where it
         lies between the two; the BMS view prefers the per-cell figures. */
      const avg = get(t, BMS, "cell_average_voltage");
      const inRange = avg != null && (min == null || avg >= min) && (max == null || avg <= max);
      return { min, avg: inRange ? avg : null, max };
    })(),
    batteryTempC: { min: minT, avg: temp(t, BMS, "average_temperature"), max: maxT },
    maxAcceptableChargeA: get(t, PCS, "bms_max_available_charge_current"),
    maxAcceptableDischargeA: get(t, PCS, "bms_max_available_discharge_current"),
    availableChargeKw: first(t, PCS, ["bms_available_charge_power", "available_charge_power"]),
    availableDischargeKw: first(t, PCS, ["bms_available_discharge_power", "available_discharge_power"]),
    /* Four HV-box probes on the reference screen, and four on this build:
       `hv_box_temperature_1..4`, alongside the `hv_box_max_temperature`
       aggregate above. They stayed null on the belief that only the aggregate
       was published — the four individual probes are in the dictionary, and
       reading them is what makes the aggregate checkable. */
    hvBoxTempC: [1, 2, 3, 4].map((i) => temp(t, BMS, `hv_box_temperature_${i}`)),
    minCellVoltageNo: get(t, BMS, "cell_min_voltage_id"),
    maxCellVoltageNo: get(t, BMS, "cell_max_voltage_id"),
    minBatteryTempNo: get(t, BMS, "battery_min_temperature_id"),
    maxBatteryTempNo: get(t, BMS, "battery_max_temperature_id"),
    monthlyChargeKwh: get(t, BMS, "monthly_cumulative_charge_energy"),
    monthlyDischargeKwh: get(t, BMS, "monthly_cumulative_discharge_energy"),
    /* Word-swapped on the wire — see wordSwapped. The monthly pair above is
       a single-word register and decodes correctly as is. */
    annualChargeKwh: wordSwapped(get(t, BMS, "yearly_cumulative_charge_energy")),
    annualDischargeKwh: wordSwapped(get(t, BMS, "yearly_cumulative_discharge_energy")),
    totalChargeAh: wordSwapped(get(t, BMS, "total_cumulative_charge_capacity")),
    totalDischargeAh: wordSwapped(get(t, BMS, "total_cumulative_discharge_capacity")),
  };
}

/* ── Chiller ──────────────────────────────────────────────────────────────── */

const MODE_LABEL: Record<number, string> = {
  0: "Shutdown", 1: "Self-Circulation", 2: "Standby", 3: "Cooling", 4: "Heating",
};

export function readChiller(t: SourceTelemetry): ChillerReadings {
  const mode = get(t, COOL, "unit_operating_mode");
  const control = get(t, COOL, "unit_control_mode");
  const inletTempC = temp(t, COOL, "inlet_water_temperature");
  const outletTempC = temp(t, COOL, "outlet_water_temperature");
  const diff = temp(t, COOL, "inlet_outlet_water_temperature_diff");

  return {
    online: online(t, COOL, ["online_points"]),
    powerSwitch: get(t, COOL, "power_on_off") === 1 ? "on" : "off",
    /* The numeric mode word, decoded where the dictionary defines the value and
       shown as the raw word where it does not — never as a friendly label the
       register did not carry. */
    workMode: mode == null ? "—" : MODE_LABEL[mode] ?? `Mode ${mode}`,
    inletPressureBar: get(t, COOL, "inlet_water_pressure"),
    outletPressureBar: get(t, COOL, "outlet_water_pressure"),
    inletTempC,
    outletTempC,
    coolingMaxBattTempC: temp(t, COOL, "cooling_battery_max_temperature"),
    coolingAvgBattTempC: temp(t, COOL, "cooling_battery_avg_temperature"),
    heatingMinBattTempC: temp(t, COOL, "heating_battery_min_temperature"),
    heatingAvgBattTempC: temp(t, COOL, "heating_battery_avg_temperature"),
    outletHighPressureAlarmBar: get(t, COOL, "outlet_high_pressure_alarm_value"),
    inletLowPressureAlarmBar: get(t, COOL, "inlet_low_pressure_alarm_value"),
    outletHighTempAlarmC: temp(t, COOL, "outlet_high_temp_alarm_value"),
    outletLowTempAlarmC: temp(t, COOL, "outlet_low_temp_alarm_value"),
    coolingSetTempC: temp(t, COOL, "cooling_set_temperature"),
    heatingSetTempC: temp(t, COOL, "heating_set_temperature"),
    inletOutletTempDiffC: diff ?? (inletTempC != null && outletTempC != null
      ? Math.round((inletTempC - outletTempC) * 10) / 10 : null),
    outdoorTempC: temp(t, COOL, "outdoor_temperature"),
    compressorAHz: get(t, COOL, "system_a_compressor_frequency"),
    compressorBHz: get(t, COOL, "system_b_compressor_frequency"),
    /* The raw code. MODE_LABEL is the OPERATING mode's table; the control
       mode is a different register with no published enumeration, and a live
       3 was being shown as "Cooling" through the wrong table. */
    unitControlMode: control == null ? "—" : `Code ${control}`,
    alarms: faultRows(t, COOL),
  };
}

/* ── Environment: dehumidifier + fire protection ──────────────────────────── */

const ON_OFF: Record<number, string> = { 0: "Stop", 1: "Running" };

/** When an asset's data was last captured: its newest reading from any
 *  stream — the fast stream counts for the PCS and BMS. */
function capturedAt(t: SourceTelemetry, asset: string): number | null {
  const times = Object.values(t.snapshotTimes?.[asset] ?? {}).filter((x): x is number => typeof x === "number");
  if ((asset === PCS || asset === BMS) && t.fastTs != null) times.push(t.fastTs);
  return times.length ? Math.max(...times) : null;
}

/** True when nothing from the asset has arrived for COMM_LOST_MS — the same
 *  rule that raises its Communication Lost alarm. */
function lostSince(t: SourceTelemetry, asset: string): boolean {
  const at = capturedAt(t, asset);
  return at != null && Date.now() - at > COMM_LOST_MS;
}

/** One device's link, as every screen shows it: Online, Offline (its own
 *  reachability bit says so) or Communication Lost (its data stopped), and
 *  when its data was captured. */
export interface CommState { state: "Online" | "Offline" | "Communication Lost"; at: number | null }
function commOf(t: SourceTelemetry, asset: string, flagAsset: string, keys: string[]): CommState {
  const at = capturedAt(t, asset);
  if (lostSince(t, asset)) return { state: "Communication Lost", at };
  return { state: online(t, flagAsset, keys) === "online" ? "Online" : "Offline", at };
}

export function readEnvironment(t: SourceTelemetry): EnvReadings {
  const mode = get(t, DEHU, "operating_mode");
  const dehu = get(t, DEHU, "dehumidification_status");
  const tempCtl = get(t, DEHU, "temperature_control_status");
  const humCtl = get(t, DEHU, "humidity_control_method");

  return {
    dhOnline: online(t, DEHU, ["online_points"]),
    dhWorkMode: mode == null ? "—" : `Mode ${mode}`,
    dhAlarm: get(t, DEHU, "alarm_status") === 1 ? "alarm" : "normal",
    currentTempC: temp(t, DEHU, "current_temperature"),
    currentHumidityPct: get(t, DEHU, "current_humidity"),
    tempControlStatus: tempCtl == null ? "—" : ON_OFF[tempCtl] ?? String(tempCtl),
    humidityControlMode: humCtl == null ? "—" : String(humCtl),
    dehumidificationStatus: dehu == null ? "—" : ON_OFF[dehu] ?? String(dehu),
    fireOnline: online(t, FIRE, ["communication_status"]),
    fireLost: lostSince(t, FIRE),
    /* The reference screen's per-detector table is gone rather than filled.
       The fire_protection asset publishes 23 signals and every one is an
       aggregate for the whole cabinet — fault_co, fire_alarm_temperature,
       fire_alarm, fault. There is no Battery Box 1..5, no per-detector warning
       level, start type or sub-valve. Six rows of "Normal / No Fault /
       Reserved / Closed" were invented, and on a fire panel that is the single
       worst place in this app to show a reassuring fiction. */
    detectors: [],
    /* What the asset does publish, derived the same way as every other fault
       grid on these screens. */
    fireSignals: faultRows(t, FIRE),
  };
}

/* ── Meter ────────────────────────────────────────────────────────────────── */

export function readMeter(t: SourceTelemetry): MeterReadings {
  return {
    online: online(t, METER, ["communication_status"]),
    frequencyHz: get(t, METER, "frequency"),
    totalPowerFactor: get(t, METER, "total_power_factor"),
    totalActiveKw: get(t, METER, "total_active_power"),
    totalReactiveKvar: get(t, METER, "total_reactive_power"),
    totalApparentKva: get(t, METER, "total_apparent_power"),
    phases: [
      phase(t, METER, "a", "Phase A"),
      phase(t, METER, "b", "Phase B"),
      phase(t, METER, "c", "Phase C"),
    ],
    forwardEnergyKwh: get(t, METER, "forward_total_active_energy"),
    reverseEnergyKwh: get(t, METER, "reverse_total_active_energy"),
    /* Filled separately by fetchMeterTrace — the snapshot is one instant,
       and the trace is three point-filtered reads of their own. */
    chart: [],
  };
}

/* ── One fetch, all five ──────────────────────────────────────────────────── */

export interface EquipmentReadings {
  pcs: PcsReadings;
  bms: BmsReadings;
  chiller: ChillerReadings;
  environment: EnvReadings;
  meter: MeterReadings;
  /** Each device's link and capture time — the one verdict every tile shows. */
  comm: { pcs: CommState; bms: CommState; cooling: CommState; dehumidifier: CommState; fire: CommState; meter: CommState };
  /** Assets the snapshot carried, so a screen can say "not on this site". */
  assets: string[];
  /**
   * The flattened snapshot itself.
   *
   * Carried so a panel that needs one signal the five shapes above do not
   * expose — Comm Status reads eight reachability words across five assets —
   * can read it from the response already in the query cache, rather than
   * issuing a second telemetry request for the same payload.
   */
  signals: SignalMap;
  /**
   * Values that were not in the newest rows and were read by point id instead
   * — the parameter's last report, at its own backend sample time. `oldestTs`
   * lets a screen say how old the oldest of them is.
   */
  lastSeen: { count: number; oldestTs: number | null; times: Record<string, number> };
}

/**
 * @param sourceId Which CABINET's equipment — `external_ems_1`, not the site.
 *   Equipment is per-cabinet, so this follows the unit picker rather than the
 *   station picker; `useEquipmentReadings` resolves it.
 */
export async function fetchEquipmentReadings(
  gatewayId: string,
  sourceId: string,
): Promise<EquipmentReadings> {
  const raw = await fetchSourceTelemetry(gatewayId, sourceId);
  const { t, lastSeen } = await fillMissing(gatewayId, sourceId, raw);
  const at = await pcsAtSnapshot(gatewayId, t);
  return {
    pcs: readPcs(at.t, at.asOf),
    bms: readBms(t),
    chiller: readChiller(t),
    environment: readEnvironment(t),
    meter: readMeter(t),
    comm: {
      pcs: commOf(t, PCS, PCS, ["pcs_online_status"]),
      bms: commOf(t, BMS, PCS, ["bms_online_status"]),
      cooling: commOf(t, COOL, COOL, ["online_points"]),
      dehumidifier: commOf(t, DEHU, DEHU, ["online_points"]),
      fire: commOf(t, FIRE, FIRE, ["communication_status"]),
      meter: commOf(t, METER, METER, ["communication_status"]),
    },
    assets: t.assets,
    signals: t.signals,
    lastSeen,
  };
}

/* ── Last-seen values ──────────────────────────────────────────────────────

   The snapshot is the newest 1,000 rows of each substream, and fast points
   crowd slow ones out of it: with the gateway quiet since 11:45 on 12 Oct
   2026, the PCS's per-phase active / reactive / apparent power, power factor
   and mode words were all older than those rows and read "—", though the
   backend held each one's last report. So: run the readers once to learn which
   signals they asked for and did not get, look those up by point id (the
   catalogue maps a signal to its id), and lay each one's newest reading in —
   with its own sample time, so the PCS's "as of" and the S1 sample it is
   paired with follow the instant the value was actually read. */

const KIND: Record<string, string> = { [PCS]: "pcs", [BMS]: "bms", [METER]: "grid_meter" };
const kindOf = (asset: string) => KIND[asset] ?? asset;

let pointIndex: Map<string, string> | null = null;
function pointIdFor(asset: string, signal: string): string | undefined {
  if (!pointIndex) {
    pointIndex = new Map();
    for (const [pid, [kinds, sig]] of Object.entries(CATALOG.points)) {
      for (const k of kinds) pointIndex.set(`${k}|${sig}`, pid);
    }
  }
  return pointIndex.get(`${kindOf(asset)}|${signal}`);
}

interface PointReading { v: number | null; unit: string | null; ts: number }
/* Per (asset, point), five minutes: the 30-second refresh must not repeat the
   lookups, and a value older than the snapshot rarely changes in that time. */
const LOOKUP_TTL_MS = 5 * 60_000;
const lookups = new Map<string, { at: number; p: Promise<PointReading | null> }>();

function lookup(gatewayId: string, assetId: string, pointId: string): Promise<PointReading | null> {
  const key = `${gatewayId}|${assetId}|${pointId}`;
  const hit = lookups.get(key);
  if (hit && Date.now() - hit.at < LOOKUP_TTL_MS) return hit.p;
  const p = fetchGeneral(gatewayId, { pointId, limit: 6 }).then((rows) => {
    const r = rows.find((x) => x.asset_id === assetId);
    const ts = Date.parse(r?.sample_time_utc ?? "");
    if (!r || Number.isNaN(ts)) return null;
    const n = r.value == null ? null : Number(r.value);
    return { v: n !== null && Number.isFinite(n) ? n : null, unit: r.unit ?? null, ts };
  });
  lookups.set(key, { at: Date.now(), p });
  p.catch(() => lookups.delete(key));
  return p;
}

async function fillMissing(
  gatewayId: string, sourceId: string, t: SourceTelemetry,
): Promise<{ t: SourceTelemetry; lastSeen: EquipmentReadings["lastSeen"] }> {
  const none = { count: 0, oldestTs: null, times: {} };
  misses = new Set();
  try { readPcs(t); readBms(t); readChiller(t); readEnvironment(t); readMeter(t); }
  finally { /* the dry run only collects names */ }
  const wanted = [...misses];
  misses = null;

  const jobs = wanted.flatMap((k) => {
    const [asset, signal] = k.split("|");
    const pid = pointIdFor(asset, signal);
    return pid ? [{ asset, signal, pid, assetId: `${sourceId}_${kindOf(asset)}` }] : [];
  });
  if (!jobs.length) return { t, lastSeen: none };

  /* Eight at a time — each is one indexed point read. */
  const results: (PointReading | null)[] = new Array(jobs.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await lookup(gatewayId, jobs[i].assetId, jobs[i].pid).catch(() => null);
    }
  }));

  const signals: SignalMap = { ...t.signals };
  const snapshot: SignalMap = { ...(t.snapshot ?? {}) };
  const units = { ...t.units };
  const times = { ...(t.snapshotTimes ?? {}) };
  const seenTimes: Record<string, number> = {};
  jobs.forEach((j, i) => {
    const r = results[i];
    if (!r || r.v == null) return;
    signals[j.asset] = { ...signals[j.asset], [j.signal]: r.v };
    snapshot[j.asset] = { ...snapshot[j.asset], [j.signal]: r.v };
    times[j.asset] = { ...times[j.asset], [j.signal]: r.ts };
    if (r.unit) units[j.asset] = { ...units[j.asset], [j.signal]: r.unit };
    seenTimes[`${j.asset}.${j.signal}`] = r.ts;
  });
  const ts = Object.values(seenTimes);
  const assets = [...new Set([...t.assets, ...Object.keys(signals)])].sort();
  return {
    t: { ...t, assets, signals, snapshot, units, snapshotTimes: times },
    lastSeen: { count: ts.length, oldestTs: ts.length ? Math.min(...ts) : null, times: seenTimes },
  };
}

/* An S1 sample this close to the PCS snapshot counts as the same instant. */
const ALIGN_MS = 3_000;

/* An S2 PCS figure more than this behind the newest S1 sample is not "the
   snapshot" any more: the uploader has gaps (13 Oct 2026: pcs_extended's
   per-phase powers last reported at 14:10 IST while S1 kept arriving every
   second), and pinning the table to that instant froze its "As Of" — and the
   S1 voltages and currents aligned to it — for as long as the gap lasted. */
const PCS_STALE_MS = 2 * 60_000;

/* The S2-only figures shown under the PCS's "As Of" stamp. */
const PCS_TIMED = [
  ...(["a", "b", "c"] as const).flatMap((p) =>
    ["active", "reactive", "apparent"].map((q) => `phase_${p}_${q}_power`)),
  "total_reactive_power", "total_apparent_power", "dc_power", "dc_power_2",
];

/**
 * The PCS at one instant: the S2 snapshot's time, with the S1 sample taken
 * then (not the newest one) supplying what only S1 carries — phase voltage
 * and current, total active power, frequency. Without a sample that close,
 * the newest S1 stays on top as before; the power figures are S2's either way.
 *
 * When the S2 snapshot is older than PCS_STALE_MS against the newest S1
 * sample, the table follows S1 instead: newest S1 on top, stamped with S1's
 * time, and the S2 power figures that old are dropped rather than shown under
 * a time they were not read at.
 */
async function pcsAtSnapshot(
  gatewayId: string, t: SourceTelemetry,
): Promise<{ t: SourceTelemetry; asOf: number | null }> {
  const at = t.snapshotTimes?.[PCS]?.phase_a_active_power ?? null;
  const base = t.snapshot?.[PCS];
  if (!t.bessId) return { t, asOf: at };

  const newest = (await fetchFastBess(gatewayId, { bessId: t.bessId, limit: 1 }).catch(() => []))[0];
  const newestTs = Date.parse(newest?.sample_time_utc ?? "");
  if (Number.isFinite(newestTs) && (at == null || newestTs - at > PCS_STALE_MS)) {
    const times = t.snapshotTimes?.[PCS] ?? {};
    const pcs = { ...(t.signals[PCS] ?? {}) };
    for (const name of PCS_TIMED) {
      const ts = times[name];
      if (ts == null || newestTs - ts > PCS_STALE_MS) pcs[name] = null;
    }
    for (const [name, v] of Object.entries(newest.data?.pcs_values ?? {})) {
      pcs[name] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    return { t: { ...t, signals: { ...t.signals, [PCS]: pcs } }, asOf: newestTs };
  }
  if (at == null || !base) return { t, asOf: at };

  const rows = await fetchFastBess(gatewayId, {
    bessId: t.bessId, fromMs: at - ALIGN_MS, toMs: at + ALIGN_MS, limit: 20,
  }).catch(() => []);
  let best: (typeof rows)[number] | undefined, gap = Infinity;
  for (const r of rows) {
    const d = Math.abs(Date.parse(r.sample_time_utc ?? "") - at);
    if (d < gap) { gap = d; best = r; }
  }
  if (!best) return { t, asOf: at };

  const pcs = { ...base };
  for (const [name, v] of Object.entries(best.data?.pcs_values ?? {})) {
    pcs[name] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return { t: { ...t, signals: { ...t.signals, [PCS]: pcs } }, asOf: at };
}

/* ── PCS DC against AC ───────────────────────────────────────────────────── */

/* pcs_extended dc_power and the three phase active powers. */
const P_PCS_DC = "p0098";
const P_PCS_PHASE_KW = ["p0181", "p0182", "p0183"];

export interface DcAcOffset {
  /** Average DC over average AC, minus one, as a percentage. Positive: DC
   *  reads larger than AC in magnitude. */
  pct: number;
  /** Average AC, kW — its sign says whether the window was mostly charging. */
  avgAcKw: number;
  /** Snapshots compared, and the window they span. */
  n: number;
  fromMs: number;
  toMs: number;
}

/**
 * How far the PCS's DC power register sits from its AC phase powers on
 * average, over the ~hour a point read of 1,000 rows reaches.
 *
 * Averaged because a single snapshot cannot settle it: the registers are read
 * at different instants inside one poll (dc_power and dc_power_2 have
 * disagreed by 11 kW in the same snapshot) and the load swings within seconds.
 * Over an hour timing washes out. On 9 Oct 2026 DC still read 10–17% above AC
 * while charging, which no converter does: a measurement offset on one side,
 * stated on screen rather than corrected — correcting it would mean choosing
 * which side to believe. null when there is too little to compare.
 */
export async function fetchDcAcOffset(gatewayId: string, sourceId: string): Promise<DcAcOffset | null> {
  if (!gatewayId || !sourceId) return null;
  const asset = `${sourceId}_pcs`;
  const read = (pointId: string) =>
    fetchGeneral(gatewayId, { pointId, limit: 1000 }).catch(() => [] as GeneralRecord[]);
  const [dc, ...phases] = await Promise.all([P_PCS_DC, ...P_PCS_PHASE_KW].map(read));

  const byTime = new Map<string, { dc?: number; ac: number; parts: number }>();
  const at = (t: string) => { let e = byTime.get(t); if (!e) byTime.set(t, e = { ac: 0, parts: 0 }); return e; };
  const value = (r: GeneralRecord) => (r.asset_id === asset && r.sample_time_utc && r.value != null ? Number(r.value) : NaN);
  for (const r of dc) { const v = value(r); if (Number.isFinite(v)) at(r.sample_time_utc!).dc = v; }
  for (const rows of phases) for (const r of rows) {
    const v = value(r);
    if (Number.isFinite(v)) { const e = at(r.sample_time_utc!); e.ac += v; e.parts++; }
  }

  let n = 0, ac = 0, dcSum = 0, fromMs = Infinity, toMs = -Infinity;
  for (const [t, e] of byTime) {
    if (e.dc == null || e.parts !== 3) continue;
    n++; ac += e.ac; dcSum += e.dc;
    const ms = Date.parse(t); fromMs = Math.min(fromMs, ms); toMs = Math.max(toMs, ms);
  }
  /* Under ~1 kW average there is no ratio worth stating at 0.1 kW resolution. */
  if (n < 20 || Math.abs(ac / n) < 1) return null;
  return { pct: Math.round((dcSum / ac - 1) * 100), avgAcKw: ac / n, n, fromMs, toMs };
}

/* ── Meter power trace ────────────────────────────────────────────────────── */

/* utility_meter total active / apparent / reactive power. */
const P_METER_KW   = "p1368";
const P_METER_KVA  = "p1376";
const P_METER_KVAR = "p1372";

/**
 * The site meter's recent power, for the Power chart.
 *
 * S2 has no range query, but a point-filtered read of 1,000 rows reaches back
 * about 35 minutes per asset — enough for a trace, and the only history this
 * backend has for any point outside the fast profile. The window is whatever
 * the rows cover; nothing here claims a period.
 *
 * Aligned on the sample time the three points share (they are polled in one
 * snapshot). A timestamp missing any of the three is dropped rather than
 * plotted as zero.
 */
export async function fetchMeterTrace(
  gatewayId: string,
  sourceId: string,
): Promise<MeterReadings["chart"]> {
  if (!gatewayId || !sourceId) return [];
  const asset = `${sourceId}_grid_meter`;

  const read = (pointId: string) =>
    fetchGeneral(gatewayId, { pointId, limit: 1000 }).catch(() => [] as GeneralRecord[]);
  const [kw, kva, kvar] = await Promise.all([read(P_METER_KW), read(P_METER_KVA), read(P_METER_KVAR)]);

  const byTime = (rows: GeneralRecord[]) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (r.asset_id !== asset || !r.sample_time_utc || r.value == null) continue;
      const n = Number(r.value);
      if (Number.isFinite(n) && !m.has(r.sample_time_utc)) m.set(r.sample_time_utc, n);
    }
    return m;
  };
  const a = byTime(kw), s = byTime(kva), q = byTime(kvar);

  return [...a.keys()]
    .filter((k) => s.has(k) && q.has(k))
    .sort((x, y) => Date.parse(x) - Date.parse(y))
    .map((k) => ({
      ts: Date.parse(k),
      t: new Date(k).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
      activeKw: a.get(k)!,
      apparentKva: s.get(k)!,
      reactiveKvar: q.get(k)!,
    }));
}
