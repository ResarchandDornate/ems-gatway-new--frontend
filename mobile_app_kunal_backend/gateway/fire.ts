/**
 * The fire protection panel, as the gateway reports it.
 *
 * 23 signals on the `fire_protection` asset, online on every source of the
 * commissioned site and — until this file — read by nothing. This is a battery
 * container: a panel that reports to the gateway and not to the app is the one
 * omission on this build that could matter to somebody standing next to it.
 *
 * Definitions are transcribed from the Telemetry Data Dictionary of 10 Aug
 * 2026 (`Northbound_EMS_Gateway_Telemetry_Data_Dictionary_20260810.csv`,
 * rows where base_asset_id = fire_protection), including its enum text
 * verbatim. They are NOT part of the 63-signal fast profile — that is PCS and
 * BMS only — so they arrive on the /api/telemetry snapshot instead, which the
 * site query already fetches. No extra request is made for any of this.
 *
 * Two things the dictionary makes plain and a bit-scan would get wrong:
 *
 *   1. `fire_alarm` and `fault` are multi-state WORDS, not booleans. `fault`
 *      reads 1 for "Fire Extinguisher Activated", which is a discharge event
 *      and emphatically not a fault; treating it as `value > 0 → faulted`
 *      would file a suppression discharge under equipment trouble.
 *   2. The module status words use 0/8, not 0/1 — 8 is "Open". A truthiness
 *      test happens to work here and would stop working the moment the vendor
 *      adds a third state, so they are decoded rather than tested.
 */

/** 0/1 alarm-or-normal, the shape most of this panel uses. */
const NORMAL_ALARM: Record<number, string> = { 0: "Normal", 1: "Alarm" };

export interface FireSignal {
  name: string;
  label: string;
  /** Decoded meanings, verbatim from the dictionary's notes column. */
  enumMap: Record<number, string>;
}

/**
 * Whether the panel is talking to the gateway at all.
 *
 * Read before anything else. Every other signal here is zero when the panel is
 * offline, and zero reads as "no fire" — so an unreachable panel and a quiet
 * one are the same screen unless this is checked first. It is the same failure
 * the grid meter has, and it is far less acceptable here.
 */
export const FIRE_COMMS = "communication_status";

/**
 * The panel's own summary of the site's fire state.
 *
 * One word covering every detector, which is why it leads the screen rather
 * than sitting among the individual bits.
 */
export const FIRE_ALARM: FireSignal = {
  name: "fire_alarm",
  label: "Fire alarm",
  enumMap: {
    0: "No fire alarm",
    1: "CO fire alarm",
    2: "Temperature fire alarm",
    3: "Two or more fire alarms",
    4: "Fire extinguisher activated",
  },
};

/**
 * The panel's own summary of its equipment state.
 *
 * State 1 is a suppression discharge, not a malfunction — see the file header.
 */
export const FIRE_FAULT: FireSignal = {
  name: "fault",
  label: "Panel state",
  enumMap: {
    0: "No fault",
    1: "Fire extinguisher activated",
    2: "Sensor fault",
    3: "Two or more alarms",
  },
};

/** Per-detector fire alarms. Any of these high is an emergency. */
export const FIRE_DETECTORS: FireSignal[] = [
  { name: "fire_alarm_co",          label: "CO detector",          enumMap: NORMAL_ALARM },
  { name: "fire_alarm_temperature", label: "Heat detector",        enumMap: NORMAL_ALARM },
  { name: "fire_alarm_ir",          label: "Infrared detector",    enumMap: NORMAL_ALARM },
  { name: "fire_alarm_start",       label: "Suppression start",    enumMap: NORMAL_ALARM },
  /* The dictionary spells this one "0,Normal;1,Feedback" rather than
     "1,Alarm". Kept as the dictionary has it: feedback is confirmation that
     the suppression system actually discharged, which is a different fact from
     a detector tripping and should not be relabelled into one. */
  { name: "fire_alarm_feedback",    label: "Suppression confirmed", enumMap: { 0: "Normal", 1: "Confirmed" } },
];

/** Per-detector equipment faults. The detector is impaired, not tripped. */
export const FIRE_FAULTS: FireSignal[] = [
  { name: "fault_co",          label: "CO detector fault",       enumMap: NORMAL_ALARM },
  { name: "fault_temperature", label: "Heat detector fault",     enumMap: NORMAL_ALARM },
  { name: "fault_ir",          label: "Infrared detector fault", enumMap: NORMAL_ALARM },
  { name: "fault_start",       label: "Suppression start fault", enumMap: NORMAL_ALARM },
  { name: "fault_feedback",    label: "Suppression feedback fault", enumMap: NORMAL_ALARM },
];

/** Actuator modules: the fan/damper and the sounder-beacon. */
export const FIRE_MODULES: FireSignal[] = [
  { name: "fan_damper_control_module_fire_alarm", label: "Fan / damper module",   enumMap: { 0: "Normal", 1: "Fire alarm" } },
  { name: "fan_damper_control_module_status",     label: "Fan / damper state",    enumMap: { 0: "Stopped", 8: "Open" } },
  { name: "sound_light_alarm_module_fire_alarm",  label: "Sounder / beacon",      enumMap: { 0: "Normal", 1: "Fire alarm" } },
  { name: "sound_light_alarm_module_status",      label: "Sounder / beacon state", enumMap: { 0: "Stopped", 8: "Open" } },
];

/** Decode a panel word, or null when the gateway did not report it. */
export function decodeFire(sig: FireSignal, v: number | null): string | null {
  if (v == null) return null;
  return sig.enumMap[v] ?? `Unknown state ${v}`;
}

/**
 * Whether a value on one of these signals means "something is happening".
 *
 * Explicitly not `value > 0`: the module status words read 8 for the ordinary
 * open state, and `fault` reads 1 for a discharge. Callers pass the signal so
 * the answer can depend on which one it is.
 */
export function isFireActive(sig: FireSignal, v: number | null): boolean {
  if (v == null) return false;
  if (sig.name.endsWith("_module_status")) return false; // a state, not an event
  return v > 0;
}
