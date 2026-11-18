"use client";

/**
 * The data layer every mobile screen reads through.
 *
 * Each hook calls the real one unconditionally — Rules of Hooks — and returns
 * fixtures instead when demo mode is on. Screens are identical in both modes,
 * which is the point: what gets design-reviewed under /m/demo is exactly the
 * component tree that runs against live UGX under /m.
 *
 * In demo mode the real hooks are handed an empty station id, which disables
 * their queries (`enabled: !!stationId`) so no request is made against an API
 * we have no token for.
 */

import { useMemo } from "react";
import { useBessLive, type BessLiveData } from "@/hooks/useBessLive";
import { useStationSummary, useIntradayData, useCommDevices } from "@/hooks/usePowerStation";
import { useAlarms, useAlarmStatistics } from "@/hooks/useAlarms";
import { useStation as useStationCtx } from "@/lib/context/StationContext";
import type { Station, StationSummary, Alarm, CommDevice, AlarmStatistics } from "@/lib/api/types";

import { useDemo } from "./demo/DemoContext";
import {
  demoStations, demoLive, demoSummary, demoDevices, demoAlarmStats,
  buildDemoCurve, buildDemoAlarms,
} from "./demo/fixtures";

/** Station selection, live or demo. */
export function useMobileStation() {
  const demo = useDemo();
  const { sel, setSel, stations, station } = useStationCtx();

  if (demo.on) {
    return {
      stationId: demo.stationId,
      station: demoStations.find((s) => s.id === demo.stationId) ?? demoStations[0],
      stations: demoStations as Station[],
      select: demo.select,
    };
  }

  const stationId = sel.mode === "station" && sel.id ? sel.id : (stations[0]?.id ?? "");
  return {
    stationId,
    station: station ?? stations.find((s) => s.id === stationId) ?? stations[0] ?? null,
    stations,
    select: (id: string) => setSel({ mode: "station", id }),
  };
}

export function useLive(stationId: string): BessLiveData {
  const demo = useDemo();
  const live = useBessLive(demo.on ? "" : stationId);
  return demo.on
    // lastTs is stamped relative to this session so the header reads
    // "Updated 24s ago" rather than a frozen date.
    ? { ...demoLive, lastTs: demo.now - 24_000 }
    : live;
}

export function useSummary(stationId: string): { data: StationSummary | undefined; isLoading: boolean } {
  const demo = useDemo();
  const q = useStationSummary(demo.on ? "" : stationId);
  return demo.on ? { data: demoSummary, isLoading: false } : { data: q.data, isLoading: q.isLoading };
}

export function useCurve(stationId: string) {
  const demo = useDemo();
  const q = useIntradayData(demo.on ? "" : stationId);
  const curve = useMemo(() => (demo.on ? buildDemoCurve() : []), [demo.on]);
  return demo.on ? { data: curve, isLoading: false } : { data: q.data ?? [], isLoading: q.isLoading };
}

export function useDevices(stationId: string): { data: CommDevice[]; isLoading: boolean } {
  const demo = useDemo();
  const q = useCommDevices(demo.on ? "" : stationId);
  return demo.on ? { data: demoDevices, isLoading: false } : { data: q.data ?? [], isLoading: q.isLoading };
}

export function useAlarmStats(): { data: AlarmStatistics | undefined; isLoading: boolean } {
  const demo = useDemo();
  const q = useAlarmStatistics();
  return demo.on ? { data: demoAlarmStats, isLoading: false } : { data: q.data, isLoading: q.isLoading };
}

export function useAlarmList(stationId: string): { data: Alarm[]; isLoading: boolean } {
  const demo = useDemo();
  const q = useAlarms(demo.on ? {} : { powerStationId: stationId || undefined });
  const rows = useMemo(() => (demo.on ? buildDemoAlarms(demo.now) : []), [demo.on, demo.now]);
  return demo.on ? { data: rows, isLoading: false } : { data: q.data?.records ?? [], isLoading: q.isLoading };
}
