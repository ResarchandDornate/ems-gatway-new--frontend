"use client";

/**
 * Live BESS figures for the dashboard and the power-flow diagram.
 *
 * Returns the same BessLiveData the UGX-era hook did, so PerStation, ScadaView
 * and PowerFlowDiagram need no changes. What is behind it is entirely
 * different: S1 for the battery and inverter at 1 Hz, S2's ems_system for the
 * site-level flows.
 *
 * ── Which figures exist, and which cannot ──────────────────────────────────
 *
 * battKw, soc, soh, tempC, maxCellTempC, voltDC, currA and gridHz are all real
 * and move.
 *
 * gridKw and loadKw are NULL, not 0. They come from the EMS's grid-facing
 * aggregates, which derive from the utility meter — and the meter reads 0.0 on
 * all 43 of its registers because it is not communicating. A single-line
 * diagram drawing 0 kW at the grid tie beside a discharging battery says the
 * site is islanded, which is a claim about the plant rather than about a dead
 * instrument.
 *
 * The four energy counters are null for the same reason: they are the meter's.
 *
 * solarKw comes from the Solis stream (S6): the newest snapshot's
 * data.solis.active_power_kw, only when it is a GOOD read from the last five
 * minutes. The inverter is not a gateway asset, so S1/S2 carry no solar.
 * When S6 has nothing current, the SOC controller's copy (S5,
 * data.solis.active_power_kw — it reads the inverter to derate it) stands in,
 * under the same five-minute rule and not when it reports the inverter
 * offline. Site-wide, so it is read whichever unit is picked; `site` carries
 * the site battery that load (solar + battery) needs. Null from both, and the
 * energy flow falls back to inferring solar from the battery
 * (lib/energy/sources/gateway.ts).
 *
 * ── Total is both cabinets, not the first one ──────────────────────────────
 *
 * On the Total unit this hook used to take the first cabinet and present it as
 * the site, so the dashboard's SoC gauge and the diagram's battery showed BESS 1
 * under a site label. Total now combines every cabinet's newest sample:
 * power and current are summed; SoC, average temperature and DC voltage are
 * the plain mean (the two cabinets are the same 130 kW build, and no register
 * gives rated kWh to weight by); SoH is the worst cabinet; max cell temperature
 * the hottest. A sum needs every cabinet present — one missing cabinet makes
 * the site figure unknown rather than half of it.
 */

import { useMemo } from "react";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useUnit } from "@/lib/context/UnitContext";
import { useQuery } from "@tanstack/react-query";
import {
  fetchController, fetchFastBess, fetchGeneral, fetchSolis, numeric, snapshotsOf, solarKw,
  type ControllerRecord, type GeneralRecord, type SolisRecord,
} from "@/lib/central";
import { TELEMETRY_STALE_AFTER_MS } from "@/lib/freshness";
import type { BessLiveData } from "./useBessLive";
import { STALE_AFTER_MS } from "./useBessLive";
import { fetchTodayEnergy, fetchLifetimeEnergy } from "@/lib/api/services/dailyEnergyCentral.service";

/** Meter-derived: 0 here means the instrument is silent, so it is unknown. */
const liveOrNull = (v: number | null): number | null => (v === null || v === 0 ? null : v);

/** Site-wide figures, whatever the unit picker shows: solar and load belong to
 *  the site (one inverter, one load), so they are read over every cabinet. */
export interface SiteLive {
  /** Battery power summed over every cabinet, kW, + discharge / − charge. */
  battKw: number | null;
  solarKw: number | null;
  chargedKwh: number | null;
  dischargedKwh: number | null;
}

export type BessLiveCentralData = BessLiveData & {
  site: SiteLive;
  /** Each selected cabinet's battery power, kW, from the same samples battKw sums; keyed by source id. */
  battKwBySource: Record<string, number | null>;
};

export function useBessLiveCentral(_stationId?: string): BessLiveCentralData {
  const { gatewayId } = useAppConfig();
  const { unit, units } = useUnit();
  /* Total → every cabinet the selector knows; a BESS → that one. */
  const sourceIds = useMemo(
    () => unit.sourceId
      ? [unit.sourceId]
      : [...new Set(units.map((u) => u.sourceId).filter((s): s is string => !!s))],
    [unit.sourceId, units],
  );
  const key = sourceIds.join(",");
  const ready = !!gatewayId && sourceIds.length > 0;
  const siteIds = useMemo(
    () => [...new Set(units.map((u) => u.sourceId).filter((s): s is string => !!s))],
    [units],
  );
  const siteKey = siteIds.join(",");

  const s1 = useQuery({
    queryKey: ["central", "bessLive", gatewayId, key],
    queryFn:  () => fetchFastBess(gatewayId, { limit: 20 }),
    enabled:  ready,
    refetchInterval: 15_000,
    staleTime: 12_000,
    retry: false,
  });

  const ems = useQuery({
    queryKey: ["central", "emsFlows", gatewayId, key],
    queryFn:  () => fetchGeneral(gatewayId, { substream: "ems_system", limit: 1000 }),
    enabled:  ready,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });

  /* Solar is site-level: read whichever unit is picked. S6 first (event rows
     are mixed in, so read a few to find the newest snapshot); the
     controller's report is the fallback. */
  const isTotal = !unit.sourceId;
  const solis = useQuery({
    queryKey: ["central", "solisSolar", gatewayId],
    queryFn:  () => fetchSolis(gatewayId, { limit: 50 }),
    enabled:  !!gatewayId,
    refetchInterval: 15_000,
    staleTime: 12_000,
    retry: false,
  });
  const controller = useQuery({
    queryKey: ["central", "controllerSolar", gatewayId],
    queryFn:  () => fetchController(gatewayId, { limit: 1 }),
    enabled:  !!gatewayId,
    refetchInterval: 15_000,
    staleTime: 12_000,
    retry: false,
  });

  /* Energy from the PCS DC counters (p0205 / p0206), for the cabinets on screen:
     today = rise since midnight, lifetime = newest reading. These were null
     under a note blaming the silent meter, but they are the PCS's own counters
     and they report. Slow-moving, so polled every 5 min. */
  const counters = useQuery({
    queryKey: ["central", "bessCounters", gatewayId, key],
    queryFn: async () => {
      const [today, lifetime] = await Promise.all([
        fetchTodayEnergy(gatewayId, sourceIds),
        fetchLifetimeEnergy(gatewayId, sourceIds),
      ]);
      return { today, lifetime };
    },
    enabled: ready,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: false,
  });

  /* Today's counters over the whole site, for the site load; on Total the
     query above already is that. */
  const siteCounters = useQuery({
    queryKey: ["central", "bessCounters", gatewayId, siteKey, "today"],
    queryFn: () => fetchTodayEnergy(gatewayId, siteIds),
    enabled: !!gatewayId && siteIds.length > 0 && !isTotal,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: false,
  });

  return useMemo<BessLiveCentralData>(() => {
    const n = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;

    /* Newest sample per cabinet — rows arrive newest first. */
    const samples = sourceIds.map((id) => (s1.data ?? []).find((r) => r.source_id === id));
    const complete = samples.every(Boolean);
    const pcsOf = (k: string) => samples.map((x) => n(x?.data?.pcs_values?.[k]));
    const bmsOf = (k: string) => samples.map((x) => n(x?.data?.bms_values?.[k]));

    const known = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
    const sum  = (xs: (number | null)[]) =>
      complete && xs.every((x) => x !== null) ? known(xs).reduce((a, b) => a + b, 0) : null;
    const mean = (xs: (number | null)[]) => {
      const k = known(xs);
      return complete && k.length === xs.length ? k.reduce((a, b) => a + b, 0) / k.length : null;
    };
    const pick = (xs: (number | null)[], f: (...v: number[]) => number) => {
      const k = known(xs);
      return k.length ? f(...k) : null;
    };

    /* Newest row per (asset, signal) across the selected EMS controllers. */
    const emsPts = new Map<string, GeneralRecord>();
    for (const r of ems.data ?? []) {
      if (!r.asset_id || !r.signal) continue;
      const k = `${r.asset_id}:${r.signal}`;
      if (!emsPts.has(k)) emsPts.set(k, r);
    }
    const e = (sig: string): (number | null)[] =>
      sourceIds.map((id) => {
        const r = emsPts.get(`${id}_ems_system:${sig}`);
        return r ? numeric(r) : null;
      });
    /* Grid and load are the site meter, which every cabinet's EMS reports —
       summing them counted the same meter twice on Total. Read one. */
    const emsSite = (sig: string) => {
      const v = e(sig).find((x) => x !== null);
      return v == null ? null : liveOrNull(v);
    };

    const battKw = sum(pcsOf("total_active_power"));
    const battKwBySource = Object.fromEntries(sourceIds.map((id, i) => [id, pcsOf("total_active_power")[i]]));
    const soc = mean(bmsOf("display_soc")) ?? mean(pcsOf("soc"));

    /* The oldest cabinet dates the combined figure. */
    const times = samples.map((x) => Date.parse(x?.sample_time_utc ?? "")).filter((t) => !Number.isNaN(t));
    const lastTs = complete && times.length ? Math.min(...times) : null;

    const anyLive = [battKw, soc, mean(pcsOf("dc_voltage"))].some((v) => v !== null);

    /* The site's battery: every cabinet's newest sample, all present or null. */
    const siteSamples = siteIds.map((id) => (s1.data ?? []).find((r) => r.source_id === id));
    const sitePower = siteSamples.map((x) => n(x?.data?.pcs_values?.total_active_power));
    const siteBattKw = siteSamples.every(Boolean) && sitePower.every((x) => x !== null)
      ? known(sitePower).reduce((a, b) => a + b, 0) : null;
    const solarKw = solarFromSolis(solis.data) ?? solarFrom(controller.data?.[0]);
    const siteToday = isTotal ? counters.data?.today : siteCounters.data;

    return {
      battKw,
      battKwBySource,
      gridKw: emsSite("grid_current_total_power"),
      loadKw: emsSite("load_power"),
      soc,
      soh: pick(bmsOf("soh"), Math.min),
      tempC: mean(bmsOf("average_temperature")) ?? mean(bmsOf("battery_min_temperature")),
      maxCellTempC: pick(bmsOf("battery_max_temperature"), Math.max),
      solarKw,
      gridHz: pick(pcsOf("grid_frequency"), (...v) => v[0]),
      voltDC: mean(pcsOf("dc_voltage")),
      /* The battery's own current, not the PCS's S1 dc_current, which is in
         step but not to size — see dcCurrent in cabinetCentral.service. */
      currA: sum(bmsOf("cluster_total_current")),
      chargedKwh: counters.data?.today.charge ?? null,
      dischargedKwh: counters.data?.today.discharge ?? null,
      todayEstimatedSince: counters.data?.today.estimatedSince ?? null,
      totalChargedKwh: counters.data?.lifetime.charge ?? null,
      totalDischargedKwh: counters.data?.lifetime.discharge ?? null,
      isLoading: s1.isLoading || ems.isLoading,
      isLive: anyLive,
      lastTs,
      isStale: lastTs !== null && Date.now() - lastTs > STALE_AFTER_MS,
      site: {
        battKw: siteBattKw,
        solarKw,
        chargedKwh: siteToday?.charge ?? null,
        dischargedKwh: siteToday?.discharge ?? null,
      },
    };
  }, [s1.data, s1.isLoading, ems.data, ems.isLoading, sourceIds, siteIds, counters.data, siteCounters.data, isTotal, solis.data, controller.data]);
}

/**
 * PV kW from the newest S6 snapshot, or null when it is not a current GOOD
 * read. S6 is the controller's own read of the inverter (one unit on this
 * site), so this and the S5 copy below say the same thing; S6 comes first
 * because it reports every few seconds and says when a read failed.
 */
function solarFromSolis(rows: SolisRecord[] | undefined): number | null {
  const s = snapshotsOf(rows ?? [])[0];
  if (!s || Date.now() - s.ts > TELEMETRY_STALE_AFTER_MS) return null;
  return solarKw(s.solis);
}

/** PV kW from a controller report, or null when it cannot stand for "now". */
function solarFrom(r: ControllerRecord | undefined): number | null {
  const s = r?.data?.solis;
  const kw = s?.active_power_kw;
  if (!r || !s || s.online === false || typeof kw !== "number" || !Number.isFinite(kw)) return null;
  const t = Date.parse(r.sample_time_utc);
  if (Number.isNaN(t) || Date.now() - t > TELEMETRY_STALE_AFTER_MS) return null;
  return Math.max(0, kw);
}
