"use client";

/**
 * The data layer for the gateway-backed mobile app.
 *
 * This is the one file that differs in substance from mobile-app/. The screens
 * are the same design system; what changed is where the numbers come from.
 * Instead of UGX station telemetry it reads the NorthBound gateway's 63-signal
 * fast historian — one-second PCS and BMS values, direct from the plant.
 *
 * Three rules carried over from the UGX app, because they matter more here not
 * less: a value the gateway did not return is null and renders as a dash; a
 * reading older than the staleness window is withheld rather than shown; and
 * no figure on any screen is computed from anything except a signal that was
 * actually read.
 */

import { useEffect, useMemo, useRef } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  getLatest, getSeries, getAlarms, getHealth, getLoggerStatus, getSources,
  getSiteTelemetry, getAuthMe, getStorageStatus, getFastBessProfile, getAssets,
  getServerUploadStatus, getRuntimeConfig, getSocProtection,
  getAiAvailable, getAiCapabilities, interpretQuestion, explainSignal, requestAdvice,
  getSolis,
  type SiteTelemetry, type SolisStatus,
  isAlarmState,
} from "./gateway/client";
import { SIGNALS, colKey, isFaultBit, type SignalDef } from "./gateway/signals";
import { explainLocally, derivedExplanation } from "./gateway/explanations";
import { computeFindings } from "./gateway/findings";
import type { AlarmExplanation, Advice, Evidence } from "./gateway/aiTypes";
import {
  FIRE_COMMS, FIRE_ALARM, FIRE_FAULT, FIRE_DETECTORS, FIRE_FAULTS, FIRE_MODULES,
  decodeFire, isFireActive, type FireSignal,
} from "./gateway/fire";
import { signalValue } from "./gateway/rows";
import type { FastBessRow, GatewayMode } from "./gateway/types";
import { useGatewaySelection } from "./gateway/GatewayContext";
import { useSiteSelection } from "./gateway/SiteContext";
import { paced, timed } from "./gateway/pace";

/** Latest values are polled at 5 s; the logger writes at 1 s.

    A floor now rather than a period: `paced` holds this cadence while the
    gateway can keep up and stretches it when it cannot. See gateway/pace.ts —
    this endpoint was measured taking 36 s to return a bare 401, against this
    5 s interval. */
const LATEST_MS = 5_000;
/** A sample older than this is not shown as current. */
const STALE_MS = 60_000;

/** The gateway's self-description — health, logger cadence, the source roster.
    Read by useGatewayHealth, useConnectivity and useFleet, which share these
    query keys and must therefore agree on the cadence. */
const HEALTH_MS = 30_000;

export interface LiveReading {
  row: FastBessRow | null;
  /** Signal lookup on the current row, PCS or BMS, null when absent. */
  get: (asset: "PCS" | "BMS", name: string) => number | null;
  ageMs: number | null;
  isStale: boolean;
  /** What the backend considers "now" — the capture playhead, or wall-clock. */
  nowMs: number;
  isLoading: boolean;
  error: string | null;
  mode: GatewayMode;
  note?: string;
}

export interface BessUnit {
  bessId: string;
  sourceId: string;
  /** A historian row exists for this unit right now. */
  reporting: boolean;
  /**
   * Whether bessId came from the gateway or was derived from the source id.
   *
   * Only a historian row states a unit's bess_id. For a source that is not
   * currently being logged there is no row, so the id is derived from the
   * naming the gateway uses — external_ems_N carries bess_N, the same mapping
   * the alarm decoder already relies on. Derived is not the same as known, so
   * it is flagged: callers that would filter rows by bess_id must not do so on
   * a guess, or a wrong guess silently returns an empty series.
   */
  bessIdConfirmed: boolean;
}

/**
 * Every unit at this site — not only the ones reporting this second.
 *
 * Built from /api/sources/summary, which lists what the gateway knows, with
 * /api/fast-bess/latest layered on to say which of them the one-second logger
 * is currently writing. It used to be built from `latest` alone, and that made
 * a unit disappear from the picker the moment it stopped being logged: a site
 * with two BESS presented as a site with one.
 *
 * A unit that is not reporting is still selectable, and deliberately so. The
 * historian holds ninety days; "offline right now" and "has no history" are
 * different facts, and the second does not follow from the first. Someone
 * whose site has just dropped is precisely the person who needs to look at the
 * last 24 hours.
 */
export function useBessIds(): BessUnit[] {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const latest = useQuery({
    queryKey: ["gw", siteId, "latest", "ids"],
    queryFn: getLatest,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
  const sources = useQuery({
    queryKey: ["gw", siteId, "sources"],
    queryFn: getSources,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  return useMemo(() => {
    const rows = latest.data?.data.rows ?? [];
    const bySource = new Map(rows.map((r) => [r.source_id, r]));

    const known = (sources.data?.data.sources ?? [])
      .map((x) => (x as { source_id?: string }).source_id)
      .filter((id): id is string => !!id);

    /* Sources first, so the site's own shape decides the order and a unit does
       not jump position when it stops being logged. Any source that reported a
       row without appearing in the summary is still included — the two lists
       disagreeing is not a reason to hide a unit that is demonstrably there. */
    const ids = [...new Set([...known, ...rows.map((r) => r.source_id)])];

    return ids.map((sourceId) => {
      const row = bySource.get(sourceId);
      return {
        sourceId,
        bessId: row?.bess_id ?? sourceId.replace(/^external_ems_/, "bess_"),
        reporting: !!row,
        bessIdConfirmed: !!row,
      };
    });
  }, [latest.data, sources.data]);
}

/**
 * The latest compact sample for a BESS — the selected one unless named.
 *
 * `forSourceId` exists so a screen can read a unit that is not the current
 * selection. Nothing about the request changes: /api/fast-bess/latest returns
 * a row for every source in one reply, and the query key is the same shared
 * one, so reading both units costs exactly what reading one costs. Only which
 * row is picked out of the reply differs.
 */
export function useLive(forSourceId?: string): LiveReading {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const { sourceId: selected } = useGatewaySelection();
  const sourceId = forSourceId ?? selected;
  const q = useQuery({
    queryKey: ["gw", siteId, "latest"],
    queryFn: timed("latest", getLatest),
    refetchInterval: paced("latest", LATEST_MS),
  });

  /* Matched on source, and never falling back to another unit's row.
     
     It used to end `?? rows[0]`, which was harmless while the picker only ever
     listed units that were reporting — the selected one always had a row. Now
     that a unit which is not being logged can be selected, that fallback would
     put BESS 1's state of charge and power on screen under the header of
     BESS 2. Silently, and with a "Live" indicator next to it. A unit with no
     current row has no current readings, and every figure downstream is
     already built to render null as a dash. */
  const row = useMemo(() => {
    const rows = q.data?.data.rows ?? [];
    return rows.find((r) => r.source_id === sourceId) ?? null;
  }, [q.data, sourceId]);

  /* Freshness is measured against the backend's clock, not the phone's. The
     reference capture reports its playhead; a live gateway does not, and
     wall-clock is correct there. */
  const nowMs = q.data?.nowMs ?? Date.now();
  const ageMs = row ? nowMs - row.timestamp_epoch_ms : null;

  return {
    row,
    nowMs,
    /* Through the same resolver History uses, for two reasons. The obvious one
       is that a gateway which flattens its columns on one endpoint may flatten
       them on another, and this build should read the value either way rather
       than depend on which endpoint it came from.

       The load-bearing one is that this line used to index into
       `row.pcs_values` unguarded. A row without that envelope did not degrade
       to a dash — it threw, and took every screen that reads a live value down
       with it. A missing signal has always been meant to render as "—"; that
       promise cannot be kept by code that crashes before it can render one. */
    get: (asset, name) => signalValue(row as unknown as Record<string, unknown>, asset, name),
    ageMs,
    isStale: ageMs != null && ageMs > STALE_MS,
    isLoading: q.isLoading,
    error: q.error ? String((q.error as Error).message) : null,
    mode: q.data?.mode ?? "live",
    note: q.data?.note,
  };
}

/* ── Connectivity ──────────────────────────────────────────────────────────
   One definition of "is this reading current", for every screen.

   The app had the ingredients and used none of them. `useLive` has computed
   `isStale` since the first commit; the dashboard never read it, so a reading
   78 minutes old was rendered under "State of charge" and "Charging" exactly
   as a reading one second old would be. The connection banner said the site
   was unreachable while the figures beside it still read as the present tense.
   In an EMS that is the worst available failure: an operator cannot tell a
   plant sitting idle from a plant nobody is hearing from, and those call for
   opposite responses.

   Nothing here invents a status the gateway could have told us. The gateway
   already publishes all three pieces:

     /api/sources/summary   `online` — "Communication state" per §7 of the API
                            Reference — and `last_seen_utc`.
     /api/fast-bess/status  `interval_seconds`, the logger's own declared
                            cadence, so the thresholds below are derived from
                            what this deployment actually does rather than
                            from a number someone picked.
     /api/fast-bess/latest  the row's `timestamp_epoch_ms`, which is when the
                            newest value we hold was actually taken.

   Where the gateway states `online`, that is the answer and this does not
   second-guess it. The age thresholds decide only what the gateway has not
   said. */

export type Freshness = "live" | "stale" | "offline" | "none";

/** Cadence to assume when the gateway has not stated one. §8: the logger is 1 s. */
const DEFAULT_INTERVAL_SEC = 1;
/* Multiples of the declared cadence, with floors so a slow-logging deployment
   does not get a threshold measured in milliseconds. At the documented 1 s
   cadence these come out at 60 s and 15 min. */
const STALE_INTERVALS = 60;
const OFFLINE_INTERVALS = 900;
const STALE_FLOOR_MS = 30_000;
const OFFLINE_FLOOR_MS = 5 * 60_000;

/** How recently the snapshot must have answered to count as evidence the
    gateway is reachable. Twice its own 15 s cadence, so one missed poll does
    not flip the banner back to a flat "Offline". */
const SNAPSHOT_TRUST_MS = 40_000;

export interface Connectivity {
  /** The one value a screen should branch on. */
  status: Freshness;
  /** True only when readings may be presented in the present tense. */
  isLive: boolean;
  /** Age of the newest reading held, ms. Null when none has ever arrived. */
  ageMs: number | null;
  /** When that reading was taken, epoch ms. */
  atMs: number | null;
  /** What the gateway says about the source. Null when it has not said. */
  deviceOnline: boolean | null;
  /** True when this app cannot currently reach the gateway at all. A separate
      fact from the device being offline, and the remedies differ. */
  unreachable: boolean;
  /**
   * True when the 1,422-signal snapshot answered recently, whatever the fast
   * profile is doing.
   *
   * These are two independent reads of one gateway and they fail
   * independently. Observed on the commissioned site, 3 September 2026: the
   * logger was alive at a 1 s cadence with a four-minute-old sample and zero
   * skips, /api/telemetry was answering, and /api/fast-bess/latest was
   * returning 502 through the proxy because the board could not answer inside
   * Cloudflare's 100 s origin timeout.
   *
   * The screen that resulted showed 3.3 kW and -1.3 kVar — genuinely current,
   * from the snapshot — beneath a banner reading "Offline · last data received
   * 5h ago". Both halves were true about their own feed and the banner claimed
   * the whole connection.
   */
  snapshotOk: boolean;
  /** The logger's declared cadence, seconds. */
  intervalSec: number;
  /** "Online" · "Data delayed" · "Offline" · "No data". */
  label: string;
  /** "Updated 12 sec ago" · "Last data received 78 min ago". */
  detail: string;
  tone: "good" | "warn" | "bad" | "idle";
  /** Prefix for a metric label: "" when live, "Last known " otherwise. */
  qualifier: string;
}

/** "12 sec ago", "8 min ago", "78 min ago", "3h ago". */
export function agoLabel(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 90) return `${sec} sec ago`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min} min ago`;
  const hr = Math.round(min / 60);
  return hr < 36 ? `${hr}h ago` : `${Math.round(hr / 24)}d ago`;
}

/** Freshness for a BESS — the selected one unless named. */
export function useConnectivity(forSourceId?: string): Connectivity {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const { sourceId: selected } = useGatewaySelection();
  const sourceId = forSourceId ?? selected;
  const live = useLive(sourceId);

  /* The gateway's own view of the source. Polled slowly: it is a summary, and
     the row timestamp below moves far faster than this does. */
  const summary = useQuery({
    queryKey: ["gw", siteId, "sources"],
    queryFn: timed("sources", getSources),
    /* Paced, like the observer in useGatewayHealth on this same key.
       React Query takes the SMALLEST refetchInterval across every observer of
       a key, so a single un-paced observer here silently pinned this query at
       30 s however slow the gateway got — which is exactly what a fixed 30_000
       did until this line. Every observer of a key has to agree, or the
       fastest one decides for all of them. */
    refetchInterval: paced("sources", HEALTH_MS),
    retry: 1,
  });

  /* Cadence is a deployment property, not a reading. */
  const logger = useQuery({
    queryKey: ["gw", siteId, "logger"],
    queryFn: timed("logger", getLoggerStatus),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  /* Whether the other feed is answering — observed, never fetched.
  
     `enabled: false` is the whole point: this subscribes to the cache entry
     useSite owns and re-renders when it changes, without adding a second
     poll of a 15 s endpoint to every screen that shows a status line. On a
     screen that never mounts useSite the entry stays pending, snapshotOk is
     false, and this behaves exactly as it did before. */
  const snapshot = useQuery({
    queryKey: siteQueryKey(siteId, sourceId),
    queryFn: () => getSiteTelemetry(sourceId),
    enabled: false,
  });

  /* Recent, not merely successful. A snapshot that arrived an hour ago and has
     failed every poll since is not evidence that the gateway is reachable now,
     and treating it as such would substitute one over-claim for another. */
  /* Evaluated per render rather than on a timer, so it can lag its own
     threshold by up to one render. That is harmless here: this hook already
     re-renders every LATEST_MS as the live query polls, which is well inside
     SNAPSHOT_TRUST_MS, and the direction of the lag is to keep claiming the
     gateway is reachable a few seconds after it stopped being — never the
     reverse. */
  const snapshotOk =
    snapshot.isSuccess &&
    snapshot.dataUpdatedAt > 0 &&
    Date.now() - snapshot.dataUpdatedAt < SNAPSHOT_TRUST_MS;

  return useMemo<Connectivity>(
    () =>
      freshnessOf({
        source: findSource(summary.data?.data.sources, sourceId),
        intervalSec: loggerInterval(logger.data?.data.interval_seconds),
        rowMs: live.row?.timestamp_epoch_ms ?? null,
        nowMs: live.nowMs,
        unreachable: live.error != null,
        snapshotOk,
      }),
    [summary.data, logger.data, live.row, live.nowMs, live.error, sourceId, snapshotOk],
  );
}

/** The gateway's row for one source, or undefined when it has not named it. */
function findSource(sources: unknown[] | undefined, sourceId: string) {
  return (sources ?? []).find(
    (x) => (x as { source_id?: string }).source_id === sourceId,
  ) as { online?: boolean | null; last_seen_utc?: string | null } | undefined;
}

/** Whether the gateway itself says this unit is down — as opposed to the app
    inferring it from an ageing reading. Used before `declaredDown` is in
    scope, and it is the same test. */
function declaredDownEarly(src: { online?: boolean | null } | undefined): boolean {
  return src?.online === false;
}

/** The logger's declared cadence, or the documented default. */
function loggerInterval(iv: unknown): number {
  return typeof iv === "number" && iv > 0 ? iv : DEFAULT_INTERVAL_SEC;
}

/**
 * Freshness, as a pure function of the four facts it is decided from.
 *
 * Split out of useConnectivity for the same reason readingsOf was split out of
 * useReadings: the comparison screen has to answer "is this current?" for a
 * unit that is not selected, and there must not be two answers to that in this
 * file. Every threshold, label and sentence below is the one the status line
 * at the top of every screen already uses.
 */
function freshnessOf({
  source: src, intervalSec, rowMs, nowMs, unreachable, snapshotOk = false,
}: {
  source: { online?: boolean | null; last_seen_utc?: string | null } | undefined;
  intervalSec: number;
  rowMs: number | null;
  nowMs: number;
  unreachable: boolean;
  /** The other feed answered recently. See Connectivity.snapshotOk. */
  snapshotOk?: boolean;
}): Connectivity {
  const deviceOnline = typeof src?.online === "boolean" ? src.online : null;

  const staleAfterMs = Math.max(STALE_FLOOR_MS, intervalSec * STALE_INTERVALS * 1000);
  const offlineAfterMs = Math.max(OFFLINE_FLOOR_MS, intervalSec * OFFLINE_INTERVALS * 1000);

  /* The newest instant we can actually point at. The row wins where there is
     one; last_seen_utc covers the case where the logger has no row for this
     source but the gateway still heard from it. */
  const seenMs = src?.last_seen_utc ? Date.parse(src.last_seen_utc) : NaN;
  const takenMs = rowMs ?? NaN;
  const atMs = Number.isFinite(takenMs)
    ? Number.isFinite(seenMs) ? Math.max(takenMs, seenMs) : takenMs
    : Number.isFinite(seenMs) ? seenMs : null;

  /* Measured against the backend's clock — the capture reports a playhead,
     and measuring its August samples against today would call every one of
     them stale. */
  const ageMs = atMs == null ? null : Math.max(0, nowMs - atMs);

  let status: Freshness;
  if (atMs == null) status = "none";
  else if (deviceOnline === false) status = "offline";
  else if (ageMs != null && ageMs > offlineAfterMs) status = "offline";
  else if (ageMs != null && ageMs > staleAfterMs) status = "stale";
  else status = "live";

  /* The gateway is answering; it is the fast profile that is behind.
  
     This is a claim about which feed failed, and it is only made when the app
     has positive evidence for it — a snapshot inside SNAPSHOT_TRUST_MS. A
     unit the gateway has explicitly declared down is excluded: that is an
     observation about the plant, and no amount of working telemetry softens
     it. */
  const feedBehind =
    snapshotOk && !declaredDownEarly(src) && (status === "offline" || status === "stale");

  const label =
    status === "live" ? "Online"
    /* Not "Offline". The app is talking to the gateway and the reader can see
       current figures on the same screen; the thing that is behind is the
       one-second feed those figures do not come from. */
    : feedBehind ? "Live feed delayed"
    : status === "stale" ? "Data delayed"
    : status === "offline" ? "Offline"
    : "No data";

  /* Two ways to be offline, and they are not the same sentence. The gateway
     declaring the source down is a fact it observed; a reading simply having
     aged out is an inference this app made. Saying "last data received 0 sec
     ago" under an Offline heading — which is what the first case produced —
     reads as a contradiction rather than as the two facts it is. */
  const declaredDown = status === "offline" && deviceOnline === false;
  const detail =
    status === "none"
      ? unreachable ? "No readings have arrived" : "Waiting for the first reading"
      : status === "live" ? `Updated ${agoLabel(ageMs!)}`
      /* Names both halves, because both are on screen. Without the second
         clause a reader is told their data is hours old while looking at a
         figure that is seconds old, and has no way to tell which to believe. */
      : feedBehind ? `Live feed ${agoLabel(ageMs!)} · site figures are current`
      : status === "stale" ? `Last updated ${agoLabel(ageMs!)}`
      : declaredDown
        ? `Gateway reports this unit offline · last data ${agoLabel(ageMs!)}`
        : `Last data received ${agoLabel(ageMs!)}`;

  return {
    status,
    isLive: status === "live",
    ageMs,
    atMs,
    deviceOnline,
    unreachable,
    intervalSec,
    label,
    detail,
    snapshotOk,
    /* Warn, not bad, when only the feed is behind. Red is for "you cannot see
       your plant"; this is "part of what you can see is late", and spending
       the alarm colour on it is how a banner stops being read. */
    tone: status === "live" ? "good"
      : feedBehind ? "warn"
      : status === "stale" ? "warn"
      : status === "offline" ? "bad"
      : "idle",
    /* Every metric label on every screen runs through this, so "Live" cannot
       survive on a screen whose data is an hour old. */
    qualifier: status === "live" ? "" : "Last known ",
  };
}

/** A signal lookup on one row. The only input the readings below have. */
type SignalGetter = (asset: "PCS" | "BMS", name: string) => number | null;

/**
 * Canonical readings, named the way the screens want them, as a pure function
 * of a row's signal lookup.
 *
 * One deliberate substitution: battery power reads `total_active_power`, not
 * `charge_discharge_power`. Across the 20-hour reference capture the latter
 * held 0.0 for every one of 70,646 samples while SOC fell from 74.7% to 53.2%
 * and total_active_power swung between -44.7 and +24.5 kW. Modbus 192 is not
 * returning real data on this firmware. Using it would render a permanently
 * idle battery.
 *
 * Split out of useReadings so the fleet view can derive the same figures for a
 * unit that is not the current selection without restating any of them. There
 * is one definition of what "power" reads on this gateway, and both the
 * single-unit screens and the comparison read it from here — a second copy
 * would be a place for the two to quietly disagree.
 */
function readingsOf(g: SignalGetter) {
  const socPcs = g("PCS", "soc");
  const socBms = g("BMS", "display_soc");
  const tMax = g("BMS", "battery_max_temperature");
  const tMin = g("BMS", "battery_min_temperature");

  return {
    /** BMS display SOC is the operational value; PCS SOC is the cross-check. */
    soc: socBms ?? socPcs,
    socPcs,
    socDisagreement: socBms != null && socPcs != null ? Math.abs(socBms - socPcs) : null,
    /** Positive = discharging, negative = charging. */
    powerKw: g("PCS", "total_active_power"),
    /** Kept visible precisely because it is suspected dead. */
    powerKwReported: g("PCS", "charge_discharge_power"),
    soh: g("BMS", "soh"),
    dcVoltage: g("PCS", "dc_voltage"),
    dcCurrent: g("PCS", "dc_current"),
    gridHz: g("PCS", "grid_frequency"),
    clusterV: g("BMS", "cluster_total_voltage_collected"),
    clusterA: g("BMS", "cluster_total_current"),
    cellMaxMv: g("BMS", "cell_max_voltage"),
    cellMinMv: g("BMS", "cell_min_voltage"),
    cellSpreadMv: g("BMS", "max_min_cell_voltage_diff"),
    tempAvg: g("BMS", "average_temperature"),
    tempMax: tMax,
    tempMin: tMin,
    tempSpread: tMax != null && tMin != null ? tMax - tMin : null,
    insulationKohm: g("BMS", "insulation_resistance"),
    onGrid: g("PCS", "on_grid_status"),
    offGrid: g("PCS", "off_grid_status"),
    pcsOnline: g("PCS", "pcs_online_status"),
    bmsOnline: g("PCS", "bms_online_status"),
    chargeState: g("BMS", "charge_discharge_status"),
    phaseV: [g("PCS", "phase_a_voltage"), g("PCS", "phase_b_voltage"), g("PCS", "phase_c_voltage")] as const,
    phaseA: [g("PCS", "phase_a_current"), g("PCS", "phase_b_current"), g("PCS", "phase_c_current")] as const,
  };
}

export function useReadings(forSourceId?: string) {
  const live = useLive(forSourceId);
  return { ...live, ...readingsOf(live.get) };
}

export type Readings = ReturnType<typeof useReadings>;

/** Every one of the 63 signals on the current sample, with its definition. */
export function useAllSignals(): { def: SignalDef; value: number | null }[] {
  const live = useLive();
  return useMemo(
    () => SIGNALS.map((def) => ({ def, value: live.get(def.asset, def.name) })),
    [live.row], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

export interface CurveSample {
  t: number;
  powerKw: number | null;
  soc: number | null;
  tempMax: number | null;
  cellSpreadMv: number | null;
  /**
   * Energy in and out over this bucket, kWh.
   *
   * Not nullable, and not derived from `powerKw`. The server integrates raw
   * row pairs and reports the result per bucket, so a bucket that held rows
   * and moved nothing reads 0 — a real measurement — while a bucket with no
   * rows is absent from the series entirely and never reaches here.
   *
   * Never multiply `powerKw` by the bucket width to get these. The plotted
   * value is a mean and the plant spikes between samples; that is the whole
   * reason these travel separately.
   */
  chargedKwh: number;
  dischargedKwh: number;
}

/**
 * Thin a series for plotting without touching the series itself.
 *
 * A 24-hour window is ~5,800 points per BESS at 15 s and 86,400 at 1 s.
 * Recharts will render either, slowly, onto a phone that cannot resolve more
 * than a few hundred pixels of x-axis. Decimation is presentation only —
 * energy integration and the min/max summaries always run over every sample,
 * because dropping points changes those numbers and must not.
 */
export function decimate<T>(rows: T[], max = 900): T[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  return rows.filter((_, i) => i % step === 0);
}

/**
 * A window of history for the selected BESS.
 *
 * Reads /api/gw/history-series, which aggregates on the server. Nothing here
 * pages the gateway, decodes a historian row or integrates energy any more —
 * all three moved to gateway/series.ts, and the reasons are worth keeping in
 * front of whoever changes this next:
 *
 *  - The rows cost 8.7 MB an hour for four figures, and any interruption in
 *    the 33 s they took discarded every one of them.
 *  - The page budget was sized from `(minutes*60)/15*2` — a guess that the
 *    data is 15-second and that both BESS come back. Live data is one-second
 *    and filtered to one BESS, so the guess was 15x short: a six-hour window
 *    bought 10,000 rows, drew 2 h 16 m of them, and labelled the result "6h".
 *    Coverage is now measured and reported, never inferred from a row count.
 *  - A `?? 0` at the chart turned "no value" into "measured zero", which drew
 *    a flat line across a cycling plant. Whatever made those values absent —
 *    and the API Reference says the envelope this build reads is the right
 *    one, so the shape theory was wrong — the rendering must never again make
 *    an absent reading indistinguishable from a measured one.
 *
 * What arrives is bucketed for the chart and totalled over every raw row, so
 * the summary figures are exact even though the line is a mean.
 */
export interface HistoryWindow {
  /** Bucketed series for plotting. A null value is a gap, never a zero. */
  samples: CurveSample[];
  /** Integrated over every raw row on the server, not over `samples`. */
  totals: {
    charged: number; discharged: number; throughput: number;
    ratioPct: number | null;
    peakKw: number | null;
    socMin: number | null; socMax: number | null;
    tempMax: number | null;
    rows: number; skippedMs: number;
  };
  /** Width of one plotted point, ms. The line is a mean over this. */
  bucketMs: number;
  /** The gateway's own sampling interval, when it states one. */
  resolutionSec: number | null;
  /** What the window actually contains, as opposed to what was asked for. */
  coverage: {
    complete: boolean;
    ready: number; total: number;
    coveredMs: number; windowMs: number;
    /** Stretches with no data yet. Empty once complete. */
    gaps: [number, number][];
  };
  /** True while the server is still filling this window in the background. */
  isFilling: boolean;
  /** Rows the gateway sent that this build could not decode, and their keys. */
  undecodable: number;
  observedKeys: string[] | null;
  burstWindow: [number, number] | null;
  requested: [number, number];
  isLoading: boolean;
  error: string | null;
  mode: GatewayMode;
}

const EMPTY_TOTALS = {
  charged: 0, discharged: 0, throughput: 0, ratioPct: null,
  peakKw: null, socMin: null, socMax: null, tempMax: null,
  rows: 0, skippedMs: 0,
} satisfies HistoryWindow["totals"];

/* How many polls without new coverage before the client stops asking. The
   server fills a bounded slice per request and returns immediately, so the
   normal case is a handful of quick rounds; this only exists so a chunk that
   fails every time cannot turn into an endless poll. */
const FILL_STALL_LIMIT = 3;

/**
 * A window of history — for the selected unit, or for one named explicitly.
 *
 * `forUnit` takes the whole BessUnit rather than a source id, because filtering
 * historian rows needs all three of its fields: the source, the bess id, and
 * whether that bess id was stated by the gateway or derived. Passing the id
 * alone would force this to re-derive the third, and a wrong guess there does
 * not error — it returns an empty series under a unit that has ninety days of
 * history.
 */
export function useHistory(
  spanMinutes: number,
  forUnit?: BessUnit,
  /**
   * An explicit window, for a question that names one.
   *
   * The span arguments describe a period ending now, which is what every
   * screen wanted until the History search box could be handed "SOC on 25
   * August" — a window that ends in the past and cannot be expressed as
   * minutes-ago. When present this replaces the derived edges entirely;
   * `spanMinutes` still sizes the bucket, so pass the window's own width.
   */
  absolute?: { from: number; to: number },
): HistoryWindow {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const selected = useGatewaySelection();
  const { bessId, sourceId, bessIdConfirmed } = forUnit ?? selected;

  /* Filter by bess id only where the gateway has actually stated one. For a
     unit that is not being logged the id is derived from the source id, and
     filtering historian rows against a guess turns "the guess was wrong" into
     "this unit has no history" — the same class of silent-empty-result this
     screen has already been burned by once. The source filter is exact and is
     always applied; within one source there is one BESS. */
  const filterBess = bessIdConfirmed ? bessId : "";

  /* Anchored to the clock the latest sample came from, read out of the query
     cache rather than fetched again. Anchoring to Date.now() would ask the
     reference capture for a window ten days after its last row. */
  const anchor = useQuery({ queryKey: ["gw", siteId, "latest"], queryFn: getLatest, staleTime: LATEST_MS });
  const nowMs = anchor.data?.nowMs ?? Date.now();

  /* The window end is rounded into a bucket so the query key holds still
     between renders. It used to need to be five minutes wide, because the key
     had to outlive a fetch that took several sequential 20 s round trips —
     anything shorter expired mid-flight and the chart never resolved.

     A request now returns in seconds whatever the span, and the server's cache
     is keyed by epoch-aligned chunks rather than by this window, so a rotating
     right edge re-uses everything already fetched. The bucket is back to being
     what it should always have been: short enough that the chart's right edge
     is current. */
  const bucketMs = spanMinutes <= 60 ? 30_000 : 60_000;
  const to = absolute ? absolute.to : Math.floor(nowMs / bucketMs) * bucketMs;
  const from = absolute ? absolute.from : to - spanMinutes * 60_000;

  /* Identifies WHICH question this window answers, as opposed to how wide it
     is. Empty for the span buttons, whose right edge rotates with the clock.
     placeholderData below distinguishes the two cases with it: a rotating edge
     must keep the previous curve on screen, and a different named window must
     not — and neither `to` nor `from` can tell those apart, because both move
     in both cases. */
  const askKey = absolute ? `${absolute.from}-${absolute.to}` : "";

  const stall = useRef({ covered: -1, misses: 0 });
  useEffect(() => {
    stall.current = { covered: -1, misses: 0 };
  }, [spanMinutes, sourceId, filterBess, askKey]);

  const q = useQuery({
    /* askKey is appended rather than inserted: placeholderData below reads
       positions 3 and 5 of this array by index, and the comment there records
       what it cost to discover that the hard way. */
    queryKey: ["gw", siteId, "series", sourceId, filterBess, spanMinutes, to, askKey],
    queryFn: () =>
      getSeries({ sourceId, bessId: filterBess, fromEpochMs: from, toEpochMs: to, points: 720, nowMs }),
    staleTime: 20_000,
    /* Not gated on the anchor at all.
    
       The anchor is /api/fast-bess/latest, and it is here for exactly one
       reason: the reference capture reports a playhead and a window has to be
       measured against it. A live gateway sends none, and wall-clock is
       correct there — which is the fallback one line above.
    
       Gating on it meant History could not so much as ask while the live call
       was failing. With the gateway unreachable that call fails forever, so
       the one screen that could still have answered — the server holds these
       chunks and was returning them — sat on a spinner. History is not a view
       of the present and must not wait on one.
    
       The cost is one wasted request in capture mode if the playhead lands
       after the first fetch. That is a local disk read. */
    enabled: !!sourceId,
    /* Hold the previous answer across a bucket rotation so the chart does not
       blank between one right edge and the next.
    
       Never across a change of span, and never across a change of unit. Both
       are the user asking a different question, and answering with the old one
       draws a real series under a label it does not belong to — with nothing
       on screen to contradict it, because the data is genuine, just not this
       unit's and not this range's.
    
       The unit half of that was missing: this checked the span alone, so
       selecting BESS 2 kept BESS 1's curve under BESS 2's header. On History a
       span change hid it; on Home, where the span never changes, it simply
       stayed, and both units appeared to have the same graph.
    
       Key is ["gw", siteId, "series", sourceId, bessId, spanMinutes, to] — 3
       and 5. These are positions in that array, so adding the site at index 1
       moved both. A wrong index here fails silently — it just stops matching —
       which is exactly how the unit half of this went unnoticed the first
       time. */
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey?.[3] === sourceId &&
      prevQuery?.queryKey?.[5] === spanMinutes &&
      prevQuery?.queryKey?.[7] === askKey
        ? prev
        : undefined,
    /* Poll while the window is still filling, then settle to the live edge.
       Each poll costs the server one bounded slice of gateway work and returns
       whatever coverage exists, so the chart grows instead of hanging. */
    refetchInterval: (query) => {
      const c = query.state.data?.data.coverage;
      if (!c) return false;
      if (c.complete) return 30_000;
      return stall.current.misses >= FILL_STALL_LIMIT ? false : 1_500;
    },
  });

  const data = q.data?.data;

  useEffect(() => {
    const c = data?.coverage;
    if (!c) return;
    if (c.covered_ms > stall.current.covered) {
      stall.current = { covered: c.covered_ms, misses: 0 };
    } else if (!c.complete) {
      stall.current.misses += 1;
    }
  }, [data]);

  const samples = useMemo<CurveSample[]>(
    () =>
      (data?.points ?? []).map(([t, p, , , soc, tempMax, cellSpreadMv, chg, dis]) => ({
        t,
        powerKw: p,
        soc,
        tempMax,
        cellSpreadMv,
        /* A series cached before these two fields existed rehydrates from
           localStorage without them. Undefined would reach the bars as NaN and
           draw nothing, so they fall back to zero — the same value the bucket
           would have carried had it genuinely moved no energy, and the cache
           is replaced by the next poll regardless. */
        chargedKwh: chg ?? 0,
        dischargedKwh: dis ?? 0,
      })),
    [data],
  );

  const totals = useMemo<HistoryWindow["totals"]>(() => {
    const t = data?.totals;
    if (!t) return EMPTY_TOTALS;
    return {
      charged: t.charged_kwh,
      discharged: t.discharged_kwh,
      throughput: t.throughput_kwh,
      ratioPct: t.ratio_pct,
      peakKw: t.peak_abs_kw,
      socMin: t.soc_min,
      socMax: t.soc_max,
      tempMax: t.temp_max,
      rows: t.rows,
      skippedMs: t.skipped_ms,
    };
  }, [data]);

  const coverage = data?.coverage;

  /* Only a failure with nothing to show. React Query keeps the last successful
     result on error and this app persists its cache to storage, so a window
     read before the gateway went away is still on screen and still true — the
     connection banner above already says it cannot be refreshed. Replacing
     real history with an error box because the *next* poll failed would throw
     away the only thing the user came to look at. */
  const failure = data
    ? null
    : q.error
      ? String((q.error as Error).message)
      : anchor.error
        ? String((anchor.error as Error).message)
        : null;

  return {
    samples,
    totals,
    bucketMs: data?.bucket_ms ?? 0,
    resolutionSec: data?.resolution_sec ?? null,
    coverage: {
      complete: coverage?.complete ?? false,
      ready: coverage?.ready ?? 0,
      total: coverage?.total ?? 0,
      coveredMs: coverage?.covered_ms ?? 0,
      windowMs: coverage?.window_ms ?? Math.max(0, to - from),
      gaps: coverage?.gaps ?? [],
    },
    isFilling: !!coverage && !coverage.complete,
    undecodable: data?.undecodable ?? 0,
    observedKeys: data?.observed_keys ?? null,
    burstWindow: data?.burst_window ?? null,
    requested: [from, to],
    /* An error anywhere in the pair ends the loading state. Both queries poll,
       and a query that has never succeeded stays pending across every retry —
       so with the gateway down `isLoading` flickered true forever and the
       screen sat on a shimmer captioned "Loading" instead of saying it could
       not reach anything. A spinner that never resolves is a worse answer than
       an error, because it invites waiting. */
    /* The anchor is deliberately absent here too. History is loading when the
       history query is loading; a failing live poll is not this screen's
       business and must not hold it on a spinner. */
    isLoading: q.isLoading && !failure,
    error: failure,
    mode: data?.mode ?? ("live" as GatewayMode),
  };
}

/* Site telemetry refreshes slower than the battery. These are metering and
   configuration figures — a grid meter integrates over its own window and the
   available-power limits change with temperature and SOC, not per second — so
   polling them at the battery's cadence would multiply gateway load for
   numbers that do not move. */
const SITE_MS = 15_000;

/**
 * Everything on the dashboard that is not the battery itself.
 *
 * Sourced from /api/telemetry, which carries the gateway's full 1,422-signal
 * cached snapshot rather than the 63-signal fast profile the rest of this file
 * reads. Grid metering, site load, available power and the cumulative energy
 * counters exist only here.
 *
 * Every field is nullable and every null means the gateway did not report it.
 * Nothing in here is derived from a plausible-looking constant: `savingsInr`
 * stays null until a tariff is configured, because the gateway prices nothing.
 *
 * `solarKw` is null too, but for a narrower reason than this comment used to
 * give — the dictionary has no solar signal, yet the gateway does have a PV
 * inverter behind a separate endpoint. See the field's own note below.
 */
export function useSite(forSourceId?: string) {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const { sourceId: selected } = useGatewaySelection();
  const sourceId = forSourceId ?? selected;
  const q = useQuery({
    queryKey: siteQueryKey(siteId, sourceId),
    queryFn: timed("telemetry", () => getSiteTelemetry(sourceId)),
    refetchInterval: paced("telemetry", SITE_MS),
    enabled: !!sourceId,
  });

  return useMemo(() => siteOf(q.data?.data), [q.data]);
}

/** One key, used by useSite and by the fleet's parallel fetch of every unit. */
const siteQueryKey = (siteId: string, sourceId: string) =>
  ["gw", siteId, "telemetry", sourceId] as const;

/**
 * The site figures, as a pure function of one /api/telemetry snapshot.
 *
 * Per source, not per plant, and that is the endpoint's own shape: the meter
 * behind external_ems_1 is external_ems_1_grid_meter. So on a two-BESS site
 * these are two readings of two meters, and the comparison screen presents
 * them as such rather than summing them into a site total that no instrument
 * measured.
 */
function siteOf(t: SiteTelemetry | undefined) {
  /* The lookup is built here rather than returned by the query, because the
     query cache is persisted to localStorage and a function does not survive
     JSON. */
  const g = (a: string, sig: string) => t?.signals?.[a]?.[sig] ?? null;

  /**
   * Whether the utility meter is answering the gateway.
   *
   * `communication_status` is 0,Offline;1,Online per the Data Dictionary, and
   * on the commissioned site it reads 0 — every one of the meter's 69 signals
   * is therefore zero, including active power, frequency, power factor and
   * both energy counters.
   *
   * That mattered because zero is a legitimate reading here. An idle plant
   * really can import 0.0 kW, so nothing downstream could tell a quiet grid
   * from an absent meter, and the dashboard rendered "0.0 kW · Importing"
   * while the battery beside it charged at 58.4 kW — power that has to come
   * from somewhere. A measured zero asserted over an unmeasured one is exactly
   * the failure this build refuses everywhere else.
   *
   * So the meter's readings are gated on it. Null, not zero: every consumer
   * already renders null as a dash, and a dash is the honest rendering of a
   * quantity nobody measured.
   *
   * Only the meter's own signals. ems_system is a separate device that has no
   * communication_status of its own and is demonstrably reporting — its `soc`
   * tracks the BMS — so its zeros are real and are left alone.
   */
  const gridReporting = g("utility_meter", "communication_status") === 1;
  const meter = (sig: string) => (gridReporting ? g("utility_meter", sig) : null);

  const importedKwh = meter("forward_total_active_energy");
  const exportedKwh = meter("reverse_total_active_energy");

  return {
    ready: !!t,
    assets: t?.assets ?? [],

    /** False when the utility meter is not communicating, in which case every
        grid figure below is null rather than the zero the gateway sends. */
    gridReporting,

    /** Grid meter active power. Sign is the meter's own convention: positive
        is import from the utility, negative is export to it. */
    gridKw: meter("total_active_power"),
    gridHz: meter("frequency"),
    gridPf: meter("total_power_factor"),
    importedKwh,
    exportedKwh,

    /** Site load as the EMS computes it, not a derived difference. */
    loadKw: g("ems_system", "load_power"),
    demandKw: g("ems_system", "demand"),

    /** What the EMS says the string can take or give right now — the
        headroom figure, which is not the same as a nameplate rating. */
    availChargeKw: g("ems_system", "total_available_charge_power"),
    availDischargeKw: g("ems_system", "total_available_discharge_power"),
    emsSoc: g("ems_system", "soc"),

    /** Cumulative counters, kWh. Monthly resets; yearly does not. */
    chargedKwhMonth: g("bms_1", "monthly_cumulative_charge_energy"),
    dischargedKwhMonth: g("bms_1", "monthly_cumulative_discharge_energy"),
    chargedKwhYear: g("bms_1", "yearly_cumulative_charge_energy"),
    dischargedKwhYear: g("bms_1", "yearly_cumulative_discharge_energy"),

    /** Lifetime AC-side throughput, as metered by the inverter itself. The
        System screen used to say this build had no energy figures at all; it
        has these, and they are the plant's own counters rather than anything
        integrated on the phone. */
    acChargedKwhTotal: g("pcs_1", "ac_cumulative_charge_energy"),
    acDischargedKwhTotal: g("pcs_1", "ac_cumulative_discharge_energy"),

    /** Liquid cooling, the asset the Thermal tab names and never read.
     *
     *  The tab claimed asset `liquid_cooling` and then rendered four BMS cell
     *  temperatures — so on a site with cooling it showed the battery instead,
     *  and on a site without it showed the battery *and* an apology. The real
     *  asset carries 113 signals here; these are the ones that answer "is the
     *  cooling working".
     *
     *  `coolantDeltaP` is deliberately absent: the gateway's own
     *  inlet_outlet_water_pressure_diff decodes negatives as unsigned and
     *  returns ~6553 (see the findings sent to the gateway team), so it is
     *  computed from the two pressures here rather than read. */
    coolantInC: g("liquid_cooling", "inlet_water_temperature"),
    coolantOutC: g("liquid_cooling", "outlet_water_temperature"),
    coolantInBar: g("liquid_cooling", "inlet_water_pressure"),
    coolantOutBar: g("liquid_cooling", "outlet_water_pressure"),
    outdoorC: g("liquid_cooling", "outdoor_temperature"),
    coolingSetC: g("liquid_cooling", "cooling_set_temperature"),
    heatingSetC: g("liquid_cooling", "heating_set_temperature"),
    coolingOn: g("liquid_cooling", "power_on_off"),

    /**
     * The inverter's AC power, split into what it does work with and what it
     * only circulates.
     *
     * Active is also on the fast profile as `total_active_power`, which is
     * what every power figure in this app reads. It is repeated here so that
     * a screen showing active beside reactive shows two figures the gateway
     * measured in the same snapshot, rather than one from a 5 s poll and one
     * from a 15 s poll that describe different instants.
     *
     * **Apparent power is deliberately absent.** `pcs_1.total_apparent_power`
     * is published and cannot be believed: sampled against the commissioned
     * gateway on 3 September 2026 it read 8.2 kVA against 13.9 kW of active
     * power, which is impossible — apparent power is never smaller than
     * active — and elsewhere it read 25.6 kVA where sqrt(P^2 + Q^2) is 5.1.
     * `total_power_factor` does not reconcile with P and Q either. Both are
     * left out rather than printed for a reader to disprove with a square
     * root. See docs/gateway-findings-2026-09-03.md.
     */
    pcsActiveKw: g("pcs_1", "total_active_power"),
    pcsReactiveKvar: g("pcs_1", "total_reactive_power"),

    /** The inverter's nameplate, kW.
        Absent from the 63-signal fast profile but present on this snapshot,
        which is why ControlScreen was bounding its slider with a made-up
        number. Nullable: a deployment that does not report it gets the stated
        fallback rather than a guess dressed as a reading. */
    ratedPowerKw: g("pcs_1", "rated_power"),

    /** No tariff reaches this gateway, so a rupee figure cannot be computed
        from it. Left null rather than estimated — a savings number that is
        actually a guess is worse than no savings number. */
    savingsInr: null as number | null,

    /**
     * Still null, but no longer because the plant has no solar.
     *
     * This said "no solar anywhere in the gateway's 2,844 signals", which is
     * true of the signal dictionary and was mistaken for a fact about the
     * site. It is not one. The gateway also exposes `/api/solis/status`,
     * outside the dictionary and outside the Phase 1.6 inventory, and on
     * 3 September 2026 it answered a customer_admin token with a Solis PV
     * inverter online at 57.81 kW on /dev/ems_solis_rtu.
     *
     * So this site generates, and the app now shows it — on the dashboard's
     * flow row, from `useSolis` below.
     *
     * This field stays null regardless, because it is part of the telemetry
     * snapshot and the snapshot genuinely has no solar in it. Filling it from
     * the Solis endpoint would put a figure from a 30 s call into an object
     * every other field of which came from one 15 s read, and a caller could
     * not tell which. The one reader of PV power calls useSolis directly.
     *
     * One thing left open: being absent from the Phase 1.6 inventory, that
     * endpoint carries no documented exposure_class, and every other endpoint
     * this app surfaces was checked against one. It is shown on the product
     * owner's instruction; the audience question is with the gateway team.
     * See docs/gateway-findings-2026-09-03.md.
     */
    solarKw: null as number | null,
  };
}

/* ── Solar ─────────────────────────────────────────────────────────────────
   The PV inverter, read from /api/solis/status.

   Not part of useSite, though it is a site-level figure and looks like it
   belongs there. Three reasons, and the first is the one that matters: it is a
   separate endpoint, so folding it in would make every dashboard render wait
   on a 6.5 s call to draw figures that arrive in one. It also has its own
   failure mode — a deployment with no PV, or the reference capture, which has
   no equivalent and answers 503 — and useSite's contract is "the snapshot
   arrived", which cannot express that. And it polls at half the rate.

   Scoped by site like every other query here: the cache is persisted, and
   without the site in the key a reload would restore one plant's generation
   under another plant's name. */

/** Slower than the 15 s snapshot, because the endpoint itself is slow. */
const SOLIS_MS = 30_000;

const SOLIS_ABSENT: SolisStatus = {
  available: false, online: false, state: null,
  powerKw: null, decision: null, timestampUtc: null,
};

/**
 * Whether this site generates, and how much right now.
 *
 * `available` false is the normal answer for a plant with no PV and for the
 * reference capture, and callers must render it as an absence rather than as
 * an error — there is nothing wrong with a battery site that has no inverter.
 *
 * `powerKw` is null whenever the inverter is not answering, never zero. The
 * distinction is the same one the utility meter needed: 0.0 kW at night is a
 * measurement, and 0.0 kW from an unreachable device is not.
 */
export function useSolis(): SolisStatus & { isLoading: boolean } {
  const { siteId } = useSiteSelection();
  const q = useQuery({
    queryKey: ["gw", siteId, "solis"],
    queryFn: timed("solis", getSolis),
    refetchInterval: paced("solis", SOLIS_MS),
    /* One retry. getSolis already turns a failure into `available: false`, so
       there is nothing here for the default three attempts to rescue — and on
       a site with no PV they would be three slow requests every poll. */
    retry: 1,
  });
  return { ...(q.data?.data ?? SOLIS_ABSENT), isLoading: q.isLoading };
}

/* ── Fire protection ───────────────────────────────────────────────────────
   Reads the same /api/telemetry snapshot useSite does, under the same query
   key, so this costs no request: the fire panel's signals are already in that
   reply and were simply never looked at. */

export interface FireRow {
  sig: FireSignal;
  value: number | null;
  /** Decoded word, or null when the gateway did not report the signal. */
  word: string | null;
  /** Whether this row is asserting something, by the signal's own rules. */
  active: boolean;
}

export interface FireSafety {
  /** False when the panel is not answering the gateway — see FIRE_COMMS. */
  reporting: boolean;
  /** True only once a snapshot has actually arrived. */
  ready: boolean;
  /** Present when the site reports no fire_protection asset at all. */
  absent: boolean;
  alarm: FireRow;
  fault: FireRow;
  detectors: FireRow[];
  faults: FireRow[];
  modules: FireRow[];
  /** Anything at all asserting: the one boolean a screen headline needs. */
  anyActive: boolean;
  /** The panel's temperature sensor, degC. */
  temperatureC: number | null;
}

export function useFireSafety(forSourceId?: string): FireSafety {
  const { siteId } = useSiteSelection();
  const { sourceId: selected } = useGatewaySelection();
  const sourceId = forSourceId ?? selected;

  const q = useQuery({
    queryKey: siteQueryKey(siteId, sourceId),
    queryFn: timed("telemetry", () => getSiteTelemetry(sourceId)),
    refetchInterval: paced("telemetry", SITE_MS),
    enabled: !!sourceId,
  });

  return useMemo(() => {
    const t = q.data?.data;
    const panel = t?.signals?.fire_protection;
    const g = (name: string) => panel?.[name] ?? null;

    const row = (sig: FireSignal): FireRow => {
      const value = g(sig.name);
      return { sig, value, word: decodeFire(sig, value), active: isFireActive(sig, value) };
    };

    const alarm = row(FIRE_ALARM);
    const fault = row(FIRE_FAULT);
    const detectors = FIRE_DETECTORS.map(row);
    const faults = FIRE_FAULTS.map(row);
    const modules = FIRE_MODULES.map(row);

    /* `absent` and `not reporting` are different facts with different
       remedies, and both differ again from "clear". A site with no panel
       commissioned should not be told its fire system is offline, and a panel
       that has stopped answering must never render as "no fire alarm". */
    const ready = !!t;
    const absent = ready && !panel;
    const reporting = !absent && g(FIRE_COMMS) === 1;

    return {
      ready,
      absent,
      reporting,
      alarm,
      fault,
      detectors,
      faults,
      modules,
      anyActive:
        reporting &&
        [alarm, fault, ...detectors, ...faults, ...modules].some((r) => r.active),
      temperatureC: g("temperature_value"),
    };
  }, [q.data]);
}

/* ── Every unit at once ────────────────────────────────────────────────────
   The single-unit hooks above answer for the selection. This answers for all
   of them, so a screen can put two BESS beside each other.

   It is not a second data path. The rows, the source summary and the logger
   cadence come from the same three shared queries the rest of the app already
   polls — /api/fast-bess/latest returns a row per source in one reply — so the
   comparison adds no request for the battery figures at all. Only the site
   snapshot is per source, because /api/telemetry is, and those are fetched in
   parallel under the same keys useSite would have used: opening a unit after
   comparing it reads a warm cache rather than refetching. */

/** One unit, with everything the comparison needs about it. */
export interface FleetUnit extends BessUnit {
  /** What a person reads: "BESS 1". */
  label: string;
  /** Whether this is the unit the rest of the app is currently pointed at. */
  selected: boolean;
  conn: Connectivity;
  readings: ReturnType<typeof readingsOf>;
  site: ReturnType<typeof siteOf>;
}

export interface Fleet {
  units: FleetUnit[];
  /**
   * Battery power across the units that reported one, kW.
   *
   * A sum is the one aggregate this screen makes, and it is defensible because
   * the quantity is additive and measured: each PCS reports its own active
   * power and two inverters on one plant do add. Nothing else is summed —
   * averaging two SOCs would invent a figure for a pack nobody metered, and
   * adding two grid meters would double-count if they turn out to be reading
   * the same connection.
   *
   * Null when no unit reported one. `contributing` says how many did, so the
   * screen can refuse to call a partial sum a site total.
   */
  totalPowerKw: number | null;
  /** How many units the sum is over. */
  contributing: number;
  /** How many the gateway knows about. */
  total: number;
  /** True while nothing has arrived yet, as opposed to having arrived empty. */
  isLoading: boolean;
  mode: GatewayMode;
}

export function useFleet(): Fleet {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const { sourceId: selectedId } = useGatewaySelection();
  const units = useBessIds();

  const latest = useQuery({
    queryKey: ["gw", siteId, "latest"],
    queryFn: timed("latest", getLatest),
    refetchInterval: paced("latest", LATEST_MS),
  });
  const summary = useQuery({
    queryKey: ["gw", siteId, "sources"],
    queryFn: timed("sources", getSources),
    /* Paced, like the observer in useGatewayHealth on this same key.
       React Query takes the SMALLEST refetchInterval across every observer of
       a key, so a single un-paced observer here silently pinned this query at
       30 s however slow the gateway got — which is exactly what a fixed 30_000
       did until this line. Every observer of a key has to agree, or the
       fastest one decides for all of them. */
    refetchInterval: paced("sources", HEALTH_MS),
    retry: 1,
  });
  const logger = useQuery({
    queryKey: ["gw", siteId, "logger"],
    queryFn: timed("logger", getLoggerStatus),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  /* One per unit, and the count changes when the gateway adds or drops a
     source. useQueries rather than a hook per unit: the list is data, and a
     hook per unit would break the rules of hooks the first time a site went
     from two units to one. */
  const telemetry = useQueries({
    queries: units.map((u) => ({
      queryKey: siteQueryKey(siteId, u.sourceId),
      queryFn: () => getSiteTelemetry(u.sourceId),
      refetchInterval: SITE_MS,
    })),
  });

  const rows = latest.data?.data.rows ?? [];
  const nowMs = latest.data?.nowMs ?? Date.now();
  const intervalSec = loggerInterval(logger.data?.data.interval_seconds);
  const unreachable = latest.error != null;

  const full: FleetUnit[] = units.map((u, i) => {
    /* Matched on source, never falling back to another unit's row — the same
       rule useLive follows, and for the same reason. On this screen the two
       units are side by side, so a fallback would put one column's readings
       under the other column's heading in the most literal way possible. */
    const row = rows.find((r) => r.source_id === u.sourceId) ?? null;

    return {
      ...u,
      label: u.bessId.replace("bess_", "BESS "),
      selected: u.sourceId === selectedId,
      conn: freshnessOf({
        source: findSource(summary.data?.data.sources, u.sourceId),
        intervalSec,
        rowMs: row?.timestamp_epoch_ms ?? null,
        nowMs,
        unreachable,
      }),
      readings: readingsOf((asset, name) =>
        signalValue(row as unknown as Record<string, unknown>, asset, name),
      ),
      site: siteOf(telemetry[i]?.data?.data),
    };
  });

  const reported = full.map((u) => u.readings.powerKw).filter((v): v is number => v != null);

  return {
    units: full,
    totalPowerKw: reported.length ? reported.reduce((a, b) => a + b, 0) : null,
    contributing: reported.length,
    total: full.length,
    isLoading: latest.isLoading && units.length === 0,
    mode: latest.data?.mode ?? "live",
  };
}

export function useAlarmList() {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const q = useQuery({ queryKey: ["gw", siteId, "alarms"], queryFn: getAlarms, refetchInterval: 15_000 });

  /* The gateway's alarm engine returns configured protection limits alongside
     genuinely asserted states — 148 of the site's 149 rows. They are split
     here rather than filtered away: `alarms` is what needs attention, and
     `setpoints` is everything set aside, kept addressable so the screen can
     say how many and show them on request. See isAlarmState. */
  return useMemo(() => {
    const all = q.data?.data.alarms ?? [];
    return {
      alarms: all.filter(isAlarmState),
      setpoints: all.filter((a) => !isAlarmState(a)),
      isLoading: q.isLoading,
      mode: q.data?.mode ?? ("live" as GatewayMode),
    };
  }, [q.data, q.isLoading]);
}

export function useGatewayHealth() {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const health = useQuery({ queryKey: ["gw", siteId, "health"], queryFn: timed("health", getHealth), refetchInterval: paced("health", HEALTH_MS) });
  const logger = useQuery({ queryKey: ["gw", siteId, "logger"], queryFn: timed("logger", getLoggerStatus), refetchInterval: paced("logger", HEALTH_MS) });
  const sources = useQuery({ queryKey: ["gw", siteId, "sources"], queryFn: timed("sources", getSources), refetchInterval: paced("sources", HEALTH_MS) });
  return {
    health: health.data?.data ?? null,
    logger: logger.data?.data ?? null,
    sources: (sources.data?.data.sources ?? []) as Record<string, unknown>[],
    mode: health.data?.mode ?? ("live" as GatewayMode),
    note: health.data?.note,
    isLoading: health.isLoading || logger.isLoading,
    error: health.error ? String((health.error as Error).message) : null,
  };
}

/* ── Gateway self-description ──────────────────────────────────────────────
   None of this changes second to second, so it is polled slowly or not at all.
   `staleTime: Infinity` on the profile is deliberate: the logged signal set is
   a deployment property, and refetching it every thirty seconds would spend a
   request on a field board — one the API Reference explicitly asks callers not
   to load — to re-learn a constant. */

/** Who the gateway says this token belongs to, and the role it granted. */
export function useIdentity() {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const q = useQuery({
    queryKey: ["gw", siteId, "auth", "me"],
    queryFn: getAuthMe,
    staleTime: 5 * 60_000,
    /* One retry, not the default two. A failure here costs nothing — the
       screen falls back to the username held in the session — and this is not
       a request worth hammering a loaded board with. */
    retry: 1,
  });
  return {
    identity: q.data?.data ?? null,
    isLoading: q.isLoading,
    error: q.error ? String((q.error as Error).message) : null,
  };
}

/** The historian's storage: how large it has grown, and whether it was vacuumed. */
export function useStorage() {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const q = useQuery({
    queryKey: ["gw", siteId, "storage", "status"],
    queryFn: getStorageStatus,
    refetchInterval: 60_000,
    retry: 1,
  });
  return { storage: q.data?.data ?? null, isLoading: q.isLoading };
}

/** The signal profile the fast historian is logging, as the gateway defines it. */
export function useLoggerProfile() {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const q = useQuery({
    queryKey: ["gw", siteId, "fast-bess", "profile"],
    queryFn: getFastBessProfile,
    staleTime: Infinity,
    retry: 1,
  });
  return { profile: q.data?.data ?? null, isLoading: q.isLoading };
}

/** Every asset the gateway reports for the selected source. */
export function useAssets() {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const { sourceId } = useGatewaySelection();
  const q = useQuery({
    queryKey: ["gw", siteId, "assets", sourceId],
    queryFn: () => getAssets(sourceId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return { assets: q.data?.data.assets ?? [], isLoading: q.isLoading };
}

/** Whether the gateway is pushing to a server of its own. */
export function useServerUpload() {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const q = useQuery({
    queryKey: ["gw", siteId, "server-upload", "status"],
    queryFn: getServerUploadStatus,
    refetchInterval: 60_000,
    retry: 1,
  });
  return { upload: q.data?.data ?? null, isLoading: q.isLoading };
}

/**
 * Whether the gateway granted this token a dispatch role.
 *
 * Read from /api/auth/me, never assumed and never stored on the client. The
 * gateway enforces the same thing on every control endpoint regardless, so
 * this is only what decides whether the UI is worth showing — it is not the
 * security boundary and must not be treated as one. `false` while the query
 * is in flight, so controls cannot flash into view before the answer lands.
 *
 * `role` is matched loosely because the field's exact spelling is not pinned
 * in the API Reference's schema section: a role list, a single string and a
 * nested claim have all been seen in gateways of this family, and reading all
 * three is cheaper than being wrong in the direction of showing dispatch to
 * someone who cannot use it.
 */
export function useIsDispatcher(): { isDispatcher: boolean; role: string | null; isLoading: boolean } {
  const { identity, isLoading } = useIdentity();

  const role = useMemo(() => {
    const i = identity as Record<string, unknown> | null;
    if (!i) return null;
    const direct = i.role ?? i.user_role ?? i.scope;
    if (typeof direct === "string") return direct;
    if (Array.isArray(direct)) return direct.join(",");
    const roles = i.roles;
    if (Array.isArray(roles)) return roles.join(",");
    if (typeof roles === "string") return roles;
    return null;
  }, [identity]);

  return {
    isDispatcher: !!role && role.includes("internal_admin"),
    role,
    isLoading,
  };
}

/** The limited runtime configuration the gateway will show a customer_admin. */
export function useRuntimeConfig() {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const q = useQuery({
    queryKey: ["gw", siteId, "config", "runtime"],
    queryFn: getRuntimeConfig,
    staleTime: 60_000,
    retry: 1,
  });
  return { config: q.data?.data ?? null, isLoading: q.isLoading };
}

/** The SOC protection controller, which is what actually guards the pack. */
export function useSocProtection() {
  /* Query keys are scoped by site. The client cache is persisted, so without
     this a reload would restore one plant's readings under another's name. */
  const { siteId } = useSiteSelection();
  const q = useQuery({
    queryKey: ["gw", siteId, "soc-protection"],
    queryFn: getSocProtection,
    refetchInterval: 30_000,
    retry: 1,
  });
  return { soc: q.data?.data ?? null, isLoading: q.isLoading };
}

export { SIGNALS, colKey };

/* ══ Advisor and explanations ═══════════════════════════════════════════════
   Both features answer locally by default and cost nothing to run. The
   inference service is consulted only where the local answer does not exist,
   and only when the deployment has one — see gateway/explanations.ts for why
   a written-once file beats a per-request model call for the fault bits, and
   gateway/findings.ts for why the advisor's findings are rules.

   Neither hook is on any polling path. Nothing here runs unless a person
   opened the screen that needs it. */

/**
 * Whether this deployment has an inference service.
 *
 * Asked once per session and cached forever: it is a property of the server,
 * it cannot change under a running client, and a deployment without one must
 * not pay a request per screen to keep rediscovering that.
 */
/**
 * Whether a local model is configured to rewrite unrecognised questions.
 *
 * Asked once and cached forever, like the hosted-service probe beside it: it
 * is a property of the server and cannot change under a running client.
 */
export function useInterpretAvailable(): boolean {
  const q = useQuery({
    queryKey: ["ai", "capabilities"],
    queryFn: getAiCapabilities,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return q.data?.interpret === true;
}

/** Rewrite a question the grammar could not parse. Null when there is no rewrite. */
export async function interpretUnparsed(text: string): Promise<string | null> {
  return interpretQuestion(text);
}

export function useAiAvailable(): boolean {
  const q = useQuery({
    queryKey: ["ai", "available"],
    queryFn: getAiAvailable,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return q.data === true;
}

/**
 * What one signal means, and what its present value says.
 *
 * Local first, always. The 29 signals the Alarms screen can show are all
 * written down, so this normally returns synchronously with no network at all;
 * `source` says which answered, and the screen shows it.
 */
export function useSignalExplanation(
  sig: SignalDef | null,
  value: number | null,
  enabled: boolean,
): {
  explanation: AlarmExplanation | null;
  source: "local" | "model" | "derived" | null;
  isLoading: boolean;
  error: string | null;
} {
  const aiAvailable = useAiAvailable();

  const local = useMemo(
    () => (sig ? explainLocally(sig, value) : null),
    [sig, value],
  );

  /* Only for a signal this build has no entry for — a profile that grew a
     register since explanations.ts was last written. Everything else is
     answered above without a request. */
  const needsModel = enabled && Boolean(sig) && !local && aiAvailable;

  const q = useQuery({
    queryKey: ["ai", "explain", sig?.name, value],
    queryFn: () =>
      explainSignal({
        signalName: sig!.name,
        value: value!,
        assetLabel: sig!.asset,
      }),
    enabled: needsModel && value != null,
    staleTime: Infinity,
    retry: false,
  });

  if (!sig || !enabled) return { explanation: null, source: null, isLoading: false, error: null };
  if (local) return { explanation: local, source: "local", isLoading: false, error: null };
  if (q.data) return { explanation: q.data, source: "model", isLoading: false, error: null };
  if (q.isLoading) return { explanation: null, source: null, isLoading: true, error: null };

  /* No entry, and either no inference service or it failed. The dictionary
     still knows what the signal is, so that is said rather than nothing. */
  return {
    explanation: derivedExplanation(sig, value),
    source: "derived",
    isLoading: false,
    error: q.error ? String((q.error as Error).message) : null,
  };
}

/**
 * The figures the advisor reasons over, assembled from what the app already
 * holds — the historian's window aggregates and the live row.
 *
 * A figure that could not be taken is left out rather than defaulted, which is
 * the same rule the rest of this file follows and matters more here: a zero
 * for a missing measurement would be reasoned about as a measurement of zero.
 */
export function useEvidence(spanMinutes: number, forUnit?: BessUnit): Evidence {
  const history = useHistory(spanMinutes, forUnit);
  const live = useLive(forUnit?.sourceId);
  const { alarms, setpoints } = useAlarmList();
  const all = useAllSignals();

  return useMemo(() => {
    const ev: Evidence = {};
    const put = (k: keyof Evidence, v: number | null | undefined) => {
      if (typeof v === "number" && Number.isFinite(v)) ev[k] = Math.round(v * 100) / 100;
    };

    put("windowHours", spanMinutes / 60);

    const t = history.totals;
    put("roundTripPct", t.ratioPct);
    put("chargedKwh", t.charged);
    put("dischargedKwh", t.discharged);
    put("peakKw", t.peakKw);
    put("socMinPct", t.socMin);
    put("socMaxPct", t.socMax);
    put("tempMaxC", t.tempMax);
    put("skippedMinutes", t.skippedMs / 60_000);

    const cov = history.coverage;
    if (cov.windowMs > 0) put("coveragePct", (cov.coveredMs / cov.windowMs) * 100);

    put("cellSpreadMv", live.get("BMS", "max_min_cell_voltage_diff"));
    put("sohPct", live.get("BMS", "soh"));
    if (live.ageMs != null) put("readingAgeSeconds", live.ageMs / 1000);

    /* Counted from the bits themselves rather than from the alarm endpoint,
       because the endpoint reports this site's protection limits as active
       alarms and the count that belongs here is asserted states. */
    ev.assertedFaultBits = all.filter(
      ({ def, value }) => isFaultBit(def) && value != null && value > 0,
    ).length;
    put("reportedSetpoints", setpoints.length);

    return ev;
  }, [spanMinutes, history.totals, history.coverage, live, alarms, setpoints, all]);
}

/**
 * Findings for the selected unit.
 *
 * Computed from the evidence by rules, every time, with no network. `prose` is
 * the inference service's phrasing of the same evidence when a deployment has
 * one — additive, never a substitute: `findings` is populated either way and
 * the screen renders it either way.
 */
export function useAdvisor(spanMinutes: number, wantProse = false): {
  evidence: Evidence;
  advice: Advice;
  prose: Advice | null;
  proseLoading: boolean;
  proseError: string | null;
  aiAvailable: boolean;
  isLoading: boolean;
} {
  const evidence = useEvidence(spanMinutes);
  const aiAvailable = useAiAvailable();
  const history = useHistory(spanMinutes);

  const advice = useMemo(() => computeFindings(evidence), [evidence]);

  const q = useQuery({
    queryKey: ["ai", "advise", evidence],
    queryFn: () => requestAdvice(evidence),
    enabled: wantProse && aiAvailable && Object.keys(evidence).length >= 3,
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    evidence,
    advice,
    prose: q.data ?? null,
    proseLoading: q.isLoading && q.fetchStatus !== "idle",
    proseError: q.error ? String((q.error as Error).message) : null,
    aiAvailable,
    isLoading: history.isLoading,
  };
}
