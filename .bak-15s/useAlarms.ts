"use client";

import { useAppConfig } from "@/hooks/useAppConfig";
import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { fetchAlarms as fetchAlarmsCentral } from "@/lib/api/services/alarmsCentral.service";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { subscribeAcks, acksVersion } from "@/lib/alarms/ack";
import { fetchAlarmStatistics, fetchAlarms } from "@/lib/api/services/alarms.service";
import type { AlarmFilters } from "@/lib/api/types";
import { episodes, fetchAlarmEvents, ALARMS_MAX_LIMIT } from "@/lib/central";

// ── Query keys ────────────────────────────────────────────────────────────────
export const alarmKeys = {
  all:        ["alarms"] as const,
  statistics: (filters: AlarmFilters = {}) => [...alarmKeys.all, "statistics", filters] as const,
  list:       (filters: AlarmFilters) => [...alarmKeys.all, "list", filters] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────────
/**
 * Counts for the three header cards.
 *
 * Takes the same filters as the list on purpose. The gateway's event log is
 * the source for both, and a header counting all-time events over a table
 * showing one selected week is the kind of disagreement nobody notices until
 * they are reconciling a report.
 */
export function useAlarmStatistics(filters: AlarmFilters = {}) {
  return useQuery({
    queryKey:    alarmKeys.statistics(filters),
    queryFn:     () => fetchAlarmStatistics(filters),
    refetchInterval: 30_000,   // poll every 30 s (mirrors the live portal)
    staleTime:       20_000,
  });
}

/**
 * Active alarms from the central backend.
 *
 * The gateway is read here rather than passed in — every caller supplies a
 * station id in `filters.powerStationId`, which is now a site and not the
 * thing this queries by. The site is the gateway, and there is one.
 */
export function useAlarms(filters: AlarmFilters = {}) {
  const { gatewayId } = useAppConfig();
  /* Someone else acknowledged (the 30 s sync brought it in): re-mark the rows. */
  const qc = useQueryClient();
  useEffect(() => {
    let last = acksVersion();
    return subscribeAcks(() => {
      const v = acksVersion();
      if (v !== last) { last = v; void qc.invalidateQueries({ queryKey: alarmKeys.all }); }
    });
  }, [qc]);
  /* Follows the unit picker: on BESS 1/2 only that cabinet's alarms, on Total
     all. A caller that passes `sourceIds` (even []) keeps its own scope. */
  const { isTotal, selected } = useSelectedCabinets();
  const scoped: AlarmFilters = filters.sourceIds !== undefined || isTotal
    ? filters
    : { ...filters, sourceIds: selected.map((c) => c.sourceId) };
  return useQuery({
    queryKey: [...alarmKeys.list(scoped), gatewayId],
    queryFn:  () => fetchAlarmsCentral(gatewayId, scoped),
    enabled:  gatewayId.length > 0,
    refetchInterval: 30_000,   // poll every 30 s, like the header counts
    staleTime: 15_000,
    placeholderData: (prev: any) => prev,   // keep old data while fetching next page
  });
}

/**
 * Alarms that cleared recently, newest first, from S4's history (episodes:
 * each alarm read in time order, so a clear logged under another
 * correlation_id still counts). Follows the unit picker like useAlarms.
 * Acknowledgement is not here: the backend has no endpoint for it.
 */
export function useRecentlyCleared(withinMs = 24 * 3_600_000) {
  const { gatewayId } = useAppConfig();
  const { isTotal, selected } = useSelectedCabinets();
  const scope = isTotal ? "" : selected.map((c) => c.sourceId).join(",");
  return useQuery({
    queryKey: [...alarmKeys.all, "recentlyCleared", gatewayId, scope, withinMs],
    queryFn: async () => {
      const since = Date.now() - withinMs;
      const ids = scope ? scope.split(",") : null;
      return episodes(await fetchAlarmEvents(gatewayId, { limit: ALARMS_MAX_LIMIT }))
        .filter((e) => e.clearedTs != null && e.clearedTs >= since)
        .filter((e) => !ids || (e.event.source_id != null && ids.includes(e.event.source_id)))
        .sort((a, b) => b.clearedTs! - a.clearedTs!);
    },
    enabled: gatewayId.length > 0,
    refetchInterval: 30_000,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

// ── Invalidation helper ───────────────────────────────────────────────────────
export function useInvalidateAlarms() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: alarmKeys.all });
}
