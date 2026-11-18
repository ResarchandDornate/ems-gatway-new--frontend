"use client";

/**
 * useWidgetKeys
 *
 * Resolves the set of PlantKey[] that a given UI widget should display for a
 * specific station, using:
 *
 *   1. PlantConfig  → derives the PlantMode (solar / dg-pv / bess / bess-solar)
 *   2. widget-registry → maps (widgetId × mode) → parameter ID list
 *   3. parameter-registry → maps parameter ID → keyPatterns + metadata
 *   4. PlantKeyMap  → matches patterns against actual UGX telemetry keys
 *
 * ─── USAGE ────────────────────────────────────────────────────────────────────
 *
 *   const { keys, isLoading, mode } = useWidgetKeys("power-graph", stationId);
 *   // keys[0].key   → "kW_grid_all"   (the real UGX key for this station)
 *   // keys[0].label → "Grid Power"
 *   // keys[0].unit  → "kW"
 *   // keys[0].color → "#5B8DEF"       (from parameter-registry)
 *   // keys[0].deviceId → "..."        (UGX device UUID — pass to fetchScadaSeries)
 *
 * ─── COMPUTED / DERIVED PARAMETERS ───────────────────────────────────────────
 *
 * Parameters marked computed:true (e.g. "plant-load") are included in the
 * returned array as synthetic PlantKey entries.  Their .key is the parameter
 * ID (e.g. "plant-load") rather than a real UGX key.  The component is
 * responsible for computing the value from the derivedFrom keys.
 * The meta.isDerived flag signals this to the caller.
 *
 * ─── FALLBACK BEHAVIOUR ───────────────────────────────────────────────────────
 *
 * If PlantConfig or PlantKeyMap hasn't loaded yet, isLoading is true and
 * keys is [].  Components should show a skeleton/spinner until isLoading
 * is false.
 *
 * If a parameter's keyPatterns produce no match in the station's PlantKeyMap
 * the parameter is silently dropped from the result.  This means a widget
 * automatically hides series that don't exist at a given site.
 */

import { useMemo } from "react";
import { usePlantConfig } from "@/hooks/usePlantConfig";
import { usePlantKeyMap } from "@/hooks/usePlantKeyMap";
import {
  PARAMETER_REGISTRY,
  type ParameterDef,
  type PlantMode,
} from "@/lib/config/parameter-registry";
import {
  resolveWidgetParams,
  type WidgetId,
} from "@/lib/config/widget-registry";
import type { PlantConfig, PlantKey, PlantKeyMap } from "@/lib/api/types";

// ─── Public return type ───────────────────────────────────────────────────────

export interface ResolvedWidgetKey extends PlantKey {
  /** The parameter-registry ID that produced this key */
  parameterId: string;
  /** Hex colour from parameter-registry */
  color: string;
  /** Whether this is a synthetic/computed series (no real UGX key) */
  isDerived: boolean;
  /**
   * For derived parameters: the parameter IDs of the source keys.
   * The component looks up these IDs in the same result array.
   */
  derivedFrom?: string[];
}

export interface UseWidgetKeysResult {
  /** Resolved and ordered keys for the widget, ready to pass to fetchScadaSeries */
  keys:      ResolvedWidgetKey[];
  /** Whether PlantConfig or PlantKeyMap is still loading */
  isLoading: boolean;
  /** Derived plant mode — null until PlantConfig resolves */
  mode:      PlantMode | null;
  /** Human-readable widget label */
  label:     string;
  /** Number of inverters at this station (0 if unknown) */
  inverterCount: number;
  /** Whether this station has a BESS */
  hasBess:   boolean;
  /** Whether this station has a WMS */
  hasWms:    boolean;
}

// ─── Mode derivation ──────────────────────────────────────────────────────────

/**
 * Derives the plant mode from a PlantConfig.
 *
 * Priority:
 *   hasBess && inverters.length > 0 → "bess-solar"
 *   hasBess && inverters.length === 0 → "bess"
 *   features.dgSync.enabled         → "dg-pv"
 *   else                            → "solar"
 */
export function derivePlantMode(config: PlantConfig): PlantMode {
  if (config.hasBess) {
    return config.inverters.length > 0 ? "bess-solar" : "bess";
  }
  if (config.features.dgSync.enabled) {
    return "dg-pv";
  }
  return "solar";
}

// ─── Key resolution helpers ───────────────────────────────────────────────────

/**
 * Try to find a matching PlantKey in the keyMap for the given parameter def.
 *
 * Resolution order:
 *  1. keyMapProperty — if the def names a PlantKeyMap group (e.g. "batteryKeys"),
 *     pick the first key from that group.
 *  2. keyPatterns — test each regex against all.map(k => k.key), first match wins.
 *
 * Returns null if no match found.
 */
function findBestKey(
  def: ParameterDef,
  keyMap: PlantKeyMap,
): PlantKey | null {
  // 1. Named group shortcut — but apply keyPatterns *within* the group first.
  //    Without this, group[0] is returned blindly, which causes e.g. stack_volt
  //    (voltage) to be picked for battery-power when batteryKeys starts with volt.
  if (def.keyMapProperty) {
    const group = keyMap[def.keyMapProperty];
    if (Array.isArray(group) && group.length > 0) {
      // Try each keyPattern against the group members first
      for (const pattern of def.keyPatterns) {
        const match = (group as PlantKey[]).find((k) => pattern.test(k.key));
        if (match) return match;
      }
      // No pattern matched within the group — fall back to group[0]
      return group[0] as PlantKey;
    }
  }

  // 2. Regex patterns — test against all keys
  for (const pattern of def.keyPatterns) {
    const match = keyMap.all.find((k) => pattern.test(k.key));
    if (match) return match;
  }

  return null;
}

/**
 * For per-inverter parameters (e.g. "solar-power-per-inverter"), return ALL
 * matching keys from the appropriate PlantKeyMap group sorted by inverter index.
 *
 * Returns an empty array if nothing found.
 */
function findAllMatchingKeys(
  def: ParameterDef,
  keyMap: PlantKeyMap,
): PlantKey[] {
  // Named group first — most reliable for per-inverter sets
  if (def.keyMapProperty) {
    const group = keyMap[def.keyMapProperty];
    if (Array.isArray(group) && group.length > 0) {
      return group as PlantKey[];
    }
  }

  // Fallback: collect all keys that match any pattern
  const matched: PlantKey[] = [];
  for (const pattern of def.keyPatterns) {
    const hits = keyMap.all.filter((k) => pattern.test(k.key));
    for (const h of hits) {
      if (!matched.some((m) => m.key === h.key)) matched.push(h);
    }
  }
  return matched;
}

/**
 * Build a synthetic PlantKey for computed / derived parameters (no real UGX key).
 */
function buildDerivedKey(def: ParameterDef, keyMap: PlantKeyMap): PlantKey {
  // Use the deviceId from the first available key so the caller has something
  // to reference when calling SCADA APIs if needed.
  const anyKey = keyMap.all[0];
  return {
    key:         def.id,              // parameter ID used as the synthetic key
    deviceId:    anyKey?.deviceId ?? "",
    deviceName:  anyKey?.deviceName ?? "",
    label:       def.label,
    unit:        def.unit,
    category:    def.category,
    subcategory: "computed",
    isRealtime:  def.isRealtime,
    isHistoric:  def.isHistoric,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWidgetKeys(
  widgetId: WidgetId,
  stationId: string,
): UseWidgetKeysResult {
  const { data: config,  isLoading: configLoading  } = usePlantConfig(stationId);
  const { data: keyMap,  isLoading: keyMapLoading  } = usePlantKeyMap(stationId);

  const isLoading = configLoading || keyMapLoading;

  const mode: PlantMode | null = useMemo(
    () => (config ? derivePlantMode(config) : null),
    [config],
  );

  const keys: ResolvedWidgetKey[] = useMemo(() => {
    if (!config || !keyMap || !mode) return [];

    // 1. Get the ordered parameter ID list for this widget + mode
    const paramIds = resolveWidgetParams(widgetId, mode);
    if (paramIds.length === 0) return [];

    const result: ResolvedWidgetKey[] = [];

    for (const paramId of paramIds) {
      const def = PARAMETER_REGISTRY[paramId];
      if (!def) continue;

      // 2. Check mode applicability (empty plantModes = all modes)
      if (def.plantModes.length > 0 && !def.plantModes.includes(mode)) {
        continue;
      }

      // 3. Computed / derived parameter — synthetic key, no UGX lookup
      if (def.computed) {
        result.push({
          ...buildDerivedKey(def, keyMap),
          parameterId: def.id,
          color:       def.color,
          isDerived:   true,
          derivedFrom: def.derivedFrom,
        });
        continue;
      }

      // 4. Per-inverter style — return all matching keys (e.g. kW_inv_1…N)
      const isPerInverter = def.keyMapProperty === "perInverterPower";
      if (isPerInverter) {
        const matches = findAllMatchingKeys(def, keyMap);
        for (const k of matches) {
          result.push({
            ...k,
            parameterId: def.id,
            color:       def.color,
            isDerived:   false,
          });
        }
        continue;
      }

      // 5. Normal single-key resolution
      const found = findBestKey(def, keyMap);
      if (found) {
        result.push({
          ...found,
          // Override label/unit from parameter-registry for consistent display
          label:       def.label,
          unit:        def.unit,
          parameterId: def.id,
          color:       def.color,
          isDerived:   false,
        });
      }
      // If not found: silently skip — site doesn't have this sensor
    }

    return result;
  }, [config, keyMap, mode, widgetId]);

  // ── Widget label from registry ──────────────────────────────────────────────
  const label = useMemo(() => {
    // Import lazily from widget-registry to avoid circular deps at module init
    const { getWidget } = require("@/lib/config/widget-registry") as typeof import("@/lib/config/widget-registry");
    return getWidget(widgetId)?.label ?? widgetId;
  }, [widgetId]);

  return {
    keys,
    isLoading,
    mode,
    label,
    inverterCount: config?.inverters.length ?? 0,
    hasBess:       config?.hasBess ?? false,
    hasWms:        config?.wms ?? false,
  };
}

export type { PlantMode };
