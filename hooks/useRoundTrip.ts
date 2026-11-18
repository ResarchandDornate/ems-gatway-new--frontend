"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRoundTrip } from "@/lib/api/services/roundTrip.service";

/**
 * One cabinet's round-trip efficiency history.
 *
 * Four stored signals per call and a figure that moves in tenths of a point
 * per month, so it is polled once an hour rather than on the live cadence.
 * Nothing on this screen changes between two thirty-second refreshes, and the
 * reads are not cheap: at 12,000 rows a signal this is the widest request the
 * app makes of the snapshot store.
 */
export function useRoundTrip(sourceId: string) {
  return useQuery({
    queryKey: ["roundTrip", sourceId],
    queryFn: () => fetchRoundTrip(sourceId),
    enabled: !!sourceId,
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
  });
}
