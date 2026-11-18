/**
 * parameter-registry.ts
 *
 * Single source of truth for every telemetry parameter that the EMS UI can
 * display.  Each entry maps a canonical parameter ID (used in widget-registry
 * and UI code) to:
 *
 *  - the raw UGX key patterns used to discover the physical telemetry key at
 *    runtime via PlantKeyMap
 *  - display metadata (label, unit, color, chart type, order)
 *  - which plant modes this parameter is relevant for
 *  - data-shape hints (realtime / historic, always-positive, computed)
 *
 * ─── USAGE ────────────────────────────────────────────────────────────────────
 * When a new site or sensor type arrives:
 *  1. Add a new ParameterDef entry here.
 *  2. Wire it into a widget in widget-registry.ts.
 *  3. No component code needs to change.
 *
 * ─── KEY PATTERNS ─────────────────────────────────────────────────────────────
 * `keyPatterns` is an ordered list of RegExps tried against the PlantKeyMap
 * for the station.  The first match wins.  We also accept an exact key string
 * which is tested first before the regex list.
 *
 * ─── PLANT MODES ─────────────────────────────────────────────────────────────
 * "solar"      — grid-tied PV only
 * "dg-pv"      — DG sync + PV (current live sites)
 * "bess"       — BESS only (no solar inverters)
 * "bess-solar" — BESS + solar inverters
 *
 * A parameter with plantModes = ["solar","dg-pv","bess-solar"] will NOT be
 * surfaced for a pure BESS site.  An empty array means "all modes".
 */

import type { KeyCategory } from "@/lib/api/types";

// ─── Core types ───────────────────────────────────────────────────────────────

export type PlantMode = "solar" | "dg-pv" | "bess" | "bess-solar";

export type ChartType =
  | "area"        // filled area chart (kW power, SOC)
  | "line"        // thin line (voltage, frequency)
  | "bar"         // stacked / grouped bars (kWh, revenue)
  | "gauge"       // radial gauge (SOC, PR%)
  | "stat"        // single numeric stat card
  | "donut";      // donut / pie

export interface ParameterDef {
  /** Stable ID used in widget-registry and hook resolution */
  id: string;

  /**
   * Ordered regex patterns tried against PlantKeyMap.  First match in the
   * station's actual key catalogue wins.  Patterns are tested case-insensitively.
   */
  keyPatterns: RegExp[];

  /**
   * Optional: if a PlantKeyMap property already groups exactly the right keys
   * (e.g. "stationPowerKeys", "batteryKeys"), name it here.  The hook will
   * prefer this over keyPatterns so you don't have to enumerate every variant.
   */
  keyMapProperty?: keyof import("@/lib/api/types").PlantKeyMap;

  /** Human-readable label shown in legends, tooltips, stat cards */
  label: string;

  /** SI unit string, e.g. "kW", "kWh", "%", "°C", "V" */
  unit: string;

  /** KeyCategory from PlantKeyMap — used for fallback group lookups */
  category: KeyCategory;

  /** Hex colour for charts / indicator dots */
  color: string;

  /** Default chart type when rendered in a chart widget */
  chartType: ChartType;

  /**
   * Plant modes where this parameter is applicable.
   * Empty array = applicable to ALL modes.
   */
  plantModes: PlantMode[];

  /** Whether this parameter has meaningful real-time (sub-minute) values */
  isRealtime: boolean;

  /** Whether this parameter supports historical trend queries */
  isHistoric: boolean;

  /**
   * When true the raw telemetry value is always ≥ 0
   * (e.g. generation kWh).  Useful for chart Y-axis auto-scaling.
   */
  alwaysPositive?: boolean;

  /**
   * When true this parameter is a derived/computed value
   * (e.g. Plant Load = Grid + Solar) and has no direct UGX key.
   * The hook returns a synthetic PlantKey with derivedFrom[] populated.
   */
  computed?: boolean;

  /** For computed parameters: the parameter IDs whose values sum/combine to this */
  derivedFrom?: string[];

  /**
   * Short description — shown in tooltips or configuration UIs when available.
   */
  description?: string;

  /**
   * Display order within a widget group.  Lower = closer to the top / left.
   */
  displayOrder: number;
}

// ─── Colour palette ───────────────────────────────────────────────────────────

export const COLORS = {
  // Power
  GRID:       "#5B8DEF",   // blue   — grid import/export
  SOLAR:      "#4ADE80",   // green  — PV generation
  LOAD:       "#94A3B8",   // slate  — plant load (computed)
  DG:         "#F59E0B",   // amber  — DG / genset
  BESS:       "#F26B4E",   // brand orange — battery power
  // Battery state
  SOC:        "#F26B4E",   // orange — state of charge
  SOH:        "#FB923C",   // light orange — state of health
  // Environment / WMS
  IRRADIANCE: "#FBBF24",   // yellow — GHI / POA
  MODULE_TEMP:"#F87171",   // rose   — module temperature
  WIND:       "#67E8F9",   // cyan   — wind speed
  // Electrical quality
  VOLTAGE:    "#A78BFA",   // violet — AC / DC voltage
  CURRENT:    "#34D399",   // emerald — current
  FREQUENCY:  "#818CF8",   // indigo — frequency
  // Performance
  PR:         "#22D3EE",   // sky — performance ratio
  CUF:        "#38BDF8",   // light sky — capacity utilisation
  // Energy counters
  ENERGY_GEN: "#4ADE80",   // green — kWh generated
  ENERGY_IMP: "#5B8DEF",   // blue  — kWh imported
  ENERGY_EXP: "#F472B6",   // pink  — kWh exported
} as const;

// ─── Registry ─────────────────────────────────────────────────────────────────

export const PARAMETER_REGISTRY: Record<string, ParameterDef> = {

  // ── Solar / PV power ───────────────────────────────────────────────────────

  "solar-power": {
    id:           "solar-power",
    label:        "Solar Power",
    unit:         "kW",
    category:     "power",
    color:        COLORS.SOLAR,
    chartType:    "area",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 2,
    description:  "Combined active power output from all PV inverters",
    keyPatterns: [
      /^kW_inv_all$/i,
      /^inv_power$/i,
      /^kW_inv_1$/i,
      /^kW_inv/i,
    ],
    keyMapProperty: "stationPowerKeys",
  },

  "solar-power-per-inverter": {
    id:           "solar-power-per-inverter",
    label:        "Inverter Power",
    unit:         "kW",
    category:     "power",
    color:        COLORS.SOLAR,
    chartType:    "area",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 3,
    description:  "Per-inverter active power — one series per inverter",
    keyPatterns: [
      /^kW_inv_\d+$/i,
    ],
    keyMapProperty: "perInverterPower",
  },

  // ── Grid power ─────────────────────────────────────────────────────────────

  "grid-power": {
    id:           "grid-power",
    label:        "Grid Power",
    unit:         "kW",
    category:     "grid",
    color:        COLORS.GRID,
    chartType:    "area",
    plantModes:   [],                   // all modes — any grid-tied plant
    isRealtime:   true,
    isHistoric:   true,
    displayOrder: 1,
    description:  "Net grid power (positive = import, negative = export)",
    keyPatterns: [
      /^kW_grid_all$/i,
      /^grid_power$/i,
      /^kW_grid_1$/i,
      /^kW_grid/i,
    ],
    keyMapProperty: "gridKeys",
  },

  "grid-energy-import": {
    id:           "grid-energy-import",
    label:        "Grid Import",
    unit:         "kWh",
    category:     "energy",
    color:        COLORS.ENERGY_IMP,
    chartType:    "bar",
    plantModes:   [],
    isRealtime:   false,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 10,
    description:  "Cumulative energy drawn from the grid",
    keyPatterns: [
      /^grid_imported$/i,
      /^kWh_grid_in/i,
      /^import_kwh$/i,
    ],
  },

  "grid-energy-export": {
    id:           "grid-energy-export",
    label:        "Grid Export",
    unit:         "kWh",
    category:     "energy",
    color:        COLORS.ENERGY_EXP,
    chartType:    "bar",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   false,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 11,
    description:  "Cumulative energy fed back to the grid",
    keyPatterns: [
      /^grid_exported$/i,
      /^kWh_grid_out/i,
      /^export_kwh$/i,
    ],
  },

  // ── Plant load (computed) ──────────────────────────────────────────────────

  "plant-load": {
    id:           "plant-load",
    label:        "Plant Load",
    unit:         "kW",
    category:     "power",
    color:        COLORS.LOAD,
    chartType:    "area",
    plantModes:   [],
    isRealtime:   true,
    isHistoric:   true,
    computed:     true,
    derivedFrom:  ["grid-power", "solar-power"],
    displayOrder: 4,
    description:  "Computed plant load = Grid Power + Solar Power (UGX formula)",
    keyPatterns:  [],
  },

  // ── DG / Genset ────────────────────────────────────────────────────────────

  "dg-power": {
    id:           "dg-power",
    label:        "DG Power",
    unit:         "kW",
    category:     "power",
    color:        COLORS.DG,
    chartType:    "area",
    plantModes:   ["dg-pv"],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 5,
    description:  "Active power from diesel / gas generator",
    keyPatterns: [
      /^kW_dg$/i,
      /^dg_power$/i,
      /^gen_power$/i,
      /^kW_gen$/i,
    ],
  },

  // ── Energy generation (kWh) ────────────────────────────────────────────────

  "energy-today": {
    id:           "energy-today",
    label:        "Today's Generation",
    unit:         "kWh",
    category:     "energy",
    color:        COLORS.ENERGY_GEN,
    chartType:    "stat",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   false,
    isHistoric:   false,
    alwaysPositive: true,
    displayOrder: 20,
    description:  "Total PV energy generated today",
    keyPatterns: [
      /^gen_today$/i,
      /^kWh_inv_today$/i,
      /^gen_inv_today$/i,
    ],
  },

  "energy-total": {
    id:           "energy-total",
    label:        "Total Generation",
    unit:         "kWh",
    category:     "energy",
    color:        COLORS.ENERGY_GEN,
    chartType:    "stat",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   false,
    isHistoric:   false,
    alwaysPositive: true,
    displayOrder: 21,
    description:  "Lifetime PV energy generated",
    keyPatterns: [
      /^gen_total$/i,
      /^kWh_inv_total$/i,
      /^gen_inv_total$/i,
    ],
    keyMapProperty: "energyKeys",
  },

  // ── Battery / BESS ─────────────────────────────────────────────────────────

  "battery-soc": {
    id:           "battery-soc",
    label:        "State of Charge",
    unit:         "%",
    category:     "battery",
    color:        COLORS.SOC,
    chartType:    "area",
    plantModes:   ["bess", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 30,
    description:  "Battery state of charge — averaged across all cells/racks",
    keyPatterns: [
      /^soc_all$/i,
      /^soc_avg$/i,
      /^soc_1$/i,
      /^soc_/i,
    ],
    keyMapProperty: "batteryKeys",
  },

  "battery-power": {
    id:           "battery-power",
    label:        "Battery Power",
    unit:         "kW",
    category:     "battery",
    color:        COLORS.BESS,
    chartType:    "area",
    plantModes:   ["bess", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    displayOrder: 31,
    description:  "BESS active power (positive = discharge, negative = charge)",
    keyPatterns: [
      /^stack_power$/i,      // UnityESS BMS key (W — adapter divides by 1000 for kW display)
      /^bess_power$/i,
      /^battery_power$/i,
      /^kW_bess$/i,
      /^kW_bat/i,
      /^bat_power/i,
    ],
    keyMapProperty: "batteryKeys",
  },

  "battery-voltage": {
    id:           "battery-voltage",
    label:        "Battery Voltage",
    unit:         "V",
    category:     "battery",
    color:        COLORS.VOLTAGE,
    chartType:    "line",
    plantModes:   ["bess", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 32,
    description:  "BESS pack / string voltage",
    keyPatterns: [
      /^Vdc_bat/i,
      /^bess_voltage$/i,
      /^bat_voltage/i,
      /^V_bat/i,
    ],
  },

  "battery-current": {
    id:           "battery-current",
    label:        "Battery Current",
    unit:         "A",
    category:     "battery",
    color:        COLORS.CURRENT,
    chartType:    "line",
    plantModes:   ["bess", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    displayOrder: 33,
    description:  "BESS pack current (positive = discharge)",
    keyPatterns: [
      /^Idc_bat/i,
      /^bess_current$/i,
      /^bat_current/i,
      /^I_bat/i,
    ],
  },

  "battery-temperature": {
    id:           "battery-temperature",
    label:        "Battery Temperature",
    unit:         "°C",
    category:     "battery",
    color:        COLORS.MODULE_TEMP,
    chartType:    "line",
    plantModes:   ["bess", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    displayOrder: 34,
    description:  "BESS cell / pack temperature (max cell)",
    keyPatterns: [
      /^temp_bat/i,
      /^bess_temp$/i,
      /^bat_temp/i,
      /^T_bat/i,
    ],
  },

  "battery-energy-charge": {
    id:           "battery-energy-charge",
    label:        "Charge Energy",
    unit:         "kWh",
    category:     "battery",
    color:        COLORS.ENERGY_IMP,
    chartType:    "bar",
    plantModes:   ["bess", "bess-solar"],
    isRealtime:   false,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 35,
    description:  "Energy charged into BESS today / over period",
    keyPatterns: [
      /^kWh_charge/i,
      /^bess_charge_kwh$/i,
      /^charge_energy/i,
    ],
  },

  "battery-energy-discharge": {
    id:           "battery-energy-discharge",
    label:        "Discharge Energy",
    unit:         "kWh",
    category:     "battery",
    color:        COLORS.BESS,
    chartType:    "bar",
    plantModes:   ["bess", "bess-solar"],
    isRealtime:   false,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 36,
    description:  "Energy discharged from BESS today / over period",
    keyPatterns: [
      /^kWh_discharge/i,
      /^bess_discharge_kwh$/i,
      /^discharge_energy/i,
    ],
  },

  // ── AC Electrical quality ──────────────────────────────────────────────────

  "voltage-phase-r": {
    id:           "voltage-phase-r",
    label:        "Voltage (R-phase)",
    unit:         "V",
    category:     "voltage",
    color:        COLORS.VOLTAGE,
    chartType:    "line",
    plantModes:   [],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 50,
    keyPatterns: [/^V_r$/i, /^V_r_1$/i, /^Vac_r/i],
  },

  "voltage-phase-y": {
    id:           "voltage-phase-y",
    label:        "Voltage (Y-phase)",
    unit:         "V",
    category:     "voltage",
    color:        "#FDE68A",
    chartType:    "line",
    plantModes:   [],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 51,
    keyPatterns: [/^V_y$/i, /^V_y_1$/i, /^Vac_y/i],
  },

  "voltage-phase-b": {
    id:           "voltage-phase-b",
    label:        "Voltage (B-phase)",
    unit:         "V",
    category:     "voltage",
    color:        "#6EE7B7",
    chartType:    "line",
    plantModes:   [],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 52,
    keyPatterns: [/^V_b$/i, /^V_b_1$/i, /^Vac_b/i],
  },

  "current-phase-r": {
    id:           "current-phase-r",
    label:        "Current (R-phase)",
    unit:         "A",
    category:     "current",
    color:        COLORS.CURRENT,
    chartType:    "line",
    plantModes:   [],
    isRealtime:   true,
    isHistoric:   true,
    displayOrder: 53,
    keyPatterns: [/^I_r$/i, /^I_r_1$/i],
  },

  "frequency": {
    id:           "frequency",
    label:        "Grid Frequency",
    unit:         "Hz",
    category:     "frequency",
    color:        COLORS.FREQUENCY,
    chartType:    "line",
    plantModes:   [],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 55,
    keyPatterns: [/^Hz_r$/i, /^freq$/i, /^Hz_/i],
  },

  // ── Weather / WMS ─────────────────────────────────────────────────────────

  "irradiance": {
    id:           "irradiance",
    label:        "Irradiance",
    unit:         "W/m²",
    category:     "wms",
    color:        COLORS.IRRADIANCE,
    chartType:    "area",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 60,
    description:  "Global Horizontal / Plane Of Array irradiance",
    keyPatterns: [
      /^ird_a$/i,
      /^GII$/i,
      /^irradiance/i,
      /^poa_/i,
      /^ghi_/i,
    ],
    keyMapProperty: "wmsKeys",
  },

  "module-temperature": {
    id:           "module-temperature",
    label:        "Module Temperature",
    unit:         "°C",
    category:     "wms",
    color:        COLORS.MODULE_TEMP,
    chartType:    "line",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    displayOrder: 61,
    keyPatterns: [
      /^temp_module$/i,
      /^T_module$/i,
      /^module_temp/i,
    ],
  },

  "ambient-temperature": {
    id:           "ambient-temperature",
    label:        "Ambient Temperature",
    unit:         "°C",
    category:     "temperature",
    color:        "#FCA5A5",
    chartType:    "line",
    plantModes:   [],
    isRealtime:   true,
    isHistoric:   true,
    displayOrder: 62,
    keyPatterns: [
      /^temp_ambient$/i,
      /^T_amb$/i,
      /^ambient_temp/i,
    ],
  },

  "wind-speed": {
    id:           "wind-speed",
    label:        "Wind Speed",
    unit:         "m/s",
    category:     "wms",
    color:        COLORS.WIND,
    chartType:    "line",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   true,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 63,
    keyPatterns: [
      /^wind_speed$/i,
      /^wind_v$/i,
      /^ws_/i,
    ],
  },

  // ── Performance ────────────────────────────────────────────────────────────

  "performance-ratio": {
    id:           "performance-ratio",
    label:        "Performance Ratio",
    unit:         "%",
    category:     "performance",
    color:        COLORS.PR,
    chartType:    "gauge",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   false,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 70,
    description:  "IEC 61724 Performance Ratio — actual ÷ expected yield × 100",
    keyPatterns: [
      /^PR$/i,
      /^perf_ratio$/i,
      /^performance_ratio/i,
    ],
    keyMapProperty: "performanceKeys",
  },

  "capacity-utilisation": {
    id:           "capacity-utilisation",
    label:        "Capacity Utilisation Factor",
    unit:         "%",
    category:     "performance",
    color:        COLORS.CUF,
    chartType:    "gauge",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   false,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 71,
    description:  "CUF = annual energy (kWh) ÷ (installed capacity (kW) × 8760)",
    keyPatterns: [
      /^CUF$/i,
      /^cap_util/i,
    ],
  },

  "specific-yield": {
    id:           "specific-yield",
    label:        "Specific Yield",
    unit:         "kWh/kWp",
    category:     "performance",
    color:        COLORS.PR,
    chartType:    "stat",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   false,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 72,
    keyPatterns: [
      /^yield$/i,
      /^specific_yield/i,
      /^kWh_per_kWp/i,
    ],
  },

  "carbon-saving": {
    id:           "carbon-saving",
    label:        "Carbon Saving",
    unit:         "tCO₂",
    category:     "performance",
    color:        "#86EFAC",
    chartType:    "stat",
    plantModes:   ["solar", "dg-pv", "bess-solar"],
    isRealtime:   false,
    isHistoric:   true,
    alwaysPositive: true,
    displayOrder: 73,
    keyPatterns: [
      /^carbon/i,
      /^CO2/i,
      /^co2_saving/i,
    ],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** All parameter IDs in the registry */
export const PARAMETER_IDS = Object.keys(PARAMETER_REGISTRY) as (keyof typeof PARAMETER_REGISTRY)[];

/** Get a parameter definition by ID, throws if not found */
export function getParameter(id: string): ParameterDef {
  const def = PARAMETER_REGISTRY[id];
  if (!def) throw new Error(`[parameter-registry] Unknown parameter ID: "${id}"`);
  return def;
}

/** Parameters applicable to a given plant mode (or all if no filter) */
export function getParametersForMode(mode: PlantMode): ParameterDef[] {
  return Object.values(PARAMETER_REGISTRY)
    .filter((p) => p.plantModes.length === 0 || p.plantModes.includes(mode))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Parameters in a given KeyCategory */
export function getParametersByCategory(category: KeyCategory): ParameterDef[] {
  return Object.values(PARAMETER_REGISTRY)
    .filter((p) => p.category === category)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}
