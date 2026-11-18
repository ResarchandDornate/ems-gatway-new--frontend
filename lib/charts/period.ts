/**
 * Day / Week / Month / Year periods, Apple Health style, in the site's zone.
 *
 * A period is the unit holding an anchor instant: the IST day, the rolling
 * seven days ending on the anchor's day, the calendar month or year. Moving
 * back or forward steps one whole unit; switching range keeps the anchor, so
 * "this Thursday" becomes "the 7 days to this Thursday", then "October", then
 * "2026".
 *
 * The dashboard has its own set (DASHBOARD_RANGES): 1 Hour — the rolling
 * sixty minutes to the anchor's next five-minute mark — 1 Day, Week, and the
 * rolling 28 Days ending on the anchor's day.
 *
 * Aggregation is per range and per kind of parameter (aggregate below):
 *   Hour   the readings themselves  (buckets: five minutes)
 *   Day    the readings themselves
 *   Week   one bucket per day       Month  one bucket per day
 *   Year   one bucket per month
 * A measurement buckets to min / average / max; a cumulative counter (kWh, Ah)
 * buckets to how much it rose; an on/off flag to whether it was ever on.
 */

import { SITE_TZ } from "../api/time.ts";

export type Range = "hour" | "day" | "week" | "days28" | "month" | "year";
export interface RangeOption { id: Range; label: string; short: string }
/** Every chart's ranges. No Month or Year: those are only downloaded, from Genie. */
export const RANGES: RangeOption[] = [
  { id: "day", label: "Day", short: "D" },
  { id: "week", label: "Week", short: "W" },
];
/** Genie's ranges: a Month or Year there is a CSV download, never a graph. */
export const GENIE_RANGES: RangeOption[] = [
  ...RANGES,
  { id: "month", label: "Month", short: "M" },
  { id: "year", label: "Year", short: "Y" },
];
/** Ranges Genie offers as a download only. */
export const isDownloadOnly = (r: Range) => r === "month" || r === "year";
/** The dashboard's ranges: nothing longer than 28 days. */
export const DASHBOARD_RANGES: RangeOption[] = [
  { id: "hour", label: "1 Hour", short: "1H" },
  { id: "day", label: "1 Day", short: "1D" },
  { id: "week", label: "Week", short: "W" },
  { id: "days28", label: "28 Days", short: "28D" },
];
/** Ranges drawn from the readings themselves rather than per-day buckets. */
export const isRaw = (r: Range) => r === "hour" || r === "day";
const HOUR_MS = 3_600_000;
/** An hour period ends on a five-minute mark, so it moves (and re-reads) every five minutes, not every second. */
const HOUR_ALIGN_MS = 5 * 60_000;

export interface Period { range: Range; from: number; to: number; label: string }

/* ── Wall clock in SITE_TZ (offset read per instant, never assumed) ─────── */

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: SITE_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
});
interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: number }
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export function wall(ts: number): Wall {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: WD[p.weekday] ?? 0 };
}
/** SITE_TZ's offset from UTC at `ts`, ms. */
function offset(ts: number): number {
  const w = wall(ts);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ts / 1000) * 1000;
}
/** The instant of a wall-clock date in SITE_TZ (month may overflow: 13 → next January). */
export function at(y: number, mo: number, d = 1, h = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h);
  return guess - offset(guess - offset(guess));
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The period of `range` holding `anchor`. */
export function periodOf(range: Range, anchor: number): Period {
  const w = wall(anchor);
  if (range === "hour") {
    const to = Math.floor(anchor / HOUR_ALIGN_MS) * HOUR_ALIGN_MS + HOUR_ALIGN_MS, from = to - HOUR_MS;
    const hm = (ts: number) => { const x = wall(ts); return `${String(x.h).padStart(2, "0")}:${String(x.mi).padStart(2, "0")}`; };
    const e = wall(to - 1);
    return { range, from, to, label: `${hm(from)}–${hm(to)}, ${e.d} ${MON[e.mo - 1]} ${e.y}` };
  }
  if (range === "day") {
    const from = at(w.y, w.mo, w.d), to = at(w.y, w.mo, w.d + 1);
    return { range, from, to, label: `${WEEKDAY[w.wd]}, ${w.d} ${MON[w.mo - 1]} ${w.y}` };
  }
  if (range === "week" || range === "days28") {
    /* Rolling: the seven (or 28) days ending on the anchor's day, so the
       latest one always shows every day up to today. */
    const from = at(w.y, w.mo, w.d - (range === "week" ? 6 : 27)), to = at(w.y, w.mo, w.d + 1);
    const a = wall(from), b = wall(to - 1);
    const label = a.mo === b.mo
      ? `${a.d}–${b.d} ${MON[b.mo - 1]} ${b.y}`
      : a.y === b.y ? `${a.d} ${MON[a.mo - 1]} – ${b.d} ${MON[b.mo - 1]} ${b.y}`
        : `${a.d} ${MON[a.mo - 1]} ${a.y} – ${b.d} ${MON[b.mo - 1]} ${b.y}`;
    return { range, from, to, label };
  }
  if (range === "month") {
    return { range, from: at(w.y, w.mo), to: at(w.y, w.mo + 1), label: `${MONTH[w.mo - 1]} ${w.y}` };
  }
  return { range, from: at(w.y, 1), to: at(w.y + 1, 1), label: String(w.y) };
}

/** The period one unit before (-1) or after (+1). */
export function shift(p: Period, dir: -1 | 1): Period {
  /* A week is the seven days ending on its anchor, so the next one is
     anchored on the last of the following seven days. */
  if ((p.range === "week" || p.range === "days28") && dir > 0) {
    const w = wall(p.to);
    return periodOf(p.range, at(w.y, w.mo, w.d + (p.range === "week" ? 6 : 27)));
  }
  if (p.range === "hour") return periodOf("hour", dir < 0 ? p.from - 1 : p.to + HOUR_MS - 1);
  /* Step from inside the period so month lengths and DST never skip one. */
  const probe = dir < 0 ? p.from - 1 : p.to + 1;
  return periodOf(p.range, probe);
}

/** Switch range keeping the anchor: the period's start, or now when "now" is inside it. */
export function switchRange(p: Period, range: Range, now: number): Period {
  /* An hour of a past period is its last hour; anything else starts where it did. */
  const anchor = now >= p.from && now < p.to ? now : range === "hour" ? p.to - 1 : p.from;
  return periodOf(range, anchor);
}

/** No navigating past the period that holds now. */
export const isLatest = (p: Period, now: number) => p.to > now;

/* ── Buckets ───────────────────────────────────────────────────────────── */

export interface Bucket { from: number; to: number; label: string }

/** Day: none (raw readings). Hour: five minutes. Week / 28 Days / Month: days. Year: months. */
export function bucketsOf(p: Period): Bucket[] {
  if (p.range === "day") return [];
  if (p.range === "hour") {
    return Array.from({ length: HOUR_MS / HOUR_ALIGN_MS }, (_, i) => {
      const from = p.from + i * HOUR_ALIGN_MS, x = wall(from);
      return { from, to: from + HOUR_ALIGN_MS, label: `${String(x.h).padStart(2, "0")}:${String(x.mi).padStart(2, "0")}` };
    });
  }
  const out: Bucket[] = [];
  if (p.range === "year") {
    const y = wall(p.from).y;
    for (let m = 1; m <= 12; m++) out.push({ from: at(y, m), to: at(y, m + 1), label: MON[m - 1] });
    return out;
  }
  let t = p.from;
  for (let i = 0; t < p.to && i < 40; i++) {
    const w = wall(t);
    const next = at(w.y, w.mo, w.d + 1);
    out.push({ from: t, to: next, label: p.range === "week" ? WEEKDAY[w.wd] : String(w.d) });
    t = next;
  }
  return out;
}

/** How a parameter buckets. */
export type Kind = "measure" | "counter" | "flag";

/** Cumulative counters are stated in energy or charge units; flags are small integer sets. */
export function kindOf(unit: string | null | undefined, values: number[]): Kind {
  const u = (unit ?? "").trim();
  if (/^(k|M|G)?Wh$|^Ah$/i.test(u)) return "counter";
  const distinct = [...new Set(values)];
  if (distinct.length && distinct.length <= 3 && distinct.every((v) => v === 0 || v === 1)) return "flag";
  return "measure";
}

export interface BucketValue {
  ts: number; label: string;
  /** Measure: min / avg / max. Counter: rise in `avg` (min/max null). Flag: `max` 0/1. */
  min: number | null; avg: number | null; max: number | null;
  n: number;
}

/**
 * One value per bucket from the readings that fall in it — never a value for
 * a bucket with no reading. A counter's rise is last − first inside the
 * bucket; a fall (a reset) gives no figure rather than a negative one.
 */
export function aggregate(readings: { ts: number; value: number }[], buckets: Bucket[], kind: Kind): BucketValue[] {
  const sorted = [...readings].sort((a, b) => a.ts - b.ts);
  let i = 0;
  return buckets.map((b) => {
    while (i < sorted.length && sorted[i].ts < b.from) i++;
    const inB: number[] = [];
    let j = i;
    while (j < sorted.length && sorted[j].ts < b.to) { inB.push(sorted[j].value); j++; }
    const ts = b.from + (b.to - b.from) / 2;
    if (!inB.length) return { ts, label: b.label, min: null, avg: null, max: null, n: 0 };
    if (kind === "counter") {
      const rise = inB[inB.length - 1] - inB[0];
      return { ts, label: b.label, min: null, avg: rise >= 0 ? rise : null, max: null, n: inB.length };
    }
    if (kind === "flag") {
      return { ts, label: b.label, min: null, avg: null, max: Math.max(...inB) > 0 ? 1 : 0, n: inB.length };
    }
    const sum = inB.reduce((a, v) => a + v, 0);
    return { ts, label: b.label, min: Math.min(...inB), avg: sum / inB.length, max: Math.max(...inB), n: inB.length };
  });
}

/** Samples to read across a period for the thinned S1 reader: enough per bucket, bounded in requests. */
export function samplesFor(range: Range): number {
  return range === "hour" ? 60 : range === "day" ? 144 : range === "week" ? 168 : range === "month" || range === "days28" ? 180 : 183;
}

/* ── Daily rows → a period's buckets ──────────────────────────────────── */

/** `YYYY-MM-DD` of an instant, in SITE_TZ. */
export function ymdOf(ts: number): string {
  const w = wall(ts);
  return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

export type Reduce = "sum" | "max" | "avg";

/**
 * Rows keyed by a calendar date ("YYYY-MM-DD"), laid onto a Week / Month
 * (one bucket per day) or a Year (one per month, each field combined by
 * `reduce[field]`). A day with no row, or a field with no number, gives null —
 * never 0. Day periods are the caller's: daily rows have nothing finer.
 */
export type DayBucketRow = { label: string; ts: number; [field: string]: number | string | null };

export function dailyToBuckets<T extends { date: string }>(
  rows: T[], period: Period, fields: Partial<Record<keyof T & string, Reduce>>,
): DayBucketRow[] {
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const byDate = new Map(rows.map((r) => [r.date.slice(0, 10), r]));
  const keys = Object.keys(fields) as (keyof T & string)[];
  return bucketsOf(period).map((b) => {
    const out: DayBucketRow = { label: b.label, ts: b.from };
    if (period.range !== "year") {
      const r = byDate.get(ymdOf(b.from));
      for (const k of keys) out[k] = num(r?.[k]);
      return out;
    }
    const inMonth = rows.filter((r) => {
      const t = at(+r.date.slice(0, 4), +r.date.slice(5, 7), +r.date.slice(8, 10), 12);
      return t >= b.from && t < b.to;
    });
    for (const k of keys) {
      const vals = inMonth.map((r) => num(r[k])).filter((v): v is number => v != null);
      const red = fields[k];
      out[k] = !vals.length ? null
        : red === "max" ? Math.max(...vals)
        : red === "avg" ? vals.reduce((a, v) => a + v, 0) / vals.length
        : vals.reduce((a, v) => a + v, 0);
    }
    return out;
  });
}
