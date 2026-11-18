/**
 * Energy per bucket from a cumulative counter, read at the buckets' edges.
 *
 * The counter's value at each edge is interpolated between the readings either
 * side of it, and a bucket is the difference between its two edges. Adjacent
 * buckets share an edge, so hours add up to their day and days to their week —
 * which a rise measured from each bucket's own first reading does not: overnight
 * the counters report about every 30 min, so an hour with no reading inside it
 * lost its energy, and today's hourly bars summed to 156 kWh against a 197 kWh
 * day (13 Oct 2026).
 *
 * An edge more than MAX_BRIDGE_MS from a reading on either side is unknown: a
 * longer silence is an outage, and spreading its energy evenly across it would
 * draw bars for hours nobody measured. The open edge of the running bucket is
 * the newest reading.
 */

export type Readings = Array<{ t: number; v: number }>;

/** The longest silence an edge may be interpolated across. */
export const MAX_BRIDGE_MS = 3 * 3_600_000;

/** The counter at `t`, interpolated between its neighbours, or null. Readings oldest first. */
export function valueAtEdge(list: Readings, t: number): number | null {
  let lo = -1;
  for (let i = 0; i < list.length && list[i].t <= t; i++) lo = i;
  const before = lo >= 0 ? list[lo] : null;
  if (before?.t === t) return before.v;
  const after = list[lo + 1] ?? null;
  if (!before || !after) return null;
  if (t - before.t > MAX_BRIDGE_MS || after.t - t > MAX_BRIDGE_MS) return null;
  return before.v + ((after.v - before.v) * (t - before.t)) / (after.t - before.t);
}

/**
 * One bucket's rise across every cabinet, kWh, or null when any cabinet's
 * edges are unknown or the counter went backwards (a reset). `now` closes the
 * running bucket at the newest reading at or before it.
 */
export function bucketRise(series: Map<string, Readings>, from: number, to: number, now: number): number | null {
  if (series.size === 0) return null;
  let total = 0;
  for (const list of series.values()) {
    const start = valueAtEdge(list, from);
    let end: number | null;
    if (to > now) {
      let last: { t: number; v: number } | null = null;
      for (const r of list) { if (r.t <= now) last = r; else break; }
      end = last && last.t > from ? last.v : start;
    } else {
      end = valueAtEdge(list, to);
    }
    if (start == null || end == null || end < start) return null;
    total += end - start;
  }
  return total;
}
