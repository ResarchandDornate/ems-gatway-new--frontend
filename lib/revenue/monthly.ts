/**
 * Discharge per month, kept by the server so last month's revenue survives.
 *
 * The BMS month-to-date discharge counter (S2 p1064) restarts each month, and
 * the backend keeps only its newest ~2.8 days — so by mid-month the figure a
 * month closed on is gone. The collector reads it every 5 min; this folds each
 * reading into the highest value seen per cabinet per IST month. The highest,
 * not the latest: a counter that resets a little before midnight would
 * otherwise overwrite the month's total with its first reading of the next.
 */

/** month "YYYY-MM" (IST) → asset id → the month's highest reading. */
export type MonthlyDoc = Record<string, Record<string, { kwh: number; at: number }>>;

const IST_MS = 330 * 60_000;
export const istMonth = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 7);

/** The IST month before the one `ms` falls in, "YYYY-MM". */
export function prevIstMonth(ms: number): string {
  const [y, m] = istMonth(ms).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Folds p1064 rows into the doc; returns true when anything changed. */
export function foldMonthly(
  doc: MonthlyDoc,
  rows: { asset_id?: string | null; sample_time_utc?: string | null; value?: unknown }[],
): boolean {
  let changed = false;
  for (const r of rows) {
    const ts = Date.parse(r.sample_time_utc ?? "");
    const kwh = typeof r.value === "number" ? r.value : Number(r.value);
    if (!r.asset_id || !Number.isFinite(ts) || !Number.isFinite(kwh) || kwh < 0) continue;
    const month = (doc[istMonth(ts)] ??= {});
    const cur = month[r.asset_id];
    if (!cur || kwh > cur.kwh) { month[r.asset_id] = { kwh, at: ts }; changed = true; }
  }
  return changed;
}

/**
 * A month's discharge over the cabinets in `sourceIds` (asset ids start with
 * their source id: `external_ems_1_bms`). Null unless every cabinet has one.
 */
export function monthTotal(doc: MonthlyDoc | null | undefined, month: string, sourceIds: string[]): number | null {
  const m = doc?.[month];
  if (!m || sourceIds.length === 0) return null;
  let total = 0;
  for (const id of sourceIds) {
    const hits = Object.entries(m).filter(([asset]) => asset === id || asset.startsWith(`${id}_`));
    if (!hits.length) return null;
    for (const [, v] of hits) total += v.kwh;
  }
  return total;
}

/* ── This month from the PCS lifetime counter ─────────────────────────────
   The BMS month counter can freeze while the PCS lifetime discharge counter
   (S2 p0206, DC) keeps going — p1064 sat still from 10 to 12 Oct 2026 and
   caught up on the 13th. So the collector also keeps, per cabinet per IST month,
   the first and last lifetime reading it saw, and a month's discharge is the
   lifetime counter's rise across it. */

/** month "YYYY-MM" (IST) → asset id → first and last lifetime reading seen in it. */
export type LifetimeDoc = Record<string, Record<string, { first: { kwh: number; at: number }; last: { kwh: number; at: number } }>>;

/** A first reading this close to the 1st counts as the month's start. */
export const ANCHOR_MS = 6 * 3_600_000;

/** Epoch ms of IST midnight on the month's 1st. */
export const monthStartMs = (month: string) => Date.parse(`${month}-01T00:00:00+05:30`);

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Folds p0206 rows into the doc; returns true when anything changed. */
export function foldLifetime(
  doc: LifetimeDoc,
  rows: { asset_id?: string | null; sample_time_utc?: string | null; value?: unknown }[],
): boolean {
  let changed = false;
  for (const r of rows) {
    const at = Date.parse(r.sample_time_utc ?? "");
    const kwh = typeof r.value === "number" ? r.value : Number(r.value);
    if (!r.asset_id || !Number.isFinite(at) || !Number.isFinite(kwh) || kwh < 0) continue;
    const month = (doc[istMonth(at)] ??= {});
    const cur = month[r.asset_id];
    if (!cur) { month[r.asset_id] = { first: { kwh, at }, last: { kwh, at } }; changed = true; continue; }
    if (at < cur.first.at) { cur.first = { kwh, at }; changed = true; }
    if (at > cur.last.at) { cur.last = { kwh, at }; changed = true; }
  }
  return changed;
}

/** The cabinets' assets in a month, each source id matched once. Null unless all are there. */
function assetsOf<T>(m: Record<string, T> | undefined, sourceIds: string[]): T[] | null {
  if (!m || sourceIds.length === 0) return null;
  const out: T[] = [];
  for (const id of sourceIds) {
    const hits = Object.entries(m).filter(([a]) => a === id || a.startsWith(`${id}_`)).map(([, v]) => v);
    if (!hits.length) return null;
    out.push(...hits);
  }
  return out;
}

/** The lifetime counter at the month's start, and whether every reading is near enough to it. */
function startOf(doc: LifetimeDoc, month: string, sourceIds: string[]): { kwh: number; complete: boolean } | null {
  const a = assetsOf(doc[month], sourceIds);
  if (!a) return null;
  const t0 = monthStartMs(month);
  return { kwh: a.reduce((s, x) => s + x.first.kwh, 0), complete: a.every((x) => x.first.at - t0 <= ANCHOR_MS) };
}

/**
 * A month's discharge from the lifetime counter: the next month's start (or
 * `nowKwh`, the live counter, for the running month; else the last reading
 * seen) minus this month's start. `complete` is false when either end was
 * first seen well after its 1st — the figure is then an understatement.
 */
export function monthFromLifetime(
  doc: LifetimeDoc | null | undefined, month: string, sourceIds: string[], nowKwh?: number | null,
): { kwh: number; complete: boolean } | null {
  if (!doc) return null;
  const start = startOf(doc, month, sourceIds);
  if (!start) return null;
  const end = startOf(doc, nextMonth(month), sourceIds);
  if (end) return { kwh: Math.max(0, end.kwh - start.kwh), complete: start.complete && end.complete };
  if (nowKwh != null) return { kwh: Math.max(0, nowKwh - start.kwh), complete: start.complete };
  const a = assetsOf(doc[month], sourceIds)!;
  return { kwh: Math.max(0, a.reduce((s, x) => s + x.last.kwh, 0) - start.kwh), complete: false };
}

export interface MonthlyDocs { months?: MonthlyDoc; lifetime?: LifetimeDoc }

/**
 * A month's discharge, from the best figure there is. The lifetime counter's
 * rise when both month starts were caught; otherwise the larger of that and
 * the BMS month counter's peak — each fails by reading low (a late anchor, a
 * counter that stopped reporting), never high. For the running month pass
 * `nowKwh` (the live lifetime counter) and `bmsNowKwh` (the live month counter).
 * Null when nothing reliable is known.
 */
export function bestMonthKwh(
  docs: MonthlyDocs | null | undefined, month: string, sourceIds: string[],
  live?: { nowKwh?: number | null; bmsNowKwh?: number | null },
): number | null {
  const pcs = monthFromLifetime(docs?.lifetime, month, sourceIds, live?.nowKwh);
  if (pcs?.complete) return pcs.kwh;
  const bmsRecorded = monthTotal(docs?.months, month, sourceIds);
  const bms = live?.bmsNowKwh != null ? Math.max(live.bmsNowKwh, bmsRecorded ?? 0) : bmsRecorded;
  if (bms == null) return live && pcs ? pcs.kwh : null;
  return pcs ? Math.max(bms, pcs.kwh) : bms;
}
