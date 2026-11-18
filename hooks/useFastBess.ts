"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchFastBess, fetchFastBessWindow, type FastBessSample } from "@/lib/central";

/**
 * A rolling window of 1 Hz BESS samples.
 *
 * 300 samples is five minutes at the edge's cadence — enough for a trend to
 * have shape without asking the backend for the 1,000-row maximum every ten
 * seconds. The endpoint has no from/to, so the window is the limit and nothing
 * else; widening it means asking for more rows, not a different range.
 *
 * Polled at 10 s rather than 1 s. The samples are already a history, so a
 * poll returns everything since the last one — matching the poll to the
 * sample rate would multiply requests by ten and show the same picture.
 */
export function useFastBess(
  gatewayId: string,
  bessId?: string,
  limit = 300,
  pollMs = 10_000,
) {
  return useQuery<FastBessSample[], Error>({
    queryKey: ["central", "fastBess", gatewayId, bessId ?? "all", limit],
    queryFn: () => fetchFastBess(gatewayId, { limit, bessId }),
    enabled: gatewayId.length > 0,
    refetchInterval: pollMs,
    staleTime: Math.max(1_000, pollMs - 2_000),
    retry: false,
  });
}

/**
 * One cabinet's full samples over the last `windowMs`, by date range. For
 * windows past the 1,000-sample count limit (~17 min); see
 * fetchFastBessWindow. Polled slower than the count reader — each poll pages
 * the whole window again.
 */
export function useFastBessWindow(
  gatewayId: string,
  bessId: string | undefined,
  windowMs: number,
  enabled = true,
  pollMs = 60_000,
) {
  return useQuery<{ samples: FastBessSample[]; completeFrom: number }, Error>({
    queryKey: ["central", "fastBessWindow", gatewayId, bessId ?? "", windowMs],
    queryFn: () => {
      const toMs = Date.now();
      return fetchFastBessWindow(gatewayId, { bessId: bessId!, fromMs: toMs - windowMs, toMs, maxPages: 5 });
    },
    enabled: enabled && gatewayId.length > 0 && !!bessId,
    refetchInterval: pollMs,
    staleTime: pollMs - 5_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}
