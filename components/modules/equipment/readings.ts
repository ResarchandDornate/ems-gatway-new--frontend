/**
 * Reading shapes for the Equipment screens.
 *
 * Types only. This file was `placeholders.ts` and carried 296 lines of invented
 * literals — line voltages, frequencies, lifetime energy counters and
 * twenty-four fault bits hardcoded green — which the views rendered exactly as
 * they render measurements. They existed so the layouts could be signed off
 * before the backend did; the NorthBound gateway now answers every one of them
 * and the literals are gone.
 *
 * The shapes stay because they are good shapes: every field was already
 * `number | null` (or a string enum), so the renderers have always handled
 * "not reported" and a real feed could not surprise them. That is why wiring
 * this up was a change to one service and not to eight screens.
 *
 * Where a field names a register in a comment, that register is what
 * lib/api/services/equipmentReadings.service.ts reads.
 */


export type PcsOperatingStatus = "standby" | "running" | "shutdown" | "stopped" | "fault" | "unknown";
export type GridTie            = "grid-connected" | "off-grid" | "invalid";
export type OnlineState        = "online" | "offline";

export interface PcsPhase {
  label: string;
  voltageV:      number | null;   // pcs_1.phase_{a,b,c}_voltage
  currentA:      number | null;   // pcs_1.phase_{a,b,c}_current
  activeKw:      number | null;   // pcs_1.phase_{a,b,c}_active_power
  reactiveKvar:  number | null;   // pcs_1.phase_{a,b,c}_reactive_power
  apparentKva:   number | null;
  powerFactor:   number | null;
}

export interface PcsReadings {
  /** When the snapshot the power figures share was sampled, epoch ms. */
  asOf?: number | null;
  lineVoltage: { ab: number | null; bc: number | null; ca: number | null };
  phases: PcsPhase[];
  totalActiveKw:     number | null;  // pcs_1.total_active_power      · 367
  totalReactiveKvar: number | null;  // pcs_1.total_reactive_power    · 375
  totalApparentKva:  number | null;
  totalPowerFactor:  number | null;
  gridFrequencyHz:   number | null;  // pcs_1.grid_frequency          · 359
  dcPowerKw:         number | null;
  operatingStatus:   PcsOperatingStatus;  // pcs_1.running_status     · 231
  gridTie:           GridTie;             // pcs_1.on_grid_status     · 235
  online:            OnlineState;         // pcs_1.pcs_online_status  · 273
  manualChargeKw:    number | null;
  manualDischargeKw: number | null;
  dcHistoricalChargeKwh:    number | null;  // pcs_1.dc_cumulative_charge_energy    · 409
  dcHistoricalDischargeKwh: number | null;  // pcs_1.dc_cumulative_discharge_energy · 411
  acHistoricalChargeKwh:    number | null;  // pcs_1.ac_cumulative_charge_energy    · 405
  acHistoricalDischargeKwh: number | null;  // pcs_1.ac_cumulative_discharge_energy · 407
  /** Fault bits, in the reference screen's order. Every one has a register in
   *  the dictionary's pcs_1 fault_alarm block. */
  faults: { label: string; ok: boolean }[];
  /** pcs_extended temperature probes, °C (p0200, p0230–p0238). */
  temperatures: { label: string; c: number | null }[];
  /** Mode and contactor state. Codes stay raw until the vendor enum is confirmed. */
  mode: {
    operatingMode: number | null;   // p0239 operating_mode_selection
    controlMode: number | null;     // p0153 control_mode
    vfOffGrid: number | null;       // p0171 vf_off_grid_status (1 = V/F, off-grid forming)
    derating: number | null;        // p0216 derating_flag (non-zero = derating)
    deratingFactor: number | null;  // p0215
    overloadDerating: number | null;// p0172
    positiveContactor: number | null;   // bms p0463 positive_contact_status
    negativeContactor: number | null;   // S1 bms negative_contactor_status
    preChargeContactor: number | null;  // S1 bms pre_charge_contactor_status
  };
  /** DC side and insulation (pcs_extended). */
  dc: {
    totalV: number | null;        // p0219 pcs_total_dc_voltage
    upperV: number | null;        // p0217
    lowerV: number | null;        // p0218
    leakageA: number | null;      // p0220
    insulationKohm: number | null;// p0221
    neutralA: number | null;      // p0214 phase_n_current_rms
  };
}


export type BmsSystemStatus = "normal" | "charge-disabled" | "discharge-disabled" | "standby" | "shutdown" | "unknown";
export type ChargeState     = "idle" | "charging" | "discharging";

export interface BmsReadings {
  online:        OnlineState;      // bms_1.online_points  · 727
  systemStatus:  BmsSystemStatus;  // bms_1.system_status  · 913
  chargeState:   ChargeState;      // bms_1.charge_discharge_status · 921
  socPct:        number | null;    // bms_1.display_soc    · 2073
  sohPct:        number | null;    // bms_1.soh            · 2075
  totalVoltageV: number | null;    // bms_1.cluster_total_voltage_collected · 2093
  totalCurrentA: number | null;    // bms_1.cluster_total_current           · 2095
  hvBoxMaxTempC: number | null;    // bms_1.hv_box_max_temperature          · 2113
  cellVoltageMv: { min: number | null; avg: number | null; max: number | null };   // 2035 / — / 2027
  batteryTempC:  { min: number | null; avg: number | null; max: number | null };   // 2055 / 2063 / 2047
  maxAcceptableChargeA:    number | null;
  maxAcceptableDischargeA: number | null;
  availableChargeKw:       number | null;
  availableDischargeKw:    number | null;
  hvBoxTempC: (number | null)[];                    // four sensors
  minCellVoltageNo: number | null;                  // bms_1.cell_min_voltage_id · 2037
  maxCellVoltageNo: number | null;                  // bms_1.cell_max_voltage_id · 2029
  minBatteryTempNo: number | null;                  // bms_1.battery_min_temperature_id · 2057
  maxBatteryTempNo: number | null;                  // bms_1.battery_max_temperature_id · 2049
  monthlyChargeKwh:    number | null;               // bms_1.monthly_cumulative_charge_energy    · 2125
  monthlyDischargeKwh: number | null;               // bms_1.monthly_cumulative_discharge_energy · 2127
  annualChargeKwh:     number | null;               // bms_1.yearly_cumulative_charge_energy     · 2129
  annualDischargeKwh:  number | null;               // bms_1.yearly_cumulative_discharge_energy  · 2131
  totalChargeAh:    number | null;
  totalDischargeAh: number | null;
}


/** The pack selector on the BMS screen. One entry per physical pack, plus the
 *  aggregate the screen opens on. */
export const BMS_PACKS = ["BMS", "PACK1", "PACK2", "PACK3", "PACK4", "PACK5"] as const;

/* ── Chiller ──────────────────────────────────────────────────────────────── */

export type ChillerMode = "shutdown" | "self-circulation" | "standby" | "cooling" | "heating";

export interface ChillerReadings {
  online: OnlineState;            // liquid_cooling.online_points   · 2291
  powerSwitch: "on" | "off";      // liquid_cooling.power_on_off    · 2293
  workMode: string;               // liquid_cooling.unit_control_mode · 2345
  inletPressureBar:  number | null;  // liquid_cooling.inlet_water_pressure     · 2333
  outletPressureBar: number | null;  // liquid_cooling.outlet_water_pressure    · 2335
  inletTempC:        number | null;  // liquid_cooling.inlet_water_temperature  · 2325
  outletTempC:       number | null;  // liquid_cooling.outlet_water_temperature · 2327
  coolingMaxBattTempC: number | null;
  coolingAvgBattTempC: number | null;
  heatingMinBattTempC: number | null;
  heatingAvgBattTempC: number | null;
  /** Thresholds the unit is configured with — settings, not measurements. */
  outletHighPressureAlarmBar: number | null;
  inletLowPressureAlarmBar:   number | null;
  outletHighTempAlarmC:       number | null;
  outletLowTempAlarmC:        number | null;
  coolingSetTempC:            number | null;  // liquid_cooling.cooling_set_temperature · 2307
  heatingSetTempC:            number | null;  // liquid_cooling.heating_set_temperature · 2309
  inletOutletTempDiffC:       number | null;  // liquid_cooling.inlet_outlet_water_temperature_diff · 2331
  outdoorTempC:  number | null;   // liquid_cooling.outdoor_temperature · p1169
  compressorAHz: number | null;   // liquid_cooling.system_a_compressor_frequency · p1257
  compressorBHz: number | null;   // liquid_cooling.system_b_compressor_frequency · p1258
  unitControlMode:            string;
  /** Every one has a register in the liquid_cooling fault_alarm block. */
  alarms: { label: string; ok: boolean }[];
}


/* ── Environment: dehumidifier + fire protection ──────────────────────────── */

export interface EnvReadings {
  dhOnline: OnlineState;        // dehumidifier.online_points            · 2563
  dhWorkMode: string;           // dehumidifier.operating_mode           · 2565
  dhAlarm: "normal" | "alarm";  // dehumidifier.alarm_status             · 2591
  currentTempC: number | null;  // dehumidifier.current_temperature      · 2587
  currentHumidityPct: number | null; // dehumidifier.current_humidity    · 2589
  tempControlStatus: string;    // dehumidifier.temperature_control_status · 2581
  humidityControlMode: string;  // dehumidifier.humidity_control_method  · 2583
  dehumidificationStatus: string; // dehumidifier.dehumidification_status · 2585
  fireOnline: OnlineState;      // fire_protection.communication_status  · 2517
  /** Its readings have stopped arriving (lib/alarms/commLost): the online bit
   *  and every flag below are its last report, not the panel now. */
  fireLost: boolean;
  /**
   * The reference screen's per-detector breakdown.
   *
   * NO REGISTERS EXIST FOR THIS. The gateway's fire_protection asset carries 23
   * signals and every one is an aggregate for the whole cabinet — fault_co,
   * fire_alarm_temperature, fault, fire_alarm and so on. There is no Battery
   * Box 1..5, no per-detector warning level, start type or sub-valve status.
   * Rendered from placeholders so the layout can be signed off, and flagged on
   * screen so nobody reads it as live per-box data.
   */
  detectors: { name: string; warningLevel: string; faultType: string; startType: string; subValve: string }[];
  /**
   * The fire panel's actual signals, derived from the asset's own fault and
   * alarm bits. This is what replaced `detectors`: real aggregates instead of
   * six invented per-box rows.
   */
  fireSignals: { label: string; ok: boolean }[];
}


/* ── Sub meter ────────────────────────────────────────────────────────────── */

export interface MeterPhase {
  label: string;
  voltageV:     number | null;
  currentA:     number | null;
  activeKw:     number | null;
  reactiveKvar: number | null;
  apparentKva:  number | null;
  powerFactor:  number | null;
}

export interface MeterReadings {
  online: OnlineState;
  frequencyHz:       number | null;
  totalPowerFactor:  number | null;
  totalActiveKw:     number | null;
  totalReactiveKvar: number | null;
  totalApparentKva:  number | null;
  phases: MeterPhase[];
  /** Cumulative import and export at the point of common coupling. */
  forwardEnergyKwh: number | null;
  reverseEnergyKwh: number | null;
  /**
   * Power chart series. Always empty on this backend: the meter's power is on
   * the live snapshot and is not logged, so there is no history to plot. Kept
   * so the chart component's contract is unchanged if a meter point is ever
   * added to the historian profile.
   */
  /** `ts` is the reading's sample time (epoch ms); `t` its HH:MM label. */
  chart: { ts: number; t: string; activeKw: number; apparentKva: number; reactiveKvar: number }[];
}

/* A flat five minutes with one small step, which is what a meter on a standby
   site actually looks like — not a sine wave. Enough shape to prove the chart
   renders and reads, without pretending to be a day of real operation. */

