/**
 * Data Analysis — the measurement-point browser.
 *
 * The page this serves is parked behind a Coming Soon card (see
 * app/(ems)/data-analysis/page.tsx), and this module is the reason it can be:
 * everything it offers now exists elsewhere, with better provenance.
 *
 *   point list     → Equipment, which lists assets and their signals with the
 *                    gateway's own units rather than units guessed from the
 *                    shape of a key name
 *   point history  → History, which reads the fast historian through one
 *                    aggregating request instead of a query per tag
 *
 * The functions are kept and wired to the gateway rather than deleted, because
 * the hook and the page still import them and a parked page should render an
 * empty state rather than fail to compile. `fetchPointList` answers honestly
 * from the snapshot; `fetchPointHistory` answers for the six signals the
 * historian logs and returns empty for the rest.
 */

import { fetchSourceTelemetry, unitOf, getSeries } from "@/lib/gateway";
import { isoToMs, msToDtLocal } from "../time";
import type { MeasurementPoint, PointHistoryEntry } from "../types";
import { parseIst } from "../time";

export type { MeasurementPoint, PointHistoryEntry };

/** Separator inside tagId so asset and signal can be split apart again. */
const TAG_SEP = "::";

export async function fetchPointList(stationId: string): Promise<MeasurementPoint[]> {
  if (!stationId) return [];
  const t = await fetchSourceTelemetry(stationId);

  const out: MeasurementPoint[] = [];
  for (const asset of Object.keys(t.signals).sort()) {
    for (const key of Object.keys(t.signals[asset]).sort()) {
      out.push({
        tagId: `${stationId}_${asset}${TAG_SEP}${key}`,
        name: `${asset} / ${key}`,
        unit: unitOf(t, asset, key),
        category: asset,
      });
    }
  }
  return out;
}

/** The six signals the fast historian logs, and which series column answers them. */
const SERIES_COLUMN: Record<string, 1 | 4 | 5 | 6> = {
  total_active_power: 1,
  charge_discharge_power: 1,
  energy_storage_power: 1,
  display_soc: 4,
  soc: 4,
  battery_max_temperature: 5,
  max_min_cell_voltage_diff: 6,
};

export async function fetchPointHistory(
  tagId: string,
  startDt: string,
  endDt: string,
): Promise<PointHistoryEntry[]> {
  const sepIdx = tagId.indexOf(TAG_SEP);
  if (sepIdx === -1) throw new Error(`Malformed tagId: ${tagId}`);
  const key = tagId.slice(sepIdx + TAG_SEP.length);

  const column = SERIES_COLUMN[key];
  /* Live-readable but not logged. Empty, rather than an error: the page's own
     empty state says more than a thrown message would. */
  if (!column) return [];

  const m = /^(external_ems_\d+)_/.exec(tagId.slice(0, sepIdx));
  const sourceId = m ? m[1] : "";
  if (!sourceId) return [];

  /* datetime-local values, IST wall time. */
  const startTs = parseIst(startDt);
  const endTs = parseIst(endDt);
  if (!(endTs > startTs)) return [];

  const r = await getSeries({
    sourceId, bessId: "", fromEpochMs: startTs, toEpochMs: endTs, points: 500, nowMs: Date.now(),
  });

  return r.data.points
    .map((p) => ({ ts: p[0], value: p[column] }))
    .filter((p): p is { ts: number; value: number } => p.value != null)
    .map((p) => ({ t: msToDtLocal(p.ts), value: p.value }));
}

/**
 * When each tag last reported.
 *
 * Always null on this backend. `/api/telemetry` stamps the response rather than
 * the individual signal, so there is no per-tag reading time to return — and
 * returning the response time for every tag would assert that all 1,422 of
 * them were read at the same instant, which is the freshness claim this app
 * has twice been burned by making. The source's own `last_seen_utc` is the
 * real figure and is on the Comm Status panel.
 */
export async function fetchPointLatestTs(
  tagIds: string[],
): Promise<Record<string, number | null>> {
  return Object.fromEntries(tagIds.map((id) => [id, null]));
}
