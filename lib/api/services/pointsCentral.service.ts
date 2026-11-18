"use client";

/**
 * The measurement-point browser, on the central backend.
 *
 * Serves both the Curve Report's asset curve and the Data Analysis page. S2 is
 * shaped for exactly this — one row per signal, with the point id, unit and
 * category already on it — so the list is the backend's own catalogue rather
 * than something reconstructed from a telemetry blob.
 *
 * ── What a tagId is ────────────────────────────────────────────────────────
 *
 * `external_ems_1_pcs::p0094`. Asset and point, because a point id is NOT
 * unique to an asset — p0207 exists on both cabinets' PCS — and a history
 * query returns every asset that carries it, interleaved. Splitting the tag
 * back apart is what lets the history be filtered to the one asked for.
 *
 * ── How far back an S2 point reaches ───────────────────────────────────────
 *
 * /general has no from/to, only `limit`, so a point's live history is its
 * newest 1,000 rows (about 35 min for a 1 s point across two assets, days for
 * a once-a-minute counter), topped up with what the app server's collector
 * stored. fetchPointHistory cuts that to the window asked for, so an empty
 * chart means "nothing reached back this far", and the curve page says so.
 * S1 points do take a window — see fastSeries.
 */

import {
  fetchGeneral, fetchFastBess, fetchFastBessSlices, fetchHistory, SUBSTREAMS, numeric, FAST_BESS_MAX_LIMIT,
  type GeneralRecord, type FastBessSample,
} from "@/lib/central";
import CATALOG_JSON from "@/lib/central/pointCatalog.json";

/**
 * pointCatalog.json: every S2 point id the backend answered for, as
 * [device types, signal, unit, category]. Built 12 Oct 2026 by reading each id
 * p0001–p1440 once by point_id; regenerate the same way when the gateway's
 * register map changes (the live reads below still add anything new).
 */
type CatalogEntry = [kinds: string[], signal: string, unit: string | null, category: string | null];
const CATALOG = CATALOG_JSON as unknown as { generated: string; points: Record<string, CatalogEntry> };
import type { MeasurementPoint, PointHistoryEntry } from "../types";

export type { MeasurementPoint, PointHistoryEntry };

const TAG_SEP = "::";

export const makeTag = (assetId: string, pointId: string) => `${assetId}${TAG_SEP}${pointId}`;

export function splitTag(tagId: string): { assetId: string; pointId: string } | null {
  const i = tagId.indexOf(TAG_SEP);
  if (i === -1) return null;
  return { assetId: tagId.slice(0, i), pointId: tagId.slice(i + TAG_SEP.length) };
}

/* ── Fast-stream (S1) points ──────────────────────────────────────────────

   S1 carries ~28 PCS and ~35 BMS signals per cabinet at 1 Hz, nested in
   data.pcs_values / data.bms_values. They have no point id, so their tag is
   `fast:<bess_id>:<group>::<signal>` — "fast:" keeps them apart from S2's
   `<asset_id>::<point_id>` tags, and the bess id is what /fast-bess filters on.
   Listed under the cabinet's own PCS / BMS device with category "fast". */

const FAST_PREFIX = "fast:";
type FastGroup = "pcs_values" | "bms_values";

export const isFastTag = (tagId: string) => tagId.startsWith(FAST_PREFIX);

function splitFastTag(tagId: string): { bessId: string; group: FastGroup; signal: string } | null {
  const parts = splitTag(tagId);
  if (!parts || !isFastTag(parts.assetId)) return null;
  const [, bessId, group] = parts.assetId.split(":");
  if (!bessId || (group !== "pcs_values" && group !== "bms_values")) return null;
  return { bessId, group, signal: parts.pointId };
}

async function fastPoints(gatewayId: string): Promise<MeasurementPoint[]> {
  /* One sample per cabinet names every signal it sends. Newest rows of all
     cabinets interleave, so a few are read to be sure each one appears. */
  const rows = await fetchFastBess(gatewayId, { limit: 20 }).catch(() => [] as FastBessSample[]);
  const out = new Map<string, MeasurementPoint>();
  for (const r of rows) {
    if (!r.bess_id || !r.source_id) continue;
    for (const group of ["pcs_values", "bms_values"] as const) {
      const device = `${r.source_id}_${group === "pcs_values" ? "pcs" : "bms"}`;
      for (const signal of Object.keys(r.data?.[group] ?? {})) {
        const tagId = makeTag(`${FAST_PREFIX}${r.bess_id}:${group}`, signal);
        if (!out.has(tagId)) out.set(tagId, { tagId, name: `${device} / ${signal}`, unit: "", category: "fast" });
      }
    }
  }
  return [...out.values()];
}

/* ── The point list ─────────────────────────────────────────────────────── */

/** `external_ems_1_bms` → ["external_ems_1", "bms"]. */
function splitAsset(assetId: string): [string, string] | null {
  const m = /^(external_ems_\d+)_(.+)$/.exec(assetId);
  return m ? [m[1], m[2]] : null;
}

/**
 * Every point the gateway publishes: S2's nine substreams, the static
 * catalogue, and S1's fast signals.
 *
 * Why a catalogue: a substream read is the newest 1,000 rows, and fast points
 * crowd slow ones out of it. On 12 Oct 2026 one read per substream named 23 of
 * the PCS's points, 28 of the cooling unit's and 545 of the BMS's ~710.
 * lib/central/pointCatalog.json lists every point id the backend answered for,
 * per device type, so the picker offers all of them; the live reads still add
 * anything new, and supply the unit when the catalogue lacks one.
 */
export async function fetchPointList(gatewayId: string): Promise<MeasurementPoint[]> {
  if (!gatewayId) return [];

  const [per, fast] = await Promise.all([
    Promise.all(SUBSTREAMS.map((ss) =>
      fetchGeneral(gatewayId, { substream: ss, limit: 1000 }).catch(() => [] as GeneralRecord[]))),
    fastPoints(gatewayId),
  ]);
  const live = per.flat();

  const seen = new Map<string, MeasurementPoint>();
  const add = (assetId: string, pointId: string, signal: string | null | undefined, unit: string | null | undefined, category: string | null | undefined) => {
    const tagId = makeTag(assetId, pointId);
    const prev = seen.get(tagId);
    if (prev) { if (!prev.unit && unit) prev.unit = unit; return; }
    seen.set(tagId, {
      tagId,
      /* "<device> / <raw signal>": the curve page splits on " / " to group by
         device, and classifies the raw signal (cell_voltage_12 → Cells). The
         raw name is also what an engineer matches against the register map. */
      name: `${assetId} / ${signal ?? pointId}`,
      /* The backend states a unit per point. Never inferred from the name. */
      unit: unit ?? "",
      category: category ?? "general",
    });
  };

  for (const r of live) if (r.asset_id && r.point_id) add(r.asset_id, r.point_id, r.signal, r.unit, r.category);

  /* The catalogue is per device TYPE (pcs, bms, …); each cabinet has its own. */
  const sources = new Set<string>();
  for (const r of live) { const a = r.asset_id && splitAsset(r.asset_id); if (a) sources.add(a[0]); }
  for (const f of fast) sources.add(f.name.slice(0, f.name.indexOf(" / ")).replace(/_(pcs|bms)$/, ""));
  for (const [pointId, [kinds, signal, unit, category]] of Object.entries(CATALOG.points)) {
    for (const kind of kinds) for (const src of sources) add(`${src}_${kind}`, pointId, signal, unit, category);
  }

  return [...seen.values(), ...fast].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * One point's history over [start, end), oldest first.
 *
 * S2 (`<asset>::<point>`): /general has no from/to, so this is the point's
 * newest 1,000 rows plus what the app server stored, cut to the window.
 * S1 (`fast:…`): /fast-bess does take from/to, read as a thinned series —
 * see fastSeries. Rows that will not parse as a number are dropped rather
 * than plotted as 0: this column carries status words and flags too.
 */
export async function fetchPointHistory(
  gatewayId: string,
  tagId: string,
  startDt?: string,
  endDt?: string,
  /** Aborted when the chart that asked is gone: its slice reads stop. */
  signal?: AbortSignal,
  /** Fast-stream tags: one sample per this much of the window (default 30 min). */
  stepMs?: number,
): Promise<PointHistoryEntry[]> {
  const parts = splitTag(tagId);
  if (!gatewayId || !parts) return [];
  const fromMs = startDt ? Date.parse(startDt) : NaN;
  const toMs = endDt ? Date.parse(endDt) : NaN;
  const inRange = (t: number) => (Number.isNaN(fromMs) || t >= fromMs) && (Number.isNaN(toMs) || t < toMs);

  const fast = splitFastTag(tagId);
  if (fast) {
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return [];
    const samples = await fastSeries(gatewayId, fast.bessId, fromMs, toMs, signal, stepMs);
    return samples
      .map((s) => {
        const v = s.data?.[fast.group]?.[fast.signal];
        return typeof v === "number" && Number.isFinite(v) ? { t: s.sample_time_utc, value: v } : null;
      })
      .filter((p): p is PointHistoryEntry => p !== null);
  }

  /* A failed live read THROWS rather than answering []: an empty chart says
     "no readings in this range", which a timeout is not. The query retries,
     and a lasting failure shows as an error. */
  const [live, stored] = await Promise.all([
    fetchGeneral(gatewayId, { pointId: parts.pointId, limit: 1000 }),
    Number.isNaN(fromMs) ? Promise.resolve([] as GeneralRecord[])
      : fetchHistory<GeneralRecord>("general", { fromMs, toMs: Number.isNaN(toMs) ? undefined : toMs, pointId: parts.pointId, assetId: parts.assetId }),
  ]);
  const byTime = new Map<number, number>();
  for (const r of [...live, ...stored]) {
    if (r.asset_id !== parts.assetId || !r.sample_time_utc) continue;
    const t = Date.parse(r.sample_time_utc);
    const v = numeric(r);
    if (Number.isNaN(t) || v === null || !inRange(t)) continue;
    byTime.set(t, v);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, value]) => ({ t: new Date(t).toISOString(), value }));
}

/**
 * One cabinet's S1 samples across [fromMs, toMs), thinned to evenly spaced
 * real samples: the window is cut into slices and each is read for its newest
 * ONE sample. Paging the whole window at 1 Hz would be ~86 requests of ~3 MB
 * for a day. Shared across signals: five fast parameters of one cabinet are
 * one read, not five.
 *
 * One per slice, not a burst: twelve consecutive 1-second samples per slice
 * made the median step 1 s, so every slice boundary looked like a hole and the
 * chart drew a tick per slice instead of a line (12 Oct 2026). Evenly spaced
 * samples join up, and the line breaks only where a slice returned nothing —
 * where the gateway really sent nothing.
 */
/** Aim for one sample per this much window… */
const FAST_STEP_MS = 30 * 60_000;
/** …but no fewer slices than this, nor more. A windowed read takes ~0.4 s
 *  alone but queues behind the browser's ~6 connections: 144 a day per
 *  cabinet, on every chart at once, left past days empty for minutes
 *  (13 Oct 2026). */
const FAST_MIN_SLICES = 24;
const FAST_MAX_SLICES = 288;   // a day at one per 5 min, for a caller that asks (stepMs)
/** Longer windows (week and up) read at most this many in the even pass —
 *  one an hour for a week, so a day's low and high are not missed… */
const FAST_MAX_SLICES_LONG = 168;
/** …and at most this many more where the data turned out to be. */
const FAST_REFINE_READS = 40;
/** Stored history is read thinned to about this many rows per window. */
const FAST_STORED_POINTS = 720;
const FAST_CONCURRENCY = 12;
/** Missing slices are probed in runs of this many (six hours of a week). */
const FAST_RUN = 6;

/** Runs `work(0…n-1)`, FAST_CONCURRENCY at a time: 144 at once is a burst the backend feels. */
async function pool(n: number, work: (i: number) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(FAST_CONCURRENCY, n) }, async () => {
    while (next < n) {
      if (signal?.aborted) return;
      await work(next++);
    }
  }));
}

/* Every slice read in the app shares four connections. Browsers open ~6 per
   host, so history can never take them all: live readings and "Data
   Updated" kept moving while a Year chart read hundreds of slices (they had
   stalled for minutes, 13 Oct 2026). */
const SLICE_SLOTS = 4;
let slicesInFlight = 0;
const sliceQueue: Array<() => void> = [];
async function sliceRead<T>(signal: AbortSignal | undefined, read: () => Promise<T>): Promise<T> {
  if (slicesInFlight >= SLICE_SLOTS) await new Promise<void>((go) => sliceQueue.push(go));
  slicesInFlight++;
  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return await read();
  } finally {
    slicesInFlight--;
    sliceQueue.shift()?.();
  }
}
const fastCache = new Map<string, Promise<FastBessSample[]>>();
/** When each cached window was read. One that reached past that moment holds
 *  hours read since, so it is read again after FAST_FRESH_MS; one wholly in
 *  the past never changes. */
const fastCachedAt = new Map<string, number>();
const FAST_FRESH_MS = 10 * 60_000;

function fastSeries(
  gatewayId: string, bessId: string, fromMs: number, toMs: number, signal?: AbortSignal, stepMs = FAST_STEP_MS,
): Promise<FastBessSample[]> {
  const key = `${gatewayId}|${bessId}|${fromMs}|${toMs}|${stepMs}`;
  const hit = fastCache.get(key);
  const at = fastCachedAt.get(key) ?? 0;
  if (hit && (toMs <= at || Date.now() - at < FAST_FRESH_MS)) return hit;
  fastCachedAt.set(key, Date.now());
  const span = toMs - fromMs;
  /* Short windows are read whole; 1,000 samples is ~16 min at 1 Hz. */
  if (span <= 15 * 60_000) {
    const run = fetchFastBess(gatewayId, { bessId, fromMs, toMs, limit: FAST_BESS_MAX_LIMIT })
      .then((rows) => rows.sort((a, b) => Date.parse(a.sample_time_utc) - Date.parse(b.sample_time_utc)));
    fastCache.set(key, run);
    run.catch(() => fastCache.delete(key));
    return run;
  }
  const cap = span > 2 * 86_400_000 ? FAST_MAX_SLICES_LONG : FAST_MAX_SLICES;
  const slices = Math.min(cap, Math.max(FAST_MIN_SLICES, Math.round(span / stepMs)));
  const step = span / slices;
  const run = (async () => {
    /* The app server's collector keeps one sample per cabinet per minute
       (the fields the history screens read). Whatever it holds is used, and
       only the slices it is missing are read from the backend. It used to be
       all or nothing: under half the window stored meant every slice read
       again — ~340 reads, ~40 s, for a two-cabinet week (21 Oct 2026). */
    const stored = (await fetchHistory<FastBessSample>("fast", {
      fromMs, toMs, bessId, stepMs: Math.max(60_000, Math.floor(span / FAST_STORED_POINTS)),
    }).catch(() => [] as FastBessSample[])).filter((r) => {
      const t = Date.parse(r.sample_time_utc ?? "");
      return t >= fromMs && t < toMs;
    });
    const sliceOf = (r: FastBessSample) => Math.floor((Date.parse(r.sample_time_utc) - fromMs) / step);
    const held: boolean[] = new Array(slices).fill(false);
    for (const r of stored) { const i = sliceOf(r); if (i >= 0 && i < slices) held[i] = true; }
    /* Each window's newest sample (null: the read failed). One request to
       the app's server, which runs the reads in parallel off the browser's
       connection limit; window by window from here if that request fails. */
    const readWindows = async (wins: [number, number][]): Promise<(FastBessSample[] | null)[]> => {
      try {
        return await fetchFastBessSlices(gatewayId, bessId, wins, signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        const out: (FastBessSample[] | null)[] = new Array(wins.length).fill(null);
        await pool(wins.length, async (n) => {
          out[n] = await sliceRead(signal, () => fetchFastBess(gatewayId, { bessId, fromMs: wins[n][0], toMs: wins[n][1], limit: 1 }))
            .catch(() => null);
        }, signal);
        return out;
      }
    };
    const win = (a: number, b: number): [number, number] => [fromMs + a * step, fromMs + b * step];

    /* The missing slices, as runs of at most FAST_RUN slices. Where the
       gateway uploaded nothing (the overnight gaps) the backend has nothing
       either, so each run is first read whole, for its newest sample: empty,
       and the run costs one read instead of one per slice; not empty, and the
       slices after that sample are empty too — only the ones before it are
       left to read. Full data costs no extra: the run's read is its last slice. */
    const runs: [number, number][] = [];
    for (let i = 0; i < slices; i++) {
      if (held[i]) continue;
      const last = runs[runs.length - 1];
      if (last && last[1] === i && i - last[0] < FAST_RUN) last[1] = i + 1; else runs.push([i, i + 1]);
    }
    const pages: FastBessSample[][] = new Array(slices).fill([]);
    const todo: number[] = [];
    const probes = await readWindows(runs.map(([a, b]) => win(a, b)));
    runs.forEach(([a, b], r) => {
      const probe = probes[r];
      if (probe === null) { for (let i = a; i < b; i++) todo.push(i); return; }   // failed: read each
      if (!probe.length) return;
      const j = Math.min(b - 1, Math.max(a, sliceOf(probe[0])));
      pages[j] = probe;
      for (let i = a; i < j; i++) todo.push(i);
    });
    const each = await readWindows(todo.map((i) => win(i, i + 1)));
    todo.forEach((i, n) => { pages[i] = each[n] ?? []; });
    /* Refine where the data is. Over a year whose history starts in late
       September, an even pass lands most slices on empty time (10 samples for
       2026 on 13 Oct). So split each slice that DID return a sample into
       finer ones, at most FAST_REFINE_READS more reads in total — only when
       under a third of the slices found anything. */
    const live = pages.map((pg, i) => (pg.length || held[i] ? i : -1)).filter((i) => i >= 0);
    const have = live.length;
    if (have > 0 && have < slices / 3) {
      const per = Math.min(16, Math.floor(FAST_REFINE_READS / have));
      const subs = live.flatMap((i) => Array.from({ length: per }, (_, k): [number, number] => {
        const a = fromMs + i * step + (k * step) / per;
        return [a, a + step / per];
      }));
      pages.push(...(await readWindows(subs)).map((pg) => pg ?? []));
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const seen = new Set<string>();
    return [...pages.flat(), ...stored]
      .filter((r) => (seen.has(r.sample_time_utc) ? false : (seen.add(r.sample_time_utc), true)))
      .sort((a, b) => Date.parse(a.sample_time_utc) - Date.parse(b.sample_time_utc));
  })();
  fastCache.set(key, run);
  run.catch(() => fastCache.delete(key));
  /* Bounded: the newest few windows are all a page asks for. */
  if (fastCache.size > 20) fastCache.delete(fastCache.keys().next().value!);
  return run;
}

/**
 * When each tag last reported.
 *
 * This used to be null for every tag, and the reason was sound: the old
 * `/api/telemetry` stamped the RESPONSE rather than each signal, so returning
 * the response time per tag would have asserted that all 1,422 were read at
 * one instant — a freshness claim this app has been burned by before.
 *
 * S2 stamps every row, so the figure is real now. Points are fetched per
 * substream rather than per tag: 1,174 tags would be 1,174 requests.
 */
export async function fetchPointLatestTs(
  gatewayId: string,
  tagIds: string[],
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = Object.fromEntries(tagIds.map((id) => [id, null]));
  if (!gatewayId || tagIds.length === 0) return out;

  const wanted = new Set(tagIds);

  /* Fast tags: the newest sample of their cabinet. */
  const fastBess = [...new Set(tagIds.map(splitFastTag).filter(Boolean).map((f) => f!.bessId))];
  await Promise.all(fastBess.map(async (bessId) => {
    const [s] = await fetchFastBess(gatewayId, { bessId, limit: 1 }).catch(() => [] as FastBessSample[]);
    const ms = s ? Date.parse(s.sample_time_utc) : NaN;
    for (const id of tagIds) if (splitFastTag(id)?.bessId === bessId && !Number.isNaN(ms)) out[id] = ms;
  }));
  const per = await Promise.all(
    SUBSTREAMS.map((ss) =>
      fetchGeneral(gatewayId, { substream: ss, limit: 1000 }).catch(() => [] as GeneralRecord[]),
    ),
  );

  for (const r of per.flat()) {
    if (!r.asset_id || !r.point_id || !r.sample_time_utc) continue;
    const tag = makeTag(r.asset_id, r.point_id);
    if (!wanted.has(tag) || out[tag] !== null) continue;   // newest first
    const ms = Date.parse(r.sample_time_utc);
    if (!Number.isNaN(ms)) out[tag] = ms;
  }
  /* A slow point is often missing from the newest rows of its substream —
     ask for it by id before saying it has never reported. */
  const missing = tagIds.filter((id) => out[id] === null && !isFastTag(splitTag(id)?.assetId ?? ""));
  await Promise.all(missing.map(async (id) => {
    const parts = splitTag(id);
    if (!parts) return;
    const rows = await fetchGeneral(gatewayId, { pointId: parts.pointId, limit: 20 }).catch(() => [] as GeneralRecord[]);
    const ms = Date.parse(rows.find((r) => r.asset_id === parts.assetId)?.sample_time_utc ?? "");
    if (!Number.isNaN(ms)) out[id] = ms;
  }));
  return out;
}

/**
 * The history tag for an asset's signal, for fetchPointHistory: its S2 point
 * (the catalogue maps device type + signal to a point id), or — for a PCS /
 * BMS signal S2 does not carry — its fast-stream (S1) tag. Null when neither
 * knows the signal.
 */
export function historyTag(assetId: string, signal: string): string | null {
  const a = splitAsset(assetId);
  if (a) {
    for (const [pointId, [kinds, sig]] of Object.entries(CATALOG.points)) {
      if (sig === signal && kinds.includes(a[1])) return makeTag(assetId, pointId);
    }
  }
  const m = /^external_ems_(\d+)_(pcs|bms)$/.exec(assetId);
  return m ? makeTag(`${FAST_PREFIX}bess_${m[1]}:${m[2] === "pcs" ? "pcs_values" : "bms_values"}`, signal) : null;
}
