"use client";

import { fetchHierarchy as fetchHierarchyCentral } from "@/lib/api/services/powerStationCentral.service";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useUnit } from "@/lib/context/UnitContext";
import {
  fetchCabinetDetail as fetchCabinetDetailCentral,
  fetchPcsData as fetchPcsDataCentral,
  fetchBmsData as fetchBmsDataCentral,
  fetchClusterData as fetchClusterDataCentral,
  fetchCellData as fetchCellDataCentral,
  fetchProbeTemps,
  fetchBmsSubDeviceList as fetchBmsSubDeviceListCentral,
  fetchPcsSubDeviceList as fetchPcsSubDeviceListCentral,
  fetchWaterChillerData as fetchWaterChillerDataCentral,
  fetchFireProtectionData as fetchFireProtectionDataCentral,
} from "@/lib/api/services/cabinetCentral.service";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchEquipmentReadings, fetchMeterTrace, fetchDcAcOffset } from "@/lib/api/services/equipmentReadings.service";
import {
  fetchHierarchy, fetchCabinetDetail, fetchPcsData, fetchBmsData,
  fetchClusterData, fetchCellData, fetchWaterChillerData,
  fetchFireProtectionData, fetchMeterData, fetchBmsSubDeviceList,
  fetchPcsSubDeviceList,
} from "@/lib/api/services/equipment.service";
import { fetchCellTrend, type CellTrend } from "@/lib/api/services/cellTrend.service";

function keepKnown(prev: CellTrend | undefined, next: CellTrend): CellTrend {
  if (!prev) return next;
  return {
    window: next.window ?? prev.window,
    weakest: next.weakest.length ? next.weakest : prev.weakest,
    strongest: next.strongest.length ? next.strongest : prev.strongest,
    envelope: next.envelope.length ? next.envelope : prev.envelope,
    cell: next.cell ?? prev.cell,
    pack: next.pack?.latestMv != null ? next.pack : prev.pack ?? next.pack,
  };
}

const eq = (key: string, ...parts: string[]) => ["equipment", key, ...parts] as const;

/* Central backend. `id` is the site (a gateway). The tree it can describe is
   two levels deep — site and cabinets — because nothing below that exists in
   the 1,174 points. See powerStationCentral.service.ts. */
export const useHierarchy = (id: string) => useQuery({
  queryKey: ["equipment", "hierarchy", id],
  queryFn:  () => fetchHierarchyCentral(id),
  enabled:  !!id,
  staleTime: 60_000,
});
export const useCabinetDetail   = (cabinetId: string, stationId: string)   => useQuery({ queryKey: eq("cabinet",   cabinetId),       queryFn: () => fetchCabinetDetailCentral(cabinetId, stationId), enabled: !!cabinetId && !!stationId, staleTime: 15_000, refetchInterval: 30_000 });
/* invN is kept in the signature and the query key so callers and cached
   entries are undisturbed, but it no longer reaches the fetcher: the gateway
   has one PCS per source, not an indexed set of inverters. */
export const usePcsData         = (cabinetId: string, stationId: string, invN = 1) => useQuery({ queryKey: eq("pcs", cabinetId, String(invN)), queryFn: () => fetchPcsDataCentral(cabinetId, stationId), enabled: !!cabinetId && !!stationId, staleTime: 15_000, refetchInterval: 30_000 });
export const useBmsData         = (pileId: string,    stationId: string)   => useQuery({ queryKey: eq("bms",       pileId),          queryFn: () => fetchBmsDataCentral(pileId, stationId),          enabled: !!pileId    && !!stationId, staleTime: 15_000, refetchInterval: 30_000 });
export const useClusterData     = (pileId: string,    stationId: string)   => useQuery({ queryKey: eq("cluster",   pileId),          queryFn: () => fetchClusterDataCentral(pileId, stationId),      enabled: !!pileId    && !!stationId, staleTime: 15_000 });
/** Per-probe BMS temperatures for one cabinet (source id) — see fetchProbeTemps. */
export const useProbeTemps      = (sourceId: string,  stationId: string)   => useQuery({ queryKey: eq("probes",    sourceId),        queryFn: () => fetchProbeTemps(sourceId, stationId),            enabled: !!sourceId  && !!stationId, staleTime: 30_000, refetchInterval: 30_000 });
export const useCellData        = (rackId: string,    stationId: string)   => useQuery({ queryKey: eq("cell",      rackId),          queryFn: () => fetchCellDataCentral(rackId, stationId),         enabled: !!rackId    && !!stationId, staleTime: 30_000, refetchInterval: 30_000 });
/**
 * Weak-cell drift over the stored window.
 *
 * Six reads of the snapshot store per call and nothing the plant is waiting
 * on, so it is polled far more slowly than the live screens: a drift measured
 * in millivolts per week does not change between two thirty-second refreshes,
 * and asking for it at that rate would spend six requests apiece on a board
 * whose cheapest reply is 2.5 s. Fifteen minutes is already finer than the
 * five-minute store it reads.
 */
export const useCellTrend = (_stationId: string, cellNo?: number, sourceOverride?: string) => {
  /* Central backend: the window is ~35 minutes of S2 and ~16 of S1, not the
     days the NorthBound store held, so it is polled every two minutes rather
     than fifteen — a slower poll would leave most of a short window stale. */
  const { gatewayId } = useAppConfig();
  const { unit, units } = useUnit();
  const sourceId = sourceOverride || unit.sourceId || units.find((u) => u.sourceId)?.sourceId || "";
  const qc = useQueryClient();
  const key = eq("cellTrend", gatewayId, sourceId, String(cellNo ?? ""));
  return useQuery({
    queryKey: key,
    /* A read that comes back short — the 1,000-row point reads hold both
       cabinets, so one cabinet's rows are sometimes missing — keeps the last
       known figures instead of flashing them to "—" until the next poll. */
    queryFn:  async () => keepKnown(qc.getQueryData<CellTrend>(key), await fetchCellTrend(gatewayId, sourceId, cellNo)),
    enabled:  !!gatewayId && !!sourceId,
    staleTime: 2 * 60_000, refetchInterval: 2 * 60_000, gcTime: 30 * 60_000,
  });
};
/**
 * The four sub-device panels, for the CABINET the unit picker has selected.
 *
 * Same resolution as useEquipmentReadings: a station is the site now, so the
 * station id cannot say which PCS or which chiller. `_stationId` is kept so
 * the views' call sites are unchanged, and is deliberately unused.
 */
function useCabinetScope() {
  const { gatewayId } = useAppConfig();
  const { unit, units } = useUnit();
  const sourceId = unit.sourceId ?? units.find((u) => u.sourceId)?.sourceId ?? "";
  return { gatewayId, sourceId, ready: !!gatewayId && !!sourceId };
}

export const useWaterChiller = (_stationId?: string) => {
  const { gatewayId, sourceId, ready } = useCabinetScope();
  return useQuery({
    queryKey: eq("waterChiller", gatewayId, sourceId),
    queryFn:  () => fetchWaterChillerDataCentral(sourceId, gatewayId),
    enabled:  ready, staleTime: 15_000, refetchInterval: 30_000,
  });
};


export const useFireProtection = (_stationId?: string) => {
  const { gatewayId, sourceId, ready } = useCabinetScope();
  return useQuery({
    queryKey: eq("fireProtection", gatewayId, sourceId),
    queryFn:  () => fetchFireProtectionDataCentral(sourceId, gatewayId),
    enabled:  ready, staleTime: 30_000,
  });
};


export const useBmsSubDeviceList = (_stationId?: string) => {
  const { gatewayId, sourceId, ready } = useCabinetScope();
  return useQuery({
    queryKey: eq("bmsSubDevice", gatewayId, sourceId),
    queryFn:  () => fetchBmsSubDeviceListCentral(sourceId, gatewayId),
    enabled:  ready, staleTime: 15_000, refetchInterval: 30_000,
  });
};


export const usePcsSubDeviceList = (_stationId?: string) => {
  const { gatewayId, sourceId, ready } = useCabinetScope();
  return useQuery({
    queryKey: eq("pcsSubDevice", gatewayId, sourceId),
    queryFn:  () => fetchPcsSubDeviceListCentral(sourceId, gatewayId),
    enabled:  ready, staleTime: 15_000, refetchInterval: 30_000,
  });
};
/**
 * Live readings for the PCS, BMS, Chiller, Environment and Meter screens.
 *
 * One query for all five: they read the same /api/telemetry snapshot, and five
 * hooks would be five requests for the same payload against a board whose
 * cheapest measured reply is 2.5 s.
 */
/**
 * Live equipment readings for the CABINET the unit picker has selected.
 *
 * Equipment is per-cabinet and the station is now the site, so the station id
 * cannot answer "which PCS". The unit picker can: each unit carries the
 * `sourceId` that reports it. On Total — an aggregate that no single PCS or
 * BMS corresponds to — the first cabinet is read, because these screens
 * describe one box and showing nothing would be worse than showing cabinet
 * one while the picker plainly says Total.
 *
 * The `_stationId` parameter is kept so the call sites in the views do not all
 * have to change; it is deliberately unused.
 */
export const useEquipmentReadings = (_stationId?: string, sourceOverride?: string) => {
  const { gatewayId } = useAppConfig();
  const { unit, units } = useUnit();
  /* `sourceOverride` is the cabinet the Equipment page's own drill-down has
     selected. Without it the PCS/BMS/Chiller/Environment tabs followed the
     global unit picker while the ESS Cabinet tab beside them followed the
     drill-down, so one screen could show BESS 2's cabinet over BESS 1's PCS. */
  const sourceId = sourceOverride || unit.sourceId || units.find((u) => u.sourceId)?.sourceId || "";

  return useQuery({
    queryKey: ["equipment", "readings", gatewayId, sourceId],
    queryFn:  () => fetchEquipmentReadings(gatewayId, sourceId),
    enabled:  !!gatewayId && !!sourceId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
};

/** The PCS's DC-against-AC offset over the last hour — see fetchDcAcOffset. */
export const useDcAcOffset = (sourceOverride?: string) => {
  const { gatewayId } = useAppConfig();
  const { unit, units } = useUnit();
  const sourceId = sourceOverride || unit.sourceId || units.find((u) => u.sourceId)?.sourceId || "";
  return useQuery({
    queryKey: ["equipment", "dcAcOffset", gatewayId, sourceId],
    queryFn:  () => fetchDcAcOffset(gatewayId, sourceId),
    enabled:  !!gatewayId && !!sourceId,
    /* An hour's average moves slowly; four point reads every 5 min is plenty. */
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
  });
};

/** The site meter's recent power trace — see fetchMeterTrace. */
export const useMeterTrace = (sourceOverride?: string) => {
  const { gatewayId } = useAppConfig();
  const { unit, units } = useUnit();
  const sourceId = sourceOverride || unit.sourceId || units.find((u) => u.sourceId)?.sourceId || "";
  return useQuery({
    queryKey: ["equipment", "meterTrace", gatewayId, sourceId],
    queryFn:  () => fetchMeterTrace(gatewayId, sourceId),
    enabled:  !!gatewayId && !!sourceId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
};

export const useMeterData          = (stationId: string) => useQuery({ queryKey: eq("meter",          stationId), queryFn: () => fetchMeterData(stationId),          enabled: !!stationId, staleTime: 60_000 });
