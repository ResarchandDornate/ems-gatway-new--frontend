"use client";
import { useQuery } from "@tanstack/react-query";
import {
  fetchRealtimePower, fetchTotalActivePower, fetchPcsCurve, fetchClusterCurve,
  fetchClusterStat, fetchCellCurve, fetchPowerQuantity, fetchProfitReport,
  fetchCounterTod, fetchAvailableCounters, fetchDayStoredDelta, type EnergyCounter,
} from "@/lib/api/services/curveReport.service";
import { useRevenueMaster } from "@/hooks/useRevenueMaster";

const cr = (key: string, ...p: string[]) => ["curveReport", key, ...p] as const;

export const useRealtimePower    = (id: string)                                => useQuery({ queryKey: cr("rtPower",   id),           queryFn: () => fetchRealtimePower(id),             enabled: !!id, staleTime: 30_000, refetchInterval: 60_000 });
export const useTotalActivePower = (id: string, s: string, e: string, refetchInterval?: number) => useQuery({ queryKey: cr("totalPower",id,s,e), queryFn: () => fetchTotalActivePower(id,s,e), enabled: !!id&&!!s&&!!e, staleTime: 60_000, refetchInterval });
export const usePcsCurve         = (cab: string, date: string, invN = 1, stationId?: string) => useQuery({ queryKey: cr("pcsCurve", cab, date, String(invN), stationId ?? ""), queryFn: () => fetchPcsCurve(cab, date, invN, stationId), enabled: !!cab && !!date, staleTime: 60_000 });
export const useClusterCurve     = (rack: string, s: string, e: string)        => useQuery({ queryKey: cr("cluster",   rack,s,e),       queryFn: () => fetchClusterCurve(rack,s,e),        enabled: !!rack&&!!s&&!!e, staleTime: 60_000 });
export const useClusterStat      = (rack: string)                              => useQuery({ queryKey: cr("clusterStat",rack),          queryFn: () => fetchClusterStat(rack),             enabled: !!rack, staleTime: 30_000 });
export const useCellCurve        = (cell: string, s: string, e: string)        => useQuery({ queryKey: cr("cell",      cell,s,e),       queryFn: () => fetchCellCurve(cell,s,e),           enabled: !!cell&&!!s&&!!e, staleTime: 60_000 });
export const usePowerQuantity    = (id: string, s: string, e: string)          => useQuery({ queryKey: cr("pwrQty",    id,s,e),         queryFn: () => fetchPowerQuantity(id,s,e),         enabled: !!id&&!!s&&!!e, staleTime: 60_000 });
/** Priced at Settings → Revenue when saved, else the site's tariff overlay. */
export const useProfitReport = (id: string, s: string, e: string) => {
  const { data: master, isLoading } = useRevenueMaster();
  const rates = master ? { chargeCostRs: master.chargeCostRs, dischargeCostRs: master.dischargeCostRs } : null;
  return useQuery({
    queryKey: cr("profit", id, s, e, String(rates?.chargeCostRs ?? "-"), String(rates?.dischargeCostRs ?? "-")),
    queryFn: () => fetchProfitReport(id, s, e, rates),
    /* Wait for the saved rates, so the overlay's figures never flash first. */
    enabled: !!id && !!s && !!e && !isLoading,
    staleTime: 60_000,
  });
};

/** Daily ToD rows for each requested counter, keyed by counter. */
export const useEnergyCounters = (id: string, counters: EnergyCounter[], s: string, e: string) => useQuery({
  queryKey: cr("energy", id, s, e, ...counters),
  queryFn: async () => Object.fromEntries(
    await Promise.all(counters.map(async c => [c, await fetchCounterTod(id, c, s, e)] as const))
  ) as Partial<Record<EnergyCounter, Awaited<ReturnType<typeof fetchCounterTod>>>>,
  enabled: !!id && !!s && !!e && counters.length > 0,
  staleTime: 60_000,
});
export const useAvailableCounters = (id: string) => useQuery({ queryKey: cr("counters", id), queryFn: () => fetchAvailableCounters(id), enabled: !!id, staleTime: 10 * 60_000 });

/** ΔStored per day for the round-trip column — see fetchDayStoredDelta. */
export const useDayStoredDelta = (id: string, s: string, e: string, enabled = true) => useQuery({
  queryKey: cr("storedDelta", id, s, e),
  queryFn: () => fetchDayStoredDelta(id, s, e),
  enabled: enabled && !!id && !!s && !!e,
  staleTime: 5 * 60_000,
});
