"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDeviceHistory } from "@/lib/api/services/history.service";

export const deviceHistoryKeys = {
  series: (deviceId: string, keys: string[], startTs: number, endTs: number, interval: number) =>
    ["deviceHistory", deviceId, keys.slice().sort().join(","), startTs, endTs, interval] as const,
};

/** Multi-key device history for a custom time range + interval. */
export function useDeviceHistory(
  deviceId: string,
  keys: string[],
  startTs: number,
  endTs: number,
  interval: number,
  limit: number,
  enabled: boolean
) {
  return useQuery({
    queryKey: deviceHistoryKeys.series(deviceId, keys, startTs, endTs, interval),
    queryFn: () => fetchDeviceHistory(deviceId, keys, startTs, endTs, interval, limit),
    enabled: enabled && !!deviceId && keys.length > 0,
    staleTime: 30_000,
  });
}
