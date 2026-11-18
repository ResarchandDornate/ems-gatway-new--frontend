"use client";

/**
 * Data Analysis — what the central backend can answer TODAY, per cabinet.
 *
 * The four analysis views (demand, efficiency, flows, fleet) are built on a
 * multi-day history, and the central backend has none: S2's `point_id` read
 * reaches about 35 minutes per asset and there is no from/to. Those services
 * still target the disabled NorthBound store and resolve empty. This file is
 * the part that does not need history.
 *
 * ── Counters the cabinets keep themselves ──────────────────────────────────
 *
 * An efficiency over a period needs the energy moved over that period, and the
 * only way to get that without history is a counter that the equipment has
 * already reset at the period's start. The BMS keeps exactly that:
 *
 *   p1063 / p1064  monthly cumulative charge / discharge, kWh  (month to date)
 *   p1065 / p1066  yearly  cumulative charge / discharge, kWh  (year to date)
 *
 * and the PCS keeps the lifetime ones:
 *
 *   p0203 / p0204  AC cumulative charge / discharge, kWh
 *   p0205 / p0206  DC cumulative charge / discharge, kWh
 *
 * So `discharge ÷ charge` is computable now for the month, the year and the
 * lifetime — one reading of each counter, no differencing. It is an UNCORRECTED
 * ratio: the pack does not start and end the period at the same SOC, so the
 * energy still stored is missing from the numerator. Over a month that error is
 * bounded by one pack's capacity against a month's throughput, which is why the
 * month figure is worth showing and a day figure would not be. The screen says
 * so beside the number.
 *
 * ── The yearly registers read ×65 536 ──────────────────────────────────────
 *
 * Measured 28 Sep: p1065 = 488 570 880, p1066 = 471 269 376 — exactly 7 455 and
 * 7 191 times 65 536. A 16-bit value landed in the high word of a 32-bit
 * decode. The kWh are therefore not shown (a figure 65 536 times too large is
 * not a figure), but the RATIO is scale-free and is reported. When the
 * gateway's register map is fixed the kWh start rendering with no change here.
 *
 * ── Live EMS settings ──────────────────────────────────────────────────────
 *
 * The demand limiter (p0050 / p0054 / p0055) and anti-reverse-flow (p0051 /
 * p0056 / p0057) are configuration, not history, so the views that are
 * otherwise empty can still say what the EMS is set to — per cabinet, because
 * each EMS holds its own copy and they are not guaranteed to agree.
 */

import { fetchGeneral, numeric, type GeneralRecord } from "@/lib/central";

/** `external_ems_1_bms` → `external_ems_1`. */
const sourceOf = (assetId: string) => /^(external_ems_\d+)/.exec(assetId)?.[1] ?? null;

/**
 * Newest value of each point, per source.
 *
 * One small point_id read each rather than a substream read: a substream at
 * limit 1000 spans seconds and is not guaranteed to contain every point once,
 * whereas a point read at 50 rows always carries both cabinets.
 */
async function newestByPoint(
  gatewayId: string,
  pointIds: string[],
): Promise<Map<string, Map<string, { value: number | null; at: string | null }>>> {
  const per = await Promise.all(
    pointIds.map((p) =>
      fetchGeneral(gatewayId, { pointId: p, limit: 50 }).catch(() => [] as GeneralRecord[]),
    ),
  );
  /* source → point → newest reading */
  const out = new Map<string, Map<string, { value: number | null; at: string | null }>>();
  per.forEach((rows, i) => {
    const pid = pointIds[i];
    for (const r of rows) {
      const src = r.asset_id ? sourceOf(r.asset_id) : null;
      if (!src) continue;
      const m = out.get(src) ?? new Map();
      if (!m.has(pid)) m.set(pid, { value: numeric(r), at: r.sample_time_utc });   // newest first
      out.set(src, m);
    }
  });
  return out;
}

/* ── Energy counters ──────────────────────────────────────────────────────── */

export interface CabinetCounters {
  sourceId: string;
  /** BMS month-to-date, kWh (DC side, at the pack). */
  monthChargeKwh: number | null;
  monthDischargeKwh: number | null;
  /** BMS year-to-date, kWh. Null when the register reads word-swapped. */
  yearChargeKwh: number | null;
  yearDischargeKwh: number | null;
  /** discharge ÷ charge year to date, %. Scale-free, so valid even when the kWh are not. */
  yearRatioPct: number | null;
  /** True when the yearly registers read as an exact multiple of 65 536. */
  yearWordSwapped: boolean;
  /** PCS lifetime, kWh. */
  acChargeKwh: number | null;
  acDischargeKwh: number | null;
  dcChargeKwh: number | null;
  dcDischargeKwh: number | null;
  /** Newest sample time among the counters read. */
  at: string | null;
}

const COUNTER_POINTS = ["p1063", "p1064", "p1065", "p1066", "p0203", "p0204", "p0205", "p0206"];

/** discharge ÷ charge as a percentage, or null when it is not a ratio of anything. */
export function ratioPct(discharge: number | null, charge: number | null): number | null {
  if (discharge == null || charge == null || charge <= 0) return null;
  return Math.round((discharge / charge) * 1000) / 10;
}

/** A 16-bit value decoded into the high word: non-zero and an exact multiple of 2^16. */
const looksWordSwapped = (v: number | null) => v != null && v >= 65_536 && v % 65_536 === 0;

export async function fetchCabinetCounters(gatewayId: string): Promise<CabinetCounters[]> {
  if (!gatewayId) return [];
  const bySource = await newestByPoint(gatewayId, COUNTER_POINTS);

  return [...bySource.keys()].sort().map((sourceId) => {
    const m = bySource.get(sourceId)!;
    const v = (p: string) => m.get(p)?.value ?? null;
    /* A word-swapped reading carries its 16-bit value in the high word, so it
       is recoverable: shift it back down. This used to discard the reading and
       show "—" for the year's charge and discharge. */
    const unswap = (x: number | null) => (looksWordSwapped(x) ? (x as number) / 65_536 : x);
    const rawYc = v("p1065"), rawYd = v("p1066");
    const swapped = looksWordSwapped(rawYc) || looksWordSwapped(rawYd);
    const yc = unswap(rawYc), yd = unswap(rawYd);
    const at = [...m.values()].map((x) => x.at).filter((x): x is string => !!x).sort().pop() ?? null;
    return {
      sourceId,
      monthChargeKwh: v("p1063"),
      monthDischargeKwh: v("p1064"),
      yearChargeKwh: yc,
      yearDischargeKwh: yd,
      yearRatioPct: ratioPct(yd, yc),
      yearWordSwapped: swapped,
      acChargeKwh: v("p0203"),
      acDischargeKwh: v("p0204"),
      dcChargeKwh: v("p0205"),
      dcDischargeKwh: v("p0206"),
      at,
    };
  });
}

/* ── EMS limiter settings ─────────────────────────────────────────────────── */

export interface EmsLimits {
  sourceId: string;
  demandEnabled: boolean | null;
  /** `demand`, kW — the dictionary does not say whether setting or measurement. */
  demandKw: number | null;
  demandLimitPct: number | null;
  antiReverseEnabled: boolean | null;
  antiReverseLowerKw: number | null;
  antiReverseUpperKw: number | null;
}

const LIMIT_POINTS = ["p0050", "p0054", "p0055", "p0051", "p0056", "p0057"];

export async function fetchEmsLimits(gatewayId: string): Promise<EmsLimits[]> {
  if (!gatewayId) return [];
  const bySource = await newestByPoint(gatewayId, LIMIT_POINTS);
  const flag = (n: number | null) => (n == null ? null : n === 1);

  return [...bySource.keys()].sort().map((sourceId) => {
    const m = bySource.get(sourceId)!;
    const v = (p: string) => m.get(p)?.value ?? null;
    return {
      sourceId,
      demandEnabled: flag(v("p0050")),
      demandKw: v("p0054"),
      demandLimitPct: v("p0055"),
      antiReverseEnabled: flag(v("p0051")),
      antiReverseLowerKw: v("p0056"),
      antiReverseUpperKw: v("p0057"),
    };
  });
}
