"use client";

import { useQuery } from "@tanstack/react-query";
import { useAppConfig } from "@/hooks/useAppConfig";
import { fetchSolarToday } from "@/lib/energy/solarToday";

/** Today's PV kWh, integrated from S5 + S6 — see lib/energy/solarToday. */
export function useSolarToday(gatewayId?: string) {
  const cfg = useAppConfig();
  const id = gatewayId || cfg.gatewayId;
  return useQuery({
    queryKey: ["central", "solarToday", id],
    queryFn: () => fetchSolarToday(id),
    enabled: !!id,
    staleTime: 60_000,
    refetchInterval: 120_000,
    placeholderData: (prev) => prev,
  });
}
