"use client";

/**
 * useLiveValues — polls UGX every 30 s for the latest telemetry values
 * for a given set of PlantKeys.
 *
 * Returns a LiveValueMap: { [key: string]: number | null }
 *
 * Usage:
 *   const { data: live } = useLiveValues(keyMap.all);
 *   const power = live?.values["inv_power"] ?? null;   // null → render blank
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchLiveValues, type LiveValuesResult } from "@/lib/api/services/liveValues.service";
import type { PlantKey } from "@/lib/api/types";

const POLL_INTERVAL = 30_000; // 30 seconds

export function useLiveValues(plantKeys: PlantKey[]) {
  // Stable query key based on the key identities
  const queryKey = useMemo(
    () => ["liveValues", ...plantKeys.map(k => `${k.deviceId}::${k.key}`)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plantKeys.map(k => `${k.deviceId}::${k.key}`).join(",")]
  );

  return useQuery<LiveValuesResult>({
    queryKey,
    queryFn:         () => fetchLiveValues(plantKeys),
    enabled:         plantKeys.length > 0,
    refetchInterval: POLL_INTERVAL,
    staleTime:       POLL_INTERVAL - 5_000,
    gcTime:          60_000,
  });
}
