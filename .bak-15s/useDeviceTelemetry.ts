"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchDeviceKeys,
  fetchDeviceLatest,
  fetchDeviceSeries,
  type TimeRange,
} from "@/lib/api/services/deviceTelemetry.service";

export const telemetryKeys = {
  keys:   (deviceId: string) => ["telemetry", "keys",   deviceId]            as const,
  latest: (deviceId: string) => ["telemetry", "latest", deviceId]            as const,
  series: (deviceId: string, key: string, range: TimeRange) =>
    ["telemetry", "series", deviceId, key, range] as const,
};

/** All available parameter keys for a device. */
export function useDeviceKeys(deviceId: string) {
  return useQuery({
    queryKey: telemetryKeys.keys(deviceId),
    queryFn:  () => fetchDeviceKeys(deviceId),
    enabled:  !!deviceId,
    staleTime: 120_000,   // keys don't change often
  });
}

/** Latest values for a fixed set of KPI keys. Auto-refreshes every 30 s. */
export function useDeviceLatest(deviceId: string, keys: string[]) {
  return useQuery({
    queryKey: telemetryKeys.latest(deviceId),
    queryFn:  () => fetchDeviceLatest(deviceId, keys),
    enabled:  !!deviceId && keys.length > 0,
    staleTime:    15_000,
    refetchInterval: 30_000,  // live refresh
  });
}

/** Timeseries for a single key over a time range. */
export function useDeviceSeries(deviceId: string, key: string, range: TimeRange) {
  return useQuery({
    queryKey: telemetryKeys.series(deviceId, key, range),
    queryFn:  () => fetchDeviceSeries(deviceId, key, range),
    enabled:  !!deviceId && !!key,
    staleTime:    30_000,
    refetchInterval: range === "1H" ? 60_000 : 300_000,  // 1-min / 5-min refresh
  });
}
