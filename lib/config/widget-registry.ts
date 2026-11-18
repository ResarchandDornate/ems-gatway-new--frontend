/**
 * widget-registry.ts
 *
 * Binds each UI widget to the parameter IDs it should display, differentiated
 * by PlantMode.  This is the only file you need to edit when:
 *
 *  - A new widget is added to the EMS UI
 *  - A widget should show a different parameter set for BESS vs solar sites
 *  - A new plant mode is introduced
 *
 * ─── DESIGN PRINCIPLES ────────────────────────────────────────────────────────
 *
 * 1. Widgets are identified by a stable string ID (WidgetId).
 * 2. Each widget definition lists parameter IDs (from parameter-registry) per
 *    plant mode.  If all modes share the same parameters, use the "default"
 *    entry.  Per-mode overrides take precedence over "default".
 * 3. Parameter IDs are resolved to actual PlantKey[] by useWidgetKeys() at
 *    runtime, using the station's PlantKeyMap.  This file stays static.
 *
 * ─── ADDING A NEW WIDGET ──────────────────────────────────────────────────────
 * 1. Add a WidgetId literal below.
 * 2. Add an entry to WIDGET_REGISTRY with at minimum a "default" binding.
 * 3. In the component, call: const { keys } = useWidgetKeys("my-widget", stationId);
 */

import type { PlantMode } from "./parameter-registry";

// ─── Widget IDs ───────────────────────────────────────────────────────────────

export type WidgetId =
  // Dashboard
  | "power-graph"             // Power Overview Chart (grid + solar/bess + load)
  | "realtime-power-soc"      // 24h intraday power + SOC dual-axis
  | "daily-charge-discharge"  // daily kWh bar chart
  | "daily-revenue"           // daily INR revenue bar chart
  // Equipment / per-inverter
  | "per-inverter-power"      // individual inverter power bars
  | "per-inverter-energy"     // individual inverter kWh
  // Battery detail
  | "battery-overview"        // SOC gauge + realtime power
  | "battery-voltage-current" // dual-axis V and I trend
  | "battery-temperature"     // temperature trend
  // Weather station
  | "wms-irradiance"          // irradiance + module temp
  | "wms-wind"                // wind speed
  // SCADA / Data Analysis
  | "scada-power"             // selectable parameter chart (scada page)
  // Curve Report
  | "curve-report-power"      // curve report power series
  // Performance
  | "performance-kpis";       // PR, CUF, yield, carbon stat cards

// ─── Widget binding shape ─────────────────────────────────────────────────────

/**
 * A widget's parameter binding for one (or all) plant modes.
 * Each entry is an ordered list of parameter IDs from parameter-registry.
 * The order determines the render order (legend, tooltip, etc.).
 */
export type WidgetModeBinding = {
  /**
   * Used when no mode-specific override exists.
   * At least one of "default" or a PlantMode key must be present.
   */
  default?: string[];
} & Partial<Record<PlantMode, string[]>>;

export interface WidgetDef {
  id:           WidgetId;
  label:        string;               // Display name for the widget
  description?: string;
  /**
   * Parameter ID bindings, keyed by plant mode with a "default" fallback.
   * Resolution order: exact mode match → "default" → []
   */
  params:       WidgetModeBinding;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const WIDGET_REGISTRY: Record<WidgetId, WidgetDef> = {

  // ── Power Graph ─────────────────────────────────────────────────────────────
  "power-graph": {
    id:          "power-graph",
    label:       "Power Graph",
    description: "Current-day multi-series power chart with live polling",
    params: {
      // Solar / DG-PV: grid + solar + computed load
      "solar":     ["grid-power", "solar-power", "plant-load"],
      "dg-pv":     ["grid-power", "solar-power", "plant-load"],
      // BESS only: grid + battery power + computed load
      "bess":      ["grid-power", "battery-power", "plant-load"],
      // BESS+Solar: all four series
      "bess-solar":["grid-power", "solar-power", "battery-power", "plant-load"],
      // Fallback (unknown mode): just grid + solar
      default:     ["grid-power", "solar-power", "plant-load"],
    },
  },

  // ── Realtime Power / SOC ────────────────────────────────────────────────────
  "realtime-power-soc": {
    id:          "realtime-power-soc",
    label:       "Realtime Power / SOC",
    description: "24-hour intraday power and battery SOC dual-axis chart",
    params: {
      "solar":      ["solar-power"],
      "dg-pv":      ["solar-power"],
      "bess":       ["battery-power", "battery-soc"],
      "bess-solar": ["solar-power", "battery-power", "battery-soc"],
      default:      ["solar-power"],
    },
  },

  // ── Daily Charge / Discharge / Generation ───────────────────────────────────
  "daily-charge-discharge": {
    id:          "daily-charge-discharge",
    label:       "Daily Charge / Discharge",
    params: {
      "solar":      ["energy-today"],
      "dg-pv":      ["energy-today"],
      "bess":       ["battery-energy-charge", "battery-energy-discharge"],
      "bess-solar": ["energy-today", "battery-energy-charge", "battery-energy-discharge"],
      default:      ["energy-today"],
    },
  },

  // ── Daily Revenue ────────────────────────────────────────────────────────────
  "daily-revenue": {
    id:          "daily-revenue",
    label:       "Daily Revenue",
    params: {
      // Revenue is computed server-side — no telemetry key needed.
      // This widget uses the station's revenue API, not the key registry.
      // Leaving params empty signals the widget should use its own data path.
      default: [],
    },
  },

  // ── Per-inverter power ───────────────────────────────────────────────────────
  "per-inverter-power": {
    id:          "per-inverter-power",
    label:       "Per-Inverter Power",
    description: "Individual inverter kW — one bar/series per inverter",
    params: {
      "solar":      ["solar-power-per-inverter"],
      "dg-pv":      ["solar-power-per-inverter"],
      "bess-solar": ["solar-power-per-inverter"],
      default:      ["solar-power-per-inverter"],
    },
  },

  // ── Per-inverter energy ──────────────────────────────────────────────────────
  "per-inverter-energy": {
    id:          "per-inverter-energy",
    label:       "Per-Inverter Energy",
    params: {
      default: ["energy-today"],
    },
  },

  // ── Battery overview ─────────────────────────────────────────────────────────
  "battery-overview": {
    id:          "battery-overview",
    label:       "Battery Overview",
    description: "SOC trend + realtime charge/discharge power",
    params: {
      "bess":       ["battery-soc", "battery-power"],
      "bess-solar": ["battery-soc", "battery-power"],
      default:      [],
    },
  },

  // ── Battery V & I ────────────────────────────────────────────────────────────
  "battery-voltage-current": {
    id:          "battery-voltage-current",
    label:       "Battery Voltage & Current",
    params: {
      "bess":       ["battery-voltage", "battery-current"],
      "bess-solar": ["battery-voltage", "battery-current"],
      default:      [],
    },
  },

  // ── Battery temperature ──────────────────────────────────────────────────────
  "battery-temperature": {
    id:          "battery-temperature",
    label:       "Battery Temperature",
    params: {
      "bess":       ["battery-temperature"],
      "bess-solar": ["battery-temperature"],
      default:      [],
    },
  },

  // ── WMS irradiance ───────────────────────────────────────────────────────────
  "wms-irradiance": {
    id:          "wms-irradiance",
    label:       "Irradiance",
    description: "Global Horizontal / POA irradiance + module temperature",
    params: {
      default: ["irradiance", "module-temperature"],
    },
  },

  // ── WMS wind ─────────────────────────────────────────────────────────────────
  "wms-wind": {
    id:          "wms-wind",
    label:       "Wind Speed",
    params: {
      default: ["wind-speed", "ambient-temperature"],
    },
  },

  // ── SCADA selectable chart ───────────────────────────────────────────────────
  "scada-power": {
    id:          "scada-power",
    label:       "SCADA Power Chart",
    description: "User-selectable parameter time-series; widget-registry provides defaults",
    params: {
      "solar":      ["solar-power", "grid-power"],
      "dg-pv":      ["solar-power", "grid-power", "dg-power"],
      "bess":       ["battery-power", "battery-soc", "grid-power"],
      "bess-solar": ["solar-power", "battery-power", "battery-soc", "grid-power"],
      default:      ["solar-power", "grid-power"],
    },
  },

  // ── Curve Report ─────────────────────────────────────────────────────────────
  "curve-report-power": {
    id:          "curve-report-power",
    label:       "Curve Report — Power",
    params: {
      "solar":      ["solar-power"],
      "dg-pv":      ["solar-power", "dg-power"],
      "bess":       ["battery-power", "grid-power"],
      "bess-solar": ["solar-power", "battery-power", "grid-power"],
      default:      ["solar-power"],
    },
  },

  // ── Performance KPIs ─────────────────────────────────────────────────────────
  "performance-kpis": {
    id:          "performance-kpis",
    label:       "Performance KPIs",
    params: {
      default: ["performance-ratio", "capacity-utilisation", "specific-yield", "carbon-saving"],
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the parameter ID list for a given widget + plant mode.
 * Resolution order: exact mode match → "default" → []
 */
export function resolveWidgetParams(widgetId: WidgetId, mode: PlantMode): string[] {
  const widget = WIDGET_REGISTRY[widgetId];
  if (!widget) return [];
  return widget.params[mode] ?? widget.params.default ?? [];
}

/**
 * Get a widget definition by ID.  Returns undefined if not found.
 */
export function getWidget(widgetId: WidgetId): WidgetDef | undefined {
  return WIDGET_REGISTRY[widgetId];
}
