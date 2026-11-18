"use client";

/**
 * Period-aware history reads for the Equipment charts (PeriodNav's Day / Week
 * / Month / Year). A Day is its readings, oldest first; a Week / Month / Year
 * is one bucket per day or month (lib/charts/period). Nothing here invents a
 * reading: a stretch the backend and the collector store do not hold is left
 * empty, and the chart draws it blank.
 *
 *   Solar   S6 snapshots (live) + S5 controller rows + the collector's stored
 *           rows + today's points kept in IndexedDB.
 *   Drift   cell_voltage_N − cell_average_voltage, both S2 points, read with
 *           fetchPointHistory (newest 1,000 rows + the stored history).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchSolis, fetchController, fetchHistory, snapshotsOf, solarKw, limitKw, isGoodRead,
  type SolisRecord, type ControllerRecord,
} from "@/lib/central";
import { loadStored, saveStored } from "@/lib/central/fastStore";
import { usePointHistories } from "@/hooks/useDataAnalysis";
import { useUnit } from "@/lib/context/UnitContext";
import { periodReadRange } from "@/components/charts/PeriodSeries";
import { withRange, type BucketRow } from "@/components/charts/BucketChart";
import { aggregate, bucketsOf, isLatest, type Period } from "@/lib/charts/period";
import { GAP_MS } from "@/lib/charts/timeAxis";
import { cadenceOf, valueAt } from "@/lib/api/services/storedSeries";
import { makeTag } from "@/lib/api/services/pointsCentral.service";
import CATALOG_JSON from "@/lib/central/pointCatalog.json";

const CATALOG = CATALOG_JSON as unknown as { points: Record<string, [string[], string, string | null, string | null]> };

const DAY_MS = 86_400_000;

/** The cabinet the unit picker has selected (same resolution as useEquipment's hooks). */
export function useCabinetSource(override?: string): string {
  const { unit, units } = useUnit();
  return override || unit.sourceId || units.find((u) => u.sourceId)?.sourceId || "";
}

/** A gap wider than this breaks a line: 5 × the usual interval, at least GAP_MS. */
export function gapFor(ts: number[]): number {
  if (ts.length < 3) return GAP_MS;
  const steps = ts.slice(1).map((t, i) => t - ts[i]).filter((d) => d > 0).sort((a, b) => a - b);
  return Math.max(GAP_MS, (steps[Math.floor(steps.length / 2)] ?? 0) * 5);
}

/** [from, to) cut into pieces the history route accepts (it refuses more than 93 days). */
function chunks(from: number, to: number, max = 90 * DAY_MS): [number, number][] {
  const out: [number, number][] = [];
  for (let a = from; a < to; a += max) out.push([a, Math.min(to, a + max)]);
  return out;
}

const periodEnd = (p: Period) => Math.min(p.to, Date.now() + 60_000);

/* ── Solar: active power and the derate limit ─────────────────────────── */

export interface SolarDayRow { ts: number; power: number | null; limit: number | null }

/* S6 answers its newest 1,000 rows — about four hours — and ignores
   from_time / to_time (checked live, 13 Oct 2026), so a Day once held only the
   afternoon and a morning the collector store had not kept vanished on
   reload. Two more sources fill it: the controller stream (S5), whose newest
   1,000 rows carry the same data.solis reading and reach back ~7.5 hours, and
   the day's points already seen in this browser, kept in IndexedDB so the
   morning stays after both live windows have moved past it. */
type DayPoint = [ts: number, kw: number | null, limit: number | null];
const dayKey = (gatewayId: string, from: number) => `solarDay.${gatewayId}.${from}`;

const asRecord = ([ts, kw, limit]: DayPoint): SolisRecord => {
  const iso = new Date(ts).toISOString();
  return {
    sample_time_utc: iso, received_at_utc: iso,
    data: { solis: { communication_quality: kw == null ? "NOT_READ" : "GOOD", online: true, active_power_kw: kw, power_limit_equivalent_kw: limit } },
  };
};

async function solarDayRows(gatewayId: string, p: Period, latest: boolean): Promise<SolisRecord[]> {
  const toMs = periodEnd(p);
  const [stored, storedCtl, live, ctl, kept] = await Promise.all([
    /* One row a minute: a day of full S6 records is otherwise several MB. */
    fetchHistory<SolisRecord>("solis", { fromMs: p.from, toMs, stepMs: 60_000 }),
    fetchHistory<ControllerRecord>("controller", { fromMs: p.from, toMs, stepMs: 60_000 }),
    fetchSolis(gatewayId, { limit: 1000, fromMs: p.from, toMs }).catch(() => [] as SolisRecord[]),
    latest ? fetchController(gatewayId, { limit: 1000 }).catch(() => [] as ControllerRecord[]) : Promise.resolve([] as ControllerRecord[]),
    latest ? loadStored<DayPoint[]>(dayKey(gatewayId, p.from)) : Promise.resolve(undefined),
  ]);

  /* Controller rows count where the inverter was online, as today's yield
     counts them (lib/energy/solarToday). */
  const fromCtl: DayPoint[] = [];
  for (const r of [...storedCtl, ...ctl]) {
    const ts = Date.parse(r.sample_time_utc ?? "");
    const sol = r.data?.solis;
    if (!Number.isFinite(ts) || ts < p.from || ts >= p.to || !sol) continue;
    const kw = sol.online === true && typeof sol.active_power_kw === "number" ? sol.active_power_kw : null;
    const limit = typeof sol.power_limit_equivalent_kw === "number" ? sol.power_limit_equivalent_kw : null;
    fromCtl.push([ts, kw, limit]);
  }

  if (!latest) return [...stored, ...live, ...fromCtl.map(asRecord)];

  /* Merge into the day's kept points and save them back. */
  const byTs = new Map<number, DayPoint>((kept ?? []).map((d) => [d[0], d]));
  for (const d of fromCtl) byTs.set(d[0], d);
  for (const sn of snapshotsOf(live)) {
    if (sn.ts >= p.from && sn.ts < p.to) byTs.set(sn.ts, [sn.ts, solarKw(sn.solis), limitKw(sn.solis)]);
  }
  const merged = [...byTs.values()].sort((x, y) => x[0] - y[0]);
  void saveStored(dayKey(gatewayId, p.from), merged);
  return [...stored, ...merged.map(asRecord)];
}

async function solarLongPoints(p: Period): Promise<[number, number][]> {
  const step = p.range === "week" ? 5 * 60_000 : p.range === "month" ? 15 * 60_000 : 60 * 60_000;
  type Kw = { sample_time_utc: string; kw: number };
  const parts = await Promise.all(chunks(p.from, periodEnd(p)).map(([a, b]) =>
    fetchHistory<Kw>("solis", { fromMs: a, toMs: b, stepMs: step, shape: "solar" })));
  const out: [number, number][] = [];
  for (const r of parts.flat()) {
    const ts = Date.parse(r.sample_time_utc ?? "");
    if (Number.isFinite(ts) && Number.isFinite(r.kw)) out.push([ts, Math.max(0, r.kw)]);
  }
  return out;
}

export function useSolarPeriod(gatewayId: string, period: Period, live: SolisRecord[] | undefined) {
  const isDay = period.range === "day";
  const latest = isLatest(period, Date.now());
  const q = useQuery({
    queryKey: ["equipment", "solarPeriod", gatewayId, period.range, period.from, latest],
    queryFn: async () => (isDay
      ? { day: await solarDayRows(gatewayId, period, latest), long: [] as [number, number][] }
      : { day: [] as SolisRecord[], long: await solarLongPoints(period) }),
    enabled: !!gatewayId,
    staleTime: latest ? 60_000 : 10 * 60_000,
    refetchInterval: latest ? 5 * 60_000 : false,
  });

  const day = useMemo<SolarDayRow[]>(() => {
    if (!isDay) return [];
    const byTs = new Map<number, SolarDayRow>();
    for (const s of snapshotsOf([...(q.data?.day ?? []), ...(live ?? [])])) {
      if (s.ts < period.from || s.ts >= period.to) continue;
      byTs.set(s.ts, { ts: s.ts, power: solarKw(s.solis), limit: limitKw(s.solis) });
    }
    return [...byTs.values()].sort((a, b) => a.ts - b.ts);
  }, [isDay, q.data, live, period.from, period.to]);

  const buckets = useMemo<BucketRow[]>(() => {
    if (isDay) return [];
    const byTs = new Map<number, number>(q.data?.long ?? []);
    for (const s of snapshotsOf(live ?? [])) {
      const kw = solarKw(s.solis);
      if (isGoodRead(s.solis) && kw != null && s.ts >= period.from && s.ts < period.to) byTs.set(s.ts, kw);
    }
    const readings = [...byTs].map(([ts, value]) => ({ ts, value }));
    return withRange(aggregate(readings, bucketsOf(period), "measure"));
  }, [isDay, q.data, live, period]);

  return { day, buckets, loading: q.isLoading };
}

/* ── Cell drift: one cell's distance from the pack average ────────────── */

const P_AVG_MV = "p1023";
const CELL_IDS_KEY = "ems.cellPointIds.v1";

/** `cell_voltage_N`'s S2 point id: the catalogue, else the ids cellTrend has cached in this browser. */
function cellPointId(cellNo: number): string | null {
  const want = `cell_voltage_${cellNo}`;
  for (const [pid, [kinds, sig]] of Object.entries(CATALOG.points)) {
    if (sig === want && kinds.includes("bms")) return pid;
  }
  try {
    const ids = JSON.parse(localStorage.getItem(CELL_IDS_KEY) ?? "{}") as Record<string, string>;
    return ids[want] ?? null;
  } catch { return null; }
}

export interface DriftRow { ts: number; dev: number | null }

export function useCellDriftPeriod(sourceId: string, cellNo: number | undefined, period: Period) {
  const assetId = sourceId ? `${sourceId}_bms` : "";
  const pid = cellNo ? cellPointId(cellNo) : null;
  const [startIso, endIso] = periodReadRange(period);
  const tags = assetId && pid ? [makeTag(assetId, pid), makeTag(assetId, P_AVG_MV)] : [];
  const [cellQ, avgQ] = usePointHistories(tags, startIso, endIso);

  const deviation = useMemo(() => {
    const toPts = (d: { t: string; value: number }[] | undefined) =>
      (d ?? []).map((e) => ({ ts: Date.parse(e.t), value: e.value })).filter((p) => Number.isFinite(p.ts));
    const cell = toPts(cellQ?.data), avg = toPts(avgQ?.data);
    if (!cell.length || !avg.length) return [] as { ts: number; value: number }[];
    /* One sample interval of tolerance when pairing, as cellTrend does. */
    const tol = Math.max(cadenceOf(avg) ?? 60_000, 60_000);
    const out: { ts: number; value: number }[] = [];
    for (const p of cell) {
      const a = valueAt(avg, p.ts, tol);
      if (a != null) out.push({ ts: p.ts, value: Math.round((p.value - a) * 10) / 10 });
    }
    return out;
  }, [cellQ?.data, avgQ?.data]);

  const isDay = period.range === "day";
  const day = useMemo<DriftRow[]>(() => (isDay ? deviation.map((p) => ({ ts: p.ts, dev: p.value })) : []), [isDay, deviation]);
  const buckets = useMemo<BucketRow[]>(
    () => (isDay ? [] : withRange(aggregate(deviation, bucketsOf(period), "measure"))),
    [isDay, deviation, period],
  );
  const loading = tags.length > 0 && (!cellQ || cellQ.isLoading || !avgQ || avgQ.isLoading);
  return { day, buckets, loading, traceable: tags.length > 0 };
}
