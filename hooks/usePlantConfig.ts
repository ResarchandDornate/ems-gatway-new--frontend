"use client";

/**
 * usePlantConfig — React Query hook for per-station plant topology.
 *
 * Fetches once and caches indefinitely (staleTime: Infinity).
 * Hardware config changes at most once per commissioning event, never intra-day.
 *
 * Usage:
 *   const { data: config, isLoading } = usePlantConfig(stationId);
 *   if (config) {
 *     // config.inverters.length  → number of solar inverters
 *     // config.meters            → grid / load / PV meters
 *     // config.transformers      → transformers present
 *     // config.wms               → weather station present
 *     // config.hasBess           → BESS cabinet present
 *     // config.features          → DG sync, export control, monitor-only flags
 *   }
 */

import { useQuery } from "@tanstack/react-query";
import { getPlantConfig } from "@/lib/api/services/plantConfig.service";
import { useStation } from "@/lib/context/StationContext";
import type { PlantConfig } from "@/lib/api/types";

export const plantConfigKeys = {
  all:    ["plantConfig"] as const,
  detail: (id: string, deviceId = "") => ["plantConfig", id, deviceId] as const,
};

/**
 * The device comes from the header selector rather than the caller, so every
 * existing `usePlantConfig(stationId)` call site becomes device-scoped without
 * changing. config.deviceId is what the telemetry hooks read, so overriding it
 * here is what makes "show me this device only" reach the whole app.
 *
 * The device is part of the query key: two devices on one station are two
 * different topologies and must not share a cache entry.
 */
export function usePlantConfig(stationId: string) {
  const { deviceId } = useStation();

  return useQuery<PlantConfig>({
    queryKey:  plantConfigKeys.detail(stationId, deviceId),
    queryFn:   () => getPlantConfig(stationId, deviceId || undefined),
    enabled:   !!stationId,
    staleTime: Infinity,   // hardware topology never changes intra-session
    gcTime:    24 * 60 * 60 * 1000, // keep in cache for 24 h
  });
}
