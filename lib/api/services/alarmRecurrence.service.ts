/**
 * Alarm recurrence — what the log says that a list of events cannot.
 *
 * ── The problem with a log ────────────────────────────────────────────────
 * An event list answers "what happened", newest first, one row at a time. It
 * is the right shape for responding to something now and the wrong shape for
 * every question worth asking about a plant that has been running for months:
 *
 *   Is this the fourth time this week or the fortieth?
 *   Is it getting worse?
 *   Does it always happen at the same time of day?
 *   How long does it take to clear, and is that changing?
 *
 * None of those are visible in a list. All of them are in the same rows.
 *
 * ── The distinction that matters most ────────────────────────────────────
 * Whether an alarm is driven by the CLOCK or by chance.
 *
 * An event that lands within the same hour nearly every day is not a fault
 * arriving repeatedly — it is a consequence of what the plant is scheduled to
 * do at that hour. Coolant temperature high at 18:40 every evening is the
 * dispatch schedule putting the pack at full discharge, not a cooling system
 * failing sixty times. The remedy is the schedule, or the threshold, and it is
 * emphatically not a site visit.
 *
 * An event that arrives at random hours and is getting more frequent is the
 * opposite: no external cause to point at, and a rate that is going the wrong
 * way. That is the one worth a visit, and it is usually far down a list sorted
 * by time because it is not the loudest.
 *
 * So each group gets a `pattern`, and the ordering on screen is by what the
 * pattern implies rather than by count. Ranking on count alone would put the
 * scheduler's own slot-change notices at the top of every plant in the fleet.
 *
 * ── One source ──────────────────────────────────────────────────────────
 * Rows come through `fetchLogRange`, which is the same query builder the alarm
 * table uses. `/api/logs/summary` exists and would roll up by severity and
 * asset server-side, but it cannot group by SIGNAL, which is the grain a
 * recurrence is counted at — and a second source would be a second answer to
 * "how many times did this fire".
 */

import { fetchLogRange, type LogRow } from "./alarms.service";
import { fetchAlarmEvents, episodes, ALARMS_MAX_LIMIT } from "@/lib/central";
import type { AlarmFilters } from "../types";
import { istDate, istHour, istMidnight } from "@/lib/api/time";
import { kindLabel, readableAlarm } from "./alarmsCentral.service";

/* ── Shape ────────────────────────────────────────────────────────────────── */

export type AlarmPattern =
  | "one-off"
  | "accelerating"
  | "scheduled"
  | "fading"
  | "steady";

export interface AlarmGroup {
  /**
   * Asset KIND + signal — the grain a recurrence is counted at.
   *
   * Kind, not instance. A site with two cabinets has two dehumidifiers, and
   * grouping by the runtime asset id put each one in its own bucket — which
   * halves every sample the rate test runs on. Measured on this plant: a
   * humidity alarm genuinely rising sixfold across the window scored 2.8σ when
   * the two cabinets were pooled and 0.9σ when they were not, so the screen
   * reported nothing wrong with a fault that was plainly getting worse.
   *
   * Pooling is also the better question. "The dehumidifiers are failing more
   * often" is a fault mode; "dehumidifier 1 fired thirteen times" is a tally.
   * `bySource` below keeps the breakdown, so a problem confined to one cabinet
   * is still visible.
   */
  key: string;
  assetBase: string;
  assetLabel: string;
  /** Occurrences per source, so a one-cabinet problem is not hidden by pooling. */
  bySource: Record<string, number>;
  signal: string;
  label: string;
  severity: string;
  count: number;
  firstTs: number;
  lastTs: number;
  /** Distinct local days it fired on. */
  daysSeen: number;
  /** Occurrences that had not cleared when the log was read. */
  openCount: number;
  /** Minutes to clear, over the occurrences that did. */
  medianClearMin: number | null;
  /** Local-hour histogram, 24 bins. */
  byHour: number[];
  /** Counts per local day across the window, oldest first. */
  byDay: number[];
  /**
   * Share of occurrences falling in the tightest two-hour window, 0–1, and
   * where that window starts. Two hours rather than one because an event that
   * straddles the top of the hour would otherwise look half as concentrated as
   * it is.
   */
  clustering: number;
  clusterStartHour: number;
  /** Occurrences per day, first half of the window against second half. */
  rateEarly: number;
  rateLate: number;
  /** Raw counts behind those rates — what the test is actually run on. */
  countEarly: number;
  countLate: number;
  /**
   * How far the split sits from even, in standard deviations. Positive is
   * worsening. Carried so the screen can show the strength of the evidence
   * rather than only the verdict.
   */
  rateZ: number;
  pattern: AlarmPattern;
}

export interface AlarmRecurrence {
  window: { fromTs: number; toTs: number; days: number } | null;
  /** Local day keys across the window, oldest first. Indexes `byDay`. */
  dayKeys: string[];
  groups: AlarmGroup[];
  totalEvents: number;
  /** True when the log had more rows than were read. */
  truncated: boolean;
}

const EMPTY: AlarmRecurrence = {
  window: null, dayKeys: [], groups: [], totalEvents: 0, truncated: false,
};

/** A group needs this many occurrences before a pattern is worth asserting. */
const MIN_FOR_PATTERN = 4;
/** Share of occurrences inside two hours that counts as clock-driven. */
const CLUSTER_THRESHOLD = 0.55;

/**
 * How far the split between the window's two halves must sit from even.
 *
 * This was a bare ratio — second half more than 1.6× the first — and a ratio
 * is not a test. On twenty events split ten and ten, Poisson noise alone moves
 * that ratio by a third, so the threshold fired on quiet alarms and stayed
 * silent on a seeded fault that really was tripling. Both failures in the same
 * screen, and both invisible without knowing the answer in advance.
 *
 * Under a constant rate over two equal periods, each event is a coin flip for
 * which half it lands in: n_late ~ Binomial(n_total, ½). So the standardised
 * departure from even is
 *
 *     z = (n_late − n_early) / √(n_late + n_early)
 *
 * which is the ordinary two-Poisson comparison and needs no rate estimate at
 * all. 1.64 is the one-sided 95% point. One-sided because an alarm becoming
 * rarer and an alarm becoming commoner are not the same question, and this
 * screen is triage rather than a publication: the cost of looking at a calm
 * alarm is a glance, and the cost of missing a worsening one is a callout.
 */
const RATE_Z = 1.64;

/** `external_ems_1_liquid_cooling` → `liquid_cooling`. */
function assetBaseOf(assetId: string, sourceId: string): string {
  if (sourceId && assetId.startsWith(`${sourceId}_`)) return assetId.slice(sourceId.length + 1);
  /* Falls back to the documented source prefix when the row named no source —
     the gateway's ids are `external_ems_N_<base>` throughout. */
  return assetId.replace(/^external_ems_\d+_/, "");
}

/** `liquid_cooling` → `Liquid Cooling` — the same names the alarm list uses. */
function assetLabel(base: string): string {
  return base ? kindLabel(base) : "Unknown";
}

/* IST day — the site's, whatever zone the browser is in. */
function localDayKey(ms: number): string {
  return istDate(ms);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  /* Median, not mean: one event that stayed open over a weekend would drag a
     mean time-to-clear into uselessness, and that event is not typical of
     anything. */
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

/**
 * Tightest two-hour window on the clock, and what share of events it holds.
 *
 * Circular, so an event cluster spanning midnight is found rather than split
 * across the ends of the array.
 */
function clusterOf(byHour: number[], total: number): { share: number; startHour: number } {
  if (!total) return { share: 0, startHour: 0 };
  let best = -1, bestAt = 0;
  for (let h = 0; h < 24; h++) {
    const n = byHour[h] + byHour[(h + 1) % 24];
    if (n > best) { best = n; bestAt = h; }
  }
  return { share: best / total, startHour: bestAt };
}

/** Standardised departure from an even split between the window's halves. */
export function rateZ(early: number, late: number): number {
  const n = early + late;
  return n > 0 ? (late - early) / Math.sqrt(n) : 0;
}

function classify(g: Omit<AlarmGroup, "pattern">): AlarmPattern {
  if (g.count < MIN_FOR_PATTERN) return "one-off";

  /* Acceleration is tested BEFORE clustering, and the order is a judgement
     rather than an accident. A duty-driven alarm that is also becoming more
     frequent is no longer explained by the duty — the plant is running the
     same schedule it ran last month — so the rate is the finding and the hour
     is context. Reporting it as merely "scheduled" would file a worsening
     fault under "expected". */
  if (g.rateZ >= RATE_Z) return "accelerating";
  if (g.clustering >= CLUSTER_THRESHOLD && g.daysSeen >= 3) return "scheduled";
  if (g.rateZ <= -RATE_Z) return "fading";
  return "steady";
}

/* ── Ordering ──────────────────────────────────────────────────────────────
   A score rather than a sort on pattern then severity, because that ordering
   had a specific and bad failure: a single CRITICAL fire-panel comms loss sank
   below every one of the scheduler's own routine slot-change notices, because
   "one-off" outranks nothing and "scheduled" outranks it. A one-off critical
   is exactly the row somebody needs to see.

   The weights say what the screen is for. A worsening alarm beats a steady
   one; a steady fault beats an event that happened once; and an alarm already
   explained by the clock comes last however often it fires, because its
   frequency is a property of the schedule rather than of the plant. Severity
   is additive so it can lift a rare but serious event over a frequent trivial
   one without ever lifting a scheduled notice over a worsening fault. */
const PATTERN_SCORE: Record<AlarmPattern, number> = {
  accelerating: 100,
  steady: 60,
  fading: 40,
  "one-off": 20,
  scheduled: 10,
};

const SEVERITY_SCORE: Record<string, number> = {
  critical: 25, fatal: 25, major: 15, minor: 6, warning: 4, info: 0,
};

/** Where a group sits on the screen. Higher is more worth looking at. */
export function attentionScore(g: Pick<AlarmGroup, "pattern" | "severity">): number {
  return PATTERN_SCORE[g.pattern] + (SEVERITY_SCORE[g.severity] ?? 0);
}

/**
 * Group the log into recurring alarms.
 *
 * @param filters Passed to the same query the alarm table uses. `startTime`
 *                and `endTime` bound the window; without them the gateway's
 *                own default range applies and the window is read back off the
 *                rows rather than assumed.
 */
export async function fetchAlarmRecurrence(
  filters: AlarmFilters = {},
  maxRows = 3000,
): Promise<AlarmRecurrence> {
  const { rows, truncated } = await fetchLogRange(filters, maxRows);
  return buildRecurrence(rows, truncated);
}

/**
 * The same analysis over the central backend's S4 alarm log.
 *
 * S4 stores each alarm as ACTIVE and CLEARED rows. `episodes` reads each
 * alarm's rows in time order — a raise starts an occurrence, a clear ends it
 * — and each becomes one LogRow with its raise and clear times, the shape the
 * analysis below was written against. `still_open` is false for a raise that
 * was re-raised with no clear logged: it is over, not open. (This pairing was
 * by correlation_id, which the log does not keep reliably, so such raises
 * counted as open for good and disagreed with the Active alarms tab.)
 *
 * Severity is translated onto this file's scale — High → critical, Medium →
 * major, Warning → warning, Low → minor — so attentionScore ranks it as it
 * ranked the old log. "Warning" is what the live dehumidifier events carry
 * (6 Oct 2026); it was falling through to info.
 */
const S4_SEVERITY: Record<string, string> = { critical: "critical", high: "critical", medium: "major", warning: "warning", low: "minor" };

/** @param sourceIds the cabinets the unit picker has selected; omitted = all. */
export async function fetchAlarmRecurrenceCentral(gatewayId: string, sourceIds?: string[]): Promise<AlarmRecurrence> {
  if (!gatewayId) return EMPTY;
  const events = await fetchAlarmEvents(gatewayId, { limit: ALARMS_MAX_LIMIT });
  const rows: LogRow[] = episodes(events)
    .filter((o) => !sourceIds?.length || (o.event.source_id != null && sourceIds.includes(o.event.source_id)))
    .map(({ event: e, raisedTs, clearedTs, open }) => ({
      timestamp_utc: new Date(raisedTs).toISOString(),
      cleared_utc: clearedTs != null ? new Date(clearedTs).toISOString() : undefined,
      still_open: open,
      source_id: e.source_id ?? undefined,
      asset_id: e.asset_id ?? undefined,
      signal_name: e.signal_name ?? e.event_type ?? undefined,
      /* Readable text ("Alarm Status"), not the log's raw message; the kind
         stands in for the asset when the event names none. */
      display_name: readableAlarm(e).content,
      asset_kind: readableAlarm(e).kind.toLowerCase().replace(/\s+/g, "_") || undefined,
      severity: S4_SEVERITY[(e.severity ?? "").toLowerCase()] ?? "info",
    }) as LogRow);
  /* 1,000 rows is the endpoint's cap; a full read may not reach the start. */
  return buildRecurrence(rows, events.length >= ALARMS_MAX_LIMIT);
}

function buildRecurrence(rows: LogRow[], truncated: boolean): AlarmRecurrence {
  if (!rows.length) return EMPTY;

  const at = (r: LogRow): number | null => {
    const raw = r.timestamp_utc ?? r.event_time ?? r.time;
    if (typeof raw !== "string" || !raw) return null;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  };

  /* The window is measured from the rows, never from the filter. A range the
     gateway had no events for would otherwise be reported as a quiet month
     when it was in fact a month the log does not reach back to. */
  let fromTs = Infinity, toTs = -Infinity;
  for (const r of rows) {
    const t = at(r);
    if (t == null) continue;
    if (t < fromTs) fromTs = t;
    if (t > toTs) toTs = t;
  }
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return EMPTY;

  /* Every IST calendar day the window touches, first to last — stepped from
     the first day's IST midnight, so a window from 13:00 on day one to 10:00
     on day three is three days, as the per-alarm day counts are. Stepping
     from the first event's own time stopped short of the last day. */
  const dayKeys: string[] = [];
  for (let d = istMidnight(fromTs) + 12 * 3_600_000; d <= istMidnight(toTs) + 12 * 3_600_000; d += 86_400_000) {
    dayKeys.push(localDayKey(d));
  }
  if (!dayKeys.length) dayKeys.push(localDayKey(fromTs));
  const dayIndex = new Map(dayKeys.map((k, i) => [k, i]));
  const windowDays = dayKeys.length;
  const midTs = fromTs + (toTs - fromTs) / 2;

  interface Acc {
    assetBase: string; signal: string; label: string; severity: string;
    bySource: Record<string, number>;
    times: number[]; clears: number[]; open: number;
    byHour: number[]; byDay: number[]; days: Set<string>;
    early: number; late: number;
  }
  const acc = new Map<string, Acc>();

  for (const r of rows) {
    const ts = at(r);
    if (ts == null) continue;
    const sourceId = String(r.source_id ?? r.source ?? "");
    const assetId = String(r.asset_id ?? "");
    const signal = String(r.signal_name ?? r.event_type ?? "");
    if (!signal && !assetId) continue;

    const assetBase = assetBaseOf(assetId, sourceId) || String(r.asset_kind ?? "");
    const key = `${assetBase}::${signal}`;
    let a = acc.get(key);
    if (!a) {
      a = {
        assetBase, signal,
        label: String(r.display_name ?? r.message ?? signal),
        severity: String(r.severity ?? "info").toLowerCase(),
        bySource: {},
        times: [], clears: [], open: 0,
        byHour: new Array(24).fill(0), byDay: new Array(windowDays).fill(0),
        days: new Set(), early: 0, late: 0,
      };
      acc.set(key, a);
    }
    if (sourceId) a.bySource[sourceId] = (a.bySource[sourceId] ?? 0) + 1;

    a.times.push(ts);
    a.byHour[istHour(ts)] += 1;
    const dk = localDayKey(ts);
    a.days.add(dk);
    const di = dayIndex.get(dk);
    if (di != null) a.byDay[di] += 1;
    if (ts < midTs) a.early += 1; else a.late += 1;

    const clearedRaw = r.cleared_utc ?? r.cleared_at;
    const cleared = typeof clearedRaw === "string" ? Date.parse(clearedRaw) : NaN;
    if (Number.isFinite(cleared) && cleared > ts) a.clears.push((cleared - ts) / 60_000);
    /* No clear: open, unless the row says it ended unlogged (S4 re-raise). */
    else if (r.still_open !== false) a.open += 1;
  }

  const halfDays = Math.max(1, windowDays / 2);

  const groups: AlarmGroup[] = [...acc.entries()].map(([key, a]) => {
    const count = a.times.length;
    const cluster = clusterOf(a.byHour, count);
    const base: Omit<AlarmGroup, "pattern"> = {
      key,
      assetBase: a.assetBase,
      assetLabel: assetLabel(a.assetBase),
      bySource: a.bySource,
      signal: a.signal,
      label: a.label,
      severity: a.severity,
      count,
      firstTs: Math.min(...a.times),
      lastTs: Math.max(...a.times),
      daysSeen: a.days.size,
      openCount: a.open,
      medianClearMin: median(a.clears),
      byHour: a.byHour,
      byDay: a.byDay,
      clustering: Math.round(cluster.share * 100) / 100,
      clusterStartHour: cluster.startHour,
      rateEarly: Math.round((a.early / halfDays) * 100) / 100,
      rateLate: Math.round((a.late / halfDays) * 100) / 100,
      countEarly: a.early,
      countLate: a.late,
      rateZ: Math.round(rateZ(a.early, a.late) * 100) / 100,
    };
    return { ...base, pattern: classify(base) };
  });

  /* Sorting on count alone would put the scheduler's own slot-change notices —
     the highest volume and the least meaning — at the top of every plant in
     the fleet. See attentionScore. */
  groups.sort((x, y) => attentionScore(y) - attentionScore(x) || y.count - x.count);

  return {
    window: { fromTs, toTs, days: windowDays },
    dayKeys,
    groups,
    totalEvents: rows.length,
    truncated,
  };
}
