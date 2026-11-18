/**
 * The time axis's pure core: the site's wall clock, adaptive tick placement
 * and tick labels. No React and no "@/" imports, so `npm test` (node's runner)
 * can load it directly; timeAxis.ts builds the Recharts props on top of it.
 */

import { SITE_TZ } from "../api/time.ts";

/* ── The site's clock ─────────────────────────────────────────────────────
   Every label is in the site's zone (SITE_TZ), whatever zone the browser is
   in. The zone's offset is read from Intl per instant rather than assumed,
   so a site outside India — or a zone with daylight saving — still lands
   its ticks on its own midnights. Timestamps themselves are never shifted. */

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: SITE_TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
export interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }
export function wall(ts: number): Wall {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
/** Offset of SITE_TZ from UTC at `ts`, ms. */
export function tzOffset(ts: number): number {
  const w = wall(ts);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ts / 1000) * 1000;
}
/** The instant of a wall-clock time in SITE_TZ. */
export function fromWall(y: number, mo: number, d: number, h = 0, mi = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const t = guess - tzOffset(guess);
  return guess - tzOffset(t);          // second pass settles a DST edge
}

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const p2 = (n: number) => String(n).padStart(2, "0");
export const hhmm = (ts: number) => { const w = wall(ts); return `${p2(w.h)}:${p2(w.mi)}`; };
export const dayLabel = (ts: number) => { const w = wall(ts); return `${w.d} ${MON[w.mo - 1]}`; };
export const dayKey = (ts: number) => { const w = wall(ts); return `${w.y}-${w.mo}-${w.d}`; };
export const sameDay = (a: number, b: number) => dayKey(a) === dayKey(b);
export const isMidnight = (ts: number) => { const w = wall(ts); return w.h === 0 && w.mi === 0; };

/** The zone's short name for tooltips ("IST"), or the zone id if Intl has none. */
export const TZ_LABEL: string = (() => {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone: SITE_TZ, timeZoneName: "short" })
      .formatToParts(new Date()).find((x) => x.type === "timeZoneName")?.value ?? SITE_TZ;
  } catch { return SITE_TZ; }
})();

/* ── Ticks ─────────────────────────────────────────────────────────────────

   Adaptive by span. The candidate ticks are round wall-clock instants — :00
   and :30, 06:00, midnights, Mondays-agnostic day steps, the 1st of a month,
   quarters, Jan 1 — at the smallest step that gives at most MAX_TICKS across
   the window. Recharts then drops every Nth label by measured width
   ("equidistantPreserveStart"), so a narrow card keeps every other one and
   they stay round; side-by-side charts of one width thin identically.

     span ≤ ~1 day   14:00 · 18:00 · 12 Oct (the midnight tick names the day)
     ≤ 4 days        11 Oct 18:00 · 12 Oct · 06:00 · 12:00 (date when it changes)
     ≤ ~4 months     12 Oct · 19 Oct · 26 Oct
     longer          Oct 2026 · Jan 2027 · Apr (year on the first and on January)  */

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/* Sub-day steps, minutes. From 1 min: a 14-minute window got one tick at 15. */
const STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720];
const STEPS_DAY = [1, 2, 7, 14];
const STEPS_MONTH = [1, 2, 3, 6, 12, 24, 60];
const MAX_TICKS = 12;

export type Mode = "time" | "datetime" | "day" | "month";

export function modeFor(span: number): Mode {
  if (span <= 26 * HOUR) return "time";
  if (span <= 4 * DAY) return "datetime";
  if (span <= 120 * DAY) return "day";
  return "month";
}

function subDayTicks(first: number, last: number): number[] {
  const span = last - first;
  const stepMin = STEPS_MIN.find((m) => span / (m * MIN) <= MAX_TICKS) ?? 720;
  /* Walk wall-clock: from the first round wall time at or after `first`. */
  const w = wall(first);
  const dayStart = fromWall(w.y, w.mo, w.d);
  const out: number[] = [];
  for (let k = 0; ; k++) {
    const minutes = k * stepMin;
    const t = fromWall(w.y, w.mo, w.d, Math.floor(minutes / 60), minutes % 60);
    if (t > last) break;
    if (t >= first) out.push(t);
    if (k > 10_000 || t - dayStart > span + 2 * DAY) break;
  }
  return out;
}

function dayTicks(first: number, last: number): number[] {
  const days = (last - first) / DAY;
  const step = STEPS_DAY.find((n) => days / n <= MAX_TICKS) ?? 14;
  const w = wall(first);
  let t = fromWall(w.y, w.mo, w.d);
  if (t < first) { const n = wall(t + DAY + HOUR); t = fromWall(n.y, n.mo, n.d); }
  const out: number[] = [];
  for (let i = 0; t <= last && i < 500; i++) {
    out.push(t);
    const n = wall(t + step * DAY + 2 * HOUR);     // +2 h: lands inside the next day across DST
    t = fromWall(n.y, n.mo, n.d);
  }
  return out;
}

function monthTicks(first: number, last: number): number[] {
  const a = wall(first), b = wall(last);
  const months = (b.y - a.y) * 12 + (b.mo - a.mo);
  const step = STEPS_MONTH.find((n) => months / n <= MAX_TICKS) ?? 60;
  /* Aligned to the calendar: quarters on Jan/Apr/Jul/Oct, years on Jan. */
  let m0 = a.y * 12 + (a.mo - 1);
  m0 = Math.ceil(m0 / step) * step;
  const out: number[] = [];
  for (let m = m0; ; m += step) {
    const t = fromWall(Math.floor(m / 12), (m % 12) + 1, 1);
    if (t < first) continue;
    if (t > last || out.length > 500) break;
    out.push(t);
  }
  return out;
}

export function timeTicks(first: number, last: number): number[] {
  if (!(last > first)) return [];
  const mode = modeFor(last - first);
  return mode === "month" ? monthTicks(first, last) : mode === "day" ? dayTicks(first, last) : subDayTicks(first, last);
}

/**
 * The label for each tick, by mode. Recharts calls the formatter in order for
 * the ticks it keeps (index 0 first), so "the date changed since the last
 * label shown" is tracked across one pass — a dropped midnight tick still
 * leaves the next label carrying its date.
 */
export function makeFormatter(mode: Mode, first: number, last: number) {
  let prev: number | null = null;
  const crossesYear = wall(first).y !== wall(last).y;
  return (ts: number, index: number): string => {
    if (index === 0) prev = null;
    const before = prev;
    prev = ts;
    if (mode === "month") {
      const w = wall(ts);
      const showYear = before === null || w.mo === 1 || wall(before).y !== w.y;
      return showYear ? `${MON[w.mo - 1]} ${w.y}` : MON[w.mo - 1];
    }
    if (mode === "day") {
      const w = wall(ts);
      return crossesYear && (before === null || wall(before).y !== w.y) ? `${dayLabel(ts)} ${w.y}` : dayLabel(ts);
    }
    if (isMidnight(ts)) return dayLabel(ts);
    if (mode === "datetime" && (before === null || !sameDay(before, ts))) return `${dayLabel(ts)} ${hhmm(ts)}`;
    return hhmm(ts);
  };
}

/** Tooltip heading for a `ts` value: "12 Oct 2026, 14:23:20 IST" — full date, seconds and zone. */
export function timeTooltipLabel(ts: unknown): string {
  const n = typeof ts === "number" ? ts : Number(ts);
  if (!Number.isFinite(n)) return "";
  const w = wall(n);
  return `${w.d} ${MON[w.mo - 1]} ${w.y}, ${p2(w.h)}:${p2(w.mi)}:${p2(w.s)} ${TZ_LABEL}`;
}

/** "10-12", "10/12" (MM-DD / MM/DD) or "2026-10-12" → "12 Oct". Anything after the date is kept ("12 Oct ·"). */
export function dayCategoryLabel(key: unknown): string {
  const s = String(key ?? "");
  const m = /^(?:(\d{4})-)?(\d{1,2})[-/](\d{1,2})(.*)$/.exec(s);
  if (!m) return s;
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return s;
  return `${d} ${MON[mo - 1]}${m[4] ?? ""}`;
}

