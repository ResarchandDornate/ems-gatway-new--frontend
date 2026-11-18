"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchStations, fetchStation } from "@/lib/api/services/stations.service";
import { useAppConfig } from "@/hooks/useAppConfig";
import type { Station } from "@/lib/api/types";

export const stationKeys = {
  all:    ["stations"] as const,
  list:   (gatewayId: string) => [...stationKeys.all, "list", gatewayId] as const,
  detail: (gatewayId: string, id: string) => [...stationKeys.all, "detail", gatewayId, id] as const,
};

/**
 * The sites this deployment can see.
 *
 * The gateway is read here rather than passed in, so no caller has to know
 * that a site is a gateway — which is a fact about this backend's shape, not
 * about any screen. It is in the query key because a different gateway is a
 * different site and must not be served from the previous one's cache.
 */
export function useStations() {
  const { configuredGatewayId: gatewayId } = useAppConfig();
  return useQuery<Station[]>({
    queryKey:  stationKeys.list(gatewayId),
    queryFn:   () => fetchStations(gatewayId),
    enabled:   gatewayId.length > 0,
    staleTime: 60_000,
  });
}

export function useStation(id: string) {
  const { configuredGatewayId: gatewayId } = useAppConfig();
  return useQuery<Station>({
    queryKey: stationKeys.detail(gatewayId, id),
    queryFn:  () => fetchStation(id, gatewayId),
    enabled:  !!id && gatewayId.length > 0,
    staleTime: 30_000,
  });
}
