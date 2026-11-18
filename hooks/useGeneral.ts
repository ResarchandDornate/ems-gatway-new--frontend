"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchGeneral, type GeneralRecord } from "@/lib/central";

/**
 * S2 rows for one substream — the signal list for an asset group.
 *
 * 1,000 is the maximum and it is the right ask here: unfiltered that spans
 * about seven seconds, and a substream carries a hundred-odd points across two
 * cabinets, so anything smaller risks not containing every signal once. This
 * query exists to answer "what does this asset read right now", and a signal
 * missing from the page because the window was too small would look like a
 * signal the gateway does not have.
 */
export function useGeneralSubstream(gatewayId: string, substream: string, pollMs = 15_000) {
  return useQuery<GeneralRecord[], Error>({
    queryKey: ["central", "general", gatewayId, substream],
    queryFn: () => fetchGeneral(gatewayId, { substream, limit: 1000 }),
    enabled: gatewayId.length > 0 && substream.length > 0,
    refetchInterval: pollMs,
    staleTime: pollMs - 2_000,
    retry: false,
  });
}

/**
 * One signal's history.
 *
 * Only a point_id query has a usable time axis — measured at about 35 minutes
 * for 500 rows, though that is split across every asset carrying the point, so
 * the caller still has to pick one.
 */
export function useGeneralPoint(gatewayId: string, pointId: string | null, limit = 500) {
  return useQuery<GeneralRecord[], Error>({
    queryKey: ["central", "generalPoint", gatewayId, pointId, limit],
    queryFn: () => fetchGeneral(gatewayId, { pointId: pointId!, limit }),
    enabled: gatewayId.length > 0 && !!pointId,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
}
