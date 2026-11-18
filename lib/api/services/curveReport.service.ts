/**
 * Curve Report — power curves and time-of-day energy.
 *
 * The ToD energy reports (Power Quantity, Profit) read the central backend:
 * S1 fast-bess power sampled per fifteen-minute bucket, scaled to the S2 PCS
 * energy counters where those can answer for the day — see "Daily ToD energy"
 * below. The power curves further down still read the NorthBound historian
 * (lib/gateway), which is disabled, and resolve empty. The asset curve does
 * not use this file; it reads S2 through pointsCentral.service.ts.
 *
 * SOLAR is integrated from the inverter's power readings (S5 + S6, see
 * lib/energy/solarToday): no yield register exists, and neither stream takes
 * a date range, so only the hours the backend still holds (about the last
 * eight) have a figure — earlier days come back `missing`, today partial.
 *
 * WHAT IS NOT HERE. Grid import and export are not offered: Site 1 is
 * islanded with no grid and its utility meter reads 0 on every register
 * (p1354 = 0). `fetchAvailableCounters` answers with what can be shown.
 */

import { getSeries } from "@/lib/gateway";
import { overlayFor, SITE_OVERLAY_FOR } from "../overlay/stations";
import { fetchPcsCurveReal } from "../adapters/gateway";
import type {
  WholePowerPoint, PcsCurvePoint, ClusterCurvePoint,
  ClusterStatInfo, CellCurvePoint, TodRow, ProfitRow,
} from "../types";
import { istDate, parseIst } from "@/lib/api/time";
import { fetchFastBess, type FastBessSample } from "@/lib/central";
import { fetchDailyEnergy } from "./dailyEnergyCentral.service";
import { fetchSolarPoints, solarSegments } from "@/lib/energy/solarToday";

const DAY_MS = 86_400_000;

const isoToMs = (d: string) => new Date(`${d}T00:00:00`).getTime();
const hm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const dtLocal = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

/* ── ToD period classifier (standard Indian C&I BESS tariff slots in IST) ──── */

type TodPeriod = "peak" | "shoulder" | "flat" | "valley";

/** IST is UTC+05:30 — the half hour matters, slots start on the hour in IST. */
const IST_OFFSET_MIN = 5 * 60 + 30;

function todPeriod(ts: number): TodPeriod {
  const d = new Date(ts);
  const istMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MIN;
  const h = Math.floor((istMinutes % (24 * 60)) / 60);
  if (h >= 18 && h < 22)             return "peak";
  if ((h >= 6 && h < 10) || h >= 22) return "shoulder";
  if (h >= 10 && h < 18)             return "flat";
  return "valley";                    // 00:00–06:00 IST
}

/* ── Power curves ─────────────────────────────────────────────────────────── */

/**
 * The last hour of plant power.
 *
 * 60 points over 60 minutes — a point a minute, each the mean of that minute's
 * one-second rows rather than one sample taken from it.
 */
export const fetchRealtimePower = async (stationId: string): Promise<WholePowerPoint[]> => {
  const now = Date.now();
  const r = await getSeries({
    sourceId: stationId, bessId: "",
    fromEpochMs: now - 60 * 60_000, toEpochMs: now, points: 60, nowMs: now,
  });
  /* Buckets the gateway had no rows for are dropped, never plotted as 0. A
     flat line across a gap is indistinguishable from a plant sitting idle. */
  return r.data.points
    .filter(([, kw]) => kw != null)
    .map(([t, kw]) => ({ t: hm(t), realtimePower: kw as number }));
};

export const fetchTotalActivePower = async (
  stationId: string, s: string, e: string,
): Promise<{ t: string; power: number }[]> => {
  const from = isoToMs(s);
  const to = isoToMs(e) + DAY_MS - 1;
  const r = await getSeries({
    sourceId: stationId, bessId: "",
    fromEpochMs: from, toEpochMs: to,
    /* ~500 points, which is what the chart can resolve. The server derives the
       bucket width from the count, so asking for points rather than an
       interval keeps the two in step whatever the span. */
    points: 500,
    nowMs: Date.now(),
  });
  return r.data.points
    .filter(([, kw]) => kw != null)
    .map(([t, kw]) => ({ t: dtLocal(t), power: kw as number }));
};

export const fetchPcsCurve = async (
  cabinetId: string, date: string, _invN = 1, stationId?: string,
): Promise<PcsCurvePoint[]> => {
  /* The curve is per source. The picker passes a cabinet id built as
     `{source}_{asset}`, so the source is recoverable from it when the caller
     did not pass one separately. */
  const sourceId = stationId || cabinetId.replace(/_(bms_1|pcs_1)$/, "");
  return fetchPcsCurveReal(sourceId, date);
};

/* ── Energy counters ──────────────────────────────────────────────────────── */

export type EnergyCounter = "charge" | "discharge" | "solar" | "gridImport" | "gridExport";

/**
 * Which counters this backend can report over a date range.
 *
 * Charge and discharge, and deliberately nothing else — see the file header.
 * The type keeps all five members because the report's UI is written against
 * them; the day a meter's energy registers have a history, this function is
 * the only thing that changes.
 */
export async function fetchAvailableCounters(stationId: string): Promise<EnergyCounter[]> {
  const pv = SITE_OVERLAY_FOR(stationId).assets?.includes("pv") ?? false;
  return pv ? ["charge", "discharge", "solar"] : ["charge", "discharge"];
}

/**
 * Daily ToD solar energy: trapezoids over the inverter's power readings,
 * each segment (≤ 5 min) credited to the band and day of its midpoint.
 * A day with no segment is `missing`; coverage is the share of the day (to
 * now, for today) that segments span.
 */
async function solarTod(gatewayId: string, startDate: string, endDate: string): Promise<TodRow[]> {
  const segs = solarSegments(await fetchSolarPoints(gatewayId, parseIst(startDate)));
  const now = Date.now();
  const rows: TodRow[] = [];
  for (let d = parseIst(startDate); d <= parseIst(endDate) && d <= now; d += DAY_MS) {
    const date = istDate(d + DAY_MS / 2);
    const end = Math.min(d + DAY_MS, now);
    const acc = emptyAccum();
    let covered = 0;
    for (const g of segs) {
      const mid = (g.t0 + g.t1) / 2;
      if (mid < d || mid >= end) continue;
      acc[todPeriod(mid)] += g.kwh;
      covered += g.t1 - g.t0;
    }
    if (!covered) { rows.push({ date, peak: 0, shoulder: 0, flat: 0, valley: 0, total: 0, missing: true, coverage: 0 }); continue; }
    const peak = r1(acc.peak), shoulder = r1(acc.shoulder), flat = r1(acc.flat), valley = r1(acc.valley);
    rows.push({ date, peak, shoulder, flat, valley, total: r1(peak + shoulder + flat + valley), coverage: Math.min(1, covered / (end - d)) });
  }
  return rows;
}

type TodAccum = Record<TodPeriod, number>;
const emptyAccum = (): TodAccum => ({ peak: 0, shoulder: 0, flat: 0, valley: 0 });

/* ── Daily ToD energy, sampled from S1 ────────────────────────────────────── */

/**
 * Daily ToD energy is S1 PCS AC power (`total_active_power`, + discharge,
 * − charge), per cabinet, sampled once per fifteen-minute bucket and taken as
 * that bucket's mean (the midpoint rule). Bands start on the hour, so every
 * bucket falls inside one band.
 *
 * Sampled, not integrated, because of what a read costs: S1 runs at ~0.8 Hz
 * per cabinet and a 1,000-row page (~20 minutes) is ~3 MB, so a day read whole
 * is ~150 pages and a month ~4,500. A sample is one `limit=8` read of the
 * first half of the bucket — both cabinets, ~12 kB — whose newest row is the
 * power at the midpoint. 96 reads a day, and a day the gateway never uploaded
 * costs one: each day is probed first.
 *
 * Gaps stay gaps. The gateway never back-fills S1, so a bucket with no sample
 * near its midpoint on every cabinet is left out rather than counted as idle,
 * and the day carries the share of buckets that were measured. A day with no
 * S1 row at all comes back `missing`, never as a row of zeros.
 *
 * Where the PCS DC energy counters (S2 p0205 / p0206, fetchDailyEnergy) can answer for a whole day
 * and every bucket was sampled, the bands are scaled so the day's total is the
 * counter's rise — the metered figure the Power Station chart shows — and the
 * samples only decide how it splits across bands.
 */
const BUCKET_MS = 15 * 60_000;
const HALF_BUCKET_MS = BUCKET_MS / 2;
/** A midpoint sample older than this did not see the bucket. */
const SAMPLE_MAX_AGE_MS = 90_000;
const BUCKET_H = BUCKET_MS / 3_600_000;
/** Parallel reads. The dev proxy is HTTP/1.1, six sockets to a host. */
const POOL = 6;

interface DayTod {
  date: string;
  charge: TodAccum;
  discharge: TodAccum;
  /** Buckets sampled on every cabinet, of `expected` (to now, for today). */
  measured: number;
  expected: number;
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/* Finished days do not change — S1 is never back-filled — so they are kept,
   in memory and across reloads. A day is "finished" two hours after it ends,
   which leaves the gateway's small send queue time to drain. */
const DAY_CACHE_KEY = "ems.todDay.v1";
const SETTLE_MS = 2 * 3_600_000;
const dayCache = new Map<string, DayTod>();

function cachedDay(key: string): DayTod | undefined {
  if (dayCache.has(key)) return dayCache.get(key);
  try {
    const raw = window.localStorage.getItem(`${DAY_CACHE_KEY}.${key}`);
    if (raw) { const d = JSON.parse(raw) as DayTod; dayCache.set(key, d); return d; }
  } catch { /* storage unavailable: read again */ }
  return undefined;
}

function keepDay(key: string, d: DayTod) {
  dayCache.set(key, d);
  try { window.localStorage.setItem(`${DAY_CACHE_KEY}.${key}`, JSON.stringify(d)); } catch { /* memory only */ }
}

const powerOf = (r: FastBessSample) => {
  const v = r.data?.pcs_values?.total_active_power;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

async function sampleDay(gatewayId: string, cabinets: string[], date: string): Promise<DayTod> {
  const start = parseIst(date);
  const now = Date.now();
  const end = Math.min(start + DAY_MS, now);
  const day: DayTod = { date, charge: emptyAccum(), discharge: emptyAccum(), measured: 0, expected: 0 };

  const buckets: number[] = [];
  for (let b = start; b < start + DAY_MS && b + HALF_BUCKET_MS <= end; b += BUCKET_MS) buckets.push(b);
  day.expected = buckets.length;
  if (!buckets.length) return day;

  /* The day's newest row: none means the gateway uploaded nothing that day,
     and buckets after it cannot have a sample, so they are not asked for. */
  const probe = await fetchFastBess(gatewayId, { fromMs: start, toMs: end, limit: 1 });
  const lastTs = probe.length ? Date.parse(probe[0].sample_time_utc) : NaN;
  if (Number.isNaN(lastTs)) return day;

  await pool(buckets.filter((b) => b <= lastTs), POOL, async (b) => {
    const mid = b + HALF_BUCKET_MS;
    const rows = await fetchFastBess(gatewayId, { fromMs: b, toMs: mid, limit: 8 }).catch(() => []);
    const powers: number[] = [];
    for (const cab of cabinets) {
      const r = rows.find((x) => x.bess_id === cab);        // newest first
      const p = r ? powerOf(r) : null;
      if (!r || p == null || mid - Date.parse(r.sample_time_utc) > SAMPLE_MAX_AGE_MS) return;
      powers.push(p);
    }
    const band = todPeriod(b);
    for (const p of powers) {
      if (p > 0) day.discharge[band] += p * BUCKET_H;
      else day.charge[band] += -p * BUCKET_H;
    }
    day.measured++;
  });
  return day;
}

async function sampleRange(gatewayId: string, startDate: string, endDate: string): Promise<DayTod[]> {
  const probe = await fetchFastBess(gatewayId, { limit: 10 });
  const cabinets = [...new Set(probe.map((r) => r.bess_id).filter(Boolean))].sort();
  const now = Date.now();
  const dates: string[] = [];
  for (let d = parseIst(startDate); d <= parseIst(endDate) && d <= now; d += DAY_MS) {
    dates.push(istDate(d + DAY_MS / 2));
  }
  if (!cabinets.length) return dates.map((date) => ({ date, charge: emptyAccum(), discharge: emptyAccum(), measured: 0, expected: 1 }));

  /* Days one after another, buckets in parallel within a day: the pool is
     per day, so a month never has more than POOL reads in flight. */
  const out: DayTod[] = [];
  for (const date of dates) {
    const key = `${gatewayId}.${cabinets.join("+")}.${date}`;
    let day = cachedDay(key);
    if (!day) {
      day = await sampleDay(gatewayId, cabinets, date);
      if (parseIst(date) + DAY_MS + SETTLE_MS < now) keepDay(key, day);
    }
    out.push(day);
  }
  return out;
}

/* fetchCounterTod is asked once per counter, and charge and discharge come
   from the same samples — so one read per range, shared for a minute. */
const inflight = new Map<string, { at: number; p: Promise<{ charge: TodRow[]; discharge: TodRow[] }> }>();

function todRows(gatewayId: string, startDate: string, endDate: string) {
  const key = `${gatewayId}|${startDate}|${endDate}`;
  const hit = inflight.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = buildTodRows(gatewayId, startDate, endDate);
  inflight.set(key, { at: Date.now(), p });
  p.catch(() => inflight.delete(key));
  return p;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

async function buildTodRows(
  gatewayId: string, startDate: string, endDate: string,
): Promise<{ charge: TodRow[]; discharge: TodRow[] }> {
  const [days, counters] = await Promise.all([
    sampleRange(gatewayId, startDate, endDate),
    fetchDailyEnergy(gatewayId, startDate, endDate).catch(() => null),
  ]);
  const metered = new Map((counters?.points ?? [])
    .filter((p) => p.fromMidnight && !p.partial)
    .map((p) => [p.date, p]));

  const row = (d: DayTod, acc: TodAccum, counterKwh: number | null | undefined): TodRow => {
    if (d.measured === 0) {
      return { date: d.date, peak: 0, shoulder: 0, flat: 0, valley: 0, total: 0, missing: true, coverage: 0 };
    }
    const sampled = acc.peak + acc.shoulder + acc.flat + acc.valley;
    const complete = d.measured === d.expected;
    const scale = complete && counterKwh != null && sampled > 0 ? counterKwh / sampled : null;
    const k = scale ?? 1;
    const peak = r1(acc.peak * k), shoulder = r1(acc.shoulder * k), flat = r1(acc.flat * k), valley = r1(acc.valley * k);
    return {
      date: d.date, peak, shoulder, flat, valley,
      total: r1(peak + shoulder + flat + valley),
      coverage: d.measured / d.expected,
      metered: scale != null,
    };
  };

  return {
    charge: days.map((d) => row(d, d.charge, metered.get(d.date)?.charge)),
    discharge: days.map((d) => row(d, d.discharge, metered.get(d.date)?.discharge)),
  };
}

/**
 * Daily ToD energy for one counter — one row per date in the range up to
 * today, `missing` where the gateway uploaded nothing.
 */
export async function fetchCounterTod(
  stationId: string,
  counter: EnergyCounter,
  startDate: string,
  endDate: string,
): Promise<TodRow[]> {
  if (counter === "solar") return solarTod(stationId, startDate, endDate);
  if (counter !== "charge" && counter !== "discharge") return [];
  const rows = await todRows(stationId, startDate, endDate);
  return rows[counter];
}

async function fetchPowerQuantityReal(
  stationId: string, startDate: string, endDate: string,
): Promise<{ charge: TodRow[]; discharge: TodRow[] }> {
  return todRows(stationId, startDate, endDate);
}

/* ── ProfitReport — ToD energy × tariff rates ─────────────────────────────── */

/**
 * The rates a site's energy is priced at, per direction.
 *
 * Tariffs are commercial configuration, not telemetry, so they come from the
 * site's entry in overlay/stations.ts (SITE_OVERLAY) and nowhere else. `todRates` prices both
 * directions by band. A site with only `dieselRateRs` (Site 1: islanded, every
 * discharged kWh displaces diesel) prices discharge at that flat rate and has
 * no rate for charge — it charges from its own solar. A direction with no rate
 * is null, and the report says "no tariff" instead of printing ₹0.
 */
export type RateBasis = "tod" | "diesel" | "settings";

export interface SiteRates {
  charge: Record<TodPeriod, number> | null;
  discharge: Record<TodPeriod, number> | null;
  chargeBasis: RateBasis | null;
  dischargeBasis: RateBasis | null;
}

/**
 * Settings → Revenue (lib/revenue/master), when saved, wins over the overlay:
 * charging priced at (A) on every band, discharge at (B), the source it replaces.
 */
export function getSiteRates(
  stationId: string, master?: { chargeCostRs: number; dischargeCostRs: number } | null,
): SiteRates {
  if (master) {
    const flat = (r: number) => ({ peak: r, shoulder: r, flat: r, valley: r });
    return {
      charge: flat(master.chargeCostRs), chargeBasis: "settings",
      discharge: flat(master.dischargeCostRs), dischargeBasis: "settings",
    };
  }
  /* The id is a gateway (a site) since 25 Sep; the per-source overlay is
     still read so a rate card written there is not ignored. */
  const overlay = { ...overlayFor(stationId), ...SITE_OVERLAY_FOR(stationId) };
  if (overlay?.todRates) {
    const { peak, shoulder, flat, valley } = overlay.todRates;
    const r = { peak, shoulder, flat, valley };
    return { charge: r, discharge: r, chargeBasis: "tod", dischargeBasis: "tod" };
  }
  const diesel = overlay?.dieselRateRs;
  if (diesel != null) {
    return {
      charge: null, chargeBasis: null,
      discharge: { peak: diesel, shoulder: diesel, flat: diesel, valley: diesel }, dischargeBasis: "diesel",
    };
  }
  return { charge: null, discharge: null, chargeBasis: null, dischargeBasis: null };
}

export interface ProfitReport {
  chargeCost: ProfitRow[];
  dischargeRevenue: ProfitRow[];
  rates: SiteRates;
}

async function fetchProfitReportReal(
  stationId: string, startDate: string, endDate: string,
  master?: { chargeCostRs: number; dischargeCostRs: number } | null,
): Promise<ProfitReport> {
  const rates = getSiteRates(stationId, master);
  if (!rates.charge && !rates.discharge) return { chargeCost: [], dischargeRevenue: [], rates };
  const { charge, discharge } = await fetchPowerQuantityReal(stationId, startDate, endDate);

  const price = (r: Record<TodPeriod, number>) => (row: TodRow): ProfitRow => {
    const peak     = Math.round(row.peak     * r.peak     * 100) / 100;
    const shoulder = Math.round(row.shoulder * r.shoulder * 100) / 100;
    const flat     = Math.round(row.flat     * r.flat     * 100) / 100;
    const valley   = Math.round(row.valley   * r.valley   * 100) / 100;
    const total    = Math.round((peak + shoulder + flat + valley) * 100) / 100;
    return {
      ...row, peak, shoulder, flat, valley, total,
      // Settled revenue comes from the billing system, which this app does not
      // read. Reported as the computed total until a real settlement feed
      // exists — never as total × an invented loss factor.
      actualRevenue: total,
    };
  };

  return {
    chargeCost: rates.charge ? charge.map(price(rates.charge)) : [],
    dischargeRevenue: rates.discharge ? discharge.map(price(rates.discharge)) : [],
    rates,
  };
}

/* ── Rack and cell curves ─────────────────────────────────────────────────── */

/**
 * Empty on this backend. The gateway exposes the battery as one aggregate
 * asset and declares no rack route — see the header of adapters/gateway.ts for
 * what was measured. The plant-level equivalents of these three (max cell
 * temperature and max cell voltage spread over time) do exist and are already
 * carried by the history series, on the History page.
 */
export const fetchClusterCurve = async (
  _rackId: string, _s: string, _e: string,
): Promise<ClusterCurvePoint[]> => [];

export const fetchClusterStat = async (_rackId: string): Promise<ClusterStatInfo> => ({
  clusterMaxTempC: null,
  clusterMinTempC: null,
  clusterMaxVoltDiffMv: null,
  clusterMinVoltDiffMv: null,
});

export const fetchCellCurve = async (
  _cellId: string, _s: string, _e: string,
): Promise<CellCurvePoint[]> => [];

/* ── Exported dispatch ────────────────────────────────────────────────────── */

export const fetchPowerQuantity = async (
  stationId: string, s: string, e: string,
): Promise<{ charge: TodRow[]; discharge: TodRow[] }> =>
  fetchPowerQuantityReal(stationId, s, e);

export const fetchProfitReport = async (
  stationId: string, s: string, e: string,
  master?: { chargeCostRs: number; dischargeCostRs: number } | null,
): Promise<ProfitReport> =>
  fetchProfitReportReal(stationId, s, e, master);

/* ── Stored-energy change per day, for the round-trip column ──────────────── */

/** SOC at a day's two IST edges, per cabinet — null where no S1 sample is within two minutes. */
export type DaySocEdges = Record<string, Record<string, { start: number | null; end: number | null }>>;

/**
 * SOC from the S1 sample just before each IST midnight (or just before now,
 * for today), per cabinet and date. `cabinets` limits the read to those
 * bess ids (`bess_1`); omitted, every cabinet the gateway reports.
 */
export async function fetchDaySocEdges(
  gatewayId: string, startDate: string, endDate: string, cabinets?: string[],
): Promise<DaySocEdges> {
  let cabs = cabinets;
  if (!cabs?.length) {
    const probe = await fetchFastBess(gatewayId, { limit: 10 }).catch(() => []);
    cabs = [...new Set(probe.map((r) => r.bess_id).filter(Boolean))].sort();
  }
  const out: DaySocEdges = {};
  if (!cabs.length) return out;
  const now = Date.now();
  const edges: number[] = [];
  for (let d = parseIst(startDate); d <= parseIst(endDate) && d <= now; d += DAY_MS) edges.push(d);
  const ends = edges.map((d) => Math.min(d + DAY_MS, now));
  const instants = [...new Set([...edges, ...ends])];
  const soc = new Map<string, number | null>();
  await pool(instants.flatMap((t) => cabs!.map((c) => [t, c] as const)), POOL, async ([t, c]) => {
    const r = await fetchFastBess(gatewayId, { bessId: c, fromMs: t - 120_000, toMs: t, limit: 1 }).catch(() => []);
    const v = r[0]?.data?.bms_values?.display_soc;
    soc.set(`${t}|${c}`, typeof v === "number" && Number.isFinite(v) ? v : null);
  });
  edges.forEach((d, i) => {
    const date = istDate(d + DAY_MS / 2);
    out[date] = {};
    for (const c of cabs!) {
      out[date][c] = { start: soc.get(`${d}|${c}`) ?? null, end: soc.get(`${ends[i]}|${c}`) ?? null };
    }
  });
  return out;
}

/** Rated capacity of a cabinet (`bess_2` → external_ems_2's overlay), kWh, or null. */
export const cabinetCapacityKwh = (bessId: string): number | null =>
  overlayFor(`external_ems_${/\d+/.exec(bessId)?.[0] ?? ""}`).installedCapacity || null;

/**
 * ΔStored per date, kWh: Σ over cabinets of capacity × (SOC at the day's end
 * − SOC at its start) / 100 (fetchDaySocEdges). Null for a day where any
 * cabinet has no SOC at an edge — then the round trip cannot be corrected,
 * and the report says so rather than printing the raw ratio.
 */
export async function fetchDayStoredDelta(
  gatewayId: string, startDate: string, endDate: string, cabinets?: string[],
): Promise<Record<string, number | null>> {
  const socs = await fetchDaySocEdges(gatewayId, startDate, endDate, cabinets);
  const out: Record<string, number | null> = {};
  for (const [date, byCab] of Object.entries(socs)) {
    let kwh = 0;
    for (const [c, e] of Object.entries(byCab)) {
      const cap = cabinetCapacityKwh(c);
      if (e.start == null || e.end == null || cap == null) { kwh = NaN; break; }
      kwh += (cap * (e.end - e.start)) / 100;
    }
    out[date] = Number.isFinite(kwh) ? r1(kwh) : null;
  }
  return out;
}
