"use client";

import { useQuery, useQueries } from "@tanstack/react-query";
import { useAppConfig } from "@/hooks/useAppConfig";
import {
  fetchPointList, fetchPointHistory, fetchPointLatestTs,
} from "@/lib/api/services/pointsCentral.service";

/**
 * The point catalogue for the whole site.
 *
 * `_stationId` is accepted and ignored: the catalogue spans every cabinet, and
 * the tag itself names the asset, so there is nothing to narrow by here. Kept
 * so the call sites do not all have to change.
 */
export const usePointList = (_stationId?: string) => {
  const { gatewayId } = useAppConfig();
  return useQuery({
    queryKey: ["dataAnalysis", "points", gatewayId],
    queryFn:  () => fetchPointList(gatewayId),
    enabled:  gatewayId.length > 0,
    staleTime: 300_000,
  });
};

export const usePointHistory = (tagId: string, startDt: string, endDt: string) => {
  const { gatewayId } = useAppConfig();
  return useQuery({
    queryKey: ["dataAnalysis", "history", gatewayId, tagId, startDt, endDt],
    queryFn:  ({ signal }) => fetchPointHistory(gatewayId, tagId, startDt, endDt, signal),
    enabled:  gatewayId.length > 0 && !!tagId,
    staleTime: 60_000,
  });
};

/**
 * History for several tags at once — one query per tag so each is cached,
 * retried and invalidated on its own, and a slow tag does not hold up the rest.
 */
/** @param stepMs fast-stream tags: one sample per this much (default 30 min). */
export const usePointHistories = (tagIds: string[], startDt: string, endDt: string, stepMs?: number) => {
  const { gatewayId } = useAppConfig();
  return useQueries({
    queries: tagIds.map((tagId) => ({
      queryKey: ["dataAnalysis", "history", gatewayId, tagId, startDt, endDt, stepMs ?? 0] as const,
      /* The signal stops a period's slice reads when its chart goes away. */
      queryFn:  ({ signal }) => fetchPointHistory(gatewayId, tagId, startDt, endDt, signal, stepMs),
      enabled:  gatewayId.length > 0 && !!tagId,
      staleTime: 60_000,
    })),
  });
};

/** When each tag last reported — used to explain an empty chart. */
export const usePointsLatestTs = (tagIds: string[]) => {
  const { gatewayId } = useAppConfig();
  return useQuery({
    queryKey: ["dataAnalysis", "latestTs", gatewayId, [...tagIds].sort()],
    queryFn:  () => fetchPointLatestTs(gatewayId, tagIds),
    enabled:  gatewayId.length > 0 && tagIds.length > 0,
    staleTime: 60_000,
  });
};
