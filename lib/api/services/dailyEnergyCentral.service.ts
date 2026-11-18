/**
 * Daily charge and discharge, from the PCS lifetime energy counters.
 *
 * Each PCS publishes two ever-rising counters on the central backend:
 *   p0203  ac_cumulative_charge_energy     kWh, every ~60 s, kept 3 years
 *   p0204  ac_cumulative_discharge_energy
 * A day's energy is the counter's rise over that day: its last reading of the
 * day minus its last reading before the day began. Summed over the cabinets.
 *
 * The limit: `/general` takes no date range and returns at most the newest
 * 1,000 rows, shared by every cabinet — about 2.8 days of counters on Site 1.
 * So only recent days can be answered. A day is left null (a gap on the chart,
 * never a 0) when:
 *   · no reading at all falls inside it (the gateway was silent, or the day
 *     is older than the window), or
 *   · a counter went backwards (a reset — the rise is unknowable).
 * Today is measured up to the newest reading and marked partial, as is any day
 * whose readings stop well before it ended, and any day with no reading near
 * its midnight — that one is measured from its own first reading, so energy
 * from a gap before it is never put on its bar.
 */

import { fetchGeneral, numeric, fetchFastBess, fetchPowerSocRange, fetchHistory, type GeneralRecord } from "@/lib/central";
import { istDate, istMidnight, parseIst } from "@/lib/api/time";
import { bucketsOf, type Period } from "@/lib/charts/period";
import { bucketRise } from "@/lib/energy/boundaryRise";

/* The PCS's DC energy counters. Not the AC pair (p0203 / p0204): on this site
   AC discharge reads above DC discharge every day (cabinet 1 by ~19 %, 10–12
   Oct 2026) and AC charge below DC charge, which inverter losses rule out.
   The DC pair holds at ~96 % per day. */
const P_CHARGE = "p0205";
const P_DISCHARGE = "p0206";
/* The AC pair, only where the DC pair has no history (fetchEnergyBuckets). */
const P_AC_CHARGE = "p0203";
const P_AC_DISCHARGE = "p0204";
const DAY_MS = 86_400_000;
/** A day whose last reading is this far short of its end is marked partial. */
const PARTIAL_GAP_MS = 15 * 60_000;
/**
 * The reading a day is measured FROM must be this close to its midnight.
 * Farther back, the rise since then includes energy from the days in between —
 * on 28 Sep the counters resumed after a 57-hour gap, and measuring from the
 * last reading before midnight (25 Sep) put three days of energy on one bar.
 * Past this, the day is measured from its first reading instead, and marked
 * partial.
 */
const ANCHOR_MAX_GAP_MS = 30 * 60_000;

export interface DailyEnergyPoint {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** kWh, or null when the window cannot answer for this day. */
  charge: number | null;
  discharge: number | null;
  /** Today, or a day the readings stop short of. */
  partial: boolean;
  /** Measured from a reading at its midnight on every cabinet — so the figure
   *  covers the day from its start, even if it is still running. */
  fromMidnight: boolean;
}

export interface DailyEnergy {
  points: DailyEnergyPoint[];
  /** The span of counter readings the backend returned, epoch ms. */
  coverage: { from: number; to: number } | null;
}

type Series = Map<string, Array<{ t: number; v: number }>>;

/** Asset ids are `<sourceId>_pcs`; keep only the cabinets asked for. */
const inScope = (assetId: string, sourceIds?: string[]) =>
  !sourceIds?.length || sourceIds.some((id) => assetId.startsWith(`${id}_`));

async function counterSeries(gatewayId: string, pointId: string, sourceIds?: string[], fromMs?: number): Promise<Series> {
  /* The live newest 1,000 (~2.8 days), plus what the collector stored from
     `fromMs` on — one row per 10 min is plenty to difference a counter. */
  const [live, stored] = await Promise.all([
    fetchGeneral(gatewayId, { pointId, limit: 1000 }),
    fromMs != null ? fetchHistory<GeneralRecord>("general", { fromMs, pointId, stepMs: 10 * 60_000 }) : Promise.resolve([] as GeneralRecord[]),
  ]);
  const seen = new Set(live.map((r) => `${r.asset_id}|${r.sample_time_utc}`));
  const rows = live.concat(stored.filter((r) => !seen.has(`${r.asset_id}|${r.sample_time_utc}`)));
  const byAsset: Series = new Map();
  for (const r of rows) {
    if (r.asset_id && !inScope(r.asset_id, sourceIds)) continue;
    const t = Date.parse(r.sample_time_utc ?? "");
    const v = numeric(r);
    if (!r.asset_id || Number.isNaN(t) || v == null) continue;
    const list = byAsset.get(r.asset_id) ?? [];
    list.push({ t, v });
    byAsset.set(r.asset_id, list);
  }
  for (const list of byAsset.values()) list.sort((a, b) => a.t - b.t);
  return byAsset;
}

/** Last reading at or before `t`, or null. */
function lastAtOrBefore(list: Array<{ t: number; v: number }>, t: number) {
  let found: { t: number; v: number } | null = null;
  for (const r of list) {
    if (r.t <= t) found = r; else break;
  }
  return found;
}

/**
 * The counter AT a midnight, read off the readings either side of it when both
 * are within ANCHOR_MAX_GAP_MS — straight-line between them. Overnight the
 * counters report about every 30 min, so the last reading of a day is often
 * 20–30 min short of midnight; without this, every such day read as partial
 * (11 Oct 2026: last reading 23:34 IST) and yesterday's figure went blank.
 */
function valueAt(list: Array<{ t: number; v: number }>, t: number): { t: number; v: number } | null {
  const before = lastAtOrBefore(list, t);
  if (before?.t === t) return before;
  const after = list.find((r) => r.t > t);
  if (!before || !after || t - before.t > ANCHOR_MAX_GAP_MS || after.t - t > ANCHOR_MAX_GAP_MS) return null;
  return { t, v: before.v + ((after.v - before.v) * (t - before.t)) / (after.t - before.t) };
}

/** IST midnight of a YYYY-MM-DD date — the site's day, not the browser's. */
const midnight = (ymd: string) => parseIst(ymd);
const ymdOf = (ms: number) => istDate(ms);

/** One day's rise across every cabinet, or null if any cabinet cannot answer. */
function dayRise(series: Series, start: number, end: number): { kwh: number | null; partial: boolean; fromMidnight: boolean } {
  if (series.size === 0) return { kwh: null, partial: false, fromMidnight: false };
  let total = 0;
  let partial = false;
  let fromMidnight = true;
  for (const list of series.values()) {
    const last = valueAt(list, end) ?? lastAtOrBefore(list, end);
    if (!last || last.t <= start) return { kwh: null, partial: false, fromMidnight: false };
    const before = valueAt(list, start) ?? lastAtOrBefore(list, start);
    let from = before;
    if (!before || start - before.t > ANCHOR_MAX_GAP_MS) {
      // No reading near midnight: measure from the day's first reading.
      from = list.find((r) => r.t > start) ?? null;
      partial = true;
      fromMidnight = false;
    }
    if (!from) return { kwh: null, partial: false, fromMidnight: false };
    const rise = last.v - from.v;
    if (rise < 0) return { kwh: null, partial: false, fromMidnight: false };
    total += rise;
    if (end - last.t > PARTIAL_GAP_MS) partial = true;
  }
  return { kwh: total, partial, fromMidnight };
}

/**
 * Daily charge / discharge for every date from `fromYmd` to `toYmd`
 * (inclusive, local calendar).
 */
export async function fetchDailyEnergy(
  gatewayId: string, fromYmd: string, toYmd: string, sourceIds?: string[],
): Promise<DailyEnergy> {
  if (!gatewayId) return { points: [], coverage: null };

  const [charge, discharge] = await Promise.all([
    counterSeries(gatewayId, P_CHARGE, sourceIds, parseIst(fromYmd) - 86_400_000),
    counterSeries(gatewayId, P_DISCHARGE, sourceIds, parseIst(fromYmd) - 86_400_000),
  ]);

  // The window every cabinet covers: from the latest "first reading" to the
  // newest reading — earlier than that, some cabinet cannot answer.
  let covFrom = -Infinity, covTo = -Infinity;
  for (const s of [charge, discharge]) {
    for (const list of s.values()) {
      if (!list.length) continue;
      covFrom = Math.max(covFrom, list[0].t);
      covTo = Math.max(covTo, list[list.length - 1].t);
    }
  }
  const coverage = Number.isFinite(covFrom) && Number.isFinite(covTo) ? { from: covFrom, to: covTo } : null;

  const now = Date.now();
  const points: DailyEnergyPoint[] = [];
  for (let day = midnight(fromYmd); day <= midnight(toYmd); day += DAY_MS) {
    // Re-anchor on the calendar so a DST-free zone and a DST zone both land on
    // local midnights (IST has none, but the browser might not be in IST).
    const start = midnight(ymdOf(day + DAY_MS / 2));
    const end = Math.min(start + DAY_MS, now);
    if (start > now) break;
    const c = dayRise(charge, start, end);
    const d = dayRise(discharge, start, end);
    const isToday = start + DAY_MS > now;
    points.push({
      date: ymdOf(start),
      charge: c.kwh,
      discharge: d.kwh,
      partial: isToday || c.partial || d.partial,
      fromMidnight: c.fromMidnight && d.fromMidnight,
    });
  }

  return { points, coverage };
}

/**
 * Today's charge / discharge so far, for KPI tiles — or nulls.
 *
 * Only when measured from a reading at midnight: a tile has no tooltip to say
 * "from 08:53", and a figure that silently skips the morning reads as the
 * day's total. The chart can show such days; a tile cannot.
 */
export interface TodayEnergy {
  charge: number | null;
  discharge: number | null;
  /**
   * Null when the figures are the counters' rise since midnight. Otherwise
   * they are an ESTIMATE from the fast stream's power, covering only from this
   * time (epoch ms) — render it as "since HH:MM · estimated".
   */
  estimatedSince: number | null;
}

const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

export async function fetchTodayEnergy(gatewayId: string, sourceIds?: string[]): Promise<TodayEnergy> {
  const today = ymdOf(Date.now());
  const { points } = await fetchDailyEnergy(gatewayId, today, today, sourceIds).catch(() => ({ points: [] as DailyEnergyPoint[] }));
  const p = points[0];
  if (p && p.fromMidnight) return { charge: r1(p.charge), discharge: r1(p.discharge), estimatedSince: null };
  /* The counters cannot answer (no midnight reading — on 1 Oct their stream
     had been stalled since 28 Sep). Fall back to integrating the fast
     stream's power, clearly labelled. */
  return estimateTodayFromPower(gatewayId, sourceIds).catch(() => ({ charge: null, discharge: null, estimatedSince: null }));
}

/** Longest step integrated across; a longer hole is left out, not bridged. */
const MAX_STEP_MS = 60_000;

/**
 * Today's charge / discharge estimated from the fast stream (S1): PCS AC power
 * (`total_active_power`, + discharging · − charging) integrated over time since
 * local midnight, per cabinet, summed.
 *
 * An estimate, and labelled as one: it is AC at the inverter, not the
 * counters' metered figure; it covers only from the first reading today; and
 * gaps over a minute are skipped, not filled. Null when no cabinet has a reading today.
 */
export async function estimateTodayFromPower(gatewayId: string, sourceIds?: string[]): Promise<TodayEnergy> {
  const none: TodayEnergy = { charge: null, discharge: null, estimatedSince: null };
  if (!gatewayId) return none;
  const start = istMidnight();

  const probe = await fetchFastBess(gatewayId, { limit: 10 });
  const cabinets = [...new Map(
    probe.filter((r) => r.bess_id && (!sourceIds?.length || sourceIds.includes(r.source_id)))
      .map((r) => [r.bess_id, r.source_id] as const),
  ).keys()];
  if (cabinets.length === 0) return none;

  /* Asked for midnight → now (from_time/to_time), so the estimate starts at
     the day's first reading rather than wherever the newest 1,000 began. */
  const perCab = await Promise.all(cabinets.map((b) =>
    fetchPowerSocRange(gatewayId, { bessId: b, fromMs: start, toMs: Date.now() }).then((r) => r.points)));
  let charge = 0, discharge = 0, since = Infinity, any = false;
  for (const rows of perCab) {
    const pts = rows
      .map((r) => ({ t: r.ts, p: r.power }))
      .filter((x): x is { t: number; p: number } => x.t >= start && x.p != null)
      .sort((a, b) => a.t - b.t);
    if (pts.length < 2) continue;
    any = true;
    since = Math.min(since, pts[0].t);
    for (let i = 1; i < pts.length; i++) {
      const dt = pts[i].t - pts[i - 1].t;
      if (dt <= 0 || dt > MAX_STEP_MS) continue;
      const kwh = ((pts[i - 1].p + pts[i].p) / 2) * (dt / 3_600_000);   // trapezoid
      if (kwh > 0) discharge += kwh; else charge += -kwh;
    }
  }
  if (!any) return none;
  return { charge: r1(charge), discharge: r1(discharge), estimatedSince: since };
}

/**
 * Lifetime charge / discharge: the newest reading of each cabinet's counter,
 * summed. Null unless every cabinet in scope has one — a missing cabinet would
 * quietly halve the figure.
 */
export async function fetchLifetimeEnergy(
  gatewayId: string, sourceIds?: string[],
): Promise<{ charge: number | null; discharge: number | null }> {
  if (!gatewayId) return { charge: null, discharge: null };
  const newest = async (pointId: string) => {
    const rows = await fetchGeneral(gatewayId, { pointId, limit: 20 });
    const by = new Map<string, number>();
    for (const r of rows) {           // newest first
      const v = numeric(r);
      if (!r.asset_id || v == null || v <= 0 || by.has(r.asset_id) || !inScope(r.asset_id, sourceIds)) continue;
      by.set(r.asset_id, v);
    }
    if (by.size === 0 || (sourceIds?.length && by.size < sourceIds.length)) return null;
    return Math.round([...by.values()].reduce((a, b) => a + b, 0) * 10) / 10;
  };
  const [charge, discharge] = await Promise.all([newest(P_CHARGE), newest(P_DISCHARGE)]);
  return { charge, discharge };
}

/** " · est. since 10:06" for a TodayEnergy estimate, or "" for counter figures. */
export function estimateNote(since: number | null | undefined): string {
  if (since == null) return "";
  return ` · est. since ${new Date(since).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

/* ── Energy per bucket, for the Day / Week / Month / Year charts ───────────── */

export interface EnergyBucket {
  label: string;
  /** Bucket start, epoch ms. */
  ts: number;
  /** kWh, or null when the counters cannot answer for this bucket. */
  charge: number | null;
  discharge: number | null;
  /** The bucket is not fully covered (still running, or a reading missing at an edge). */
  partial: boolean;
}

/**
 * Charge and discharge per bucket of a period: hours on a Day, days on a Week
 * or Month, months on a Year — each the PCS counters' rise across it, by the
 * same rule as the daily figures (dayRise: anchored at the bucket's start when
 * a reading is near it, null where no reading falls inside).
 */
/**
 * Charge / discharge per bucket from the fast stream's AC power, for the part
 * of the buckets since local midnight only: a day of samples is a few reads
 * per cabinet, a week would be hundreds. Used only where the energy counters
 * have nothing (the site-scoped backend publishes none). An estimate — AC at
 * the inverter, gaps over a minute skipped. A bucket with no samples is left
 * out (a gap), never 0.
 */
async function powerBuckets(
  gatewayId: string, buckets: { from: number; to: number }[], sourceIds?: string[],
): Promise<Map<number, { c: number; d: number }>> {
  const out = new Map<number, { c: number; d: number }>();
  const now = Date.now();
  const start = Math.max(istMidnight(), buckets[0]?.from ?? 0);
  if (!buckets.some((b) => b.to > start && b.from < now)) return out;
  const probe = await fetchFastBess(gatewayId, { limit: 10 });
  const cabinets = [...new Set(probe
    .filter((r) => r.bess_id && (!sourceIds?.length || sourceIds.includes(r.source_id)))
    .map((r) => r.bess_id))];
  const perCab = await Promise.all(cabinets.map((b) =>
    fetchPowerSocRange(gatewayId, { bessId: b, fromMs: start, toMs: now }).then((r) => r.points)));
  for (const rows of perCab) {
    const pts = rows
      .filter((x): x is typeof x & { power: number } => x.ts >= start && x.power != null)
      .sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < pts.length; i++) {
      const dt = pts[i].ts - pts[i - 1].ts;
      if (dt <= 0 || dt > MAX_STEP_MS) continue;
      const mid = pts[i - 1].ts + dt / 2;
      const bi = buckets.findIndex((b) => mid >= b.from && mid < b.to);
      if (bi < 0) continue;
      const kwh = ((pts[i - 1].power + pts[i].power) / 2) * (dt / 3_600_000);   // + discharge · − charge
      const cur = out.get(bi) ?? { c: 0, d: 0 };
      if (kwh > 0) cur.d += kwh; else cur.c += -kwh;
      out.set(bi, cur);
    }
  }
  return out;
}

export async function fetchEnergyBuckets(
  gatewayId: string, period: Period, sourceIds?: string[],
): Promise<EnergyBucket[]> {
  if (!gatewayId) return [];
  const since = period.from - DAY_MS;
  const [charge, discharge] = await Promise.all([
    counterSeries(gatewayId, P_CHARGE, sourceIds, since),
    counterSeries(gatewayId, P_DISCHARGE, sourceIds, since),
  ]);
  const now = Date.now();
  const buckets = period.range === "day"
    ? Array.from({ length: 24 }, (_, h) => ({ from: period.from + h * 3_600_000, to: period.from + (h + 1) * 3_600_000, label: String(h).padStart(2, "0") }))
    : bucketsOf(period);
  /* Each bar is the counter between its edges (lib/energy/boundaryRise), so
     hours add up to their day and days to their week. */
  const rise = (s: Series, b: { from: number; to: number }) => bucketRise(s, b.from, b.to, now);
  const dc = buckets.map((b) => (b.from > now ? { c: null, d: null } : { c: rise(charge, b), d: rise(discharge, b) }));

  /* The DC pair has only been stored since 13 Oct 2026; before that the
     collector kept the AC pair. A bar the DC counters cannot answer is read
     off the AC ones rather than left empty. */
  let ac: { c: number | null; d: number | null }[] | null = null;
  if (dc.some((x, i) => buckets[i].from <= now && (x.c == null || x.d == null))) {
    const [acC, acD] = await Promise.all([
      counterSeries(gatewayId, P_AC_CHARGE, sourceIds, since).catch(() => new Map() as Series),
      counterSeries(gatewayId, P_AC_DISCHARGE, sourceIds, since).catch(() => new Map() as Series),
    ]);
    ac = buckets.map((b) => (b.from > now ? { c: null, d: null } : { c: rise(acC, b), d: rise(acD, b) }));
  }
  const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  /* No counters at all (the site-scoped backend): today's buckets from power. */
  const none = (x: { c: number | null; d: number | null } | undefined) => !x || (x.c == null && x.d == null);
  const est = buckets.every((_, i) => none(dc[i]) && none(ac?.[i]))
    ? await powerBuckets(gatewayId, buckets, sourceIds).catch(() => new Map<number, { c: number; d: number }>())
    : new Map<number, { c: number; d: number }>();
  return buckets.map((b, i) => ({
    label: b.label, ts: b.from,
    charge: r1(dc[i].c ?? ac?.[i].c ?? est.get(i)?.c ?? null),
    discharge: r1(dc[i].d ?? ac?.[i].d ?? est.get(i)?.d ?? null),
    partial: b.to > now || est.has(i),
  }));
}
