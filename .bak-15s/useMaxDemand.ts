"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMaxDemand } from "@/lib/api/services/maxDemand.service";

/**
 * The site's maximum-demand history.
 *
 * `allSources` matters and is not optional in spirit: the meter is read from
 * one source because there is one grid connection, but the battery's
 * contribution has to be summed across every cabinet behind it or the
 * counterfactual understates what the BESS took off the peak. See the service.
 *
 * Polled every five minutes, matching the snapshot store's own cadence — a
 * demand block is fifteen minutes long and nothing useful changes faster than
 * the store it is read from. The live half of the screen is the block in
 * progress, and five minutes is three looks at it before it closes.
 */
export function useMaxDemand(sourceId: string, allSources: string[]) {
  return useQuery({
    queryKey: ["maxDemand", sourceId, [...allSources].sort().join(",")],
    queryFn: () => fetchMaxDemand(sourceId, allSources),
    enabled: !!sourceId && allSources.length > 0,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
