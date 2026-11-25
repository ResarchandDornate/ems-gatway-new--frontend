"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDevice } from "@/lib/api/services/devices.service";
import { fetchDevices as fetchDevicesCentral } from "@/lib/api/services/commDevices.service";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useSelectedCabinets } from "@/hooks/useDashboardCentral";

export const deviceKeys = {
  all:    ["devices"] as const,
  list:   (customerId: string) => [...deviceKeys.all, "list", customerId] as const,
  detail: (customerId: string, deviceId: string) =>
    [...deviceKeys.all, "detail", customerId, deviceId] as const,
};

/**
 * Every asset the gateway reports, as the device registry.
 *
 * `_customerId` is ignored: there is no customer tier on this backend, and the
 * roster is the gateway's own asset list — the same one Comm Status shows.
 */
export function useDevices(_customerId?: string) {
  const { gatewayId } = useAppConfig();
  /* Narrowed to the unit picker's cabinets (ids are `<sourceId>_<asset>`). */
  const { isTotal, selected } = useSelectedCabinets();
  const sourceIds = isTotal ? null : selected.map((c) => c.sourceId);
  return useQuery({
    queryKey:  deviceKeys.list(gatewayId),
    queryFn:   () => fetchDevicesCentral(gatewayId),
    enabled:   gatewayId.length > 0,
    staleTime: 30_000,
    select: (list) => (sourceIds ? list.filter((d) => sourceIds.some((id) => String(d.id).startsWith(`${id}_`))) : list),
  });
}

/** Single device — resolves via list cache if available. */
export function useDevice(customerId: string, deviceId: string) {
  return useQuery({
    queryKey: deviceKeys.detail(customerId, deviceId),
    queryFn:  () => fetchDevice(customerId, deviceId),
    enabled:  !!customerId && !!deviceId,
    staleTime: 30_000,
  });
}
