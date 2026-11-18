/**
 * The 63-signal fast historian profile, as published by the NorthBound gateway
 * (`pcs_bms_critical_lean_90d`, 28 PCS + 35 BMS per BESS).
 *
 * `observed` is not part of the gateway contract. It records what the signal
 * actually did across the 20 h 21 m reference capture of 2026-08-10/11:
 * "varying" means the value moved, "static" means it never changed once.
 * 41 of 63 were static. For 25 of those — the fault and alarm bits — a
 * constant zero is the correct and healthy reading. For the rest it is a
 * finding, and the UI says so rather than drawing a flat line and implying
 * the plant was calm.
 *
 * Generated from Northbound_Fast_BESS_63_Signal_Profile_20260810.csv. Do not
 * hand-edit; regenerate if the gateway profile changes.
 */

export type SignalAsset = "PCS" | "BMS";

export interface SignalDef {
  asset: SignalAsset;
  /** Canonical protocol key, e.g. display_soc. */
  name: string;
  label: string;
  category: string;
  unit: string | null;
  /** Decoded meanings for status/fault words, where the profile defines them. */
  enumMap: Record<number, string> | null;
  /** What this signal did across the reference capture. */
  observed: "varying" | "static";
}

export const SIGNALS: SignalDef[] = [
  { asset: "PCS", name: "phase_a_voltage", label: "Phase A Voltage", category: "voltage", unit: "V", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "phase_b_voltage", label: "Phase B Voltage", category: "voltage", unit: "V", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "phase_c_voltage", label: "Phase C Voltage", category: "voltage", unit: "V", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "phase_a_current", label: "Phase A Current", category: "current", unit: "A", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "phase_b_current", label: "Phase B Current", category: "current", unit: "A", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "phase_c_current", label: "Phase C Current", category: "current", unit: "A", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "dc_voltage", label: "DC Voltage", category: "voltage", unit: "V", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "dc_current", label: "DC Current", category: "current", unit: "A", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "grid_frequency", label: "Grid Frequency", category: "general", unit: "Hz", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "charge_discharge_power", label: "Charge/Discharge Power", category: "power", unit: "kW", enumMap: null, observed: "static" },
  { asset: "PCS", name: "total_active_power", label: "Total Active Power", category: "power", unit: "kW", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "soc", label: "SOC", category: "soc_soh", unit: "%", enumMap: null, observed: "varying" },
  { asset: "PCS", name: "fault_status", label: "Fault Status", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "PCS", name: "total_fault_status", label: "Total Fault Status", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "PCS", name: "total_alarm_status", label: "Total Alarm Status", category: "fault_alarm", unit: null, enumMap: {0: "Invalid", 1: "Alarm"}, observed: "static" },
  { asset: "PCS", name: "on_grid_status", label: "On-Grid Status", category: "status", unit: null, enumMap: {0: "Invalid", 1: "On-Grid"}, observed: "static" },
  { asset: "PCS", name: "off_grid_status", label: "Off-Grid Status", category: "status", unit: null, enumMap: {0: "Invalid", 1: "Off-Grid"}, observed: "static" },
  { asset: "PCS", name: "running_status_2", label: "Running Status", category: "status", unit: null, enumMap: {0: "Invalid", 1: "Running"}, observed: "static" },
  { asset: "PCS", name: "pcs_online_status", label: "PCS Online Status", category: "status", unit: null, enumMap: {0: "Offline", 1: "Online"}, observed: "static" },
  { asset: "PCS", name: "bms_online_status", label: "BMS Online Status", category: "status", unit: null, enumMap: {0: "Offline", 1: "Online"}, observed: "static" },
  { asset: "PCS", name: "sw_fault_ac_over_voltage", label: "SW Fault-AC Over-Voltage", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "PCS", name: "sw_fault_ac_under_voltage", label: "SW Fault-AC Under-Voltage", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "PCS", name: "sw_fault_ac_over_frequency", label: "SW Fault-AC Over-Frequency", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "PCS", name: "sw_fault_ac_under_frequency", label: "SW Fault-AC Under-Frequency", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "PCS", name: "sw_fault_ac_over_current", label: "SW Fault-AC Over-Current", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "PCS", name: "hw_fault_ac_over_current", label: "HW Fault-AC Over-Current", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "PCS", name: "sw_fault_dc_charge_over_current", label: "SW Fault-DC Charge Over-Current", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "PCS", name: "sw_fault_dc_discharge_over_current", label: "SW Fault-DC Discharge Over-Current", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "cluster_total_voltage_collected", label: "Cluster Total Voltage (Collected)", category: "voltage", unit: "V", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "cluster_total_current", label: "Cluster Total Current", category: "current", unit: "A", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "can_hall_sampling_current", label: "CAN Hall Sampling Current", category: "current", unit: "A", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "display_soc", label: "Display SOC", category: "soc_soh", unit: "%", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "soh", label: "SOH", category: "soc_soh", unit: "%", enumMap: null, observed: "static" },
  { asset: "BMS", name: "cell_max_voltage", label: "Cell Max Voltage", category: "voltage", unit: "mV", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "cell_min_voltage", label: "Cell Min Voltage", category: "voltage", unit: "mV", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "max_min_cell_voltage_diff", label: "Max-Min Cell Voltage Diff", category: "voltage", unit: "mV", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "battery_max_temperature", label: "Battery Max Temperature", category: "temperature", unit: "degC", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "battery_min_temperature", label: "Battery Min Temperature", category: "temperature", unit: "degC", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "average_temperature", label: "Average Temperature", category: "temperature", unit: "degC", enumMap: null, observed: "varying" },
  { asset: "BMS", name: "insulation_resistance", label: "Insulation Resistance", category: "insulation", unit: "kohm", enumMap: null, observed: "static" },
  { asset: "BMS", name: "pre_charge_total_voltage", label: "Pre-Charge Total Voltage", category: "voltage", unit: "V", enumMap: null, observed: "static" },
  { asset: "BMS", name: "system_status", label: "System Status", category: "status", unit: null, enumMap: {0: "Normal", 1: "Charge Disabled", 2: "Discharge Disabled", 3: "Standby", 4: "Shutdown"}, observed: "static" },
  { asset: "BMS", name: "charge_discharge_status", label: "Charge/Discharge Status", category: "io", unit: null, enumMap: {0: "Idle", 1: "Discharge", 2: "Charge"}, observed: "varying" },
  { asset: "BMS", name: "pre_charge_contactor_status", label: "Pre-Charge Contactor Status", category: "status", unit: null, enumMap: {0: "Open", 1: "Closed"}, observed: "static" },
  { asset: "BMS", name: "negative_contactor_status", label: "Negative Contactor Status", category: "status", unit: null, enumMap: {0: "Open", 1: "Closed"}, observed: "static" },
  { asset: "BMS", name: "contactor_fault", label: "Contactor Fault", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "fuse_fault", label: "Fuse Fault", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "insulation_fault", label: "Insulation Fault", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "insulation_monitoring_fault", label: "Insulation Monitoring Fault", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "battery_temperature_sensor_fault", label: "Battery Temperature Sensor Fault", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "voltage_sampling_fault", label: "Voltage Sampling Fault", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "current_sampling_fault_functional_safety_fault", label: "Current Sampling Fault (Functional Safety Fault)", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "charge_over_current", label: "Charge Over-Current", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "discharge_over_current_level_1", label: "Discharge Over-Current (Level 1)", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "bmu_communication_fault", label: "BMU Communication Fault", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "bau_communication_fault", label: "BAU Communication Fault", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "pcs_communication_fault", label: "PCS Communication Fault", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "cell_over_voltage_level_1", label: "Cell Over-Voltage (Level 1)", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "cell_under_voltage_level_1", label: "Cell Under-Voltage (Level 1)", category: "fault_alarm", unit: null, enumMap: {0: "Normal", 1: "Fault"}, observed: "static" },
  { asset: "BMS", name: "battery_pack_over_voltage_alarm_voltage_value", label: "Battery Pack Over-Voltage Alarm Voltage Value", category: "fault_alarm", unit: "V", enumMap: null, observed: "static" },
  { asset: "BMS", name: "battery_pack_under_voltage_alarm_voltage_value", label: "Battery Pack Under-Voltage Alarm Voltage Value", category: "fault_alarm", unit: "V", enumMap: null, observed: "static" },
  { asset: "BMS", name: "battery_charge_over_current_alarm_current_value", label: "Battery Charge Over-Current Alarm Current Value", category: "fault_alarm", unit: "A", enumMap: null, observed: "static" },
  { asset: "BMS", name: "battery_discharge_over_current_alarm_current_value", label: "Battery Discharge Over-Current Alarm Current Value", category: "fault_alarm", unit: "A", enumMap: null, observed: "static" },
];

/** Column key as it appears in a flattened history row: "PCS display_soc". */
export const colKey = (s: Pick<SignalDef, "asset" | "name">) => `${s.asset} ${s.name}`;

export const SIGNAL_BY_KEY: Record<string, SignalDef> = Object.fromEntries(
  SIGNALS.map((s) => [colKey(s), s]),
);

/**
 * A configured alarm threshold, not a state.
 *
 * Four of the 29 `fault_alarm` signals are setpoints rather than bits — the
 * voltage and current at which the BMS will raise an alarm — and the profile
 * says so plainly: they carry a unit (V, A) and no `enumMap`, where every
 * genuine bit carries `unit: null` and `{0: "Normal", 1: "Fault"}`. Their
 * names say it too: "Battery Pack Over-Voltage Alarm *Voltage Value*".
 *
 * Counting them as bits is a latent false positive rather than a live one.
 * `value > 0` scores a threshold as asserted, so a pack configured to alarm
 * at 1500 V would put a red "4 active faults" on the Signals header over a
 * healthy plant, while the Alarms screen — which reads the gateway's own
 * /alarms endpoint — said "Nominal".
 *
 * Checked against the live gateway on 2026-09-02: all four read 0.00, so the
 * contradiction is not currently on screen. The split stands anyway, because
 * the categorisation is wrong on its own terms and the miscount is real — it
 * is 25 bits, not 29 — and because the failure appears the day anyone
 * commissions these thresholds to their proper values.
 *
 * That all four read 0.00 is itself worth asking the gateway team about. An
 * over-voltage alarm threshold of zero volts is not a configured protection
 * limit; either the registers are unmapped or the BMS was never given them.
 */
export const isAlarmThreshold = (s: SignalDef) =>
  s.category === "fault_alarm" && s.unit !== null;

/**
 * Fault and alarm bits. A constant zero here is health, not a dead register.
 *
 * 25 of the 63 signals, not 29: the four thresholds above share the category
 * but are readings, and belong with the readings.
 */
export const isFaultBit = (s: SignalDef) =>
  s.category === "fault_alarm" && !isAlarmThreshold(s);

/**
 * Signals that were static across the reference capture AND are neither fault
 * bits nor configured thresholds — i.e. the ones worth querying the gateway
 * team about.
 *
 * Thresholds are excluded because a setpoint that never moves is a setpoint
 * working correctly, and flagging it would be reporting configuration as a
 * fault. Note this is an argument about movement, not about value: the four
 * on this gateway sit at 0.00, which is a finding — see isAlarmThreshold —
 * but it is a finding about commissioning rather than about a dead register,
 * and SUSPECT_STATIC exists to name the latter.
 */
export const SUSPECT_STATIC = SIGNALS.filter(
  (s) => s.observed === "static" && !isFaultBit(s) && !isAlarmThreshold(s),
);

/** Decode a numeric word to its label when the profile defines one. */
export function decode(s: SignalDef, v: number | null): string | null {
  if (v == null) return null;
  if (!s.enumMap) return null;
  return s.enumMap[v] ?? null;
}
