"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMeterReadings } from "@/lib/api/services/meterReadings.service";

/** A SECURE meter (solar_meter / load_meter), one per gateway, on the equipment cadence. */
export const useMeterReadings = (gatewayId: string, substream: string) =>
  useQuery({
    queryKey: ["central", "meter", substream, gatewayId],
    queryFn: () => fetchMeterReadings(gatewayId, substream),
    enabled: !!gatewayId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
