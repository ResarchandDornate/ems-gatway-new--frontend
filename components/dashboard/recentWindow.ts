/**
 * The S2 series, reshaped for the dashboard's two recent curves.
 *
 * These cards used to be "· today", fed by a disabled stub, and then S1's
 * window — 1,000 samples at 1 Hz, about 17 minutes. The API still answers only
 * the newest 1,000 rows of anything, but the S2 SOC and battery-power points
 * publish every ~11 s, so the same 1,000 rows reach about an hour and a half.
 * See fetchS2Recent for which points and how they were checked against S1.
 *
 * The label is read off the data (spanMin), never off what was asked for, so
 * it cannot claim more than the rows hold.
 *
 * Thirty-second buckets: the two cabinets and the two points publish on the
 * same tick, so a bucket lines them up, and ~180 points a line is plenty.
 */

import type { S2RecentSeries } from "@/lib/api/services/dashboardCentral.service";
import { reading, type FastBessSample } from "@/lib/central";

const BUCKET_MS = 30_000;

export interface RecentRow {
  ts: number;
  t: string;
  /** Site or cabinet battery power (DC side), kW. + discharge · − charge. */
  power: number | null;
  /** One SOC column per cabinet, keyed `soc_<bessId>`. */
  [soc: `soc_${string}`]: number | null;
  /** One power column per cabinet, keyed `pwr_<bessId>`, kW; `power` is their sum. */
  [pwr: `pwr_${string}`]: number | null;
}

function hms(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Rows for the selected cabinets, oldest first, plus the covered span in
 * minutes (null when there is nothing to cover).
 *
 * Power is summed across the selection only in buckets where EVERY selected
 * cabinet has a reading: a sum over one of two cabinets is not a smaller site
 * figure, it is a wrong one. SOC is not summed or averaged at all — averaging
 * assumes equal capacity, which no register states — so on Total each cabinet
 * keeps its own line.
 */
export function recentRows(
  series: Record<string, S2RecentSeries> | undefined,
  cabinets: { bessId: string; sourceId: string }[],
): { rows: RecentRow[]; spanMin: number | null } {
  if (!series || cabinets.length === 0) return { rows: [], spanMin: null };

  type Acc = { soc: number; socN: number; p: number; pN: number };
  const buckets = new Map<number, Map<string, Acc>>();
  let first = Infinity, last = -Infinity;

  const add = (bessId: string, ts: number, k: "soc" | "p", v: number) => {
    first = Math.min(first, ts); last = Math.max(last, ts);
    const key = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
    const per = buckets.get(key) ?? new Map<string, Acc>();
    const a = per.get(bessId) ?? { soc: 0, socN: 0, p: 0, pN: 0 };
    if (k === "soc") { a.soc += v; a.socN++; } else { a.p += v; a.pN++; }
    per.set(bessId, a);
    buckets.set(key, per);
  };

  for (const c of cabinets) {
    const s = series[c.sourceId];
    if (!s) continue;
    for (const pt of s.soc) add(c.bessId, pt.ts, "soc", pt.value);
    for (const pt of s.power) add(c.bessId, pt.ts, "p", pt.value);
  }

  const rows: RecentRow[] = [...buckets.keys()].sort((x, y) => x - y).map((key) => {
    const per = buckets.get(key)!;
    const row: RecentRow = { ts: key, t: hms(key), power: null };
    let sum = 0, complete = true;
    for (const c of cabinets) {
      const a = per.get(c.bessId);
      row[`soc_${c.bessId}`] = a && a.socN ? a.soc / a.socN : null;
      row[`pwr_${c.bessId}`] = a && a.pN ? a.p / a.pN : null;
      if (a && a.pN) sum += a.p / a.pN; else complete = false;
    }
    row.power = complete ? sum : null;
    return row;
  });

  const spanMin = Number.isFinite(first) && last > first ? Math.max(1, Math.round((last - first) / 60_000)) : null;
  return { rows, spanMin };
}

/** Newest value of an S1 flag for one cabinet: 1 → true, 0 → false. */
export function s1Flag(
  windows: Record<string, FastBessSample[]> | undefined,
  bessId: string,
  name: string,
  freshMs: number,
): boolean | null {
  const s = windows?.[bessId]?.[0];
  if (!s) return null;
  const t = Date.parse(s.sample_time_utc ?? "");
  if (Number.isNaN(t) || Date.now() - t > freshMs) return null;
  const v = reading(s, "pcs_values", name);
  return v === 1 ? true : v === 0 ? false : null;
}
