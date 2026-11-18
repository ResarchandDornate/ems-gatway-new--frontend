/**
 * Where filled history chunks survive a restart.
 *
 * series.ts holds an in-memory LRU of hour chunks, and that cache is the whole
 * reason a second look at the same window is instant. It is also the reason a
 * first look is not: the map is per-process, so every deploy, crash and scale
 * event throws away work that cost one gateway round-trip per hour — and the
 * gateway answers a *bare 401* in 2.5-6.7 s, so those round-trips are the
 * entire cost of a history request.
 *
 * The arithmetic that forces this file, measured against the endpoint rather
 * than assumed — 8.0 s per request plus 5.27 ms per row:
 *
 *     24 h =  18 chunks →  ~10 min      7 d = 126 chunks →  ~70 min
 *     30 d = 540 chunks → ~299 min
 *
 * against a FILL_BUDGET_MS of 45 s. No amount of tuning closes a gap of that
 * shape, and three quarters of it is per-row work no chunk size can touch. The
 * only thing that does is not asking twice.
 *
 * So: a chunk that is *sealed* — its span is over and fully read — can never
 * change again, and is written here. Everything behind the current chunk is
 * served from disk on the next request, and the gateway is asked only for the
 * one still in progress.
 *
 * This is the component §2 of the Server Pull Historian specification calls the
 * IT ingestion worker's database. The same document rules that the dashboard
 * must not "act as the permanent server-side historian", which is exactly what
 * it has been doing on every chart load.
 *
 * One file per chunk, sharded by day. Not a database: the write is append-only
 * and idempotent, the read is by exact key, and there is no query. Bringing a
 * driver, a schema and a migration path to a keyed blob store would be cost
 * without a matching question it answers.
 */

import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

/* Bumped whenever the on-disk shape changes. A stale file is ignored rather
   than migrated: it is a cache of something the gateway can still be asked
   for, so the cheap, always-correct answer is to refill it. */
const FORMAT = 1;

/**
 * Root of the store.
 *
 * A relative default on purpose. Mounted on a volume this survives container
 * replacement, which is the point; unmounted it still survives every restart
 * *within* a container, which is already most of the benefit and costs no
 * deployment change to get. The failure mode of an unmounted path is a
 * re-backfill, not an error, so this needs no configuration to be safe.
 */
const ROOT = process.env.HISTORY_DIR?.trim() || ".data/history";

/** Absent numbers are NaN in memory; JSON has no NaN, so null carries it. */
const encNums = (a: number[]): (number | null)[] =>
  a.map((v) => (Number.isNaN(v) ? null : v));
const decNums = (a: (number | null)[]): number[] =>
  a.map((v) => (v === null ? NaN : v));
const encN = (v: number): number | null => (Number.isNaN(v) ? null : v);
const decN = (v: number | null | undefined): number => (v == null ? NaN : v);

/* The part of a Chunk worth persisting, described structurally rather than
   imported: series.ts owns the type, and importing it back would put a cycle
   between two modules that already point at each other once.

   Field-by-field rather than a Record, so a Chunk is assignable to this with
   no cast — an index signature would make the two structurally incompatible in
   exactly the direction this store needs. */
export interface StoredBuckets {
  t: number[]; n: number[];
  pSum: number[]; pN: number[]; pMin: number[]; pMax: number[];
  socSum: number[]; socN: number[]; socMin: number[]; socMax: number[];
  tMax: number[]; dvMax: number[];
  chgKwh: number[]; disKwh: number[]; skipMs: number[];
}

export interface StoredChunk {
  from: number;
  to: number;
  b: StoredBuckets;
  rows: number;
  undecodable: number;
  observed: string[] | null;
  chargedKwh: number;
  dischargedKwh: number;
  skippedMs: number;
  firstT: number | null; firstP: number;
  lastT: number | null;  lastP: number;
  peakAbsKw: number; socMin: number; socMax: number; tempMax: number;
  resolutionSec: number | null;
  /** The single bess_id this chunk's rows carried, when there was one. */
  soleBess: string | null;
  coveredTo: number;
  sealed: boolean;
  filledAt: number;
}

/* Keys the bucket arrays by name so a field added to Buckets is carried
   without touching this file — and so a field *removed* simply stops being
   read, rather than decoding into an array of undefined. */
const BUCKET_KEYS: (keyof StoredBuckets)[] = [
  "t", "n", "pSum", "pN", "pMin", "pMax",
  "socSum", "socN", "socMin", "socMax",
  "tMax", "dvMax", "chgKwh", "disKwh", "skipMs",
];

/**
 * Path for one chunk.
 *
 * Site first, then source and BESS, then the day — the same hierarchy the data
 * has. Sharding by day keeps a directory at 24 entries instead of the 2,160 a
 * flat ninety-day store would hold, which matters to every tool that will ever
 * list it, including a person with a shell.
 *
 * The site is part of the path for the reason chunkKey states: source ids are
 * assigned per gateway, so every site built from the same template has an
 * `external_ems_1`. Two plants sharing a directory would silently serve one
 * another's history.
 */
function pathFor(siteId: string, sourceId: string, bessId: string, start: number): string {
  const day = new Date(start).toISOString().slice(0, 10);
  return join(ROOT, safe(siteId), `${safe(sourceId)}__${safe(bessId)}`, day, `${start}.json`);
}

/* These reach the filesystem, and two of the three come from a gateway rather
   than from this codebase. Anything outside the id charset is replaced rather
   than rejected: a source the gateway names unexpectedly should degrade to an
   odd-looking directory, not to an unwritable store or a path escape. */
const safe = (s: string) => (s || "_").replace(/[^A-Za-z0-9_-]/g, "_");

/** Read one chunk, or undefined when it is absent, stale or unreadable. */
export async function loadChunk(
  siteId: string, sourceId: string, bessId: string, start: number,
): Promise<StoredChunk | undefined> {
  try {
    const raw = await readFile(pathFor(siteId, sourceId, bessId, start), "utf8");
    const j = JSON.parse(raw) as { v?: number; c?: Record<string, unknown> };
    if (j.v !== FORMAT || !j.c) return undefined;
    const c = j.c as Record<string, unknown>;

    const rawB = (c.b ?? {}) as Record<string, (number | null)[]>;
    const b = {} as StoredBuckets;
    for (const k of BUCKET_KEYS) b[k] = decNums(rawB[k] ?? []);

    return {
      from: c.from as number,
      to: c.to as number,
      b,
      rows: (c.rows as number) ?? 0,
      undecodable: (c.undecodable as number) ?? 0,
      observed: (c.observed as string[] | null) ?? null,
      chargedKwh: (c.chargedKwh as number) ?? 0,
      dischargedKwh: (c.dischargedKwh as number) ?? 0,
      skippedMs: (c.skippedMs as number) ?? 0,
      firstT: (c.firstT as number | null) ?? null,
      firstP: decN(c.firstP as number | null),
      lastT: (c.lastT as number | null) ?? null,
      lastP: decN(c.lastP as number | null),
      peakAbsKw: decN(c.peakAbsKw as number | null),
      socMin: decN(c.socMin as number | null),
      socMax: decN(c.socMax as number | null),
      tempMax: decN(c.tempMax as number | null),
      resolutionSec: (c.resolutionSec as number | null) ?? null,
      soleBess: (c.soleBess as string | null) ?? null,
      coveredTo: (c.coveredTo as number) ?? (c.to as number),
      sealed: true,
      filledAt: (c.filledAt as number) ?? 0,
    };
  } catch {
    /* Absent is the common case and not worth distinguishing from corrupt:
       both mean "ask the gateway", and both are recovered by doing so. */
    return undefined;
  }
}

/**
 * Persist one chunk. Sealed chunks only.
 *
 * An unsealed chunk is still being read — its hour has not ended, or the
 * gateway has not been followed to the end of it. Writing one would put a
 * partial hour on disk that later reads would treat as complete, and the
 * window would report a gap as a fact about the plant. Sealed means the hour
 * is over and fully covered, which is the only state that can never change.
 */
export async function saveChunk(
  siteId: string, sourceId: string, bessId: string, c: StoredChunk,
): Promise<void> {
  if (!c.sealed) return;
  const p = pathFor(siteId, sourceId, bessId, c.from);
  const b: Record<string, (number | null)[]> = {};
  for (const k of BUCKET_KEYS) b[k] = encNums(c.b[k] ?? []);

  const body = JSON.stringify({
    v: FORMAT,
    c: {
      from: c.from, to: c.to, b,
      rows: c.rows, undecodable: c.undecodable, observed: c.observed,
      chargedKwh: c.chargedKwh, dischargedKwh: c.dischargedKwh, skippedMs: c.skippedMs,
      firstT: c.firstT, firstP: encN(c.firstP),
      lastT: c.lastT, lastP: encN(c.lastP),
      peakAbsKw: encN(c.peakAbsKw), socMin: encN(c.socMin),
      socMax: encN(c.socMax), tempMax: encN(c.tempMax),
      resolutionSec: c.resolutionSec, soleBess: c.soleBess,
      coveredTo: c.coveredTo, filledAt: c.filledAt,
    },
  });

  try {
    await mkdir(dirname(p), { recursive: true });
    /* Written beside the target and renamed, because a reader can arrive
       mid-write. rename is atomic within a filesystem, so a reader sees either
       the previous file or the complete new one, never a truncated one that
       would decode as an hour with no rows in it. */
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, body, "utf8");
    await rename(tmp, p);
  } catch {
    /* A store that cannot be written is a slower app, not a broken one. The
       gateway remains the source of truth and every chunk is refillable, so
       this must never propagate into the caller's request. */
  }
}

/** True when the store is configured to somewhere a restart will not erase. */
export const isPersistent = (): boolean => Boolean(process.env.HISTORY_DIR?.trim());

export const storeRoot = (): string => ROOT;
