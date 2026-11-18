"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchEnergyFlows } from "@/lib/api/services/energyFlows.service";

/**
 * The site's energy flows over the stored window.
 *
 * Three signals for the site plus three per cabinet, at the widest limit the
 * snapshot store is asked for anywhere in the app, so it is polled hourly.
 * Nothing on this screen is a live reading: the newest complete day is
 * yesterday.
 */
export function useEnergyFlows(sourceId: string, allSources: string[]) {
  return useQuery({
    queryKey: ["energyFlows", sourceId, [...allSources].sort().join(",")],
    queryFn: () => fetchEnergyFlows(sourceId, allSources),
    enabled: !!sourceId && allSources.length > 0,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
  });
}
