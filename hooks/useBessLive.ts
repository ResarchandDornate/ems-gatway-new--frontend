"use client";

/**
 * useBessLive — polls UGX every 30 s for the latest BESS telemetry values.
 *
 * Telemetry keys (UnityESS / UGX DG_pv device profile):
 *   stack_power      → kW  (positive = discharge, negative = charge)
 *   stack_soc        → %
 *   stack_soh        → %
 *   stack_volt       → V
 *   stack_curr       → A
 *   stack_ave_temp   → °C
 *   daily_cha_cap    → kWh (firmware 0.1 kWh/count, converted by liveValues service)
 *   daily_dis_cap    → kWh
 *   total_cha_cap    → kWh (lifetime)
 *   total_dis_cap    → kWh (lifetime)
 *   grid_power       → kW (positive = import) — if available
 *   kW_grid_1        → kW — older naming convention
 *
 * Every field is `number | null`. null means UGX has no value for that key —
 * callers must render a placeholder, never a substitute reading.
 *
 * This hook previously fell back to a BESS_DEMO constant whenever UGX returned
 * nothing, so a device that had stopped publishing rendered a full dashboard of
 * plausible but fabricated numbers. Missing data is now reported as missing,
 * and `lastTs` / `isStale` describe how old the real readings are.
 */

import { useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePlantConfig } from "./usePlantConfig";
import { fetchLiveValues, pickMetricValue } from "@/lib/api/services/liveValues.service";
import { activeProfile, metricToTags, type MetricId } from "@/lib/api/metrics";
import { reportTelemetryTs } from "@/lib/telemetryClock";
import { useSolis } from "./useSolis";
import type { PlantKey } from "@/lib/api/types";

// ── BESS keys to request ──────────────────────────────────────────────────────

/**
 * What this hook needs, stated as canonical metrics. The actual tag names are
 * derived from the active profile, so a site whose firmware uses different
 * spellings works as soon as those spellings are listed in the profile —
 * no change here.
 */
const BESS_METRICS: MetricId[] = [
  "bank.power",
  /* The measured alternative to bank.power, and on this backend the only one
     that arrives. bank.power is a *derived* binding — pack volts × pack amps —
     and a derived binding names no tag, so it has nothing for fetchLiveValues
     to read and nothing for pickMetricValue to match. Asking for it alone left
     the cockpit's battery node reading "IDLE" with a dash through it while the
     cabinet was dispatching 80 kW. The northbound profile says as much in its
     own note against bank.power. */
  "pcs.activePower",
  "bank.soc", "bank.soh",
  "bank.voltage", "bank.current", "bank.cellTempAvg", "bank.cellTempMax",
  "site.gridPower", "site.solarPower", "pcs.frequency",
  "bank.todayChargeKwh", "bank.todayDischargeKwh",
  "bank.lifetimeChargeKwh", "bank.lifetimeDischargeKwh",
  "site.ratedCapacityKwh",
];

/** Every tag the profile might read for those metrics, de-duplicated. */
function bessTags(): string[] {
  const profile = activeProfile();
  const tags = BESS_METRICS.flatMap((m) => metricToTags(profile, m))
    .filter((t) => t && !t.includes("{"));   // skip templated families
  return [...new Set(tags)];
}

// ── Return shape ──────────────────────────────────────────────────────────────

export interface BessLiveData {
  battKw:            number | null;   // stack_power (positive=discharge, negative=charge)
  gridKw:            number | null;   // grid_power or kW_grid_1 (positive=import)
  loadKw:            number | null;   // derived = gridKw + battKw
  soc:               number | null;   // stack_soc %
  soh:               number | null;   // stack_soh %
  tempC:             number | null;   // stack_ave_temp °C
  maxCellTempC:      number | null;   // stack_max_temp °C
  solarKw:           number | null;   // site solar/PV power (hybrid sites only)
  gridHz:            number | null;   // grid frequency
  voltDC:            number | null;   // stack_volt V
  currA:             number | null;   // stack_curr A
  chargedKwh:        number | null;   // daily_cha_cap kWh
  dischargedKwh:     number | null;   // daily_dis_cap kWh
  /** Set when charged/discharged today are an estimate from power: from when. */
  todayEstimatedSince?: number | null;
  totalChargedKwh:   number | null;   // total_cha_cap kWh
  totalDischargedKwh:number | null;   // total_dis_cap kWh
  isLoading:         boolean;
  /** true when at least one value came back non-null from UGX */
  isLive:            boolean;
  /** Newest telemetry timestamp (ms) from the device, or null if it never published. */
  lastTs:            number | null;
  /** true when the newest reading is older than STALE_AFTER_MS. */
  isStale:           boolean;
}

/**
 * A device is considered stale once its newest reading is older than this.
 * Polling is 30 s; 15 min allows for slow-publishing firmware without letting
 * genuinely dead links pass as live.
 */
export const STALE_AFTER_MS = 15 * 60_000;

/** All-null reading — used while loading and when the device has no data. */
const EMPTY: Omit<BessLiveData, "isLoading"> = {
  battKw: null, gridKw: null, loadKw: null,
  soc: null, soh: null, tempC: null,
  maxCellTempC: null, solarKw: null, gridHz: null,
  voltDC: null, currA: null,
  chargedKwh: null, dischargedKwh: null,
  totalChargedKwh: null, totalDischargedKwh: null,
  isLive: false, lastTs: null, isStale: false,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBessLive(stationId: string): BessLiveData {
  const { data: config, isLoading: configLoading } = usePlantConfig(stationId);
  /* The inverter, which lives on its own endpoint. See solarKw below. */
  const { data: solis } = useSolis(!!stationId);
  const solisKw = solis?.data.available && solis.data.online ? solis.data.powerKw : null;

  // Build PlantKey[] for every tag the profile binds to the metrics we need.
  const plantKeys = useMemo((): PlantKey[] => {
    if (!config?.deviceId) return [];
    return bessTags().map((key): PlantKey => ({
      key,
      deviceId:    config.deviceId,
      deviceName:  config.gridxId,
      label:       key,
      unit:        "",
      category:    "battery" as PlantKey["category"],
      subcategory: "BESS",
      isRealtime:  true,
      isHistoric:  false,
    }));
  }, [config?.deviceId, config?.gridxId]);

  const { data: result, isLoading: liveLoading } = useQuery({
    queryKey:        ["bessLive", config?.deviceId],
    queryFn:         () => fetchLiveValues(plantKeys),
    enabled:         plantKeys.length > 0,
    refetchInterval: 30_000,
    staleTime:       25_000,
    gcTime:          60_000,
  });

  // Publish the reading time from the DATA, not from the fetch.
  //
  // Reporting inside fetchLiveValues looked equivalent and is not: this app
  // persists the query cache to storage, so on reload react-query rehydrates
  // the last response without calling queryFn at all. The fetch never happens,
  // the clock never hears, and the header reads "—" over a dashboard that is
  // plainly showing live values — until the next poll half a minute later.
  // Keyed off the timestamp itself, this fires for a cache hit too.
  const reportedTs = result?.lastTs ?? null;
  useEffect(() => { reportTelemetryTs(reportedTs); }, [reportedTs]);

  const isLoading = configLoading || liveLoading;

  // No response yet (loading, or the station has no BESS device) → all null.
  // `values` is also checked: a persisted cache written by an older build can
  // rehydrate a different shape, and a stale cache entry must not be able to
  // take the whole dashboard down.
  if (!result?.values) return { ...EMPTY, isLoading };

  const { values, lastTs } = result;

  const isLive  = Object.values(values).some((v) => v !== null);
  const isStale = lastTs != null && Date.now() - lastTs > STALE_AFTER_MS;

  // A device that has stopped publishing reports nothing, rather than its last
  // words dressed as the present.
  //
  // UGX answers every poll with the newest stored point regardless of age, so a
  // plant that went quiet days ago still returns a complete, entirely plausible
  // set of readings. Showing them with a "stale" chip alongside was not enough:
  // the numbers are the loud part of the page and the chip is not, so the
  // dashboard read as live at a glance. Past the threshold the values are
  // dropped and only `lastTs` survives, so the UI can say when the plant last
  // spoke. The readings themselves are still in UGX — Historical Data is where
  // you go to look at them, with a time range attached and no pretence that
  // they describe right now.
  if (isStale) {
    return { ...EMPTY, isLoading, lastTs, isStale: true };
  }

  // Resolve by canonical role, not by raw key spelling — stack_power vs
  // rack_power vs any future firmware naming all land on the same role.
  // Request order (BESS_RT_KEYS) decides preference when several keys respond.
  const battKw =
    pickMetricValue(values, "bank.power") ?? pickMetricValue(values, "pcs.activePower");
  const gridKw = pickMetricValue(values, "site.gridPower");
  // Load = grid import + battery discharge (stack_power sign: + discharge, − charge).
  // Only derivable when both inputs are present.
  const loadKw =
    gridKw != null && battKw != null ? Math.max(0, gridKw + battKw) : null;

  return {
    battKw,
    gridKw,
    loadKw,
    soc:               pickMetricValue(values, "bank.soc"),
    soh:               pickMetricValue(values, "bank.soh"),
    tempC:             pickMetricValue(values, "bank.cellTempAvg"),
    maxCellTempC:      pickMetricValue(values, "bank.cellTempMax"),
    /* PV comes from `/api/solis/status`, not from the telemetry snapshot —
       the northbound profile says as much where it declares site.solarPower
       unmapped. `pickMetricValue` therefore could never return anything for
       it, and every screen reading this hook has drawn the Solar PV node as
       offline over a producing array. The profile lookup is kept as the first
       source so a gateway that DOES publish PV in its snapshot still wins. */
    solarKw:           pickMetricValue(values, "site.solarPower") ?? solisKw,
    gridHz:            pickMetricValue(values, "pcs.frequency"),
    voltDC:            pickMetricValue(values, "bank.voltage"),
    currA:             pickMetricValue(values, "bank.current"),
    chargedKwh:        pickMetricValue(values, "bank.todayChargeKwh"),
    dischargedKwh:     pickMetricValue(values, "bank.todayDischargeKwh"),
    totalChargedKwh:   pickMetricValue(values, "bank.lifetimeChargeKwh"),
    totalDischargedKwh:pickMetricValue(values, "bank.lifetimeDischargeKwh"),
    isLoading,
    isLive,
    lastTs,
    isStale,
  };
}
