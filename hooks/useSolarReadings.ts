"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchSolarReadings } from "@/lib/api/services/solarReadings.service";

/**
 * The site's PV combiner box, refreshed on the same cadence as the other
 * equipment tabs. One combiner per site, so this follows the gateway, not the
 * unit picker.
 */
export const useSolarReadings = (gatewayId: string) =>
  useQuery({
    queryKey: ["central", "solar", gatewayId],
    queryFn: () => fetchSolarReadings(gatewayId),
    enabled: !!gatewayId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
