"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchGatewayHealth, type GatewayHealthRecord } from "@/lib/central";

/**
 * Gateway health records, newest first.
 *
 * Polled at 30 s to match the heartbeat rather than for its own sake: the
 * gateway's own reporting interval sets how often anything new can appear, and
 * nothing here changes faster than it arrives.
 *
 * `retry: false` for the same reason as the heartbeat — this screen exists to
 * report the state of a link, so a failure is the answer rather than something
 * to paper over with three silent attempts.
 */
export function useGatewayHealth(gatewayId: string, limit = 50) {
  return useQuery<GatewayHealthRecord[], Error>({
    queryKey: ["central", "gatewayHealth", gatewayId, limit],
    queryFn: () => fetchGatewayHealth(gatewayId, limit),
    enabled: gatewayId.length > 0,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
}
