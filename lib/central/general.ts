/**
 * S2 general asset telemetry, off the central backend.
 *
 *   GET /gateways/{id}/general?limit=&substream=&point_id=
 *
 * Where S1 covers the battery and inverter at 1 Hz, S2 covers everything else
 * the gateway reads — the cooling loop, the meter, fire protection, the IO
 * module — and it is shaped completely differently.
 *
 * ── One row is ONE signal ──────────────────────────────────────────────────
 *
 * S1 bundles 63 signals into one sample. S2 does the opposite: every row is a
 * single reading of a single point on a single asset. A screen that wants "the
 * cooling loop right now" is therefore asking for the newest row PER point_id,
 * not for the newest row — see `latestPerSignal`.
 *
 * ── Volume, and what it means for the window ───────────────────────────────
 *
 * Measured against this gateway: limit=1000 unfiltered spans about SEVEN
 * SECONDS, carrying 465 distinct points across 10 assets. Unfiltered, this is
 * not a history at all; it is a firehose of the present. A time axis only
 * exists once the request narrows to one point — `point_id=p0207&limit=500`
 * spans about 35 minutes.
 *
 * ── The asset trap ─────────────────────────────────────────────────────────
 *
 * A point_id is not unique to an asset. p0207 exists on external_ems_1_pcs and
 * external_ems_2_pcs alike, and a point_id query returns BOTH interleaved —
 * 250 rows each in the measurement above. There is no asset_id parameter, so
 * the split has to happen here. Plotting a point_id response without it draws
 * two cabinets as one line, which is the same trap S1 sets and the same wrong
 * chart at the end of it.
 *
 * ── One read is not the whole substream ────────────────────────────────────
 *
 * Measured 28 September 2026: bms_extended carries ~726 points per cabinet,
 * so one snapshot of both cabinets is ~1,450 rows against a 1,000-row cap and
 * no asset filter. A single substream read therefore misses about a third of
 * the BMS — a different third each time — and a first catalogue built from
 * two reads never saw the 160 cell temperatures, the HV-box probes or ~100 of
 * the BMS's own level-1/2/3 alarm flags. An alarm list built on one read
 * would drop a raised flag whenever it fell outside the newest 1,000.
 *
 * So whole-substream reads are merged: every read adds its rows to a cache of
 * the newest row per (asset, point), and the answer is that cache, newest
 * first, less anything more than MERGE_MAX_AGE_MS older than the NEWEST row it
 * holds — measured from the data, not the clock, so when the gateway goes
 * quiet the last full snapshot stays readable instead of emptying five minutes
 * later (which is what measuring from now did on 28 Sep). Each row keeps its own
 * sample_time_utc, so nothing is made to look fresher than it is. Coverage
 * fills in over two or three polls. Point reads are not merged — they are
 * histories, and a cache would put old rows among them.
 *
 * ── value is a string ──────────────────────────────────────────────────────
 *
 * Deliberately, per the API note: the column carries floats, status integers
 * and flags alike. Parse where a number is needed and keep the original for
 * display, because "0.0" and "0" are the same number and not the same reading.
 */

import { getSession } from "./session";
import { centralUrl } from "./serverScope";
import { CentralReadError } from "./gateways";

export const GENERAL_MAX_LIMIT = 1000;

/** The nine documented substreams, in the order the equipment reads. */
export const SUBSTREAMS = [
  "ems_system",
  "pcs_extended",
  "bms_extended",
  "utility_meter",
  "liquid_cooling",
  "fire_protection",
  "dehumidifier",
  "io_module",
  "remote_control",
] as const;
export type Substream = (typeof SUBSTREAMS)[number];

/** `GeneralRecord`: every field is required by the schema and every one nullable. */
export interface GeneralRecord {
  substream: string | null;
  asset_id: string | null;
  point_id: string | null;
  signal: string | null;
  value: string | null;
  unit: string | null;
  category: string | null;
  quality: string | null;
  sample_time_utc: string | null;
  received_at_utc: string | null;
  /** The raw record. Carries display_name, policy, key_signal, rw, source_id. */
  data: Record<string, unknown>;
}

export async function fetchGeneral(
  gatewayId: string,
  opts: { limit?: number; substream?: string; pointId?: string } = {},
): Promise<GeneralRecord[]> {
  const s = getSession();
  if (!s) throw new CentralReadError("Not signed in");

  const limit = Math.max(1, Math.min(opts.limit ?? 50, GENERAL_MAX_LIMIT));
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.substream) qs.set("substream", opts.substream);
  if (opts.pointId) qs.set("point_id", opts.pointId);

  const r = await fetch(
    centralUrl(`/api/central/gateways/${encodeURIComponent(gatewayId)}/general?${qs}`),
    { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" },
  );

  if (r.status === 422) throw new CentralReadError("Gateway id or limit rejected by the backend", 422);
  if (!r.ok) throw new CentralReadError(`Central backend answered ${r.status}`, r.status);

  const body: unknown = await r.json();
  /* Sorted by sample time, not trusted in arrival order: a backlog the gateway
     uploads after an outage arrives late with old sample times, and the
     first-sighting readers below would otherwise take it for the current value. */
  const rows = Array.isArray(body)
    ? (body as GeneralRecord[]).slice().sort((a, b) => rowTime(b) - rowTime(a))
    : [];
  return opts.substream && !opts.pointId ? mergeSnapshot(gatewayId, opts.substream, rows) : rows;
}

/* ── Snapshot merge ───────────────────────────────────────────────────────── */

/** A merged row this much older than the newest one has been superseded and is dropped. */
export const MERGE_MAX_AGE_MS = 5 * 60_000;

const snapshots = new Map<string, Map<string, GeneralRecord>>();

const rowTime = (r: GeneralRecord): number => {
  const t = Date.parse(r.sample_time_utc ?? "");
  return Number.isNaN(t) ? 0 : t;
};

function mergeSnapshot(gatewayId: string, substream: string, rows: GeneralRecord[]): GeneralRecord[] {
  const key = `${gatewayId}|${substream}`;
  const cache = snapshots.get(key) ?? new Map<string, GeneralRecord>();
  snapshots.set(key, cache);

  for (const r of rows) {
    if (!r.asset_id || !r.point_id) continue;
    const k = `${r.asset_id}|${r.point_id}`;
    const had = cache.get(k);
    if (!had || rowTime(r) >= rowTime(had)) cache.set(k, r);
  }

  let newest = 0;
  for (const r of cache.values()) newest = Math.max(newest, rowTime(r));
  const cutoff = newest - MERGE_MAX_AGE_MS;
  for (const [k, r] of cache) if (rowTime(r) < cutoff) cache.delete(k);

  /* Newest first, as the endpoint answers — callers take the first sighting. */
  return [...cache.values()].sort((a, b) => rowTime(b) - rowTime(a));
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** The number behind the string, or null when it is not one. */
export function numeric(r: GeneralRecord | undefined): number | null {
  if (!r || r.value == null) return null;
  const n = Number(r.value);
  return Number.isFinite(n) ? n : null;
}

/** The readable label the raw record carries, falling back to the signal name. */
export function label(r: GeneralRecord): string {
  const d = r.data?.display_name;
  return (typeof d === "string" && d) || r.signal || r.point_id || "—";
}

/** Signals the gateway itself marks as key, for a default view that is not 465 rows. */
export const isKeySignal = (r: GeneralRecord): boolean => r.data?.key_signal === true;

/** Assets present, sorted — there is no endpoint that lists them. */
export function assetsIn(rows: GeneralRecord[]): string[] {
  return [...new Set(rows.map((r) => r.asset_id).filter((a): a is string => !!a))].sort();
}

/**
 * Newest row per point_id, for one asset.
 *
 * Rows arrive newest first, so the first sighting of a point_id is its current
 * value and later ones are history. Scoped to an asset because a point_id is
 * shared across cabinets and merging them would show one cabinet's reading
 * under the other's name.
 */
export function latestPerSignal(rows: GeneralRecord[], assetId: string | null): GeneralRecord[] {
  const seen = new Map<string, GeneralRecord>();
  for (const r of rows) {
    if (!r.point_id) continue;
    if (assetId && r.asset_id !== assetId) continue;
    if (!seen.has(r.point_id)) seen.set(r.point_id, r);
  }
  return [...seen.values()].sort((a, b) => label(a).localeCompare(label(b)));
}

/** Oldest → newest for one asset, for plotting a single point_id. */
export function seriesFor(rows: GeneralRecord[], assetId: string | null): GeneralRecord[] {
  return rows
    .filter((r) => !assetId || r.asset_id === assetId)
    .slice()
    .reverse();
}
