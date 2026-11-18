/**
 * Reading one signal's history — once the gateway's snapshot store, now the
 * central backend (see "Read from the central backend" below).
 *
 * `/api/storage/points` is the only way to get a time axis for anything
 * outside the 63-signal fast profile — the per-cell families, the meter's
 * energy counters, the cooling loop — and five screens now read it. This is
 * the one copy of the rules they all need.
 *
 * Extracted after the fourth identical copy appeared. Each was fifteen lines
 * and they had already begun to differ in which timestamp field they preferred,
 * which is precisely the drift that makes two screens disagree about the same
 * register.
 *
 * THE RULES, stated once:
 *
 *   TIMESTAMP   `source_timestamp` first — when the gateway read the register,
 *               which is what a trend is a trend OF. `ingest_timestamp` is when
 *               the row was written and folds any backlog in the writer into
 *               the x-axis. The API reference documents `telemetry_points`'
 *               columns rather than this endpoint's JSON, so all three
 *               spellings are accepted and the preference order is what makes
 *               the choice deliberate rather than whichever arrives first.
 *
 *   QUALITY     A point whose quality is not "good" resolves to null and is
 *               dropped, the same rule `leafValue` applies to live telemetry.
 *               The gateway holds the last decoded number in place when a read
 *               fails, so a stale register trended as a live one draws a flat
 *               line that means "nothing was read" while looking exactly like
 *               "nothing changed".
 *
 *   ORDER       Sorted ascending here. The endpoint answers newest-first and
 *               every caller wants the opposite; sorting rather than reversing
 *               because an ordering this code did not establish is not one to
 *               rely on.
 *
 *   FAILURE     An absent series, not a thrown error. These screens read six
 *               to twelve signals at a time from a field board behind a tunnel,
 *               and one of them failing is not a reason to show none of the
 *               others — the figures that depended on it come back null, which
 *               every caller already renders as a dash.
 */

import { fetchGeneral, fetchFastBess, fetchHistory, numeric, type FastBessSample, type GeneralRecord } from "@/lib/central";
import { istDate, istMidnight } from "@/lib/api/time";
import { appConfigInit } from "@/lib/central/appConfig";

export interface Sample {
  ts: number;
  value: number;
}

/* ── Read from the central backend ─────────────────────────────────────────
 *
 * The gateway's snapshot store (/api/storage/points) went with NorthBound.
 * The same series now come from the central backend, by the signal's home:
 *
 *   S2 /general  — counters and EMS/meter registers, by point id. No date
 *                  range: the newest 1,000 rows, ~2.8 days for the PCS energy
 *                  counters (both cabinets in one read).
 *   S1 /fast-bess — SOC, temperatures, cell spread and PCS power. It takes a
 *                  date range but is 1 Hz, so it is PROBED: one sample at
 *                  each IST midnight's two sides and every two hours between,
 *                  over the last three days. A day's first/last and its
 *                  min/max then come from real readings; a mean is coarse.
 *
 * Callers still name assets the NorthBound way (`external_ems_1_pcs_1`);
 * the `_1` is dropped to S2's `external_ems_1_pcs`. Unknown signals answer
 * an empty series, as a failed read always did. */

const S2_POINT: Record<string, string> = {
  ac_cumulative_charge_energy: "p0203",
  ac_cumulative_discharge_energy: "p0204",
  load_power: "p0037",
  forward_total_active_energy: "p1405",
  reverse_total_active_energy: "p1406",
};
/* The grid meter's power registers. Asked for by asset, because the PCS
   publishes a `total_active_power` too and that one is read off S1. */
const METER_POINT: Record<string, string> = {
  total_active_power: "p1368",
  total_apparent_power: "p1376",
  total_power_factor: "p1380",
};
const S1_GROUP: Record<string, "bms_values" | "pcs_values"> = {
  display_soc: "bms_values",
  average_temperature: "bms_values",
  max_min_cell_voltage_diff: "bms_values",
  total_active_power: "pcs_values",
};
const PROBE_DAYS = 3;
/* The collector's store reaches further back than the backend does. */
const STORED_DAYS = 30;
const STORED_STEP_MS = 10 * 60_000;
const PROBE_STEP_MS = 2 * 3_600_000;
const PROBE_HALF_MS = 120_000;

let gatewayP: Promise<string> | null = null;
function gatewayId(): Promise<string> {
  gatewayP ??= fetch("/api/app-config", appConfigInit())
    .then((r) => (r.ok ? r.json() : { gatewayId: "" }))
    .then((j: { gatewayId?: string }) => j.gatewayId ?? "")
    .catch(() => "");
  return gatewayP;
}

const s2Cache = new Map<string, Promise<Awaited<ReturnType<typeof fetchGeneral>>>>();
const probeCache = new Map<string, Promise<FastBessSample | null>>();

/** One S1 sample nearest the end of [from, to), cached for the session. */
function probe(gw: string, bessId: string, from: number, to: number): Promise<FastBessSample | null> {
  const k = `${bessId}@${from}`;
  let p = probeCache.get(k);
  if (!p) {
    p = fetchFastBess(gw, { bessId, fromMs: from, toMs: to, limit: 1 }).then((r) => r[0] ?? null).catch(() => null);
    /* The current window is still filling; let it be asked again. */
    if (to < Date.now() - 60_000) probeCache.set(k, p);
  }
  return p;
}

/** Probe instants: each IST midnight's two sides, every 2 h between, and now. */
function probeWindows(now: number): [number, number][] {
  const out: [number, number][] = [];
  const start = istMidnight(now) - (PROBE_DAYS - 1) * 86_400_000;
  for (let m = start; m <= now; m += 86_400_000) {
    out.push([m - PROBE_HALF_MS, m]);                         // last of the day before
    for (let t = m; t < m + 86_400_000 && t < now; t += PROBE_STEP_MS) out.push([t, t + PROBE_HALF_MS]);
  }
  out.push([now - PROBE_HALF_MS, now]);
  return out;
}

async function pooled<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await f(items[k]); }
  }));
  return out;
}

/** One signal's history, oldest first, bad reads dropped. */
export async function storedSeries(
  assetId: string,
  signalName: string,
  _limit: number,
): Promise<Sample[]> {
  try {
    const gw = await gatewayId();
    if (!gw) return [];
    const asset = assetId.replace(/_(pcs|bms)_\d+$/, "_$1");
    const out: Sample[] = [];

    const point = (asset.endsWith("_grid_meter") ? METER_POINT[signalName] : undefined) ?? S2_POINT[signalName];
    if (point) {
      let p = s2Cache.get(point);
      if (!p) { p = fetchGeneral(gw, { pointId: point, limit: 1000 }); s2Cache.set(point, p); setTimeout(() => s2Cache.delete(point), 60_000); }
      const stored = await fetchHistory<GeneralRecord>("general", {
        fromMs: Date.now() - STORED_DAYS * 86_400_000, pointId: point, assetId: asset, stepMs: STORED_STEP_MS,
      });
      const seenTs = new Set<number>();
      for (const r of [...(await p), ...stored]) {
        if (r.asset_id !== asset) continue;
        const ts = Date.parse(r.sample_time_utc ?? "");
        const v = numeric(r);
        if (Number.isFinite(ts) && v != null && !seenTs.has(ts)) { seenTs.add(ts); out.push({ ts, value: v }); }
      }
      return out.sort((a, b) => a.ts - b.ts);
    }

    const group = S1_GROUP[signalName];
    const src = /^(external_ems_(\d+))/.exec(assetId);
    if (group && src) {
      const bessId = `bess_${src[2]}`;            // external_ems_N reports bess_N (S5: X = bess_1, Y = bess_2)
      const [probed, stored] = await Promise.all([
        pooled(probeWindows(Date.now()), 6, ([f, t]) => probe(gw, bessId, f, t)),
        fetchHistory<FastBessSample>("fast", { fromMs: Date.now() - STORED_DAYS * 86_400_000, bessId, stepMs: STORED_STEP_MS }),
      ]);
      const rows = [...probed, ...stored];
      const seen = new Set<number>();
      for (const r of rows) {
        if (!r || (r.quality && r.quality !== "good")) continue;
        const ts = Date.parse(r.sample_time_utc ?? "");
        const v = (r.data?.[group] as Record<string, unknown> | undefined)?.[signalName];
        if (!Number.isFinite(ts) || seen.has(ts) || typeof v !== "number" || !Number.isFinite(v)) continue;
        seen.add(ts);
        out.push({ ts, value: v });
      }
      return out.sort((a, b) => a.ts - b.ts);
    }
    return [];
  } catch {
    return [];
  }
}

/* ── Shared shapes over a series ──────────────────────────────────────────── */

/** Local date key, the grain every one of these screens buckets by. */
export function dayKey(ms: number): string {
  return istDate(ms);   // IST, the site's day
}

/** First and last sample of each local day — how a counter is differenced. */
export function dayEdges(samples: Sample[]): Map<string, { first: Sample; last: Sample }> {
  const m = new Map<string, { first: Sample; last: Sample }>();
  for (const s of samples) {
    const k = dayKey(s.ts);
    const cur = m.get(k);
    if (!cur) m.set(k, { first: s, last: s });
    else if (s.ts > cur.last.ts) cur.last = s;
  }
  return m;
}

/**
 * Median sample interval — the honest read of a cadence nothing publishes.
 *
 * Median rather than mean: a store that was offline for a day has one enormous
 * gap, and a mean would report a cadence no sample was ever taken at.
 */
export function cadenceOf(samples: Sample[]): number | null {
  if (samples.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) gaps.push(samples[i].ts - samples[i - 1].ts);
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] ?? null;
}

/** Nearest sample at or before `ts`, within `tol`. Null beyond it. */
export function valueAt(samples: Sample[], ts: number, tol: number): number | null {
  if (!samples.length) return null;
  let lo = 0, hi = samples.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].ts <= ts) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return null;
  /* Carried forward only within one sample interval. Beyond that the two
     series are not describing the same instant, and a figure computed across a
     gap is the difference between two different moments. */
  return ts - samples[best].ts <= tol ? samples[best].value : null;
}
