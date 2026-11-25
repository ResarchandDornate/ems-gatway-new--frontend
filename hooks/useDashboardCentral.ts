"use client";

/**
 * The dashboard's own reads off the central backend. See
 * lib/api/services/dashboardCentral.service.ts for what each figure is and
 * which ones were left out on purpose.
 */

import { useQuery } from "@tanstack/react-query";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useUnit } from "@/lib/context/UnitContext";
import {
  fetchCabinetReadings, fetchS1Today, fetchS1Windows, fetchS2Recent, type CabinetReadings, type S2RecentSeries,
} from "@/lib/api/services/dashboardCentral.service";
import type { FastBessSample } from "@/lib/central";

/**
 * Energy counters and subsystem flags, per cabinet. Counters move by the kWh
 * and flags by the minute, so a one-minute poll is ample.
 */
export function useCabinetReadings() {
  const { gatewayId } = useAppConfig();
  return useQuery<Record<string, CabinetReadings>>({
    queryKey: ["dashboard", "cabinetReadings", gatewayId],
    queryFn: () => fetchCabinetReadings(gatewayId),
    enabled: gatewayId.length > 0,
    refetchInterval: 30_000,
    staleTime: 50_000,
    retry: false,
  });
}

/**
 * The cabinets the dashboard is describing right now, from the unit picker:
 * one on a BESS selection, all of them on Total.
 *
 * Returned as both ids because S1 filters on bess_id and S2 splits on
 * source_id, and the picker is the only thing that knows which pairs with which.
 */
export function useSelectedCabinets() {
  const { unit, units } = useUnit();
  const cabinets = units.filter((u) => u.bessId && u.sourceId);
  const chosen = unit.bessId ? cabinets.filter((u) => u.id === unit.id) : cabinets;
  return {
    isTotal: !unit.bessId,
    /** Every cabinet on the site, selected or not. */
    all: cabinets.map((u) => ({ bessId: u.bessId!, sourceId: u.sourceId!, label: u.label })),
    selected: chosen.map((u) => ({ bessId: u.bessId!, sourceId: u.sourceId!, label: u.label })),
  };
}

/**
 * The newest S1 samples for every cabinet on the site — read for the PCS/BMS
 * online flags. Always all cabinets, so switching units is a re-slice.
 */
export function useS1Windows() {
  const { gatewayId } = useAppConfig();
  const { all } = useSelectedCabinets();
  const bessIds = all.map((c) => c.bessId);
  return useQuery<Record<string, FastBessSample[]>>({
    queryKey: ["dashboard", "s1Windows", gatewayId, bessIds.join(",")],
    queryFn: () => fetchS1Windows(gatewayId, bessIds),
    enabled: gatewayId.length > 0 && bessIds.length > 0,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
}

/**
 * SOC and battery power for every cabinet, ~1.5 h back — see fetchS2Recent.
 * Two point reads a minute; the window slides forward on each.
 */
/**
 * Today's SOC and power for every cabinet, from the fast stream, midnight to
 * now (see fetchS1Today). Always all cabinets, so switching units re-slices.
 */
export function useS1Today() {
  const { gatewayId } = useAppConfig();
  const { all } = useSelectedCabinets();
  return useQuery<Record<string, S2RecentSeries>>({
    queryKey: ["dashboard", "s1Today", gatewayId, all.map((c) => c.bessId).join(",")],
    queryFn: () => fetchS1Today(gatewayId, all),
    enabled: gatewayId.length > 0 && all.length > 0,
    refetchInterval: 30_000,
    staleTime: 50_000,
    retry: false,
    placeholderData: (prev) => prev,
    /* A day of ~1 Hz points outgrows localStorage; fastBess keeps them in
       IndexedDB instead, so a refresh still resumes rather than restarts. */
    meta: { persist: false },
  });
}

export function useS2Recent() {
  const { gatewayId } = useAppConfig();
  const { all } = useSelectedCabinets();
  const sourceIds = all.map((c) => c.sourceId);
  return useQuery<Record<string, S2RecentSeries>>({
    queryKey: ["dashboard", "s2Recent", gatewayId, sourceIds.join(",")],
    queryFn: () => fetchS2Recent(gatewayId, sourceIds),
    enabled: gatewayId.length > 0 && sourceIds.length > 0,
    refetchInterval: 30_000,
    staleTime: 50_000,
    retry: false,
  });
}
