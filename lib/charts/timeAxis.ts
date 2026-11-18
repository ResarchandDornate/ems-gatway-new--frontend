/**
 * A time axis for the "recent readings" charts.
 *
 * These charts draw whatever the backend's newest 1,000 readings are, and those
 * can be days old when the site has gone quiet. Labelled as categories, the
 * axis printed every reading's HH:MM:SS edge to edge, spaced a 70-minute hole
 * the same as a 9-minute step, and never said which day it was showing — so a
 * chart of 28 Sep read as this afternoon.
 *
 * Here the axis is real time: gaps take the room they took, labels are HH:MM
 * and spaced by width, the line breaks where readings stop, and the caption
 * names the date and age whenever the readings are not from right now.
 */

import { formatAge } from "@/lib/freshness";
import {
  timeTicks, modeFor, makeFormatter, hhmm, dayLabel, dayKey, sameDay, dayCategoryLabel,
} from "./timeTicks";

export { timeTicks, timeTooltipLabel, dayCategoryLabel, TZ_LABEL } from "./timeTicks";
import { makeTimeTick, EmptyTick } from "./TimeTick";

/* Built once, not per render: a tick component made inside timeAxisProps was a
   new component type every render, so React unmounted and remounted every
   label on every chart each time the page re-rendered. Ticks render in order
   from index 0 and reset there (see TimeTick), so charts can share these. */
const TWO_LINE_TICK = makeTimeTick({ timeOf: hhmm, dateOf: dayLabel, dayOf: dayKey, dateOnFirst: true });
const ONE_LINE_TICK = makeTimeTick({ timeOf: hhmm, dateOf: dayLabel, dayOf: dayKey, dateOnFirst: false });

/** A stretch with no reading longer than this breaks the line. */
export const GAP_MS = 5 * 60_000;

/**
 * Props for a Recharts <XAxis> over rows carrying `ts` (epoch ms). Spread after
 * the shared `xAxis`.
 *
 * @param span the window the user chose, [from, to] epoch ms. With it the
 *   axis covers that window, not just the readings in it — "last 24 hours"
 *   over an hour of data must not draw a one-hour axis. Charts shown together
 *   pass the same span, so their ticks and grid lines line up.
 * @param opts.hideLabels keep the ticks (and vertical grid lines) but print no
 *   labels — for the upper charts of a stack whose bottom chart carries them.
 */
export function timeAxisProps(
  rows: { ts: number }[],
  span?: [number, number],
  opts: { hideLabels?: boolean } = {},
) {
  const fixed = !!span && Number.isFinite(span[0]) && Number.isFinite(span[1]) && span[1] > span[0];
  const first = fixed ? span![0] : rows[0]?.ts ?? 0;
  const last = fixed ? span![1] : rows[rows.length - 1]?.ts ?? 0;
  /* A tick at the window's very end has no room for its label, and Recharts
     will not draw a label past the edge — so with one there, the only spacing
     it accepts is one that skips it: a 72-hour axis of 13 ticks came out as
     every 5th (3 labels on 950 px). Candidates that close to the end go. */
  const ticks = timeTicks(first, last).filter((t, i, all) => i === 0 || all.length <= 2 || last - t >= (last - first) * 0.04);
  const mode = modeFor(last - first);
  /* Sub-day ticks (time / datetime modes) draw two lines — the time, and the
     date under the first label of each day (see TimeTick). The formatter, which
     is what Recharts measures to thin labels, is the time alone. A window
     inside one day needs no date line and keeps the single-line height. */
  /* …and also when the window is not today: readings from 10 Oct drawn as
     "02:00 · 02:20 · 03:40" read as this morning. The clock only decides
     whether the date is shown; the readings' times come from the data. */
  const twoLine = (mode === "time" || mode === "datetime") && last > first
    && (!sameDay(first, last) || !sameDay(last, Date.now()));
  const subDay = mode === "time" || mode === "datetime";
  const fmt = subDay ? (ts: number) => hhmm(ts) : makeFormatter(mode, first, last);
  const tick = opts.hideLabels
    ? EmptyTick
    : subDay
      ? (twoLine ? TWO_LINE_TICK : ONE_LINE_TICK)
      : undefined;
  return {
    dataKey: "ts",
    type: "number" as const,
    scale: "time" as const,
    domain: (fixed ? [first, last] : ["dataMin", "dataMax"]) as [number, number] | [string, string],
    allowDataOverflow: fixed,
    ...(ticks.length ? { ticks } : {}),
    /* Every Nth candidate by measured label width — no overlaps, and what is
       kept stays on round times. */
    interval: "equidistantPreserveStart" as const,
    minTickGap: 10,
    /* Hidden labels are still MEASURED as the real text: Recharts thins ticks
       by label width, and an empty label left the upper charts of a stack
       with twice the grid lines of the labelled one below. EmptyTick draws
       nothing, so they keep exactly the labelled chart's ticks. */
    tickFormatter: fmt,
    ...(tick ? { tick } : {}),
    ...(opts.hideLabels ? { height: 6, tickMargin: 0 } : twoLine ? { height: 38 } : {}),
  };
}

/* ── Day-category axes (daily bars) ───────────────────────────────────────

   The daily charts put one category per day, keyed by a short date string.
   They print "12 Oct" whatever the key's shape, and thin by width the same
   way as the time axes. */

/** Props for a daily-category <XAxis>; spread after `xAxis`. */
export const dayAxisProps = {
  tickFormatter: dayCategoryLabel,
  interval: "equidistantPreserveStart" as const,
  minTickGap: 10,
};

/**
 * The rows with an all-null row inserted inside every gap longer than GAP_MS,
 * so lines and areas break there instead of bridging the hole.
 */
export function withGaps<T extends { ts: number }>(rows: T[], gapMs = GAP_MS): T[] {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && rows[i].ts - rows[i - 1].ts > gapMs) {
      const blank = Object.fromEntries(
        Object.keys(rows[i]).map((k) => [k, k === "ts" ? rows[i - 1].ts + 1 : k === "t" ? "" : null]),
      ) as unknown as T;
      out.push(blank);
    }
    out.push(rows[i]);
  }
  return out;
}

/**
 * What window the readings cover, in words: "12:46–15:54" for today and
 * current, "28 Sep, 12:46–15:54 · 2d ago" otherwise; "· 1 gap" when the line
 * breaks.
 */
export function windowCaption(rows: { ts: number }[], now: number = Date.now()): string {
  if (!rows.length) return "no readings";
  const first = rows[0].ts;
  const last = rows[rows.length - 1].ts;
  let gaps = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].ts - rows[i - 1].ts > GAP_MS) gaps++;

  const span = sameDay(first, now) && sameDay(last, now)
    ? `${hhmm(first)}–${hhmm(last)}`
    : sameDay(first, last)
      ? `${dayLabel(first)}, ${hhmm(first)}–${hhmm(last)}`
      : `${dayLabel(first)} ${hhmm(first)} – ${dayLabel(last)} ${hhmm(last)}`;
  const age = now - last > 10 * 60_000 ? ` · ${formatAge(now - last)} ago` : "";
  const gapNote = gaps ? ` · ${gaps} gap${gaps > 1 ? "s" : ""}` : "";
  return `${span}${age}${gapNote}`;
}

/** A hole this long is shaded as "no data" rather than left as blank axis. */
const HOLE_MS = 30 * 60_000;

/**
 * Stretches of [span] with no reading for HOLE_MS or more — before the first
 * reading, between two, and after the last — for a <ReferenceArea> each. An
 * unshaded empty morning read as a chart that had failed to draw, beside a
 * month total that clearly had energy in it.
 */
export function noDataAreas(rows: { ts: number }[], span: [number, number], holeMs = HOLE_MS): [number, number][] {
  const [from, to] = span;
  const out: [number, number][] = [];
  let prev = from;
  for (const r of rows) {
    if (r.ts < from || r.ts > to) continue;
    if (r.ts - prev >= holeMs) out.push([prev, r.ts]);
    prev = r.ts;
  }
  if (to - prev >= holeMs) out.push([prev, to]);
  return out;
}
