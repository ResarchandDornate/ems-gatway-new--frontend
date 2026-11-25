"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchSolis } from "@/lib/central";

/**
 * S6 Solis inverter samples, newest first — the newest row per inverter is its
 * live state. Named apart from useSolis, which reads the NorthBound gateway's
 * /api/solis/status for the phone app.
 */
export const useSolisCentral = (gatewayId: string, limit = 1000) =>
  useQuery({
    queryKey: ["central", "solis", gatewayId, limit],
    queryFn: () => fetchSolis(gatewayId, { limit }),
    enabled: !!gatewayId,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
