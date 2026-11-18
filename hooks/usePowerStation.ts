"use client";

import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { fetchDailyEnergy, fetchEnergyBuckets } from "@/lib/api/services/dailyEnergyCentral.service";
import type { Period } from "@/lib/charts/period";
import {
  fetchDailyData, fetchDailyDataCustom,
  fetchIntradayData, fetchIntradayDataCustom, fetchHistoricalPower,
  fetchPerInverterData,
} from "@/lib/api/services/powerStation.service";
import {
  fetchStationSummary as fetchStationSummaryCentral,
  fetchMatrixData as fetchMatrixDataCentral,
  fetchRecentPower, fetchRecentFast, fetchPlantTopology, fetchCommStatus,
} from "@/lib/api/services/powerStationCentral.service";

const ps = (key: string, ...p: string[]) => ["powerStation", key, ...p] as const;

/* Central backend. `id` is the SITE — a gateway — since the station model
   changed on 25 Sep 2026. See lib/api/services/powerStationCentral.service.ts. */
/** The cabinets the unit picker has selected — undefined on Total (= all).
 *  Every Power Station hook below scopes to these, so BESS 1 / BESS 2 /
 *  Total change what each tile and chart describes. */
function usePickedSources(): { sourceIds: string[] | undefined; key: string } {
  const { isTotal, selected } = useSelectedCabinets();
  const sourceIds = isTotal ? undefined : selected.map((c) => c.sourceId);
  return { sourceIds, key: sourceIds?.join(",") ?? "all" };
}

export function useStationSummary(id: string) {
  const { sourceIds, key } = usePickedSources();
  return useQuery({
    queryKey: ps("summary", id, key),
    queryFn:  () => fetchStationSummaryCentral(id, sourceIds),
    enabled:  !!id,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
export const useDailyData      = (id: string, range: "7d"|"month"|"year"|"all") => useQuery({ queryKey: ps("daily", id, range), queryFn: () => fetchDailyData(id, range), enabled: !!id, staleTime: 60_000, placeholderData: keepPreviousData });
export const useIntradayData   = (id: string)                          => useQuery({ queryKey: ps("intraday", id),   queryFn: () => fetchIntradayData(id),           enabled: !!id, staleTime: 30_000, refetchInterval: 60_000 });
export const useHistoricalPower = (id: string, startDate: string, endDate: string) =>
  useQuery({ queryKey: ps("historical", id, startDate, endDate), queryFn: () => fetchHistoricalPower(id, startDate, endDate), enabled: !!id && !!startDate && !!endDate, staleTime: 120_000 });
export const useDailyDataCustom = (id: string, startTs: number, endTs: number, enabled = true) =>
  useQuery({ queryKey: ps("dailyCustom", id, String(startTs), String(endTs)), queryFn: () => fetchDailyDataCustom(id, startTs, endTs), enabled: !!id && enabled && startTs > 0 && endTs > 0, staleTime: 120_000 });
export const useIntradayDataCustom = (id: string, startTs: number, endTs: number, enabled = true) =>
  useQuery({ queryKey: ps("intradayCustom", id, String(startTs), String(endTs)), queryFn: () => fetchIntradayDataCustom(id, startTs, endTs), enabled: !!id && enabled && startTs > 0 && endTs > 0, staleTime: 120_000 });
export function useMatrixData(id: string, matrixId?: string) {
  const { sourceIds, key } = usePickedSources();
  return useQuery({
    queryKey: ps("matrix", id, matrixId ?? "", key),
    queryFn:  () => fetchMatrixDataCentral(id, matrixId, sourceIds),
    enabled:  !!id,
    staleTime: 15_000,
    refetchInterval: 30_000,
    /* Up to 7 days of ~1 Hz points: too big for localStorage (see useS1Today). */
    meta: { persist: false },
  });
}
/* Comms health from the central backend, keyed on the GATEWAY rather than the
   station — the device list is the gateway's asset roster, and a site is a
   gateway. See fetchCommStatus. The topology strip reads the same entry. */
const commQuery = (gatewayId: string) => ({
  queryKey: ps("comm", gatewayId),
  queryFn: () => fetchCommStatus(gatewayId),
  staleTime: 30_000,
});
export function useCommDevices(gatewayId: string) {
  /* One read for the site; the unit picker narrows it to the selected
     cabinets' devices (ids are `<sourceId>_<asset>`). */
  const { sourceIds } = usePickedSources();
  return useQuery({
    ...commQuery(gatewayId),
    enabled:  !!gatewayId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    select: (list) => (sourceIds ? list.filter((d) => sourceIds.some((id) => d.id.startsWith(`${id}_`))) : list),
  });
}
export const usePerInverterData   = (id: string) => useQuery({ queryKey: ps("perInverter", id),                     queryFn: () => fetchPerInverterData(id),          enabled: !!id, staleTime: 30_000, refetchInterval: 60_000 });

/* Central backend, Single Station Data. The newest ~1.5 h of S2 (every ~11 s) —
   the only window this backend can reach. useIntradayData above still points
   at the disabled NorthBound seam and is left for its other callers. */
export function useRecentPower(gatewayId: string) {
  const { sourceIds, key } = usePickedSources();
  return useQuery({
    queryKey: ps("recentPower", gatewayId, key),
    queryFn:  () => fetchRecentPower(gatewayId, sourceIds),
    enabled:  !!gatewayId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
/* The site's asset roster and control flags, for the topology strip. Replaces
   usePlantConfig on this page, which reads the disabled NorthBound seam. */
export function usePlantTopology(gatewayId: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ps("topology", gatewayId),
    queryFn: async () =>
      fetchPlantTopology(gatewayId, await qc.fetchQuery(commQuery(gatewayId)).catch(() => undefined)),
    enabled:  !!gatewayId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

/** Daily charge / discharge from the PCS energy counters — see
 *  dailyEnergyCentral.service for what the backend's window can answer. */
/** Charge / discharge per hour, day or month of a Day / Week / Month / Year period. */
export const useEnergyBuckets = (gatewayId: string, period: Period) => {
  const { sourceIds, key } = usePickedSources();
  return useQuery({
    queryKey: ps("energyBuckets", gatewayId, period.range, String(period.from), key),
    queryFn: () => fetchEnergyBuckets(gatewayId, period, sourceIds),
    enabled: !!gatewayId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    /* No keepPreviousData: last week's bars must not sit under this month's label. */
  });
};

export const useDailyEnergy = (gatewayId: string, fromYmd: string, toYmd: string) => {
  const { sourceIds, key } = usePickedSources();
  return useQuery({
    queryKey: ps("dailyEnergy", gatewayId, fromYmd, toYmd, key),
    queryFn: () => fetchDailyEnergy(gatewayId, fromYmd, toYmd, sourceIds),
    enabled: !!gatewayId && !!fromYmd && !!toYmd,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
};

/** The fast stream's version of the recent curves — see fetchRecentFast. */
export type FastWindow =
  | { kind: "latest" }                          // newest 1,000 per cabinet
  | { kind: "last"; ms: number }                // ending now, resolved at fetch time
  | { kind: "range"; from: number; to: number };

export function useRecentFast(gatewayId: string, win: FastWindow = { kind: "latest" }) {
  const { sourceIds, key } = usePickedSources();
  const winKey = win.kind === "last" ? `last:${win.ms}` : win.kind === "range" ? `range:${win.from}-${win.to}` : "latest";
  return useQuery({
    queryKey: ps("recentFast", gatewayId, key, winKey),
    queryFn:  () => {
      const now = Date.now();
      const range: [number, number] | undefined =
        win.kind === "last" ? [now - win.ms, now] : win.kind === "range" ? [win.from, win.to] : undefined;
      return fetchRecentFast(gatewayId, sourceIds, range);
    },
    placeholderData: (prev) => prev,
    enabled:  !!gatewayId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
