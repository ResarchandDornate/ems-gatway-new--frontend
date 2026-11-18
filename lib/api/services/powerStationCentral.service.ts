"use client";

/**
 * Power Station Monitoring, from the central backend.
 *
 * Replaces the NorthBound-backed readers for the two views whose figures
 * actually exist on this backend. What is missing and why is catalogued in
 * docs/power-station-api-mapping.md; the short version is that the battery and
 * inverter report well and the grid meter reports nothing at all.
 *
 * ── Null is not zero, and it matters more here than usual ──────────────────
 *
 * The meter's registers are mapped, answer `quality: "good"`, and read 0.0 —
 * all 43 of them, including three phase voltages. A reader that passed those
 * through as numbers would put "0 kW" on screen beside a live battery and
 * invite the conclusion that the site is idle. Every meter-derived figure
 * below is therefore NULL, which these UI types already model and already
 * render as an em dash.
 *
 * The rule: a figure whose register reads 0 only because the instrument behind
 * it is silent is unknown, not zero. `liveOrNull` is where that judgement is
 * applied, once, with the evidence beside it.
 */

import { COMM_LOST_MS } from "@/lib/alarms/commLost";
import {
  fetchFastBess, fetchPowerSocRange, fetchGeneral, fetchGatewayHealth, fetchAlarmEvents, episodes,
  SUBSTREAMS, numeric, decoded, type GeneralRecord, type FastBessSample,
} from "@/lib/central";
import { SITE_OVERLAY_FOR, gatewayLabel } from "../overlay/stations";
import { fetchS2Recent } from "./dashboardCentral.service";
import { fetchDailyEnergy, fetchTodayEnergy } from "./dailyEnergyCentral.service";
import { istDate, istMidnight } from "@/lib/api/time";
import { dieselRevenueInr, siteLoadKw } from "@/lib/energy/load";
import type { StationSummary, MatrixData, EquipmentHierarchy, CommDevice } from "../types";
import { deviceType, kindOf, LINK_POINTS, type PresenceRow } from "@/lib/devices/registry";
import { installedAssets } from "./devicePresence";

/* ── Points this module reads ─────────────────────────────────────────────── */
const P_RATED_POWER      = "p0094";  // pcs_extended · kW · live
const P_REACTIVE_POWER   = "p0188";  // pcs_extended · kVar · live
const P_AVAIL_CHARGE     = "p0031";  // ems_system  · kW · meter-derived, dead
const P_AVAIL_DISCHARGE  = "p0032";  // ems_system  · kW · meter-derived, dead
/* The lifetime totals read the DC pair: the AC pair is inconsistent on this
   site (see dashboardCentral POINTS). */
const P_DC_CUM_CHARGE    = "p0205";  // pcs_extended · kWh · lifetime, DC
const P_DC_CUM_DISCHARGE = "p0206";  // pcs_extended · kWh · lifetime, DC
const P_DEMAND_ENABLE    = "p0050";  // ems_system  · flag
const P_EXPORT_LIMIT_ON  = "p0051";  // ems_system  · anti_reverse_flow_enable

/**
 * Meter-derived figures read 0.0 because the meter is silent, so 0 here is an
 * absence rather than a measurement. Anything else is passed through.
 */
const liveOrNull = (v: number | null): number | null => (v === null || v === 0 ? null : v);

/** Newest row per asset, from a newest-first response. */
function newestByAsset(rows: GeneralRecord[]): Map<string, GeneralRecord> {
  const m = new Map<string, GeneralRecord>();
  for (const r of rows) if (r.asset_id && !m.has(r.asset_id)) m.set(r.asset_id, r);
  return m;
}

/** Newest S1 sample per BESS, from a newest-first response. */
function newestByBess(rows: FastBessSample[]): Map<string, FastBessSample> {
  const m = new Map<string, FastBessSample>();
  for (const r of rows) if (r.bess_id && !m.has(r.bess_id)) m.set(r.bess_id, r);
  return m;
}

const pcs = (s: FastBessSample | undefined, k: string): number | null => {
  const v = s?.data?.pcs_values?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const bms = (s: FastBessSample | undefined, k: string): number | null => {
  const v = s?.data?.bms_values?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** Asset ids are `<sourceId>_<asset>`; an empty or absent list means every cabinet. */
const inCabinets = (assetId: string | null | undefined, sourceIds?: string[]) =>
  !sourceIds?.length || (!!assetId && sourceIds.some((id) => assetId.startsWith(`${id}_`)));

/** Sum of a point across every asset that reports it — or only the selected
 *  cabinets' — or null if none do. */
async function sumPoint(gatewayId: string, pointId: string, sourceIds?: string[]): Promise<number | null> {
  try {
    const rows = await fetchGeneral(gatewayId, { pointId, limit: 50 });
    const latest = newestByAsset(rows);
    /* Per cabinet, decode faults undone before summing (lib/central/decode). */
    const vals = [...latest.entries()]
      .filter(([asset]) => inCabinets(asset, sourceIds))
      .map(([, r]) => decoded(r.substream, r.signal, numeric(r)))
      .filter((n): n is number => n !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  } catch {
    return null;
  }
}

/* ── Station summary ──────────────────────────────────────────────────────── */

/**
 * Alarms raised today (IST): S4 raise events since midnight, one per alarm
 * episode — paired by asset + signal as Recurrence does, since correlation_id
 * is not reliable. A flag still raised from yesterday is not today's alarm;
 * the active count is on Alarm Monitoring. Null when the log cannot be read.
 */
async function todayAlarmCount(gatewayId: string, sourceIds?: string[]): Promise<number | null> {
  const log = await fetchAlarmEvents(gatewayId, { limit: 1000 }).catch(() => null);
  if (!log) return null;
  const since = istMidnight();
  return episodes(log).filter((e) =>
    e.raisedTs >= since &&
    (!sourceIds?.length || (e.event.source_id != null && sourceIds.includes(e.event.source_id)))).length;
}

/** Whole rupees: a counter in kWh × ₹30 carries paise to three places. */
const rupees = (v: number | null): number | null => (v == null ? null : Math.round(v));

/**
 * Yesterday's discharge, kWh, from the PCS AC counters (p0204) — only when
 * the day is complete: a reading at its start midnight on every cabinet and
 * readings through to its end. A day the counters only partly cover is null,
 * not a smaller figure that reads as a slow day.
 */
async function yesterdayDischargeKwh(gatewayId: string, sourceIds?: string[]): Promise<number | null> {
  const ymd = istDate(istMidnight() - 12 * 3_600_000);
  const { points } = await fetchDailyEnergy(gatewayId, ymd, ymd, sourceIds).catch(() => ({ points: [] }));
  const p = points.find((x) => x.date === ymd);
  return p && p.fromMidnight && !p.partial ? p.discharge : null;
}

/** @param sourceIds the cabinets the unit picker has selected; omitted = all. */
export async function fetchStationSummary(gatewayId: string, sourceIds?: string[]): Promise<StationSummary> {
  if (!gatewayId) throw new Error("No gateway configured");

  const [ratedKw, alarms, health, lifeCharge, lifeDischarge, today, yesterday] = await Promise.all([
    sumPoint(gatewayId, P_RATED_POWER, sourceIds),
    todayAlarmCount(gatewayId, sourceIds),
    fetchGatewayHealth(gatewayId, 1).catch(() => []),
    sumPoint(gatewayId, P_DC_CUM_CHARGE, sourceIds),
    sumPoint(gatewayId, P_DC_CUM_DISCHARGE, sourceIds),
    fetchTodayEnergy(gatewayId, sourceIds),
    yesterdayDischargeKwh(gatewayId, sourceIds),
  ]);

  const ov = SITE_OVERLAY_FOR(gatewayId);
  const sources =
    (health[0]?.data as { health?: { sources?: unknown[] } } | undefined)?.health?.sources ?? [];

  return {
    stationId: gatewayId,
    stationName: ov.powerStationEnglishName ?? ov.powerStationName ?? gatewayId,
    stationLocation: ov.stationLocation ?? "",
    hasBess: ov.hasBess ?? true,
    /* The stated nameplate wins over the register, as in siteToStation. */
    installedKw: ov.installedPower ?? ratedKw ?? 0,
    /* No kWh nameplate exists on any asset — see the mapping doc §3.4. */
    capacityKwh: ov.installedCapacity ?? 0,
    /* Lifetime totals are NOT meter-derived, and were wrongly nulled with the
       meter's figures. The PCS keeps its own lifetime counters, live on both
       cabinets, summed here. The DC pair (p0205/p0206): AC would be what a
       meter agrees with, but the AC pair is inconsistent on this site —
       cabinet 1 AC discharge exceeds its AC charge and both cabinets' AC
       discharge exceeds DC discharge (13 Oct 2026). liveOrNull: a lifetime
       counter of exactly 0 on a commissioned cabinet is an unread register.

       "Today" is the AC counters' rise since local midnight, which tracks SOC. A point-filtered
       read reaches back ~2.8 days, so a midnight reading is there whenever the
       gateway was reporting then; when it was not, today is null rather than
       a figure that silently skips the morning (dailyEnergyCentral). */
    totalChargeKwh: liveOrNull(lifeCharge),
    totalDischargeKwh: liveOrNull(lifeDischarge),
    todayChargeKwh: today.charge,
    todayDischargeKwh: today.discharge,
    todayEnergyEstimatedSince: today.estimatedSince,
    /* Load kWh × the diesel rate (lib/energy/load). Load energy is the
       discharge until solar is measured. Yesterday is the same counters'
       rise across yesterday, when both its midnights are in the ~2.8 days
       the counters reach back (yesterdayDischargeKwh). */
    totalRevenueInr: rupees(dieselRevenueInr(liveOrNull(lifeDischarge), ov.dieselRateRs)),
    yesterdayRevenueInr: rupees(dieselRevenueInr(yesterday, ov.dieselRateRs)),
    todayRevenueInr: dieselRevenueInr(today.discharge, ov.dieselRateRs),
    yesterdayDischargeKwh: yesterday,
    todayAlarms: alarms,
    /* Lifetime round trip on the same DC counters as the totals beside it. */
    stationEfficiencyPct: (() => {
      const c = liveOrNull(lifeCharge), d = liveOrNull(lifeDischarge);
      return c != null && d != null ? Math.round((d / c) * 1000) / 10 : null;
    })(),
    fileId: String(Array.isArray(sources) ? sources.length : 0),
  };
}

/* ── Matrix data ──────────────────────────────────────────────────────────── */

/**
 * The site's matrix.
 *
 * `matrixId` is accepted and ignored: this backend has one gateway, and the
 * cabinets beneath it are the unit picker's business rather than a second
 * level of matrix. The parameter stays so the view's call site is unchanged,
 * and so it still means something if a site ever has two.
 */
export async function fetchMatrixData(
  gatewayId: string,
  _matrixId?: string,
  sourceIds?: string[],
): Promise<MatrixData | null> {
  if (!gatewayId) return null;

  const [samples, reactive, availCharge, availDischarge, health, today] = await Promise.all([
    fetchFastBess(gatewayId, { limit: 20 }),
    sumPoint(gatewayId, P_REACTIVE_POWER, sourceIds),
    sumPoint(gatewayId, P_AVAIL_CHARGE, sourceIds),
    sumPoint(gatewayId, P_AVAIL_DISCHARGE, sourceIds),
    fetchGatewayHealth(gatewayId, 1).catch(() => []),
    fetchTodayEnergy(gatewayId, sourceIds),
  ]);

  const byBess = newestByBess(samples);
  if (byBess.size === 0) return null;

  const units = [...byBess.entries()]
    .filter(([, smp]) => !sourceIds?.length || sourceIds.includes(smp.source_id))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  const powers = units.map(([, s]) => pcs(s, "total_active_power")).filter((n): n is number => n !== null);
  const socs   = units.map(([, s]) => bms(s, "display_soc") ?? pcs(s, "soc")).filter((n): n is number => n !== null);
  const totalSoc = socs.length ? socs.reduce((a, b) => a + b, 0) / socs.length : null;

  /* Site phase current is the SUM across cabinets — the two PCS sit in
     parallel on one AC bus. This used to read cabinet 1 alone, which put half
     the site's current under a heading that names the site. Null unless
     every cabinet reports the phase, so a missing cabinet cannot quietly
     halve the figure. */
  const phaseSum = (k: string): number | null => {
    const vs = units.map(([, s]) => pcs(s, k));
    return vs.length && vs.every((v) => v !== null)
      ? (vs as number[]).reduce((a, b) => a + b, 0)
      : null;
  };

  /* Remaining energy is SOC × rated capacity, and capacity is a commercial
     fact with no register on any asset. Computed when the site overlay
     states one; null (an em dash) until somebody writes it down. */
  const capKwh = SITE_OVERLAY_FOR(gatewayId).installedCapacity ?? 0;
  const remainingDischarge = capKwh > 0 && totalSoc !== null ? (capKwh * totalSoc) / 100 : null;
  const remainingCharge    = capKwh > 0 && totalSoc !== null ? capKwh - (capKwh * totalSoc) / 100 : null;

  /* The edge controller IS the gateway: the one box every cabinet reports
     through. Its run state is the gateway's own health verdict — status ok,
     the fast logger running, no active poll error — from the newest
     heartbeat. No heartbeat, no claim: null keeps the panel's "not reported". */
  const hs = health[0]?.data?.health as
    | (Record<string, unknown> & { status?: string; gateway_mode?: string })
    | undefined;
  const logger = hs?.fast_bess_logger as { running?: boolean } | undefined;
  const edgeController = hs
    ? {
        name: `Edge gateway${hs.gateway_mode ? ` · ${hs.gateway_mode}` : ""}`,
        runStatus: (hs.status === "ok" && hs.poll_error_active !== true && logger?.running !== false
          ? "normal" : "abnormal") as "normal" | "abnormal",
      }
    : null;

  /* One matrix for the site. The cabinets are its members — which is the same
     hierarchy the unit picker shows, so the two cannot disagree. */
  return {
    matrixId: gatewayId,
    matrixName: "Site",
    /* Today's pair is the PCS counters' rise since midnight — null when no
       midnight reading exists, not 0. Remaining needs a capacity. */
    energy: {
      remainingDischargeKwh: remainingDischarge,
      todayChargeKwh: today.charge,
      remainingChargeKwh: remainingCharge,
      todayDischargeKwh: today.discharge,
      todayEstimatedSince: today.estimatedSince,
    },
    power: {
      totalActivePowerKw: powers.length ? powers.reduce((a, b) => a + b, 0) : null,
      /* Not liveOrNull: 0 kVAr is an ordinary reading on an idle PCS, and p0188
         is a live PCS register, not a meter figure. Null only when absent. */
      totalReactivePowerKvar: reactive,
      maxChargeablePowerKw: liveOrNull(availCharge),
      maxDischargePowerKw: liveOrNull(availDischarge),
    },
    current: {
      phaseA: phaseSum("phase_a_current"),
      phaseB: phaseSum("phase_b_current"),
      phaseC: phaseSum("phase_c_current"),
    },
    totalSocPct: totalSoc,
    edgeController,
    cabinets: units.map(([bessId, s]) => ({
      id: bessId,
      name: /^bess[_-]?(\d+)$/i.test(bessId) ? `BESS ${/\d+/.exec(bessId)![0]}` : bessId,
      powerKw: pcs(s, "total_active_power"),
      socPct: bms(s, "display_soc") ?? pcs(s, "soc"),
    })),
  };
}

/**
 * The equipment tree, as far as this backend describes one.
 *
 * It describes two levels: the site, and the cabinets under it. There is no
 * grid, pile, rack or cell anywhere in the 1,174 points — the battery is
 * reported as one aggregate per cabinet — so those arrays stay empty rather
 * than being invented to fill the shape. The view only walks as far as
 * matrices, which is exactly as far as this goes.
 */
export async function fetchHierarchy(gatewayId: string): Promise<EquipmentHierarchy> {
  if (!gatewayId) return { stationId: "", grids: [] };

  /* The roster is the gateway's own source list (S3), so a cabinet that has
     gone quiet is still counted; S1 only names each source's bess_id. The
     newest 20 S1 samples span seconds, and used to drop a silent cabinet. */
  const [samples, health] = await Promise.all([
    fetchFastBess(gatewayId, { limit: 20 }).catch(() => []),
    fetchGatewayHealth(gatewayId, 1).catch(() => []),
  ]);
  const byBess = newestByBess(samples);
  const known = new Map<string, FastBessSample>();     // bess_id → sample (source_id set)
  for (const [b, smp] of byBess) known.set(b, smp);
  for (const src of health[0]?.data?.health?.sources ?? []) {
    const sid = src.source_id ?? "";
    if (!/^external_ems_\d+$/.test(sid) || [...known.values()].some((x) => x.source_id === sid)) continue;
    /* external_ems_N reports bess_N on this gateway (S5: X = bess_1, Y = bess_2). */
    known.set(`bess_${/\d+/.exec(sid)![0]}`, { source_id: sid } as FastBessSample);
  }
  const units = [...known.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  /* Ids are asset-shaped so each level can name its own source. The hooks
     below this pass an id and the station, and the station is now the site —
     so the id is the only thing that can say which cabinet. */
  const cabinets = units.map(([bessId, s]) => {
    const sourceId = s.source_id ?? "";
    const n = /\d+/.exec(bessId)?.[0] ?? bessId;
    return {
      id: sourceId,
      name: `BESS ${n}`,
      matrixId: gatewayId,
      piles: [{
        id: `${sourceId}_bms`,
        name: "BMS",
        cabinetId: sourceId,
        /* One cluster per cabinet: bms_extended carries cluster aggregates and
           260 per-cell voltages, but no second rack. Cells are left empty and
           fetched by the cell reader — enumerating 260 of them here would put
           them in every hierarchy response for no reader that wants them. */
        racks: [{
          id: `${sourceId}_bms_cluster`,
          name: "Cluster 1",
          pileId: `${sourceId}_bms`,
          cells: [],
        }],
      }],
    };
  });

  /* Grid and matrix are the old model's levels; here they are the site and the
     gateway (organisation › site › gateway › BESS unit). Both carry the gateway
     id, because one gateway is one site until the backend can list sites. */
  const siteName = SITE_OVERLAY_FOR(gatewayId).powerStationEnglishName ?? "Site";
  return {
    stationId: gatewayId,
    grids: [{
      id: gatewayId,
      name: siteName,
      matrices: [{ id: gatewayId, name: gatewayLabel(gatewayId), gridId: gatewayId, cabinets }],
    }],
  };
}

/* ── Recent power and SOC — the "Today's" charts ──────────────────────────── */

/**
 * One point of the Single Station Data curves. `load` is solar + battery (see
 * lib/energy/load): with no solar reading, only a discharging tick has one,
 * and every other tick is null rather than 0.
 */
export interface RecentPoint {
  t: string;
  /** Epoch ms of the tick, so a caption can state the real span. */
  ts: number;
  /** Site battery power, kW, summed across cabinets. Negative = charging. */
  power: number;
  soc: number | null;
  load: number | null;
}

/** HH:MM:SS in the viewer's zone — the window is minutes, so minutes alone repeat. */
const hms = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/**
 * The newest ~1.5 hours of site battery power and SOC, from S2.
 *
 * NOT today. Every read answers only the newest 1,000 rows, with no from/to.
 * This used S1, where 1,000 samples at 1 Hz is ~17 minutes; the S2 SOC and
 * battery-power points publish every ~11 s, so the same cap reaches about an
 * hour and a half. Which points, and how they were checked against S1, is in
 * fetchS2Recent (dashboardCentral.service) — this reads the same two, so the
 * dashboard and this page draw the same curve. Power is the DC-side figure.
 *
 * Grouped into 10-second ticks. Both cabinets publish on the same tick, so a
 * tick carries one reading of each; a tick missing a cabinet is dropped
 * rather than plotted as half the site.
 */
const TICK_MS = 10_000;

export async function fetchRecentPower(gatewayId: string, only?: string[]): Promise<RecentPoint[]> {
  if (!gatewayId) return [];

  const probe = await fetchFastBess(gatewayId, { limit: 10 });
  const sourceIds = [...new Set(probe.map((r) => r.source_id).filter(Boolean))]
    .filter((id) => !only?.length || only.includes(id));
  if (sourceIds.length === 0) return [];

  const series = await fetchS2Recent(gatewayId, sourceIds);

  const ticks = new Map<number, { power: Map<string, number>; soc: Map<string, number> }>();
  const at = (ts: number) => {
    const k = Math.floor(ts / TICK_MS) * TICK_MS;
    const t = ticks.get(k) ?? { power: new Map(), soc: new Map() };
    ticks.set(k, t);
    return t;
  };
  for (const id of sourceIds) {
    for (const p of series[id]?.power ?? []) at(p.ts).power.set(id, p.value);
    for (const p of series[id]?.soc ?? []) at(p.ts).soc.set(id, p.value);
  }

  const n = sourceIds.length;
  return [...ticks.entries()]
    .filter(([, v]) => v.power.size === n)
    .sort(([a], [b]) => a - b)
    .map(([ts, v]) => ({
      t: hms(new Date(ts).toISOString()),
      ts,
      power: [...v.power.values()].reduce((a, b) => a + b, 0),
      soc: v.soc.size === n ? [...v.soc.values()].reduce((a, b) => a + b, 0) / n : null,
    }))
    .map((p) => ({ ...p, load: siteLoadKw(null, p.power) }));
}

/**
 * The same curves from S1, the fast stream, for the newest minutes.
 *
 * S2 can stall while S1 keeps arriving — on 1 Oct S2 still ended on 28 Sep
 * while S1 was current — so the short time windows read this. Its 1,000 rows
 * per cabinet cover anything from minutes to days, depending on how steadily
 * the gateway uploads.
 *
 * Power here is the PCS AC output (`total_active_power`), NOT the DC figure
 * S2 gives: at the same instant the two disagree by far more than inverter
 * losses (one lags the other), so they are never drawn on one line — the view
 * picks one source per window and says which. SOC (`display_soc`) equals S2's
 * p0041 exactly, so the two SOC series can be merged.
 */
export interface RecentFast {
  points: RecentPoint[];
  /** With a range: epoch ms the readings are complete from (see fetchFastBessRange). */
  completeFrom: number | null;
}

/**
 * @param range [from, to) epoch ms. Given, the backend is asked for that
 *   window (from_time/to_time); omitted, for the newest 1,000 per cabinet.
 */
export async function fetchRecentFast(
  gatewayId: string, only?: string[], range?: [number, number],
): Promise<RecentFast> {
  if (!gatewayId) return { points: [], completeFrom: null };
  const probe = await fetchFastBess(gatewayId, { limit: 10 });
  const bessIds = [...new Set(
    probe.filter((r) => !only?.length || only.includes(r.source_id)).map((r) => r.bess_id).filter(Boolean),
  )];
  if (bessIds.length === 0) return { points: [], completeFrom: null };

  let completeFrom: number | null = null;
  const perBess: FastBessSample[][] = await Promise.all(
    bessIds.map((b) =>
      range
        ? fetchPowerSocRange(gatewayId, { bessId: b, fromMs: range[0], toMs: range[1] })
            .then(({ points, completeFrom: c }) => {
              completeFrom = Math.max(completeFrom ?? -Infinity, c);
              /* Back into the sample shape the loop below reads, newest first. */
              return points.slice().reverse().map((p) => ({
                sample_time_utc: new Date(p.ts).toISOString(),
                data: { pcs_values: { total_active_power: p.power }, bms_values: { display_soc: p.soc } },
              }) as unknown as FastBessSample);
            })
            .catch(() => [])
        : fetchFastBess(gatewayId, { bessId: b, limit: 1000 }).catch(() => []),
    ),
  );

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ticks = new Map<number, Map<string, { power: number | null; soc: number | null }>>();
  perBess.forEach((rows, i) => {
    for (const r of rows) {                         // newest first
      const ts = Date.parse(r.sample_time_utc ?? "");
      if (Number.isNaN(ts)) continue;
      const k = Math.floor(ts / TICK_MS) * TICK_MS;
      const tick = ticks.get(k) ?? new Map();
      if (!tick.has(bessIds[i])) {                  // keep the newest per tick
        tick.set(bessIds[i], {
          power: num(r.data?.pcs_values?.total_active_power),
          soc: num(r.data?.bms_values?.display_soc),
        });
      }
      ticks.set(k, tick);
    }
  });

  const n = bessIds.length;
  const points = [...ticks.entries()]
    .filter(([, v]) => v.size === n && [...v.values()].every((x) => x.power != null))
    .sort(([a], [b]) => a - b)
    .map(([ts, v]) => {
      const vals = [...v.values()];
      const socs = vals.map((x) => x.soc).filter((x): x is number => x != null);
      const power = vals.reduce((a, x) => a + (x.power as number), 0);
      return {
        t: hms(new Date(ts).toISOString()),
        ts,
        power,
        soc: socs.length === n ? socs.reduce((a, b) => a + b, 0) / n : null,
        load: siteLoadKw(null, power),
      };
    });
  return { points, completeFrom };
}

/* ── Communication status ─────────────────────────────────────────────────── */

/**
 * Each asset's link, for Communication Status and the topology strip.
 *
 * Online is the asset's own reachability register where it has one (the
 * register Equipment reads: `communication_status`, or `online_points`), else
 * its source's online flag. An online asset is Abnormal when its source
 * reports bad signals, or when its newest row is overdue for ITS cadence:
 * three of its own reporting intervals, never under five minutes. The BMS
 * snapshot, the IO module and fire protection report slowly, and a fixed five
 * minutes called them Abnormal for their cadence alone.
 *
 * Only fitted devices are listed. The gateway publishes every slot its EMS is
 * configured with, and a slot with nothing behind it (Site 1's grid meter: all
 * zeros, link 0) is not an offline device — see the presence rule in
 * lib/devices/registry. Each device carries its registry `kind`, so screens
 * that list or count devices read them from here rather than naming them.
 */
const COMMS_POINTS = LINK_POINTS;
const STALE_UNKNOWN_MS = 30 * 60_000;

/** `external_ems_1_io_module` → `BESS 1 · IO Module`. */
function assetName(assetId: string): string {
  const cab = /^external_ems_(\d+)_/.exec(assetId)?.[1];
  const label = deviceType(kindOf(assetId)).label;
  return cab ? `BESS ${cab} · ${label}` : label;
}

/** Median spacing of an asset's distinct sample times, ms; null under two. */
function cadenceMs(times: number[]): number | null {
  const t = [...new Set(times)].sort((a, b) => a - b);
  if (t.length < 2) return null;
  const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

export async function fetchCommStatus(gatewayId: string): Promise<CommDevice[]> {
  if (!gatewayId) return [];

  const [perSubstream, health, pointRows, fast] = await Promise.all([
    Promise.all(SUBSTREAMS.map((ss) =>
      fetchGeneral(gatewayId, { substream: ss, limit: 1000 }).catch(() => [] as GeneralRecord[]))),
    fetchGatewayHealth(gatewayId, 1).catch(() => []),
    Promise.all(COMMS_POINTS.map((pointId) =>
      fetchGeneral(gatewayId, { pointId, limit: 20 }).catch(() => [] as GeneralRecord[]))),
    /* The fast stream counts as the PCS's and BMS's data arriving. */
    fetchFastBess(gatewayId, { limit: 10 }).catch(() => []),
  ]);
  const all = perSubstream.flat();
  if (all.length === 0) return [];
  const points = pointRows.flat();

  const sourceOnline = new Map<string, boolean>();
  const sourceBad = new Map<string, number>();
  const sources = (health[0]?.data as { health?: { sources?: unknown[] } } | undefined)?.health?.sources;
  for (const src of Array.isArray(sources) ? sources : []) {
    const row = src as Record<string, unknown>;
    if (typeof row.source_id !== "string") continue;
    sourceOnline.set(row.source_id, row.online === true);
    if (typeof row.bad_signal_count === "number") sourceBad.set(row.source_id, row.bad_signal_count);
  }

  /* Newest row, every sample time, and the newest reachability value, per asset. */
  const latest = newestByAsset(all);
  const times = new Map<string, number[]>();
  const newestTs = new Map<string, number>();
  for (const f of fast) {
    const t = Date.parse(f.sample_time_utc ?? "");
    if (Number.isNaN(t) || !f.source_id) continue;
    for (const asset of [`${f.source_id}_pcs`, `${f.source_id}_bms`]) {
      if (t > (newestTs.get(asset) ?? -Infinity)) newestTs.set(asset, t);
    }
  }
  for (const r of [...points, ...all]) {
    if (!r.asset_id) continue;
    const t = Date.parse(r.sample_time_utc ?? "");
    if (Number.isNaN(t)) continue;
    (times.get(r.asset_id) ?? times.set(r.asset_id, []).get(r.asset_id)!).push(t);
    if (t > (newestTs.get(r.asset_id) ?? -Infinity)) newestTs.set(r.asset_id, t);
  }
  const flag = new Map<string, number>();
  const flagPoint = new Map<string, string>();
  const flagRows = [...points, ...all]
    .filter((r) => r.asset_id && (r.signal === "communication_status" || r.signal === "online_points"))
    .sort((a, b) => Date.parse(b.sample_time_utc ?? "") - Date.parse(a.sample_time_utc ?? ""));
  for (const r of flagRows) {
    if (flag.has(r.asset_id!)) continue;
    const v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    flag.set(r.asset_id!, v);
    if (r.point_id) flagPoint.set(r.asset_id!, r.point_id);
  }

  /* Every row read per asset, for the presence rule. */
  const rowsByAsset = new Map<string, PresenceRow[]>();
  for (const r of [...points, ...all]) {
    if (r.asset_id) (rowsByAsset.get(r.asset_id) ?? rowsByAsset.set(r.asset_id, []).get(r.asset_id)!).push(r);
  }
  const installed = await installedAssets(rowsByAsset);

  const now = Date.now();
  return [...latest.entries()]
    .filter(([assetId]) => installed.has(assetId))
    .map(([assetId, row]): CommDevice => {
      const own = flag.get(assetId);
      const srcId = (row.data?.source_id as string | undefined) ?? null;
      const online = own !== undefined ? own === 1 : !!(srcId && sourceOnline.get(srcId));
      const seen = newestTs.get(assetId) ?? Date.parse(row.sample_time_utc ?? "");
      /* The Communication Lost rule (lib/alarms/commLost), so this screen,
         the Equipment tiles and the alarm agree: silent past 15 min, or three
         of its own reporting intervals if longer. "abnormal" = lost. A
         source's bad-signal count is not a lost link and no longer counts. */
      const cadence = cadenceMs(times.get(assetId) ?? []);
      const limit = cadence == null ? STALE_UNKNOWN_MS : Math.max(COMM_LOST_MS, 3 * cadence);
      const stale = row.substream !== "remote_control" && Number.isFinite(seen) && now - seen > limit;
      const status: CommDevice["status"] = !online ? "offline" : stale ? "abnormal" : "online";
      return {
        id: assetId,
        kind: kindOf(assetId),
        name: assetName(assetId),
        ip: null,
        port: null,
        protocol: row.substream ?? null,
        lastSeen: Number.isFinite(seen) ? new Date(seen).toISOString() : row.sample_time_utc ?? "",
        status,
        statusRegister: own !== undefined ? `${flagPoint.get(assetId) ?? "?"} = ${own}` : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/* ── Plant topology — the strip atop Single Station Data ──────────────────── */

/**
 * What the site is made of, as the central backend describes it.
 *
 * This strip used to read usePlantConfig, which resolves through the disabled
 * NorthBound seam and so reported an empty plant: "0× —" inverters, no
 * meters, rated power "—" and every feature off, BESS included. Here the
 * roster is the S2 asset list (the same one Communication Status lists) and
 * each figure names its register.
 *
 * Nulls are unknowns: `transformers` is null because no asset kind is a
 * transformer, which is not the same as the site having none.
 */
export interface PlantTopology {
  gatewayId: string;
  emsControllers: number;
  pcsCount: number;
  bmsCount: number;
  meters: { total: number; offline: number };
  transformers: number | null;
  ratedKw: number | null;
  hasBess: boolean;
  wms: boolean;
  /** p0051 anti_reverse_flow_enable on any controller; null if unread. */
  exportControl: boolean | null;
  /** p0050 demand_enable on any controller; null if unread. */
  demandControl: boolean | null;
}

async function anyFlagOn(gatewayId: string, pointId: string): Promise<boolean | null> {
  try {
    const rows = await fetchGeneral(gatewayId, { pointId, limit: 50 });
    const vals = [...newestByAsset(rows).values()].map(numeric).filter((n): n is number => n !== null);
    return vals.length ? vals.some((v) => v === 1) : null;
  } catch {
    return null;
  }
}

/** @param roster the Communication Status roster, when the caller already has it,
 *  so the strip and that page count the same meters from the same read. */
export async function fetchPlantTopology(gatewayId: string, roster?: CommDevice[]): Promise<PlantTopology | null> {
  if (!gatewayId) return null;

  const [devices, ratedKw, exportControl, demandControl] = await Promise.all([
    roster ?? fetchCommStatus(gatewayId).catch(() => []),
    sumPoint(gatewayId, P_RATED_POWER),
    anyFlagOn(gatewayId, P_EXPORT_LIMIT_ON),
    anyFlagOn(gatewayId, P_DEMAND_ENABLE),
  ]);
  if (devices.length === 0) return null;

  const of = (k: string) => devices.filter((d) => d.kind === k);
  const meters = of("grid_meter");
  const bmsCount = of("bms").length;

  return {
    gatewayId,
    emsControllers: of("ems_system").length,
    pcsCount: of("pcs").length,
    bmsCount,
    meters: { total: meters.length, offline: meters.filter((m) => m.status === "offline").length },
    transformers: null,
    /* The stated nameplate wins over the PCS rated-power registers, as on
       the wiring tiles and Installed Power. */
    ratedKw: SITE_OVERLAY_FOR(gatewayId).installedPower ?? liveOrNull(ratedKw),
    hasBess: bmsCount > 0,
    /* No asset kind measures weather — see views/WeatherStationView.tsx. */
    wms: false,
    exportControl,
    demandControl,
  };
}
