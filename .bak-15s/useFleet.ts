"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchFleet } from "@/lib/api/services/fleet.service";

/**
 * Every unit behind the gateway, benchmarked against every other.
 *
 * Six stored-signal reads per unit, so this is the heaviest query in the app
 * and is polled the least often. Nothing it reports moves inside an hour: a
 * cycle count, an efficiency and a mean temperature are all window averages.
 */
export function useFleet(sources: string[], enabled = true) {
  return useQuery({
    queryKey: ["fleet", [...sources].sort().join(",")],
    queryFn: () => fetchFleet(sources),
    enabled: enabled && sources.length > 0,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
  });
}
