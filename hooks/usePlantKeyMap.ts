"use client";

/**
 * usePlantKeyMap — React Query hook for per-station telemetry key map.
 *
 * Returns a fully annotated PlantKeyMap for the given station, covering
 * every telemetry key on every device, categorised and labelled.
 *
 * Cached with staleTime: Infinity — key lists change only on firmware
 * update or device recommission (same cadence as plant config).
 *
 * Usage:
 *   const { data: keyMap } = usePlantKeyMap(stationId);
 *   if (keyMap) {
 *     keyMap.perInverterPower   → per-inverter kW channels, sorted
 *     keyMap.wmsKeys            → all weather station keys
 *     keyMap.batteryKeys        → all BESS keys
 *     keyMap.byCategory["grid"] → grid import/export/power keys
 *   }
 */

import { useQuery } from "@tanstack/react-query";
import { getPlantKeyMap } from "@/lib/api/services/plantKeyMap.service";
import type { PlantKeyMap } from "@/lib/api/types";

export const plantKeyMapKeys = {
  all:    ["plantKeyMap"] as const,
  detail: (id: string) => ["plantKeyMap", id] as const,
};

export function usePlantKeyMap(stationId: string) {
  return useQuery<PlantKeyMap>({
    queryKey:  plantKeyMapKeys.detail(stationId),
    queryFn:   () => getPlantKeyMap(stationId),
    enabled:   !!stationId,
    staleTime: Infinity,
    gcTime:    24 * 60 * 60 * 1000,
  });
}
