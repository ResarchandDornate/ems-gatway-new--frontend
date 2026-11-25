"use client";

import { useQuery } from "@tanstack/react-query";
import { useAppConfig } from "@/hooks/useAppConfig";
import { fetchCabinetCounters, fetchEmsLimits } from "@/lib/api/services/analysisCentral.service";

/**
 * Per-cabinet energy counters, off S2 — see analysisCentral.service.ts.
 *
 * A minute is plenty: the month counter moves by a few kWh an hour, and the
 * ratio built on it moves in hundredths of a point.
 */
export function useCabinetCounters(enabled = true) {
  const { gatewayId } = useAppConfig();
  return useQuery({
    queryKey: ["analysisCentral", "counters", gatewayId],
    queryFn: () => fetchCabinetCounters(gatewayId),
    enabled: enabled && gatewayId.length > 0,
    staleTime: 55_000,
    refetchInterval: 30_000,
    retry: false,
  });
}

/** The EMS's demand-limit and anti-reverse-flow settings, per cabinet. */
export function useEmsLimits(enabled = true) {
  const { gatewayId } = useAppConfig();
  return useQuery({
    queryKey: ["analysisCentral", "limits", gatewayId],
    queryFn: () => fetchEmsLimits(gatewayId),
    enabled: enabled && gatewayId.length > 0,
    staleTime: 55_000,
    refetchInterval: 30_000,
    retry: false,
  });
}
