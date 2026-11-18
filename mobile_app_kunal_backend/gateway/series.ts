/**
 * History, aggregated on the server so the phone never carries the rows.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * One hour of history is 3,456 one-second rows and 8.7 MB on the wire, and the
 * gateway needs about 33 s to produce it. The History screen uses four numbers
 * off each of those rows — power, SOC, peak cell temperature, cell spread — out
 * of the 63 the profile carries. Better than 95% of that payload was fetched,
 * parsed and thrown away, on a phone, over mobile data, and any interruption
 * anywhere in those 33 s discarded the lot and started again.
 *
 * The gateway offers no downsampling: §8 exposes from, to, limit, order and
 * format and nothing else. A pre-aggregated endpoint is the right long-term
 * answer and it is gateway-team work. This module is the part that does not
 * need them, and it removes the phone from the problem entirely:
 *
 *   phone → this server:  ~40 KB of buckets, always
 *   this server → gateway: the rows, once, on a wire that can take it
 *
 * ── Why it does not happen twice ──────────────────────────────────────────
 * History is immutable. A window that has already ended cannot change, so a
 * chunk of it, once aggregated, is correct forever. Work is therefore cut into
 * epoch-aligned 30-minute chunks, each cached under the caller's entitlement
 * scope, and the trailing chunk — the only one still moving — is extended from
 * its own high-water mark rather than re-read. After the first pass, a chart
 * costs the seconds that have actually elapsed since the last one.
 *
 * ── Why an interruption stops mattering ───────────────────────────────────
 * Each request does a bounded amount of gateway work and returns whatever
 * coverage it has, complete or not. Nothing is discarded on failure: a chunk
 * that lands is kept, a chunk that fails is simply still missing, and the next
 * request picks up exactly where this one stopped. There is no long request to
 * interrupt and no accumulated buffer to lose.
 *
 * ── What is never rounded away ────────────────────────────────────────────
 * Buckets carry min and max as well as the mean, and the energy integral, the
 * peaks and the SOC range are all accumulated over every raw row before any
 * bucketing happens. Decimation here is presentation only, exactly as it was
 * when it lived on the client. A chart drawn from these buckets and a chart
 * drawn from the raw rows report the same totals.
 *
 * Server-only: it holds a process-wide cache and reads the gateway directly.
 */

import { createHash } from "node:crypto";
import { gatewayRead, GatewayReadError } from "./proxy";
import { isDemoSite } from "./demo";
import { loadChunk, saveChunk } from "./chunkStore";
import type { Site } from "./sites";
import { readSample, decodable, observedKeys, type RowSample } from "./rows";
import { beginUserWait, userWaitsInFlight } from "./pressure";

/* ── Shape of the work ─────────────────────────────────────────────────── */

/** Finest resolution the cache stores. Everything coarser folds from this. */
export const BASE_BUCKET_MS = 5_000;
/* Cache granularity.

   Measured against the endpoint rather than assumed, because the assumption
   this was previously sized on has expired. Timing /fast-bess/history at
   several limits gives:

       time = 8.0 s  +  5.27 ms per row       (100 → 5,000 rows)

   Both terms are real, and the second one dominates any wide window: 24 h is
   86,400 rows, so 7.6 min of the ~10 min it costs is per-row work that no
   chunk size can touch. The older comment here said a request costs about the
   same whatever is asked of it. That was true at the 8-16 s reads it was
   written against and is not true now; sizing a chunk on it overstates what
   this constant buys.

   What it does buy is the fixed term. PAGE_LIMIT is 5,000 rows and the logger
   writes one row per second per source, so a page holds 83.3 minutes and that
   is the ceiling. 80 minutes is 4,800 rows — 96% of the page, 200 rows of
   headroom — and the largest round number under the cap that also divides the
   day exactly: 18 chunks per day, none straddling midnight. 83 would take the
   last 4% and give 17.35 a day, drifting against both the wall clock and
   chunkStore's day-sharded paths.

   At 60 minutes a chunk carried 3,600 rows, 72% of a page already paid for.
   24 h went from 24 requests to 18 and 30 d from 720 to 540 — worth about 7%
   of wall-clock, not the 25% the request count suggests.

   MUST stay in step with backfill.ts, which imports it. The walker fills
   chunks by start instant and buildSeries looks them up by the same instant;
   two grids would have the backfill write chunks nothing ever reads. */
export const CHUNK_MS = 80 * 60_000;
/** A chunk is immutable once this far past its end; until then it is extended. */
const SEAL_LAG_MS = 20_000;
/** How long an open chunk's tail is trusted before it is extended again. */
const OPEN_TTL_MS = 15_000;

/** The gateway's own per-page cap, API Reference §8. */
const PAGE_LIMIT = 5000;
/** Pages per chunk. 60 min of 1 s rows fits in one; the rest is headroom. */
const PAGES_PER_CHUNK = 3;

/* One request does a bounded amount of gateway work and then answers with
   whatever it has. These numbers are the whole reason a wide window no longer
   hangs: the client gets a partial series quickly and a complete one over
   however many polls it takes, instead of one request that either finishes or
   loses everything. Concurrency is 2 because the board is the bottleneck and
   the third parallel read makes the first two slower, not the set faster.

   The budget bounds when new work is *started*, not when the request ends: a
   read already in flight is allowed to finish rather than be thrown away. With
   gateway reads at 8-16 s that overshoots, and measured history-series times
   were 27-55 s against a nominal 20 s. 45 s is what it had actually grown into,
   stated rather than discovered: at two concurrent reads it buys the whole
   FILL_MAX_CHUNKS queue in one pass, so a 6 h window arrives in a single poll
   instead of the three or four it used to take. */
const FILL_BUDGET_MS = 45_000;
const FILL_MAX_CHUNKS = 8;
const FILL_CONCURRENCY = 2;

/** Gaps wider than this are not integrated across. Matches the client rule. */
const GAP_GUARD_MS = 120_000;

/* ~86 KB per chunk of 1 s data: 720 buckets of fifteen fields, twice the
   buckets of a 30-minute chunk and half as many chunks to hold an hour.

   800 because the ceiling has to clear the widest window the screen offers.
   30 d is 540 chunks at 80 minutes (it was 720 at 60), and at the old 600 this
   cache was smaller than its own largest request: a 30 d window evicted its
   oldest chunks while still fetching the newest, so it could never be
   assembled whole however warm the process was. 800 clears 540 with room, and
   would still clear a 30 d window if the chunk size were taken back down.

   Still in-process, but no longer the only copy: chunkStore.ts holds sealed
   chunks on disk, so eviction now costs a local file read instead of a gateway
   round-trip, and a redeploy starts warm. That is what makes ~69 MB the right
   trade rather than a reason to shrink — memory is a cache over the store now,
   not the store. */
const CACHE_MAX_CHUNKS = 800;

/* ── One cached chunk ──────────────────────────────────────────────────── */

/**
 * Buckets as parallel arrays rather than an array of objects.
 *
 * 360 buckets of fifteen fields is 5,400 numbers. As objects that is 360 V8
 * objects per chunk and roughly four times the memory of fifteen packed double
 * arrays, and the cache is sized in chunks. Absent values are NaN, which keeps
 * every array packed — a null would deoptimise all of them.
 *
 * Every total the window reports is carried here rather than only on the chunk,
 * because a window rarely lands on the chunk grid and a chunk-level total can
 * only be reported whole. The extremes and the energy are accumulated from raw
 * rows exactly as before — this changes where they are stored, not how they are
 * measured, so clipping a window to its own edges costs at most the one bucket
 * at each end rather than up to a whole chunk of data it never asked for.
 */
interface Buckets {
  t: number[];
  n: number[];
  pSum: number[]; pN: number[]; pMin: number[]; pMax: number[];
  socSum: number[]; socN: number[]; socMin: number[]; socMax: number[];
  tMax: number[];
  dvMax: number[];
  /* The trapezoid over the raw pair ending in this bucket, and the gap it
     declined to integrate across. Attributed to the later sample's bucket, so
     a pair is counted once and by the edge a window would clip on. */
  chgKwh: number[]; disKwh: number[]; skipMs: number[];
}

const emptyBuckets = (): Buckets => ({
  t: [], n: [], pSum: [], pN: [], pMin: [], pMax: [],
  socSum: [], socN: [], socMin: [], socMax: [],
  tMax: [], dvMax: [],
  chgKwh: [], disKwh: [], skipMs: [],
});

interface Chunk {
  from: number;
  to: number;
  b: Buckets;
  rows: number;
  /** Rows whose columns this build could not find. Reported, never silent. */
  undecodable: number;
  observed: string[] | null;

  chargedKwh: number;
  dischargedKwh: number;
  skippedMs: number;

  /** First and last raw sample, so the integral joins across chunk seams. */
  firstT: number | null; firstP: number;
  lastT: number | null;  lastP: number;

  peakAbsKw: number; socMin: number; socMax: number; tempMax: number;

  resolutionSec: number | null;
  /**
   * The single bess_id every row in this chunk carried, when there was one.
   *
   * A chunk fetched before the app has confirmed which BESS it is looking at
   * is fetched unfiltered — deliberately, because filtering on a guessed id
   * turns "the guess was wrong" into "this unit has no history". But the rows
   * that come back still say which BESS they are from, and for a source
   * carrying exactly one they all say the same thing. That makes the
   * unfiltered chunk identical to the filtered one, and lets it be stored
   * under the id it actually holds rather than under none — so the request
   * that arrives a moment later, once the id is confirmed, finds it on disk
   * instead of buying the same rows a second time.
   */
  soleBess: string | null;
  /** How far into the chunk the gateway has actually been read. */
  coveredTo: number;
  sealed: boolean;
  filledAt: number;
}

function newChunk(from: number): Chunk {
  return {
    from, to: from + CHUNK_MS,
    b: emptyBuckets(),
    rows: 0, undecodable: 0, observed: null,
    chargedKwh: 0, dischargedKwh: 0, skippedMs: 0,
    firstT: null, firstP: NaN, lastT: null, lastP: NaN,
    peakAbsKw: NaN, socMin: NaN, socMax: NaN, tempMax: NaN,
    resolutionSec: null,
    soleBess: null,
    coveredTo: from,
    sealed: false,
    filledAt: 0,
  };
}

/* ── The cache ─────────────────────────────────────────────────────────── */

/* Map preserves insertion order, so re-inserting on read makes it an LRU with
   no bookkeeping. Keyed by entitlement scope first: a chunk is never visible
   to a caller whose token does not already reach that source. */
const cache = new Map<string, Chunk>();

/* Site first, and it is not decoration. Source ids are assigned per gateway,
   not globally: every site commissioned from the same template has an
   `external_ems_1` carrying a `bess_1`. Without the site in this key, two
   sites whose tokens happen to resolve to the same entitlement scope would
   share cached chunks, and one plant's history would render under the other's
   name — silently, correctly-shaped, and impossible to spot on screen. */
const chunkKey = (siteId: string, scope: string, sourceId: string, bessId: string, start: number) =>
  `${siteId}|${scope}|${sourceId}|${bessId}|${start}`;

function readChunk(key: string): Chunk | undefined {
  const c = cache.get(key);
  if (!c) return undefined;
  cache.delete(key);
  cache.set(key, c);
  return c;
}

function writeChunk(key: string, c: Chunk): void {
  cache.delete(key);
  cache.set(key, c);
  while (cache.size > CACHE_MAX_CHUNKS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Pull whatever the durable store already holds into the memory cache.
 *
 * Reads run together rather than in sequence: these are small local files and
 * a 30 d window asks for 720 of them, which is a tenth of a second in parallel
 * and most of a second one after another.
 *
 * A chunk already in memory is never re-read — memory is the newer of the two
 * by construction, since everything on disk was written from it.
 */
async function hydrate(
  siteId: string, scopeKey: string, sourceId: string, bessId: string, starts: number[],
): Promise<void> {
  const missing = starts.filter((s) => !cache.has(chunkKey(siteId, scopeKey, sourceId, bessId, s)));
  if (!missing.length) return;

  const loaded = await Promise.all(
    missing.map((s) => loadChunk(siteId, sourceId, bessId, s).catch(() => undefined)),
  );
  for (let i = 0; i < missing.length; i++) {
    const c = loaded[i];
    if (c) writeChunk(chunkKey(siteId, scopeKey, sourceId, bessId, missing[i]), c);
  }
}

/* ── Who is allowed to see a cached chunk ──────────────────────────────── */

/**
 * A cache key component that stands for "what this token may read".
 *
 * Two callers share cached chunks only when the gateway grants them the same
 * sources, so a shared cache can never hand one customer another's plant. When
 * /api/auth/me does not say — an older gateway, a role with no source list, a
 * failed call — the scope falls back to the token's own digest, which is
 * private by construction. Degrading to a colder cache is the safe direction.
 */
interface Scope { key: string; sources: string[] | null }

const scopes = new Map<string, { scope: Scope; at: number }>();
const SCOPE_TTL_MS = 5 * 60_000;

const digest = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

async function scopeFor(auth: string | null, site: Site): Promise<Scope> {
  /* Keyed by site as well as token. Tokens from different gateways are
     different strings, so a collision needs two sites to have issued the same
     token — but the entitlement this resolves to is a statement about one
     gateway's sources, and it should not be reachable under another's id. */
  const token = auth ?? "";
  const id = digest(`${site.id}|${token}`);
  const hit = scopes.get(id);
  if (hit && Date.now() - hit.at < SCOPE_TTL_MS) return hit.scope;

  let scope: Scope = { key: id, sources: null };
  try {
    const { body } = await gatewayRead("auth/me", new URLSearchParams(), auth, site);
    const sources = Array.isArray(body.source_ids)
      ? body.source_ids.filter((s): s is string => typeof s === "string").slice().sort()
      : null;
    const role = typeof body.role === "string" ? body.role : "";
    if (sources && sources.length) {
      scope = { key: digest(`${role}|${sources.join(",")}`), sources };
    }
  } catch {
    /* The call failed — almost always because the gateway is unreachable,
       which is exactly when the cache matters most.

       Keep the scope this token last resolved to. Falling through to the
       token-digest fallback would be safe but useless: it is a *different*
       cache key, so every chunk already held for this caller would be orphaned
       at the moment the gateway went away, and History would go blank on a
       blip. Entitlement does not change because a request timed out.

       With no previous answer there is nothing to reuse and the private
       fallback stands. The gateway still enforces the real boundary on every
       read below; this only decides which cache bucket is consulted. */
    if (hit) {
      scopes.set(id, { scope: hit.scope, at: Date.now() });
      return hit.scope;
    }
  }

  scopes.set(id, { scope, at: Date.now() });
  return scope;
}

/* ── Accumulating raw rows into a chunk ────────────────────────────────── */

function bucketIndex(b: Buckets, start: number): number {
  const last = b.t.length - 1;
  if (last >= 0 && b.t[last] === start) return last;
  if (last < 0 || start > b.t[last]) {
    b.t.push(start); b.n.push(0);
    b.pSum.push(0); b.pN.push(0); b.pMin.push(NaN); b.pMax.push(NaN);
    b.socSum.push(0); b.socN.push(0); b.socMin.push(NaN); b.socMax.push(NaN);
    b.tMax.push(NaN); b.dvMax.push(NaN);
    b.chgKwh.push(0); b.disKwh.push(0); b.skipMs.push(0);
    return b.t.length - 1;
  }
  /* Out of order. order=asc makes this unreachable in practice; a linear walk
     back is still cheaper than being wrong if the gateway ever reorders. */
  for (let i = last; i >= 0; i--) if (b.t[i] === start) return i;
  return -1;
}

const lo = (a: number, v: number) => (Number.isNaN(a) ? v : Math.min(a, v));
const hi = (a: number, v: number) => (Number.isNaN(a) ? v : Math.max(a, v));

/**
 * Fold one ascending run of samples into a chunk.
 *
 * Called once per gateway page and again for every extension of the open
 * chunk, so it has to be resumable: the running integral picks up from the
 * chunk's own last sample rather than from the start of the run.
 */
function accumulate(chunk: Chunk, samples: RowSample[]): void {
  let prevT = chunk.lastT;
  let prevP = chunk.lastP;

  for (const s of samples) {
    if (s.t < chunk.from || s.t >= chunk.to) continue;

    const i = bucketIndex(chunk.b, Math.floor(s.t / BASE_BUCKET_MS) * BASE_BUCKET_MS);

    /* Energy over the raw pair, before anything is averaged. Identical
       trapezoid to the one the client used to run, including the gap guard:
       ~3.6% of expected samples are missing and bridging a two-minute hole
       would invent energy that was never measured.

       Recorded against this sample's bucket as well as the chunk. The chunk
       total is what a whole sealed chunk contributes; the bucket total is what
       a window that ends mid-chunk can honestly claim. */
    if (prevT != null && !Number.isNaN(prevP)) {
      const dt = s.t - prevT;
      if (dt > 0) {
        if (dt > GAP_GUARD_MS) {
          chunk.skippedMs += dt;
          if (i >= 0) chunk.b.skipMs[i] += dt;
        } else {
          const p2 = s.powerKw ?? prevP;
          const kwh = ((prevP + p2) / 2) * (dt / 3_600_000);
          if (kwh > 0) {
            chunk.dischargedKwh += kwh;
            if (i >= 0) chunk.b.disKwh[i] += kwh;
          } else {
            chunk.chargedKwh += -kwh;
            if (i >= 0) chunk.b.chgKwh[i] += -kwh;
          }
        }
      }
    }

    if (i >= 0) {
      const b = chunk.b;
      b.n[i] += 1;
      if (s.powerKw != null) {
        b.pSum[i] += s.powerKw; b.pN[i] += 1;
        b.pMin[i] = lo(b.pMin[i], s.powerKw);
        b.pMax[i] = hi(b.pMax[i], s.powerKw);
        chunk.peakAbsKw = hi(chunk.peakAbsKw, Math.abs(s.powerKw));
      }
      if (s.soc != null) {
        b.socSum[i] += s.soc; b.socN[i] += 1;
        b.socMin[i] = lo(b.socMin[i], s.soc);
        b.socMax[i] = hi(b.socMax[i], s.soc);
        chunk.socMin = lo(chunk.socMin, s.soc);
        chunk.socMax = hi(chunk.socMax, s.soc);
      }
      if (s.tempMax != null) {
        b.tMax[i] = hi(b.tMax[i], s.tempMax);
        chunk.tempMax = hi(chunk.tempMax, s.tempMax);
      }
      if (s.cellSpreadMv != null) b.dvMax[i] = hi(b.dvMax[i], s.cellSpreadMv);
    }

    chunk.rows += 1;
    if (chunk.firstT == null) { chunk.firstT = s.t; chunk.firstP = s.powerKw ?? NaN; }
    prevT = s.t;
    if (s.powerKw != null) prevP = s.powerKw;
    chunk.lastT = s.t;
    chunk.lastP = prevP;
    if (s.t >= chunk.coveredTo) chunk.coveredTo = s.t + 1;
  }
}

/* ── Fetching ──────────────────────────────────────────────────────────── */

interface Fetched {
  samples: RowSample[];
  /* The one bess_id every row carried, or null when the rows carried none or
     carried more than one. See `soleBess` on Chunk. */
  soleBess: string | null;
  resolutionSec: number | null;
  burstWindow: [string, string] | null;
  undecodable: number;
  observed: string[] | null;
  reachedEnd: boolean;
}

/**
 * Read one range from the gateway, following the epoch cursor per §8.
 *
 * Rows are decoded and dropped in the same pass: nothing but the four figures
 * a history view needs survives past this function, which is what keeps a
 * 30-minute chunk under 30 KB in memory instead of 4 MB.
 */
async function fetchRange(
  sourceId: string,
  bessId: string,
  from: number,
  to: number,
  auth: string | null,
  site: Site,
): Promise<Fetched> {
  const samples: RowSample[] = [];
  let cursor = from;
  let resolutionSec: number | null = null;
  let burstWindow: [string, string] | null = null;
  let undecodable = 0;
  let observed: string[] | null = null;
  let reachedEnd = false;
  const bessSeen = new Set<string>();

  for (let page = 0; page < PAGES_PER_CHUNK; page++) {
    const p = new URLSearchParams({
      from_epoch_ms: String(Math.round(cursor)),
      to_epoch_ms: String(Math.round(to)),
      limit: String(PAGE_LIMIT),
      order: "asc",
      format: "compact",
    });
    if (sourceId) p.set("source_id", sourceId);

    const { body } = await gatewayRead("fast-bess/history", p, auth, site);
    const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];

    if (typeof body._resolution_sec === "number") resolutionSec = body._resolution_sec;
    if (Array.isArray(body._burst_window)) burstWindow = body._burst_window as [string, string];

    let lastT: number | null = null;
    for (const row of rows) {
      if (typeof row.bess_id === "string" && row.bess_id) bessSeen.add(row.bess_id);
      if (bessId && row.bess_id != null && row.bess_id !== bessId) continue;
      const s = readSample(row);
      if (!s) continue;
      lastT = s.t;
      if (!decodable(row)) {
        undecodable += 1;
        if (!observed) observed = observedKeys(row);
        continue;
      }
      samples.push(s);
    }

    /* has_more is absent on the live gateway, which returns a bare items array
       with no cursor. A short page is what ends the loop there. */
    const more = typeof body.has_more === "boolean" ? body.has_more : rows.length >= PAGE_LIMIT;
    const next = typeof body.next_cursor === "number" ? body.next_cursor : lastT;

    if (!more || next == null) { reachedEnd = true; break; }
    if (next + 1 <= cursor) { reachedEnd = true; break; }
    cursor = next + 1;
  }

  return {
    samples, resolutionSec, burstWindow, undecodable, observed, reachedEnd,
    soleBess: bessSeen.size === 1 ? [...bessSeen][0] : null,
  };
}

/** Fill a chunk, or extend the open one from its own high-water mark. */
async function fill(
  chunk: Chunk,
  sourceId: string,
  bessId: string,
  auth: string | null,
  nowMs: number,
  site: Site,
): Promise<[string, string] | null> {
  const from = Math.max(chunk.from, chunk.coveredTo);
  const to = Math.min(chunk.to, nowMs);
  if (to <= from) {
    if (Date.now() >= chunk.to + SEAL_LAG_MS) chunk.sealed = true;
    chunk.filledAt = Date.now();
    return null;
  }

  const got = await fetchRange(sourceId, bessId, from, to, auth, site);
  accumulate(chunk, got.samples);

  if (got.resolutionSec != null) chunk.resolutionSec = got.resolutionSec;
  if (got.soleBess) chunk.soleBess = got.soleBess;
  chunk.undecodable += got.undecodable;
  if (!chunk.observed && got.observed) chunk.observed = got.observed;

  /* Coverage advances to where the read actually got to, not to where it was
     asked to go — an empty stretch is genuinely covered, a truncated page is
     not. Without this an hour with no rows would be re-read forever. */
  if (got.reachedEnd) chunk.coveredTo = Math.max(chunk.coveredTo, to);

  chunk.filledAt = Date.now();
  /* Sealed on wall-clock, never on a client-supplied clock: a caller with a
     wrong idea of "now" must not be able to freeze a half-read chunk into a
     cache that other callers share. */
  if (Date.now() >= chunk.to + SEAL_LAG_MS && chunk.coveredTo >= chunk.to) chunk.sealed = true;

  return got.burstWindow;
}

/* ── Assembling an answer ──────────────────────────────────────────────── */

/**
 * [t, mean kW, min kW, max kW, mean SOC %, max cell °C, max spread mV,
 *  charged kWh, discharged kWh]
 *
 * The two energy figures are appended rather than inserted, because data.ts
 * destructures this tuple by position and every reader of the first seven
 * fields is entitled to keep working untouched.
 *
 * They are not the plotted mean multiplied by the bucket width. They are the
 * trapezoid over the raw rows, accumulated in `Buckets.chgKwh` at decode time
 * and only summed here — the same arithmetic that produces `totals`, at bucket
 * granularity instead of window granularity. That distinction is the whole
 * reason this is worth adding: a bar chart built from the plotted line would
 * under-report a bucket that spiked between samples, which is exactly the
 * error the totals were moved server-side to avoid.
 *
 * Zero is a real answer here, unlike the nullable fields beside it. A bucket
 * with rows in it and no throughput genuinely moved no energy, and the rows
 * that say so were counted. A bucket with no rows is never emitted at all.
 *
 * One caveat, stated because a reader will otherwise find it by subtraction:
 * the energy in a pair of raw rows that straddles a chunk seam is added to
 * `totals` further down and belongs to no bucket, so summing the bars can fall
 * short of the total by those seams. It is bounded by one sample-pair per
 * eighty minutes and it is never the other way round.
 */
export type SeriesPoint = [
  number,
  number | null, number | null, number | null,
  number | null, number | null, number | null,
  number, number,
];

export interface SeriesResponse {
  source_id: string;
  bess_id: string;
  from_epoch_ms: number;
  to_epoch_ms: number;
  bucket_ms: number;
  points: SeriesPoint[];
  totals: {
    charged_kwh: number; discharged_kwh: number; throughput_kwh: number;
    ratio_pct: number | null;
    peak_abs_kw: number | null;
    soc_min: number | null; soc_max: number | null;
    temp_max: number | null;
    rows: number; skipped_ms: number;
  };
  coverage: {
    /** Chunks the window needs, and how many are in hand. */
    total: number; ready: number;
    covered_ms: number; window_ms: number;
    complete: boolean;
    /** Stretches of the window with no data yet, newest last. */
    gaps: [number, number][];
  };
  /** Rows the gateway returned that this build could not decode. */
  undecodable: number;
  observed_keys: string[] | null;
  resolution_sec: number | null;
  burst_window: [number, number] | null;
  mode: "live" | "capture" | "demo";
}

const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

const orNull = (v: number) => (Number.isNaN(v) ? null : v);

/* ── Entry point ───────────────────────────────────────────────────────── */

export interface SeriesRequest {
  sourceId: string;
  bessId: string;
  fromEpochMs: number;
  toEpochMs: number;
  /** Points the client wants back. The bucket size is derived from it. */
  points: number;
  auth: string | null;
  /** The client's anchor clock — the capture playhead, or wall-clock. */
  nowMs: number;
  /** Which gateway to read. Resolved from the request header by the route. */
  site: Site;
}

export async function buildSeries(req: SeriesRequest): Promise<SeriesResponse> {
  const { sourceId, bessId, auth, site } = req;
  const from = Math.round(req.fromEpochMs);
  const to = Math.round(req.toEpochMs);
  if (!(to > from)) throw new GatewayReadError(400, "to_epoch_ms must be after from_epoch_ms");

  const span = to - from;
  const wanted = Math.max(60, Math.min(req.points || 720, 2000));
  const bucketMs = Math.max(
    BASE_BUCKET_MS,
    Math.ceil(span / wanted / BASE_BUCKET_MS) * BASE_BUCKET_MS,
  );

  const scope = await scopeFor(auth, site);
  if (scope.sources && sourceId && !scope.sources.includes(sourceId)) {
    throw new GatewayReadError(403, `This account is not entitled to ${sourceId}.`);
  }

  /* Never trust a client clock to run ahead of this one. It may legitimately
     lag — the reference capture's playhead is genuinely in the past — but a
     "now" in the future would seal chunks that have not happened. */
  const nowMs = Math.min(req.nowMs || Date.now(), Date.now());

  let burst: [string, string] | null = null;
  let present: Chunk[];
  let total = 1;

  {
    const starts: number[] = [];
    for (let s = Math.floor(from / CHUNK_MS) * CHUNK_MS; s < to; s += CHUNK_MS) {
      if (s <= nowMs) starts.push(s);
    }
    total = starts.length;

    /* Newest first. The right-hand edge of a chart is what someone is actually
       looking at, so it is what a bounded budget should buy first. */
    /* Anything already on disk is put back in memory before the work is
       decided, so a sealed hour costs a file read rather than a gateway
       round-trip — which is the difference between 30 d being 720 requests and
       being none. Only for a caller the entitlement check above has already
       cleared for this source: the store is keyed by plant rather than by
       token, so this read is what stands in for the scope in the cache key.
       A blank sourceId means "whichever sources this token reaches", which is
       a question the store cannot answer, so it stays on the gateway path. */
    if (sourceId) await hydrate(site.id, scope.key, sourceId, bessId, starts);

    const work = starts
      .slice()
      .reverse()
      .map((s) => ({ start: s, key: chunkKey(site.id, scope.key, sourceId, bessId, s) }))
      .filter(({ key, start }) => {
        const c = readChunk(key);
        if (!c) return true;
        if (c.sealed) return false;
        return Date.now() - c.filledAt > OPEN_TTL_MS && c.coveredTo < Math.min(c.to, nowMs);
      });

    const deadline = Date.now() + FILL_BUDGET_MS;
    const queue = work.slice(0, FILL_MAX_CHUNKS);
    let next = 0;
    let attempted = 0;
    let failed = 0;
    let lastError: unknown = null;

    const worker = async () => {
      while (next < queue.length && Date.now() < deadline) {
        const item = queue[next++];
        const chunk = readChunk(item.key) ?? newChunk(item.start);
        attempted += 1;
        const doneWaiting = beginUserWait();
        try {
          const b = await fill(chunk, sourceId, bessId, auth, nowMs, site);
          if (b) burst = b;
          writeChunk(item.key, chunk);
          /* Sealed means the chunk is over and fully read, so this is the one
             moment its contents become final. Not awaited: the caller is
             waiting on a chart, and a slow disk must not join the gateway in
             the FILL_BUDGET_MS the request is measured against.
          
             Stored under the id the rows actually carried when the request did
             not name one. History fires once before the app has confirmed which
             BESS it is looking at and again after — two cache keys for the same
             hours, so the second was buying rows the first had already paid
             for. An unfiltered read of a source carrying one BESS is byte for
             byte the filtered read, and `soleBess` is the evidence of that
             rather than an assumption about it: null unless every row agreed.
          
             Never stored under no id at all — that wrote an `external_ems_1___`
             directory nothing would look in. */
          const storeBess = bessId || chunk.soleBess;
          if (chunk.sealed && sourceId && storeBess) {
            void saveChunk(site.id, sourceId, storeBess, chunk);
          }
        } catch (e) {
          /* A chunk that failed is simply still missing. Whatever it did
             accumulate before the failure is kept and extended next time —
             this is the whole reason an interruption no longer costs the
             window. A 401 is the one exception: the token is gone and every
             remaining chunk would fail the same way. */
          if (e instanceof GatewayReadError && e.status === 401) throw e;
          failed += 1;
          lastError = e;
          if (chunk.rows > 0 || chunk.undecodable > 0) writeChunk(item.key, chunk);
        } finally {
          /* In `finally` so the 401 rethrow above cannot leak the count. A
             counter that only ever goes up would park the backfill forever. */
          doneWaiting();
        }
      }
    };

    await Promise.all(Array.from({ length: FILL_CONCURRENCY }, worker));

    /* `undecodable > 0` belongs here as much as `rows > 0` does. A chunk whose
       every row came back in a shape this build cannot read holds no samples,
       and dropping it for that reason would discard the only evidence that
       anything is wrong — the window would report zero rows, no error and an
       empty chart, which is precisely the silent failure this module exists to
       make impossible. */
    present = starts
      .map((s) => readChunk(chunkKey(site.id, scope.key, sourceId, bessId, s)))
      .filter((c): c is Chunk => !!c && (c.rows > 0 || c.undecodable > 0));

    /* Every attempt failed and nothing was already cached. Returning an empty
       series here would be the worst available answer: the caller renders "no
       rows in this window", which is a claim about the plant, when the truth is
       that the gateway could not be reached at all. The old client-side pager
       was careful about exactly this and the care was lost when the paging
       moved server-side — a screen reading "Covers 0 s of 1 h" over an
       unreachable gateway is the same lie in a new place.

       Note what is NOT this case: chunks that succeeded and held no rows. Those
       leave `failed` at zero, `present` empty, and the window is honestly
       reported as empty — which is a real answer about a plant that was not
       logging. */
    if (present.length === 0 && attempted > 0 && failed === attempted) {
      if (lastError instanceof GatewayReadError) throw lastError;
      throw new GatewayReadError(
        502,
        lastError instanceof Error ? lastError.message : "could not reach the gateway",
      );
    }
  }

  /* ── Fold to the requested resolution, and total what the window contains ── */

  let charged = 0, discharged = 0, skipped = 0, rows = 0, undecodable = 0;
  let peak = NaN, socMin = NaN, socMax = NaN, tempMax = NaN;
  let resolution: number | null = null;
  let observed: string[] | null = null;

  const points: SeriesPoint[] = [];
  let cur = -1;
  let n = 0, pSum = 0, pN = 0, pMin = NaN, pMax = NaN, socSum = 0, socN = 0, tMax = NaN, dvMax = NaN;
  /* This bucket's share of the window's energy. Same source as the totals
     below — the per-bucket trapezoids — so the bars and the summary above them
     cannot disagree about what the plant moved. */
  let bChg = 0, bDis = 0;

  const flush = () => {
    if (cur < 0 || n === 0) return;
    points.push([
      cur,
      pN ? round(pSum / pN, 3) : null,
      orNull(Number.isNaN(pMin) ? NaN : round(pMin, 3)),
      orNull(Number.isNaN(pMax) ? NaN : round(pMax, 3)),
      socN ? round(socSum / socN, 2) : null,
      orNull(Number.isNaN(tMax) ? NaN : round(tMax, 2)),
      orNull(Number.isNaN(dvMax) ? NaN : round(dvMax, 1)),
      round(bChg, 4),
      round(bDis, 4),
    ]);
  };

  for (const c of present) {
    const b = c.b;
    for (let i = 0; i < b.t.length; i++) {
      /* Strictly the requested window. The exception that used to live here
         kept samples outside it when the backend was the bundled capture,
         whose retained burst carried its own August timestamps; with the
         capture gone, a sample outside the window is simply not part of the
         answer. */
      if (b.t[i] < from || b.t[i] >= to) continue;
      const start = Math.floor(b.t[i] / bucketMs) * bucketMs;
      if (start !== cur) {
        flush();
        cur = start;
        n = 0; pSum = 0; pN = 0; pMin = NaN; pMax = NaN; socSum = 0; socN = 0; tMax = NaN; dvMax = NaN;
        bChg = 0; bDis = 0;
      }
      n += b.n[i];
      pSum += b.pSum[i]; pN += b.pN[i];
      if (!Number.isNaN(b.pMin[i])) pMin = lo(pMin, b.pMin[i]);
      if (!Number.isNaN(b.pMax[i])) pMax = hi(pMax, b.pMax[i]);
      socSum += b.socSum[i]; socN += b.socN[i];
      if (!Number.isNaN(b.tMax[i])) tMax = hi(tMax, b.tMax[i]);
      if (!Number.isNaN(b.dvMax[i])) dvMax = hi(dvMax, b.dvMax[i]);

      /* The window's own totals, from the same buckets and the same clip that
         produced the line above them. Summed here rather than from the chunks
         because a chunk can only be added whole: a 1 h window sits across three
         30 min chunks and shares an edge with none of them, so chunk-level
         totals described up to 30 extra minutes the window never asked for and
         the row count came out larger than the window has seconds. */
      rows += b.n[i];
      charged += b.chgKwh[i];
      discharged += b.disKwh[i];
      bChg += b.chgKwh[i];
      bDis += b.disKwh[i];
      skipped += b.skipMs[i];
      if (!Number.isNaN(b.pMin[i])) peak = hi(peak, Math.abs(b.pMin[i]));
      if (!Number.isNaN(b.pMax[i])) peak = hi(peak, Math.abs(b.pMax[i]));
      if (!Number.isNaN(b.socMin[i])) socMin = lo(socMin, b.socMin[i]);
      if (!Number.isNaN(b.socMax[i])) socMax = hi(socMax, b.socMax[i]);
      if (!Number.isNaN(b.tMax[i])) tempMax = hi(tempMax, b.tMax[i]);
    }
  }
  flush();

  /* ── What the chunks report about themselves, plus the seams between them ── */

  for (let i = 0; i < present.length; i++) {
    const c = present[i];

    /* Chunk-scoped on purpose. An undecodable row is one whose columns this
       build could not find, so it carries no timestamp to place it in a bucket
       and cannot be clipped to a window. It is a statement about what the
       gateway sent, not a measurement of the plant, and it is reported wide
       rather than dropped: silence here is the failure this module exists to
       prevent. */
    undecodable += c.undecodable;
    if (c.resolutionSec != null) resolution = c.resolutionSec;
    if (!observed && c.observed) observed = c.observed;

    /* The pair that straddles a chunk boundary belongs to neither chunk's
       integral. Joined here from the stored edges, so the total matches what a
       single pass over the raw rows would have produced — but only when the
       join lands inside the window, since every other total is now clipped to
       it and a seam outside it is someone else's energy. */
    const nx = present[i + 1];
    if (nx && c.lastT != null && nx.firstT != null && !Number.isNaN(c.lastP)) {
      const seamAt = nx.firstT;
      const inWindow = seamAt >= from && seamAt < to;
      const dt = seamAt - c.lastT;
      if (!inWindow) {
        /* nothing: this seam is outside the requested window */
      } else if (dt > 0 && dt <= GAP_GUARD_MS) {
        const p2 = Number.isNaN(nx.firstP) ? c.lastP : nx.firstP;
        const kwh = ((c.lastP + p2) / 2) * (dt / 3_600_000);
        if (kwh > 0) discharged += kwh; else charged += -kwh;
      } else if (dt > GAP_GUARD_MS) {
        skipped += dt;
      }
    }
  }

  /* ── Coverage, stated rather than assumed ── */

  const covered: [number, number][] = [];
  for (const c of present) {
    const a = Math.max(c.from, from);
    const b = Math.min(c.sealed ? c.to : c.coveredTo, to);
    if (b > a) {
      const last = covered[covered.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else covered.push([a, b]);
    }
  }
  const coveredMs = covered.reduce((s, [a, b]) => s + (b - a), 0);

  const windowEnd = Math.min(to, nowMs);
  const gaps: [number, number][] = [];
  let at = from;
  for (const [a, b] of covered) {
    if (a > at) gaps.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < windowEnd) gaps.push([at, windowEnd]);

  const windowMs = Math.max(0, windowEnd - from);
  const ready = present.length;

  return {
    source_id: sourceId,
    bess_id: bessId,
    from_epoch_ms: from,
    to_epoch_ms: to,
    bucket_ms: bucketMs,
    points,
    totals: {
      charged_kwh: round(charged, 4),
      discharged_kwh: round(discharged, 4),
      throughput_kwh: round(charged + discharged, 4),
      ratio_pct: charged > 0 ? round((discharged / charged) * 100, 2) : null,
      peak_abs_kw: orNull(peak),
      soc_min: orNull(socMin),
      soc_max: orNull(socMax),
      temp_max: orNull(tempMax),
      rows,
      skipped_ms: skipped,
    },
    coverage: {
      total, ready,
      covered_ms: coveredMs,
      window_ms: windowMs,
      /* Complete means the window is actually covered, measured — not inferred
         from a row count against a guess about resolution. That guess is what
         put a 2 h 16 m series under a "6h" label. */
      complete: windowMs === 0 || coveredMs >= windowMs - bucketMs,
      gaps,
    },
    undecodable,
    observed_keys: undecodable > 0 ? observed : null,
    resolution_sec: resolution,
    burst_window: burst ? [Date.parse(burst[0]), Date.parse(burst[1])] : null,
    /* Where the rows came from. "capture" is gone with the fixture that
       served it; "demo" means the synthetic plant in gateway/demo.ts answered
       every read below, and a screen that wants to say so reads this. */
    mode: isDemoSite(site) ? "demo" : "live",
  };
}

/* ── Backfill entry point ──────────────────────────────────────────────────
   buildSeries fills only what the window in front of a user needs, which is
   the right rule for a request and the wrong one for a store: it means 30 d of
   history exists only for someone willing to sit through 720 gateway reads.

   This is the same fill, addressable one hour at a time, so backfill.ts can
   walk the ninety days the gateway retains without duplicating any of the
   decode, accumulate or seal logic. It deliberately does not touch the memory
   cache: the worker runs for hours and would otherwise evict the chunks that
   live requests are using, to hold hours nobody has asked for. */

export type BackfillResult = "stored" | "filled" | "open" | "empty";

/* Gateway reads somebody is waiting on. Now the shared count from pressure.ts
   rather than a local one that saw only chart fills — the walker was standing
   aside for charts while flattening the five-second live poll, which is the
   request every screen in the app depends on. Re-exported under its old name
   so backfill.ts and anything else reading it keep working. */
export const liveFillsInFlight = userWaitsInFlight;

/**
 * Ensure one hour is in the durable store, reading the gateway only if it is
 * not already there.
 *
 * Throws what the gateway threw. The caller is a loop that has to tell "this
 * hour holds nothing" from "the gateway is refusing", because the first should
 * advance and the second should back off.
 */
export async function ensureChunk(
  site: Site, sourceId: string, bessId: string, start: number, auth: string | null,
): Promise<BackfillResult> {
  if (await loadChunk(site.id, sourceId, bessId, start)) return "stored";

  const chunk = newChunk(start);
  await fill(chunk, sourceId, bessId, auth, Date.now(), site);

  /* Unsealed means one of two things, and neither may be stored: the hour has
     not ended yet, or the read was truncated before covering it. saveChunk
     refuses either, and this reports it so the walker treats the hour as still
     outstanding rather than counting it done and never returning to it. */
  if (!chunk.sealed) return "open";

  await saveChunk(site.id, sourceId, bessId || chunk.soleBess || "", chunk);
  return chunk.rows > 0 ? "filled" : "empty";
}
