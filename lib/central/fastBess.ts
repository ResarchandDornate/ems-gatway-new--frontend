/**
 * S1 fast-BESS telemetry, off the central backend.
 *
 *   GET /gateways/{id}/fast-bess?limit=&bess_id=
 *
 * The first endpoint on that backend that returns a plant measurement. Samples
 * come back NEWEST FIRST at the edge's 1 Hz cadence, so a chart has to reverse
 * them before plotting or time runs backwards.
 *
 * ── The values are nested, and that is easy to get wrong ───────────────────
 *
 * Top-level fields are the sample's metadata — bess_id, the two timestamps,
 * quality. The numbers live one level down, in `data.pcs_values` (28 signals)
 * and `data.bms_values` (35). Charting DC voltage means
 * `sample_time_utc` against `data.pcs_values.dc_voltage`, not a top-level key.
 *
 * ── What this endpoint is, and is not ──────────────────────────────────────
 *
 * It is a LATEST reader, not a history one. `limit` is the only window control
 * — there is no from/to and no bucketing — so the reachable span is limit x 1 s
 * and nothing more. At the maximum that is 1,000 samples, about 16.7 minutes.
 * Anything wider needs the aggregated history endpoint requested in
 * docs/central-backend-s1-contract.md §3, which has not been built.
 *
 * A caller must therefore read the covered period back off the data rather
 * than label a chart from what it asked for. `windowOf()` below exists so no
 * screen is tempted to do the latter.
 *
 * ── Limit is rejected, not clamped ─────────────────────────────────────────
 *
 * Verified against the live backend: limit=1001 answers 422, not 1000. So the
 * clamp happens here, before the request, or a caller asking for "everything"
 * gets an error instead of a page.
 */

import { getSession } from "./session";
import { centralUrl } from "./serverScope";
import { CentralReadError } from "./gateways";
import { loadStored, saveStored } from "./fastStore";

export const FAST_BESS_MAX_LIMIT = 1000;

/** Signal dictionaries. Values are bare numbers; keys vary by firmware. */
export type SignalValues = Record<string, number | null | undefined>;

export interface FastBessPayload {
  pcs_values?: SignalValues;
  bms_values?: SignalValues;
  profile_name?: string;
  pcs_signal_count?: number;
  bms_signal_count?: number;
  good_signal_count?: number;
  bad_signal_count?: number;
  [k: string]: unknown;
}

/**
 * `FastBessRecord`, exactly as /openapi.json declares it.
 *
 * Every top-level field is REQUIRED by the schema; only `max_data_age_ms` is
 * nullable. They are typed that way rather than defensively-optional so the
 * contract is visible here — if the backend ever drops one, this type is where
 * it should be changed deliberately, not quietly absorbed by a `??` at each of
 * a dozen call sites.
 *
 * `data` is the exception and stays loose on purpose: the spec declares it as a
 * bare object with `additionalProperties: true` and says nothing about its
 * contents. The pcs_values/bms_values split below comes from the written API
 * note, not the schema, and that note warns the signal set varies by gateway
 * firmware and profile — so everything inside `data` is optional.
 */
export interface FastBessSample {
  source_id: string;
  bess_id: string;
  sample_time_utc: string;
  received_at_utc: string;
  /** Sample-level, NOT per-signal — see the note in the view. */
  quality: string;
  max_data_age_ms: number | null;
  data: FastBessPayload;
}

/**
 * Newest first, as returned.
 *
 * `[]` is a valid empty state and not an error. As with gateway health, the
 * endpoint answers `[]` for a gateway id that does not exist too — verified
 * against a fabricated UUID — so an empty result cannot tell "no samples yet"
 * apart from "wrong gateway".
 */
export async function fetchFastBess(
  gatewayId: string,
  opts: { limit?: number; bessId?: string; fromMs?: number; toMs?: number } = {},
): Promise<FastBessSample[]> {
  const s = getSession();
  if (!s) throw new CentralReadError("Not signed in");

  const limit = Math.max(1, Math.min(opts.limit ?? 50, FAST_BESS_MAX_LIMIT));
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.bessId) qs.set("bess_id", opts.bessId);
  /* from inclusive, to exclusive, UTC. Within the window the backend still
     answers newest first and caps at `limit`. */
  if (opts.fromMs != null && Number.isFinite(opts.fromMs)) qs.set("from_time", new Date(opts.fromMs).toISOString());
  if (opts.toMs != null && Number.isFinite(opts.toMs)) qs.set("to_time", new Date(opts.toMs).toISOString());

  const r = await fetch(
    centralUrl(`/api/central/gateways/${encodeURIComponent(gatewayId)}/fast-bess?${qs}`),
    { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" },
  );

  if (r.status === 422) throw new CentralReadError("Gateway id or limit rejected by the backend", 422);
  if (!r.ok) throw new CentralReadError(`Central backend answered ${r.status}`, r.status);

  const body: unknown = await r.json();
  return Array.isArray(body) ? newestFirst(body as FastBessSample[]) : [];
}

/**
 * Newest first by SAMPLE time, whatever order the backend answered in.
 *
 * The gateway buffers while it is offline and uploads the backlog when it
 * reconnects, so arrival order is not time order. A backend that sorts by
 * arrival would put an hour-old buffered sample at the top, and every screen
 * that takes the first row as "now" would show it as live. Stable, so rows
 * with the same sample time keep the backend's order.
 */
/**
 * The newest sample of each window, read on the app's server in one request
 * (app/api/fast-slices): per window [sample], [] when it has none, null when
 * that read failed. Throws when the batch itself cannot be made, so a caller
 * can fall back to reading the windows one by one.
 */
export async function fetchFastBessSlices(
  gatewayId: string, bessId: string, windows: [number, number][], signal?: AbortSignal,
): Promise<(FastBessSample[] | null)[]> {
  if (!windows.length) return [];
  const s = getSession();
  if (!s) throw new CentralReadError("Not signed in");
  const r = await fetch(centralUrl("/api/fast-slices"), {
    method: "POST",
    headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    body: JSON.stringify({ gatewayId, bessId, windows }),
    cache: "no-store",
    signal,
  });
  if (!r.ok) throw new CentralReadError(`Batch read answered ${r.status}`, r.status);
  const body: unknown = await r.json();
  if (!Array.isArray(body) || body.length !== windows.length) throw new CentralReadError("Batch read answered the wrong shape");
  return body.map((x) => (Array.isArray(x) ? newestFirst(x as FastBessSample[]) : null));
}

function newestFirst(rows: FastBessSample[]): FastBessSample[] {
  const t = (r: FastBessSample) => {
    const n = Date.parse(r.sample_time_utc ?? "");
    return Number.isNaN(n) ? 0 : n;
  };
  return [...rows].sort((a, b) => t(b) - t(a));
}

/* ── A time window ───────────────────────────────────────────────────────── */

/** The two readings the range charts and today's energy use, slimmed down. */
export interface PowerSocPoint {
  ts: number;
  /** PCS AC power, kW, + discharge / − charge. */
  power: number | null;
  /** display_soc, %. */
  soc: number | null;
}

/* Requests per call. Each full page is ~3 MB (63 signals × 1,000 rows), and on
   a busy day the stream runs at ~1 Hz — 86 pages a day — so a long window
   cannot be read whole; the caption says where loading stopped, and the next
   call carries on from there. */
const RANGE_MAX_REQUESTS = 6;

/* One contiguous, slimmed interval per cabinet, extended at either end as
   windows ask for more, and kept in IndexedDB (fastStore) so a page refresh
   resumes from it instead of paging midnight → now again.

   `todo` is what is still to be read inside [from, to): stretches never read
   because the request budget ran out (`unread`, which caption completeness),
   and holes in the data queued for a re-read. A gateway that was offline
   uploads its backlog late, into time this cache already covers — always into
   a hole, since nothing was sampled there — so every RECHECK_MS the holes are
   re-read rather than the whole interval being thrown away. */
const RECHECK_MS = 15 * 60_000;
/* A stretch this long with no sample counts as a hole. */
const HOLE_MS = 2 * 60_000;
/* Held in memory: the longest window a view asks for (Last 7 days). */
const KEEP_MS = 8 * 86_400_000;
/* Written to IndexedDB: enough for today's charts after any refresh. */
const STORE_MS = 36 * 3_600_000;

interface Span { a: number; b: number; unread: boolean }
interface Interval { from: number; to: number; points: PowerSocPoint[]; todo: Span[]; checked: number }
const intervals = new Map<string, Interval>();
const restored = new Set<string>();

const slim = (r: FastBessSample): PowerSocPoint | null => {
  const ts = Date.parse(r.sample_time_utc ?? "");
  if (Number.isNaN(ts)) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { ts, power: n(r.data?.pcs_values?.total_active_power), soc: n(r.data?.bms_values?.display_soc) };
};

/** First index whose ts is >= t. */
function lowerBound(points: PowerSocPoint[], t: number): number {
  let lo = 0, hi = points.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (points[m].ts < t) lo = m + 1; else hi = m; }
  return lo;
}

/** points with [a, b) replaced by `fresh` (oldest first, inside [a, b)). */
const splice = (points: PowerSocPoint[], a: number, b: number, fresh: PowerSocPoint[]) =>
  points.slice(0, lowerBound(points, a)).concat(fresh, points.slice(lowerBound(points, b)));

/** Holes in [from, to) as re-read spans, skipping what is already queued unread. */
function holes(iv: Interval): Span[] {
  const out: Span[] = [];
  const queued = (a: number, b: number) => iv.todo.some((s) => s.a < b && a < s.b);
  let prev = iv.from;
  for (const p of [...iv.points, { ts: iv.to } as PowerSocPoint]) {
    if (p.ts - prev > HOLE_MS && !queued(prev, p.ts)) out.push({ a: prev, b: p.ts, unread: false });
    prev = p.ts + 1;
  }
  return out;
}

/** Drops everything older than `cutoff`. */
function trimmed(iv: Interval, cutoff: number): Interval {
  if (iv.from >= cutoff) return iv;
  return {
    ...iv,
    from: cutoff,
    points: iv.points.slice(lowerBound(iv.points, cutoff)),
    todo: iv.todo.filter((s) => s.b > cutoff).map((s) => ({ ...s, a: Math.max(s.a, cutoff) })),
  };
}

/**
 * Pages [fromMs, toMs) newest first until the window is covered or the budget
 * runs out. Returns the points oldest first and where they are complete from.
 */
async function readWindow(
  gatewayId: string, bessId: string, fromMs: number, toMs: number, budget: number,
): Promise<{ points: PowerSocPoint[]; completeFrom: number; used: number }> {
  const out: PowerSocPoint[] = [];
  let edge = toMs, used = 0;
  while (used < budget) {
    used++;
    const page = await fetchFastBess(gatewayId, { bessId, fromMs, toMs: edge, limit: FAST_BESS_MAX_LIMIT });
    for (const r of page) { const p = slim(r); if (p) out.push(p); }
    if (page.length < FAST_BESS_MAX_LIMIT) return { points: out.reverse(), completeFrom: fromMs, used };
    const oldest = Date.parse(page[page.length - 1].sample_time_utc ?? "");
    if (Number.isNaN(oldest) || oldest >= edge) break;
    edge = oldest;   // exclusive, so the edge sample is not read twice
  }
  out.reverse();
  return { points: out, completeFrom: out[0]?.ts ?? toMs, used };
}

/**
 * Power and SOC for one cabinet over [fromMs, toMs), oldest first.
 *
 * The backend takes from_time/to_time on this endpoint since 1 Oct 2026 but
 * still caps a response at 1,000 rows, newest first. `completeFrom` is where
 * the points are known to be complete from: fromMs when the window was
 * covered, later when the request budget ran out first — say so in a caption.
 */
export function fetchPowerSocRange(
  gatewayId: string,
  opts: { bessId: string; fromMs: number; toMs: number },
): Promise<{ points: PowerSocPoint[]; completeFrom: number }> {
  /* One at a time per cabinet. The dashboard's charts and its today-energy
     figure ask for the same midnight → now on the same render; run together,
     both read the whole day before either had cached it. */
  const key = `${gatewayId}|${opts.bessId}`;
  const run = (locks.get(key) ?? Promise.resolve()).then(() => rangeLocked(gatewayId, key, opts));
  locks.set(key, run.catch(() => undefined));
  return run;
}

const locks = new Map<string, Promise<unknown>>();

async function rangeLocked(
  gatewayId: string,
  key: string,
  opts: { bessId: string; fromMs: number; toMs: number },
): Promise<{ points: PowerSocPoint[]; completeFrom: number }> {
  const { bessId, fromMs, toMs } = opts;
  if (!restored.has(key)) {
    restored.add(key);
    const stored = await loadStored<Interval>(key);
    if (stored && !intervals.has(key) && Array.isArray(stored.points) && Array.isArray(stored.todo)) {
      intervals.set(key, stored);
    }
  }
  let iv = intervals.get(key);

  /* Not touching what is held: read the window on its own and keep it if it
     is the newer one (the live case). */
  if (!iv || toMs < iv.from || fromMs > iv.to) {
    const r = await readWindow(gatewayId, bessId, fromMs, toMs, RANGE_MAX_REQUESTS);
    if (!iv || toMs > iv.to) {
      keep(key, {
        from: fromMs, to: toMs, points: r.points, checked: Date.now(),
        todo: r.completeFrom > fromMs ? [{ a: fromMs, b: r.completeFrom, unread: true }] : [],
      });
    }
    return { points: r.points, completeFrom: r.completeFrom };
  }

  if (toMs > iv.to) { iv.todo.push({ a: iv.to, b: toMs, unread: true }); iv.to = toMs; }
  if (fromMs < iv.from) { iv.todo.push({ a: fromMs, b: iv.from, unread: true }); iv.from = fromMs; }
  if (Date.now() - iv.checked > RECHECK_MS) { iv.todo.push(...holes(iv)); iv.checked = Date.now(); }

  /* Newest first: that is what a refresh needs. Only spans this window
     touches are read; the rest wait for a window that wants them. */
  iv.todo.sort((x, y) => y.b - x.b);
  let budget = RANGE_MAX_REQUESTS;
  const left: Span[] = [];
  let i = 0, failure: unknown = null;
  try {
    for (; i < iv.todo.length; i++) {
      const s = iv.todo[i];
      if (budget <= 0 || s.b <= fromMs || s.a >= toMs) { left.push(s); continue; }
      const r = await readWindow(gatewayId, bessId, s.a, s.b, budget);
      budget -= r.used;
      iv.points = splice(iv.points, r.completeFrom, s.b, r.points);
      if (r.completeFrom > s.a) left.push({ ...s, b: r.completeFrom });
    }
  } catch (e) {
    failure = e;
  }
  /* An interrupted read keeps what it got; the span it was on, and any not
     reached, stay queued for the next call. */
  iv.todo = left.concat(iv.todo.slice(i));
  keep(key, iv);

  const gap = iv.todo
    .filter((s) => s.unread && s.b > fromMs && s.a < toMs)
    .reduce((m, s) => Math.max(m, Math.min(s.b, toMs)), fromMs);
  const points = iv.points.slice(lowerBound(iv.points, fromMs), lowerBound(iv.points, toMs));
  /* A failed read with nothing held for the window is the caller's to handle;
     with something held, what was already read is still true — show it
     rather than blanking the chart, and the next call retries. */
  if (failure && !points.length) throw failure;
  return { points, completeFrom: gap };
}

/** Holds the interval in memory and writes the newest part through to IndexedDB. */
function keep(key: string, iv: Interval) {
  const now = Date.now();
  const held = trimmed(iv, now - KEEP_MS);
  intervals.set(key, held);
  void saveStored(key, trimmed(held, now - STORE_MS));
}

/* ── Helpers every reader of this endpoint needs ──────────────────────────── */

/** Oldest → newest, for plotting. The API's order is the reverse. */
export const chronological = (rows: FastBessSample[]): FastBessSample[] =>
  [...rows].reverse();

/**
 * The window the data ACTUALLY covers, read off the samples.
 *
 * Never inferred from `limit`: a gap in the logger, a gateway that was offline,
 * or simply fewer stored rows than asked for all make the real span shorter
 * than the request implies. Labelling a chart "16 minutes" because that is what
 * 1,000 samples would be at 1 Hz is how a chart starts lying.
 */
export function windowOf(rows: FastBessSample[]): { fromMs: number; toMs: number; spanMs: number } | null {
  const ts = rows
    .map((r) => Date.parse(r.sample_time_utc ?? ""))
    .filter((t) => !Number.isNaN(t));
  if (!ts.length) return null;
  const fromMs = Math.min(...ts), toMs = Math.max(...ts);
  return { fromMs, toMs, spanMs: toMs - fromMs };
}

/** Union of signal names present across the window, so a key absent from the
 *  newest sample but present earlier is still listed. */
export function signalNames(rows: FastBessSample[], group: "pcs_values" | "bms_values"): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.data?.[group] ?? {})) seen.add(k);
  return [...seen].sort();
}

/** A numeric reading, or null. Guards the non-finite and the non-numeric alike. */
export function reading(
  s: FastBessSample | undefined,
  group: "pcs_values" | "bms_values",
  name: string,
): number | null {
  const v = s?.data?.[group]?.[name];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Every full sample for one cabinet over [fromMs, toMs), newest first, paged
 * 1,000 rows at a time until the window is covered or `maxPages` runs out.
 *
 * For views that need more than power and SOC (Live BESS draws DC voltage and
 * cell temperature too), so nothing is slimmed. Each page is ~3 MB, which is
 * why the budget is small: an hour at 1 Hz is about four pages. `completeFrom`
 * says where the samples are complete from when the budget ran out first.
 */
export async function fetchFastBessWindow(
  gatewayId: string,
  opts: { bessId: string; fromMs: number; toMs: number; maxPages?: number },
): Promise<{ samples: FastBessSample[]; completeFrom: number }> {
  const out: FastBessSample[] = [];
  let edge = opts.toMs;
  const budget = opts.maxPages ?? 5;
  for (let used = 0; used < budget; used++) {
    const page = await fetchFastBess(gatewayId, {
      bessId: opts.bessId, fromMs: opts.fromMs, toMs: edge, limit: FAST_BESS_MAX_LIMIT,
    });
    out.push(...page);
    if (page.length < FAST_BESS_MAX_LIMIT) return { samples: out, completeFrom: opts.fromMs };
    const oldest = Date.parse(page[page.length - 1].sample_time_utc ?? "");
    if (Number.isNaN(oldest) || oldest >= edge) break;
    edge = oldest;   // exclusive, so the edge sample is not read twice
  }
  const last = Date.parse(out[out.length - 1]?.sample_time_utc ?? "");
  return { samples: out, completeFrom: Number.isNaN(last) ? opts.toMs : last };
}
