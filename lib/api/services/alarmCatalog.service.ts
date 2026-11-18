/**
 * Which points are alarms — the classification the alarm list rests on.
 *
 * ── Why this is a table and not a regex ────────────────────────────────────
 *
 * S2's `category: "fault_alarm"` holds 345 points, and fewer than two thirds
 * of them are alarms. The rest are the configuration and the evidence around
 * an alarm, and every kind leaks into a naive "non-zero means raised" count:
 *
 *   • SETTINGS. The BMS protection ladder (p0902–p1009) is 94 threshold
 *     registers — `rack_cell_over_voltage_l1_alarm_limit_critical_alarm =
 *     3750 mV` — and the chiller's four `*_alarm_value` points hold its trip
 *     setpoints. They are non-zero on a healthy plant, always.
 *   • CONTEXT. BMS p1069–p1116 record the cell, module and temperature AT the
 *     last alarm — `max_voltage_cell_id_at_alarm`, `min_voltage_value_at_alarm`.
 *     The ids are unitless and named "alarm", so the old three-test filter
 *     counted a cell number as a raised alarm the first time one was written.
 *   • COMMANDS. `fault_reset`, `fault_reset_2`, `system_fault_reset` are
 *     writable reset coils, named for a fault because they clear one.
 *   • STATUSES and READINGS. `pcs_running_status = 2`, `co1`, `ir_low_position
 *     = 5`, `sound_light_alarm_module_status` — enumerations and sensor values.
 *
 * And the other way round, the old filter's word list missed flags that are
 * plainly alarms: `fire_protection_spraying`, `fire_protection_offline`,
 * `e_stop_signal`, `bms_temperature_abnormal`, the chiller's `_probe_reversed`
 * and `_wiring_abnormal` pair, and E-stop / open-failed flags that the gateway
 * files under `general` and `status` rather than `fault_alarm`. S1's 25 fault
 * bits were not read at all.
 *
 * So the rule set below is ordered, and every exception in it is a named point
 * rather than a pattern, because a pattern is what got it wrong both ways.
 * Checked against the full catalogue (1,047 points). Of the 345 `fault_alarm`
 * points: 207 flags, 95 settings, 19 at-alarm context, 13 statuses, 6 readings,
 * 3 reset commands, 2 relay outputs. Add the 7 flags filed elsewhere and S2
 * watches 214 flags per cabinet; S1 adds 25 fault bits and 2 online bits.
 * Against the old filter: 13 false positives removed (the reset coils, the
 * seven `*_id_at_alarm` cell/module numbers, a module status, two relay
 * outputs) and 22 missed flags added.
 *
 * ── Severity ────────────────────────────────────────────────────────────────
 *
 * No flag carries one. The BMS threshold ladder names its levels — L1 is
 * `critical_alarm`, L3 is `early_warning` — but the active flags that trip on
 * those thresholds are not published per level (S1 has `cell_over_voltage_
 * level_1` and nothing for L2/L3). What is left is the signal name: a fault,
 * trip, lock, E-stop or fire condition has stopped something; an alarm is
 * being reported. That is labelled a derivation, never vendor severity.
 *
 * No imports but types, on purpose: this file runs under plain `node` against
 * the catalogue CSV, which is how the counts above were checked.
 */

import type { AlarmType } from "../types";

/** What a point is, as far as the alarm list is concerned. */
export type PointKind =
  | "flag"           // an alarm: raised when non-zero
  | "flag_inverted"  // an alarm: raised when ZERO (an online bit)
  | "setting"        // a threshold / setpoint — configuration, never an alarm
  | "context"        // a value captured at the last alarm (cell id, voltage)
  | "command"        // a writable reset coil
  | "output"         // a relay output driven by an alarm, not the alarm
  | "status"         // an enumeration or mode
  | "reading"        // a measurement
  | "other";         // not in the alarm category at all

export interface PointClass {
  kind: PointKind;
  /** Only on flags. Derived from the name — see the header. */
  severity?: AlarmType;
}

/* ── S2 ───────────────────────────────────────────────────────────────────── */

/**
 * Flags the gateway files OUTSIDE `fault_alarm`, keyed `substream:point_id`.
 *
 * E-stop and open-failed are the two a person most needs to see, and neither
 * would appear from the category alone. Left out deliberately: `e_stop_flag_1/2`
 * and `e_stop_timer` (internal sequencing of the same E-stop), `pcs_e_stop_
 * control` (a command), `e_stop_input_status` (the same input as `e_stop`),
 * and `overload_derating` (an operating state the PCS chose, not a failure).
 */
const EXTRA_FLAGS: Record<string, AlarmType> = {
  "ems_system:p0060": "failure",   // e_stop
  "ems_system:p0061": "failure",   // master_e_stop
  "pcs_extended:p0122": "failure", // e_stop
  "pcs_extended:p0158": "failure", // remote_e_stop
  "pcs_extended:p0127": "failure", // open_failed
  "pcs_extended:p0150": "alarm",   // system_abnormal
  "pcs_extended:p0132": "failure", // offline_status
};

/**
 * Points inside `fault_alarm` that are not alarms and that the rules below
 * would otherwise get wrong. Named, so a reader can check each one.
 */
const NOT_ALARM: Record<string, PointKind> = {
  /* Reset coils (rw = 1 on the ems side; writes on the others). */
  "pcs_extended:p0121": "command",          // fault_reset
  "pcs_extended:p0155": "command",          // fault_reset_2
  "remote_control:p1353": "command",        // system_fault_reset
  /* Enumerations. `fire_protection_status` has no documented encoding, and
     `fire_protection_alarm` / `_fault` / `_spraying` already carry the states
     a person needs, so it is not guessed at. */
  "ems_system:p0020": "status",             // bms_status
  "ems_system:p0021": "status",             // pcs_running_status
  "ems_system:p0071": "status",             // fire_protection_status
  "pcs_extended:p0116": "status",           // running_status
  "pcs_extended:p0139": "status",           // liquid_cooling_equipment_status
  "pcs_extended:p0140": "status",           // fire_protection_status
  "pcs_extended:p0173": "status",           // bms_dry_contact_input
  "pcs_extended:p0202": "status",           // pcs_running_status
  "liquid_cooling:p1173": "status",         // unit_control_mode
  "fire_protection:p1279": "status",        // fan_damper_control_module_status
  "fire_protection:p1281": "status",        // sound_light_alarm_module_status
  /* Communication-status bits read 1 when healthy. The explicit
     `fire_protection_offline` (ems p0067) carries the fault, so these are not
     inverted into a second copy of it. */
  "ems_system:p0066": "status",             // fire_protection_communication_status
  "fire_protection:p1259": "status",        // communication_status
  /* Detector readings, unitless on the wire. */
  "fire_protection:p1271": "reading",       // co1
  "fire_protection:p1272": "reading",       // co2
  "fire_protection:p1273": "reading",       // co3
  "fire_protection:p1274": "reading",       // ir_high_position
  "fire_protection:p1275": "reading",       // ir_low_position
  "fire_protection:p1270": "reading",       // temperature_value (℃)
  /* The meter's relay outputs follow its alarms; counting them doubles one. */
  "utility_meter:p1413": "output",          // do1_alarm_output
  "utility_meter:p1414": "output",          // do2_alarm_output
};

/** BMS p1069–p1116: the snapshot taken at the last alarm. */
function isBmsAtAlarmContext(substream: string, pointId: string): boolean {
  if (substream !== "bms_extended") return false;
  const n = Number(pointId.slice(1));
  return n >= 1069 && n <= 1116;
}

/** The threshold / setpoint vocabulary, in the names the gateway uses. */
const SETTING_NAME = /(_alarm_limit|_recovery_limit|_threshold|_alarm_value$|alarm_limit_|recovery_limit_)/;

/**
 * A flag's name, beyond `fault|alarm`. Each word is here because a real point
 * uses it for a failure and nothing else in the category does.
 */
const FLAG_WORD =
  /(fault|alarm|fail|trip|leak|smoke|overload|abnormal|_lock$|offline|spraying|e_stop|reversed|conflict)/;

/**
 * The BMS's own protection flags — `cell_over_voltage_level_2`,
 * `hv_box_over_temp_level_1`, `insulation_too_low` and ~75 more on
 * bms_extended. None says fault or alarm, so FLAG_WORD alone files them as
 * statuses and the page never raises them. They only became visible once
 * substream reads were merged (lib/central/general.ts): the 1,000-row cap had
 * been hiding most of them.
 *
 * Their threshold registers name the levels — L1 "critical alarm", L2
 * "alarm", L3 "early warning" — and severity follows that naming.
 */
const PROTECTION =
  /(too_high|too_low|too_large|over_voltage|under_voltage|over_current|over_temp|under_temp|diff_over_high|_diff_level_)/;

function protectionSeverity(signal: string): AlarmType {
  if (/level_3$/.test(signal)) return "inform";
  if (/level_2$/.test(signal)) return "alarm";
  return "failure";
}

/** Fault, trip, lock, E-stop, fire: something has stopped. The rest report. */
const FAILURE_WORD = /(fault|trip|fail|_lock$|e_stop|spraying|fire|smoke|leak|offline|level_1)/;

export function severityFor(signal: string): AlarmType {
  return FAILURE_WORD.test(signal) ? "failure" : "alarm";
}

/** Classify one S2 point. Pure; takes the catalogue fields, not a record. */
export function classifyS2(p: {
  substream: string | null;
  point_id: string | null;
  signal: string | null;
  unit: string | null;
  category: string | null;
}): PointClass {
  const ss = p.substream ?? "";
  const pid = p.point_id ?? "";
  const sig = (p.signal ?? "").toLowerCase();
  const key = `${ss}:${pid}`;

  if (key in EXTRA_FLAGS) return { kind: "flag", severity: EXTRA_FLAGS[key] };
  if (key in NOT_ALARM) return { kind: NOT_ALARM[key] };
  if (p.category !== "fault_alarm") return { kind: "other" };

  if (isBmsAtAlarmContext(ss, pid) || /_at_alarm/.test(sig)) return { kind: "context" };
  if (SETTING_NAME.test(sig)) return { kind: "setting" };
  /* A unit marks a quantity, and no flag carries one. */
  if (p.unit) return { kind: "reading" };
  if (!sig || sig.endsWith("_value")) return { kind: "reading" };
  if (FLAG_WORD.test(sig)) return { kind: "flag", severity: severityFor(sig) };
  if (PROTECTION.test(sig)) return { kind: "flag", severity: protectionSeverity(sig) };
  return { kind: "status" };
}

/* ── S1 ───────────────────────────────────────────────────────────────────── */

/**
 * The fast-BESS fault bits, per group. Every boolean S1 carries that names a
 * failure; the `*_alarm_*_value` keys beside them are context (they read 0
 * until an alarm writes the value it tripped at), and `system_status` /
 * `charge_discharge_status` / `running_status_2` are enumerations.
 */
export const S1_FLAGS: Record<"pcs_values" | "bms_values", Record<string, AlarmType>> = {
  pcs_values: {
    fault_status: "failure",
    total_fault_status: "failure",
    total_alarm_status: "alarm",
    hw_fault_ac_over_current: "failure",
    sw_fault_ac_over_current: "failure",
    sw_fault_ac_over_voltage: "failure",
    sw_fault_ac_under_voltage: "failure",
    sw_fault_ac_over_frequency: "failure",
    sw_fault_ac_under_frequency: "failure",
    sw_fault_dc_charge_over_current: "failure",
    sw_fault_dc_discharge_over_current: "failure",
  },
  bms_values: {
    fuse_fault: "failure",
    contactor_fault: "failure",
    insulation_fault: "failure",
    insulation_monitoring_fault: "failure",
    voltage_sampling_fault: "failure",
    current_sampling_fault_functional_safety_fault: "failure",
    battery_temperature_sensor_fault: "failure",
    bau_communication_fault: "failure",
    bmu_communication_fault: "failure",
    pcs_communication_fault: "failure",
    cell_over_voltage_level_1: "failure",
    cell_under_voltage_level_1: "failure",
    discharge_over_current_level_1: "failure",
    charge_over_current: "alarm",
  },
};

/** Online bits: 1 is healthy, so the alarm is the zero. */
export const S1_INVERTED: Record<"pcs_values" | "bms_values", Record<string, string>> = {
  pcs_values: { pcs_online_status: "PCS offline" },
  bms_values: { bms_online_status: "BMS offline" },
};

/** S1 values captured at the last alarm, shown beside a raised BMS flag. */
export const S1_CONTEXT: Record<string, string> = {
  battery_pack_over_voltage_alarm_voltage_value: "Pack voltage at over-voltage alarm",
  battery_pack_under_voltage_alarm_voltage_value: "Pack voltage at under-voltage alarm",
  battery_charge_over_current_alarm_current_value: "Current at charge over-current alarm",
  battery_discharge_over_current_alarm_current_value: "Current at discharge over-current alarm",
};

/**
 * History, and the things that hang off it, have no source.
 *
 * There is no alarm event endpoint on the central backend — only the present
 * value of each flag. Raised-at, cleared-at, duration, acknowledgement and
 * recurrence all need one. Flipped when docs/central-backend-s1-contract.md
 * grows an alarm log; until then screens that need history say so instead of
 * reading the retired gateway's log and reporting its failure as "no events".
 */
export const ALARM_HISTORY_AVAILABLE = true;
