"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAlarmRecurrenceCentral } from "@/lib/api/services/alarmRecurrence.service";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import type { AlarmFilters } from "@/lib/api/types";

/**
 * Recurring alarms, from the central backend's S4 alarm log.
 *
 * S4 has no date range — it answers the newest 1,000 transitions — so the
 * window is read back off the events, not from `filters`, which is kept in the
 * key only so the page's range still scopes the cache. A pattern measured over
 * days does not change between two thirty-second refreshes, hence the slow poll.
 */
export function useAlarmRecurrence(filters: AlarmFilters, enabled = true) {
  const { gatewayId } = useAppConfig();
  /* Follows the unit picker, like useAlarms. */
  const { isTotal, selected } = useSelectedCabinets();
  const sourceIds = isTotal ? undefined : selected.map((c) => c.sourceId);
  return useQuery({
    queryKey: ["alarmRecurrence", gatewayId, filters, sourceIds?.join(",") ?? "all"],
    queryFn: () => fetchAlarmRecurrenceCentral(gatewayId, sourceIds),
    enabled: enabled && gatewayId.length > 0,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
}
