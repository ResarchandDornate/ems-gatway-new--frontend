/**
 * Dashboard readings that exist on the central backend but that no shared
 * reader carries: the energy counters, the subsystem reachability flags, and
 * the S2 series behind the two "recent" curves.
 *
 * Dashboard-only on purpose. useBessLiveCentral is shared with the power-flow
 * twin and the power-station wiring view, and its four energy fields are null
 * there for a reason that is still true of THOSE screens — so rather than
 * change what they read, this file answers the dashboard's own questions.
 *
 * ── The counters, and which side of the inverter they count ────────────────
 *
 *   p0203 / p0204  pcs   ac_cumulative_{charge,discharge}_energy   kWh, lifetime, AC
 *   p1063 / p1064  bms   monthly_cumulative_{charge,discharge}_energy  kWh, this month, DC
 *
 * They are the cabinet's own registers, not the utility meter's, so they read
 * while the meter is silent. Lifetime is AC-side (what crossed the PCS),
 * month-to-date is DC-side (what the BMS saw) — close, not equal, and a screen
 * must not present one as the other.
 *
 * Deliberately NOT read: p1065 / p1066, the yearly counters. They arrive word-
 * swapped — 488,570,880 is 7,455 × 65,536, i.e. 7,455 kWh with its two 16-bit
 * halves in the wrong order (p1067/p1068 Ah show the same pattern). Undoing
 * that here would silently break the day the backend fixes its decode, so they
 * stay off screen until the value is right at the source.
 *
 * ── Reachability ───────────────────────────────────────────────────────────
 *
 * One link flag per System Status device type, keyed by its registry kind
 * (lib/devices/registry: `linkPoint`, `summary`) — today p1146 liquid_cooling,
 * p1354 grid_meter and p1282 dehumidifier. Which of them a cabinet actually
 * HAS is the roster's call (fetchCommStatus), not this file's: a slot with no
 * device behind it still publishes a flag, and it reads 0.
 *
 * The PCS and BMS flags are S1's `pcs_online_status` / `bms_online_status`
 * (registry `fastLink`) and are read off the window below, not here.
 *
 * A flag is only believed while its row is fresh. The gateway keeps reporting
 * `quality: good` for a device that stopped talking, so the timestamp is the
 * one thing here that can tell a current "1" from the last word of a device
 * that has since gone quiet.
 */

import {
  fetchFastBess, fetchPowerSocRange, fetchGeneral, fetchController, fetchHistory, socByBess, wordSwapped, FAST_BESS_MAX_LIMIT, CONTROLLER_MAX_LIMIT,
  type FastBessSample, type GeneralRecord, type ControllerRecord,
} from "@/lib/central";
import { istMidnight } from "@/lib/api/time";
import { DEVICE_TYPES, SUMMARY_TYPES } from "@/lib/devices/registry";

/** Older than this and a status row says nothing about now. */
export const STATUS_FRESH_MS = 15 * 60_000;

const POINTS = {
  acCharge: "p0203",
  acDischarge: "p0204",
  /* Lifetime, PCS DC side. The lifetime figures read these: the AC pair is
     inconsistent on this site (13 Oct 2026: cabinet 1 AC discharge 8,202 >
     AC charge 7,208, and on both cabinets AC discharge > DC discharge, which
     inverter losses rule out); the DC pair holds at ~93% round trip. The AC
     pair's day-to-day rises still track SOC and stay the basis for periods. */
  dcCharge: "p0205",
  dcDischarge: "p0206",
  monthCharge: "p1063",
  monthDischarge: "p1064",
  /* Year to date, BMS DC. Word-swapped on the wire (lib/central/decode). */
  yearCharge: "p1065",
  yearDischarge: "p1066",
} as const;
type PointKey = keyof typeof POINTS;

/** One cabinet's counters and flags. Every field is null when unknown. */
export interface CabinetReadings {
  sourceId: string;
  acChargeKwh: number | null;
  acDischargeKwh: number | null;
  /** Lifetime, DC — what lifetime totals show. */
  dcChargeKwh: number | null;
  dcDischargeKwh: number | null;
  monthChargeKwh: number | null;
  monthDischargeKwh: number | null;
  yearChargeKwh: number | null;
  yearDischargeKwh: number | null;
  /** Per device kind: its link flag, and when the device last reported (epoch ms). */
  links: Record<string, DeviceLink>;
}

export interface DeviceLink {
  online: boolean | null;
  at: number | null;
}

/** The System Status devices whose link is an S2 point (S1-flagged ones are not read here). */
const LINKED = SUMMARY_TYPES.filter((t) => t.linkPoint && !t.fastLink);

const ASSET_SUFFIX = new RegExp(`_(${DEVICE_TYPES.map((t) => t.kind).join("|")})$`);

/** The EMS controller an asset belongs to. The raw record says so directly;
 *  the asset id's prefix is the fallback. */
function sourceOf(r: GeneralRecord): string | null {
  const s = r.data?.source_id;
  if (typeof s === "string" && s) return s;
  return r.asset_id ? r.asset_id.replace(ASSET_SUFFIX, "") : null;
}

function blank(sourceId: string): CabinetReadings {
  return {
    sourceId,
    acChargeKwh: null, acDischargeKwh: null,
    dcChargeKwh: null, dcDischargeKwh: null,
    monthChargeKwh: null, monthDischargeKwh: null,
    yearChargeKwh: null, yearDischargeKwh: null,
    links: {},
  };
}

/** A counter: finite and non-negative, or unknown. */
function counter(r: GeneralRecord | undefined): number | null {
  if (!r || r.value == null) return null;
  const n = Number(r.value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A 1/0 flag, as last reported — however old. A stale flag is still the last
 * thing the device said; the screen dates it (see SystemStatus) rather than
 * blanking it, so an operator can see what the plant looked like when it went
 * quiet.
 */
const tsOf = (r: GeneralRecord): number | null => {
  const t = Date.parse(r.sample_time_utc ?? "");
  return Number.isNaN(t) ? null : t;
};

function flag(r: GeneralRecord | undefined, _now: number): boolean | null {
  if (!r || r.value == null) return null;
  const n = Number(r.value);
  return n === 1 ? true : n === 0 ? false : null;
}

/**
 * Newest reading of each point, per cabinet.
 *
 * One point_id query each: unfiltered S2 spans seven seconds and is not
 * guaranteed to contain a slow register at all, whereas a point query returns
 * its recent rows for both cabinets interleaved. 20 rows is ten per cabinet —
 * the newest per asset is all this needs.
 */
export async function fetchCabinetReadings(gatewayId: string): Promise<Record<string, CabinetReadings>> {
  const keys = Object.keys(POINTS) as PointKey[];
  /* A device's capture time is its newest reading of any kind, not of its
     online bit: on 13 Oct the liquid-cooling online point stopped at 13:44
     while the unit's other readings kept arriving. */
  const [results, linkRows, deviceRows] = await Promise.all([
    Promise.all(keys.map((k) =>
      fetchGeneral(gatewayId, { pointId: POINTS[k], limit: 20 }).catch(() => [] as GeneralRecord[]))),
    Promise.all(LINKED.map((t) =>
      fetchGeneral(gatewayId, { pointId: t.linkPoint, limit: 20 }).catch(() => [] as GeneralRecord[]))),
    Promise.all(LINKED.map((t) =>
      fetchGeneral(gatewayId, { substream: t.substream, limit: 60 }).catch(() => [] as GeneralRecord[]))),
  ]);

  const now = Date.now();
  const out: Record<string, CabinetReadings> = {};
  keys.forEach((k, i) => {
    const newest = new Map<string, GeneralRecord>();
    for (const r of results[i]) {
      const src = sourceOf(r);
      if (src && !newest.has(src)) newest.set(src, r);
    }
    for (const [src, r] of newest) {
      const c = (out[src] ??= blank(src));
      switch (k) {
        case "acCharge":       c.acChargeKwh = counter(r); break;
        case "acDischarge":    c.acDischargeKwh = counter(r); break;
        case "dcCharge":       c.dcChargeKwh = counter(r); break;
        case "dcDischarge":    c.dcDischargeKwh = counter(r); break;
        case "monthCharge":    c.monthChargeKwh = counter(r); break;
        case "monthDischarge": c.monthDischargeKwh = counter(r); break;
        case "yearCharge":     c.yearChargeKwh = wordSwapped(counter(r)); break;
        case "yearDischarge":  c.yearDischargeKwh = wordSwapped(counter(r)); break;
      }
    }
  });
  LINKED.forEach(({ kind }, i) => {
    const link = (src: string) => ((out[src] ??= blank(src)).links[kind] ??= { online: null, at: null });
    const seen = new Set<string>();
    for (const r of linkRows[i]) {
      const src = sourceOf(r);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      link(src).online = flag(r, now);
    }
    for (const r of deviceRows[i]) {
      const src = sourceOf(r), t = tsOf(r);
      if (!src || t == null) continue;
      const l = link(src);
      if (l.at == null || t > l.at) l.at = t;
    }
  });
  return out;
}

/**
 * Sum one field over the given cabinets — or null if ANY of them is unknown.
 * A site total assembled from one of two cabinets is not a smaller total, it
 * is a wrong one.
 */
export function sumOver(
  readings: Record<string, CabinetReadings> | undefined,
  sourceIds: string[],
  pick: (c: CabinetReadings) => number | null,
): number | null {
  if (!readings || sourceIds.length === 0) return null;
  let total = 0;
  for (const id of sourceIds) {
    const v = readings[id] ? pick(readings[id]) : null;
    if (v == null) return null;
    total += v;
  }
  return total;
}

/**
 * All-of for a status flag across cabinets: offline if any is offline, online
 * only if every one is, unknown otherwise.
 */
export function allOnline(flags: (boolean | null)[]): boolean | null {
  if (flags.length === 0) return null;
  if (flags.some((f) => f === false)) return false;
  if (flags.every((f) => f === true)) return true;
  return null;
}

/**
 * The newest S1 samples per cabinet — for the PCS/BMS online flags only.
 *
 * This used to pull the endpoint's full 1,000 samples a cabinet (~3 MB a
 * minute) because it also fed the two "recent" curves. Those now come from S2
 * (fetchS2Recent below), and a flag needs only the newest sample.
 */
export async function fetchS1Windows(
  gatewayId: string,
  bessIds: string[],
): Promise<Record<string, FastBessSample[]>> {
  const rows = await Promise.all(
    bessIds.map((b) =>
      fetchFastBess(gatewayId, { bessId: b, limit: 5 }).catch(() => [] as FastBessSample[]),
    ),
  );
  const out: Record<string, FastBessSample[]> = {};
  bessIds.forEach((b, i) => { out[b] = rows[i]; });
  return out;
}

/* ── The "recent" curves ──────────────────────────────────────────────────── */

/**
 * SOC and battery power over the widest window the API reaches.
 *
 * Every read answers only the newest 1,000 rows, so how far back a curve goes
 * depends on how often its signal is published. S1 is 1 Hz: 1,000 samples is
 * ~17 minutes. These two S2 points publish every ~11 s, and a point read
 * carries both cabinets, so 1,000 rows is ~500 each — about an hour and a half.
 * Checked against S1 on 28 September 2026:
 *
 *   p0041  ems_system  soc                    equals S1 bms display_soc exactly
 *   p0075  ems_system  energy_storage_power   equals pcs dc_power (DC side);
 *                                             same sign as S1 (− = charging)
 *
 * There is no S2 point for total AC power — only three per-phase ones, which
 * publish every ~6 s and so reach ~50 minutes. p0075 is the DC-side figure and
 * runs about the inverter's losses away from S1's AC total; the chart says so.
 */
export const P_RECENT_SOC = "p0041";
export const P_RECENT_POWER = "p0075";

export interface S2Point { ts: number; value: number }
export interface S2RecentSeries {
  soc: S2Point[];
  power: S2Point[];
  /** SOC points that came from the SOC controller, filling stretches S1 left empty. */
  socFilled?: number;
}

/**
 * Today's SOC and power per cabinet from the fast stream (S1), local midnight
 * to now — the same shape as fetchS2Recent, so the charts take either.
 *
 * S1 takes from_time/to_time; S2 does not, and on 1 Oct ran about an hour
 * behind S1. Power here is PCS AC (`total_active_power`), SOC `display_soc`
 * (equal to S2's p0041). Keyed by source id.
 */
export async function fetchS1Today(
  gatewayId: string,
  cabinets: { bessId: string; sourceId: string }[],
): Promise<Record<string, S2RecentSeries>> {
  const start = istMidnight();
  const now = Date.now();
  const out: Record<string, S2RecentSeries> = {};
  const [, controller, storedController] = await Promise.all([
    Promise.all(cabinets.map(async ({ bessId, sourceId }) => {
      const { points } = await fetchPowerSocRange(gatewayId, { bessId, fromMs: start, toMs: now })
        .catch(() => ({ points: [] }));
      const soc: S2Point[] = [], power: S2Point[] = [];
      for (const p of points) {                   // oldest first
        if (p.soc != null) soc.push({ ts: p.ts, value: p.soc });
        if (p.power != null) power.push({ ts: p.ts, value: p.power });
      }
      out[sourceId] = { soc, power };
    })),
    fetchController(gatewayId, { limit: CONTROLLER_MAX_LIMIT }).catch(() => [] as ControllerRecord[]),
    /* The live read reaches ~8 h back; the collector's store reaches midnight. */
    fetchHistory<ControllerRecord>("controller", { fromMs: start, shape: "soc" }),
  ]);

  /* SOC where S1 is silent, from the SOC controller. The gateway back-fills
     the controller's reports after an outage and nothing else (8 Oct 2026:
     S1 empty 00:00–10:35 IST, the controller ~1 report/min throughout), so
     the day's SOC curve need not have a hole the controller can fill. Power
     has no such source and keeps its gap. */
  const s1Soc = Object.fromEntries(cabinets.map((c) => [c.bessId, out[c.sourceId]?.soc ?? []]));
  const liveTs = new Set(controller.map((r) => r.sample_time_utc));
  const merged = [...controller, ...storedController.filter((r) => !liveTs.has(r.sample_time_utc))];
  const fill = socByBess(merged.filter((r) => Date.parse(r.sample_time_utc) >= start), s1Soc);
  for (const { bessId, sourceId } of cabinets) {
    const s = out[sourceId];
    const extra = (fill[bessId] ?? []).filter((p) => !s.soc.some((q) => Math.abs(q.ts - p.ts) < FILL_CLEARANCE_MS));
    if (!extra.length) continue;
    s.soc = [...s.soc, ...extra].sort((a, b) => a.ts - b.ts);
    s.socFilled = extra.length;
  }
  return out;
}

/* A controller report this close to an S1 reading adds nothing. */
const FILL_CLEARANCE_MS = 2 * 60_000;

export async function fetchS2Recent(
  gatewayId: string,
  sourceIds: string[],
): Promise<Record<string, S2RecentSeries>> {
  const [soc, power] = await Promise.all(
    [P_RECENT_SOC, P_RECENT_POWER].map((pointId) =>
      fetchGeneral(gatewayId, { pointId, limit: FAST_BESS_MAX_LIMIT }).catch(() => [] as GeneralRecord[]),
    ),
  );
  const series = (rows: GeneralRecord[], sourceId: string): S2Point[] =>
    rows
      .filter((r) => r.asset_id === `${sourceId}_ems_system` && (!r.quality || r.quality === "good"))
      .map((r) => ({ ts: Date.parse(r.sample_time_utc ?? ""), value: Number(r.value) }))
      .filter((p) => !Number.isNaN(p.ts) && Number.isFinite(p.value))
      .sort((a, b) => a.ts - b.ts);

  const out: Record<string, S2RecentSeries> = {};
  for (const id of sourceIds) out[id] = { soc: series(soc, id), power: series(power, id) };
  return out;
}
