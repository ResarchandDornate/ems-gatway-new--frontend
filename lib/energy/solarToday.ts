"use client";

/**
 * Today's PV energy, integrated from the controller's view of the inverter.
 *
 * There is no yield register: S6 carries power, not energy, and the Solis
 * daily-yield register is not read. So this is ∫ active_power_kw dt over
 * today's IST rows of S5 (data.solis, online reads) and S6 (GOOD reads),
 * merged and de-duplicated by time, by trapezoids — a gap of more than
 * five minutes is not bridged, because nobody knows what the sun did in it.
 *
 * Neither stream has from/to. S5's 1,000 rows reached back to about 08:00 IST
 * on 8 Oct, S6's to about 12:30, so a morning is usually only partly covered:
 * `isFloor` says the figure is at least this much, and `fromTs` from when.
 */

import { fetchController, fetchSolis, fetchHistory, snapshotsOf, isGoodRead } from "@/lib/central";
import { istMidnight } from "@/lib/api/time";

const MAX_GAP_MS = 5 * 60_000;
/** Earliest IST hour PV can start; coverage starting later misses some sun. */
const SUNRISE_HOUR = 6;

export interface SolarToday {
  kwh: number | null;
  /** First and last reading integrated, epoch ms. */
  fromTs: number | null;
  toTs: number | null;
  /** True when the readings start after sunrise or have gaps: at least `kwh`. */
  isFloor: boolean;
  /** Minutes of the covered span left out for gaps. */
  gapMin: number;
}

/**
 * Every PV power reading the backend still holds, oldest first, merged from
 * S5 (online reads) and S6 (GOOD reads), kW, never negative.
 */
export async function fetchSolarPoints(gatewayId: string, fromMs: number = istMidnight()): Promise<[number, number][]> {
  /* Live reads reach back hours; the collector's store (app/api/history)
     reaches back to the day it started, so a whole day — or a month — can be
     integrated once it has been running. */
  type Kw = { sample_time_utc: string; kw: number };
  const [ctl, sol, storedCtl, storedSol] = await Promise.all([
    fetchController(gatewayId, { limit: 1000 }).catch(() => []),
    fetchSolis(gatewayId, { limit: 1000 }).catch(() => []),
    fetchHistory<Kw>("controller", { fromMs, shape: "solar" }),
    fetchHistory<Kw>("solis", { fromMs, shape: "solar" }),
  ]);
  const byTs = new Map<number, number>();
  for (const r of [...storedCtl, ...storedSol]) {
    const ts = Date.parse(r.sample_time_utc ?? "");
    if (Number.isFinite(ts) && Number.isFinite(r.kw)) byTs.set(ts, Math.max(0, r.kw));
  }
  for (const r of ctl) {
    const ts = Date.parse(r.sample_time_utc ?? "");
    const s = r.data?.solis;
    const kw = s?.active_power_kw;
    if (Number.isFinite(ts) && s?.online === true && typeof kw === "number" && Number.isFinite(kw)) byTs.set(ts, Math.max(0, kw));
  }
  for (const snap of snapshotsOf(sol)) {
    const kw = snap.solis.active_power_kw;
    if (isGoodRead(snap.solis) && typeof kw === "number" && Number.isFinite(kw)) byTs.set(snap.ts, Math.max(0, kw));
  }
  return [...byTs].sort(([a], [b]) => a - b);
}

/** Trapezoids between consecutive readings no more than MAX_GAP_MS apart. */
export function solarSegments(pts: [number, number][]): { t0: number; t1: number; kwh: number }[] {
  const out: { t0: number; t1: number; kwh: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [t0, p0] = pts[i - 1], [t1, p1] = pts[i];
    if (t1 - t0 > MAX_GAP_MS) continue;
    out.push({ t0, t1, kwh: ((p0 + p1) / 2) * ((t1 - t0) / 3_600_000) });
  }
  return out;
}

export async function fetchSolarToday(gatewayId: string): Promise<SolarToday> {
  const since = istMidnight();
  const pts = (await fetchSolarPoints(gatewayId)).filter(([t]) => t >= since);
  if (pts.length < 2) return { kwh: null, fromTs: pts[0]?.[0] ?? null, toTs: pts[0]?.[0] ?? null, isFloor: true, gapMin: 0 };

  let kwh = 0, covered = 0;
  for (const seg of solarSegments(pts)) { kwh += seg.kwh; covered += seg.t1 - seg.t0; }
  const fromTs = pts[0][0], toTs = pts[pts.length - 1][0];
  const gap = (toTs - fromTs) - covered;
  const startsLate = fromTs > since + SUNRISE_HOUR * 3_600_000 && pts[0][1] > 0.5;
  return {
    kwh: Math.round(kwh * 10) / 10,
    fromTs, toTs,
    isFloor: startsLate || gap > 0,
    gapMin: Math.round(gap / 60_000),
  };
}
