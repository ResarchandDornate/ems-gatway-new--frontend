/**
 * Weak-cell trend — which cell is going out of family, and by how much.
 *
 * ── The question this answers ─────────────────────────────────────────────
 * The cell map shows the pack as it is right now. It will show you that cell
 * 137 is 33 mV below the pack mean this second, and it cannot tell you whether
 * that is a cell failing or a cell that happens to be low at this SOC. Those
 * two have the same picture and completely different consequences, and the
 * difference is only visible over time.
 *
 * So this computes two things the snapshot cannot:
 *
 *   PERSISTENCE  how often a given cell is the pack minimum. A cell that holds
 *                the minimum 4% of the time is noise — at 260 cells somebody
 *                has to be lowest. A cell that holds it 94% of the time is a
 *                cell out of family, and that is a service visit.
 *   DRIFT        the selected cell's distance from the pack average, over the
 *                stored window, with a slope fitted to it. "14 mV below family
 *                and widening at 2.3 mV a week" is a sentence somebody can act
 *                on; "3351 mV" is not.
 *
 * ── Why it costs six calls and not two hundred and sixty ──────────────────
 * `/api/storage/points` takes one signal per call (see getStoredPoints), so
 * trending all 260 cell registers would be 260 round trips against a board
 * whose cheapest reply is 2.5 s. That is not a screen, it is an outage.
 *
 * The way out is that the BMS already does the argmin for us, every sample,
 * and stores the answer: `cell_min_voltage_id` is a register in its own right.
 * Its history IS the persistence ranking — one call, whatever the pack size —
 * and it is a better source than 260 voltage traces would be, because it is
 * the BMS's own comparison at its own sampling instant rather than ours across
 * 260 separately-stored series that were never guaranteed to line up.
 *
 * So: two id histories for the ranking, three pack figures for the envelope,
 * and one per-cell trace for whichever cell is being examined. Six, fixed.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 * It does not label the window. `/api/storage/points` takes no time range, so
 * the period covered is whatever the most recent `limit` rows happen to span —
 * and the snapshot cadence is a deployment property nothing publishes. The
 * covered span is therefore measured from the returned timestamps and reported
 * as `window`, and the caller renders that rather than the period it hoped for.
 * A slope per week computed over four hours of data is stated as such.
 */

import { cadenceOf, valueAt } from "./storedSeries";
import { fetchGeneral, fetchFastBess, numeric, reading, type GeneralRecord } from "@/lib/central";
import { isDriftIssue, worstDrift } from "@/lib/energy/cellDrift";
import CATALOG_JSON from "@/lib/central/pointCatalog.json";

const CATALOG = CATALOG_JSON as unknown as { points: Record<string, [string[], string, string | null, string | null]> };

/* ── Reading a stored row ─────────────────────────────────────────────────── */

export interface TrendPoint { ts: number; value: number }

/* ── Statistics ───────────────────────────────────────────────────────────── */

/**
 * Least-squares slope, in value-units per week.
 *
 * Per week rather than per sample, because the sample interval is not a stated
 * property of this gateway and a slope per sample would silently change
 * meaning if the cadence were ever retuned.
 */
function slopePerWeek(points: TrendPoint[]): number | null {
  if (points.length < 8) return null;
  const n = points.length;
  const t0 = points[0].ts;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    /* Weeks since the first sample, so the regressor is small and the units
       come out of the fit directly. */
    const x = (p.ts - t0) / 604_800_000;
    sx += x; sy += p.value; sxx += x * x; sxy += x * p.value;
  }
  const denom = n * sxx - sx * sx;
  /* Every sample at the same instant — a store that wrote one batch. There is
     no slope through a vertical line and reporting one would be arithmetic on
     a divide-by-zero. */
  if (Math.abs(denom) < 1e-9) return null;
  return (n * sxy - sx * sy) / denom;
}

/* ── Public shape ─────────────────────────────────────────────────────────── */

export interface CellPersistence {
  /** 1-based cell number, as the BMS indexes its own block. */
  cellNo: number;
  /** Samples in which this cell held the extreme. */
  samples: number;
  /** Share of the covered window, 0–100. */
  sharePct: number;
}

export interface CellTrend {
  /** The window the stored rows actually span. Measured, never assumed. */
  window: { fromTs: number; toTs: number; samples: number; cadenceMs: number | null } | null;
  /** Cells that held the pack minimum, most persistent first. */
  weakest: CellPersistence[];
  /** Cells that held the pack maximum, most persistent first. */
  strongest: CellPersistence[];
  /** Pack min / average / max over the window, merged on timestamp. */
  envelope: { ts: number; min: number | null; avg: number | null; max: number | null }[];
  /** The examined cell's own trace, and its distance from the pack average. */
  cell: {
    cellNo: number;
    points: TrendPoint[];
    /** value − pack average at the same instant. Negative is below family. */
    deviation: TrendPoint[];
    /** Most recent deviation, mV. */
    latestDeviationMv: number | null;
    /** Fitted drift of that deviation, mV per week. Negative is widening. */
    driftMvPerWeek: number | null;
    /** The latest deviation is a drift issue (|mV| ≥ 100 — lib/energy/cellDrift). */
    issue: boolean;
  } | null;
  /**
   * The worst cell anywhere in the pack: the pack minimum or maximum, whichever
   * is farther from the average, at the newest envelope sample. `issue` is the
   * one flag the screens show; below 100 mV nothing is flagged.
   */
  pack: {
    latestMv: number | null;
    latestTs: number | null;
    /** Envelope samples in the window at or past the threshold. */
    issueSamples: number;
    issue: boolean;
  };
}

const EMPTY: CellTrend = {
  window: null, weakest: [], strongest: [], envelope: [], cell: null,
  pack: { latestMv: null, latestTs: null, issueSamples: 0, issue: false },
};

/** Rank an id history by how often each id appears. */
function persistence(points: TrendPoint[]): CellPersistence[] {
  if (!points.length) return [];
  const counts = new Map<number, number>();
  for (const p of points) {
    /* Ids are 1-based integers. A 0 means the register was not populated at
       that sample rather than "cell zero", and counting it would invent a
       cell that does not exist. */
    const id = Math.round(p.value);
    if (!Number.isFinite(id) || id < 1) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  return [...counts.entries()]
    .map(([cellNo, samples]) => ({
      cellNo,
      samples,
      sharePct: Math.round((samples / total) * 1000) / 10,
    }))
    .sort((a, b) => b.samples - a.samples);
}

/* ── Where each series comes from, on the central backend ─────────────────

   This used to read /api/storage/points on the NorthBound gateway, whose
   public API now answers 503 — so the panel sat on "nothing to trend" for
   every cabinet. The same five signals exist on the central backend, split
   across its two streams:

     cell_min_voltage_id   S2 bms_extended p1019   point-filtered, ~35 min
     cell_max_voltage_id   S2 bms_extended p1015   point-filtered, ~35 min
     cell_average_voltage  S2 bms_extended p1023   point-filtered, ~35 min, mV
     cell_min/max_voltage  S1 bms_values           1 Hz, 1,000 rows ≈ 16 min, mV
     cell_voltage_N        S2 bms_extended         point id looked up live

   Neither stream has a range query, so the window is minutes, not weeks. The
   panel already labels the window it was given rather than the one it hoped
   for, and a slope over half an hour is stated as such. */

const P_MIN_ID = "p1019";
const P_MAX_ID = "p1015";
const P_AVG_MV = "p1023";

/** One S2 point's rows for one asset, oldest first, bad reads dropped. */
async function s2Series(gatewayId: string, pointId: string, assetId: string): Promise<TrendPoint[]> {
  const rows = await fetchGeneral(gatewayId, { pointId, limit: 1000 }).catch(() => [] as GeneralRecord[]);
  const out: TrendPoint[] = [];
  for (const r of rows) {
    if (r.asset_id !== assetId) continue;
    if (r.quality && r.quality !== "good") continue;
    const ts = Date.parse(r.sample_time_utc ?? "");
    const v = numeric(r);
    if (!Number.isNaN(ts) && v !== null) out.push({ ts, value: v });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** S1's cell extremes for one cabinet, oldest first. */
async function s1Extremes(
  gatewayId: string, sourceId: string,
): Promise<{ min: TrendPoint[]; max: TrendPoint[] }> {
  /* bess_id for the source, read off a small probe — S1 filters by bess_id,
     not by source, and 1,000 unfiltered rows would be half the other cabinet. */
  const probe = await fetchFastBess(gatewayId, { limit: 20 }).catch(() => []);
  const bessId = probe.find((r) => r.source_id === sourceId)?.bess_id;
  if (!bessId) return { min: [], max: [] };

  const rows = await fetchFastBess(gatewayId, { limit: 1000, bessId }).catch(() => []);
  const min: TrendPoint[] = [], max: TrendPoint[] = [];
  for (const r of rows) {
    if (r.source_id !== sourceId || (r.quality && r.quality !== "good")) continue;
    const ts = Date.parse(r.sample_time_utc ?? "");
    if (Number.isNaN(ts)) continue;
    const lo = reading(r, "bms_values", "cell_min_voltage");
    const hi = reading(r, "bms_values", "cell_max_voltage");
    if (lo !== null) min.push({ ts, value: lo });
    if (hi !== null) max.push({ ts, value: hi });
  }
  const asc = (a: TrendPoint, b: TrendPoint) => a.ts - b.ts;
  return { min: min.sort(asc), max: max.sort(asc) };
}

/**
 * `cell_voltage_N`'s point id. Not contiguous with N, so looked up, not computed.
 *
 * The id is the same on both cabinets, so any row for the cell will do — this
 * used to insist on this cabinet's row, and one 1,000-row read holds barely
 * more than one ~726-point snapshot of ONE cabinet, so the cell was missing
 * about half the time ("No stored trace"). Every id seen is cached, here and
 * in this browser, so later lookups need no read at all.
 */
const CELL_IDS_KEY = "ems.cellPointIds.v1";
let cellIds: Record<string, string> | null = null;
function loadCellIds(): Record<string, string> {
  if (cellIds) return cellIds;
  try { cellIds = JSON.parse(localStorage.getItem(CELL_IDS_KEY) ?? "{}"); } catch { cellIds = {}; }
  return cellIds!;
}
async function cellPointId(gatewayId: string, _assetId: string, cellNo: number): Promise<string | null> {
  const want = `cell_voltage_${cellNo}`;
  /* The catalogue names every BMS point id. The substream read below stays as
     the fallback for a cell the catalogue does not list. */
  for (const [pid, [kinds, sig]] of Object.entries(CATALOG.points)) {
    if (sig === want && kinds.includes("bms")) return pid;
  }
  const ids = loadCellIds();
  if (ids[want]) return ids[want];
  const rows = await fetchGeneral(gatewayId, { substream: "bms_extended", limit: 1000 })
    .catch(() => [] as GeneralRecord[]);
  for (const r of rows) {
    if (r.signal && r.point_id && /^cell_voltage_\d+$/.test(r.signal)) ids[r.signal] = r.point_id;
  }
  try { localStorage.setItem(CELL_IDS_KEY, JSON.stringify(ids)); } catch { /* session only */ }
  return ids[want] ?? null;
}

/**
 * Read the pack's drift history.
 *
 * @param gatewayId The site.
 * @param sourceId  Which cabinet, e.g. `external_ems_1`.
 * @param cellNo    Which cell to trace in detail. Omit and it traces whichever
 *                  cell the ranking says is weakest, which is what a screen
 *                  opening cold should show.
 */
export async function fetchCellTrend(
  gatewayId: string,
  sourceId: string,
  cellNo?: number,
): Promise<CellTrend> {
  if (!gatewayId || !sourceId) return EMPTY;
  /* S2's asset id for the battery: `external_ems_1_bms`, not the NorthBound
     `external_ems_1_bms_1` this used to key on. */
  const assetId = `${sourceId}_bms`;

  /* allSettled semantics by construction — every reader resolves to an empty
     series on failure. Independent reads, and one of them failing is not a
     reason to show none of the others. */
  const [minId, maxId, avg, ext] = await Promise.all([
    s2Series(gatewayId, P_MIN_ID, assetId),
    s2Series(gatewayId, P_MAX_ID, assetId),
    s2Series(gatewayId, P_AVG_MV, assetId),
    s1Extremes(gatewayId, sourceId),
  ]);
  const { min, max } = ext;

  const weakest = persistence(minId);

  /* Which cell to trace in detail, resolved HERE rather than by the caller —
     one question, one call path. Caller passes a cell only when somebody has
     picked a different one. */
  const traced = cellNo && cellNo >= 1 ? cellNo : weakest[0]?.cellNo;
  const pid = traced ? await cellPointId(gatewayId, assetId, traced) : null;
  const cellPts = pid ? await s2Series(gatewayId, pid, assetId) : [];

  /* The window is read off whichever series spans the most TIME. Not the
     most rows: S1's 1,000 rows at 1 Hz cover ~16 minutes, S2's fewer rows
     cover ~35, and counting rows would report the shorter one. */
  const span = (x: TrendPoint[]) => (x.length ? x[x.length - 1].ts - x[0].ts : -1);
  const longest = [minId, maxId, min, avg, max, cellPts].reduce(
    (a, b) => (span(b) > span(a) ? b : a), [] as TrendPoint[],
  );
  const window = longest.length
    ? {
        fromTs: longest[0].ts,
        toTs: longest[longest.length - 1].ts,
        samples: longest.length,
        cadenceMs: cadenceOf(longest),
      }
    : null;

  /* One sample interval of tolerance when lining two series up, with a floor
     so a store that batches does not reject every pairing. */
  const tol = Math.max(window?.cadenceMs ?? 60_000, 60_000);

  const envelope = avg.map((p) => ({
    ts: p.ts,
    min: valueAt(min, p.ts, tol),
    avg: p.value,
    max: valueAt(max, p.ts, tol),
  }));

  let cell: CellTrend["cell"] = null;
  if (traced && cellPts.length) {
    const deviation: TrendPoint[] = [];
    for (const p of cellPts) {
      const packAvg = valueAt(avg, p.ts, tol);
      if (packAvg != null) deviation.push({ ts: p.ts, value: p.value - packAvg });
    }
    const latestDeviationMv = deviation.length
      ? Math.round(deviation[deviation.length - 1].value * 10) / 10
      : null;
    cell = {
      cellNo: traced,
      points: cellPts,
      deviation,
      latestDeviationMv,
      issue: isDriftIssue(latestDeviationMv),
      driftMvPerWeek: (() => {
        const s = slopePerWeek(deviation);
        return s == null ? null : Math.round(s * 10) / 10;
      })(),
    };
  }

  const worst = envelope.map((e) => ({ ts: e.ts, mv: worstDrift(e) })).filter((x) => x.mv != null);
  const last = worst[worst.length - 1];
  const pack = {
    latestMv: last ? Math.round(last.mv! * 10) / 10 : null,
    latestTs: last?.ts ?? null,
    issueSamples: worst.filter((x) => isDriftIssue(x.mv)).length,
    issue: isDriftIssue(last?.mv),
  };

  return { window, weakest, strongest: persistence(maxId), envelope, cell, pack };
}
