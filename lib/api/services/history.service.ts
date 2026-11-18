/**
 * Multi-signal history, from the NorthBound EMS Gateway's fast historian.
 *
 * `/api/gw/history-series` is the only path here. It walks the gateway's
 * `/api/fast-bess/history` a page at a time behind a server-side chunk cache,
 * integrates energy over the raw one-second rows, and returns a bucketed
 * series with coverage stated. Pulling the raw rows into the browser instead
 * is what this replaced: it cost 8.7 MB an hour for four figures, took 33
 * seconds, and any interruption in those 33 seconds discarded every one of
 * them.
 *
 * The six series it can answer are fixed — power, SOC, cell temperature and
 * cell spread — so `keys` selects among those rather than naming arbitrary
 * registers. deviceTelemetry.service documents which signal maps to which, and
 * the same table is used here so the two pages never disagree about what is
 * chartable.
 */

import { getSeries } from "@/lib/gateway";

export interface HistoryPoint {
  ts: number;
  t: string;
  /** Value per requested key, keyed by key name. */
  [key: string]: number | string;
}

/** Selectable history series, and which column of a SeriesPoint each is. */
export const HISTORY_SERIES = {
  power:      { column: 1, label: "Active Power",      unit: "kW" },
  powerMin:   { column: 2, label: "Power (min)",       unit: "kW" },
  powerMax:   { column: 3, label: "Power (max)",       unit: "kW" },
  soc:        { column: 4, label: "SOC",               unit: "%"  },
  cellTemp:   { column: 5, label: "Max Cell Temp",     unit: "°C" },
  cellSpread: { column: 6, label: "Max Cell Spread",   unit: "mV" },
} as const satisfies Record<string, { column: 1|2|3|4|5|6; label: string; unit: string }>;

export type HistoryKey = keyof typeof HISTORY_SERIES;

export const isHistoryKey = (k: string): k is HistoryKey => k in HISTORY_SERIES;

const dtLocal = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });

/**
 * Aligned series for one or more keys over a custom range, merged into one row
 * per timestamp and ready for a multi-line chart.
 *
 * One request whatever the key count, because every key is a column of the
 * same aggregate. The UGX version issued one query per key and merged them on
 * timestamps that did not always line up.
 *
 * @param sourceId  Gateway source, e.g. `external_ems_1`.
 * @param interval  Desired bucket width in ms. Converted to a point count,
 *                  which is what the server takes; it picks the bucket from
 *                  the count so that the two cannot drift apart.
 */
export async function fetchDeviceHistory(
  sourceId: string,
  keys: string[],
  startTs: number,
  endTs: number,
  interval: number,
  limit: number,
): Promise<HistoryPoint[]> {
  const wanted = keys.filter(isHistoryKey);
  if (!sourceId || !wanted.length || !(endTs > startTs)) return [];

  const span = endTs - startTs;
  const points = Math.min(
    limit || 720,
    Math.max(1, Math.round(span / Math.max(interval, 1_000))),
  );

  const r = await getSeries({
    sourceId, bessId: "", fromEpochMs: startTs, toEpochMs: endTs, points, nowMs: Date.now(),
  });

  const out: HistoryPoint[] = [];
  for (const p of r.data.points) {
    const row: HistoryPoint = { ts: p[0], t: dtLocal(p[0]) };
    let any = false;
    for (const k of wanted) {
      const v = p[HISTORY_SERIES[k].column];
      /* Absent stays absent. An undefined property is skipped by the chart's
         line renderer, which draws a gap; writing 0 would draw a floor. */
      if (v != null) {
        row[k] = v;
        any = true;
      }
    }
    /* A bucket where none of the selected series reported is not a row. */
    if (any) out.push(row);
  }
  return out;
}
