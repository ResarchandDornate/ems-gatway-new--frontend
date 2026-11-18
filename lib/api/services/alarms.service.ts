/**
 * Alarm Monitoring, from the NorthBound EMS Gateway.
 *
 * Two endpoints, and the difference between them is the whole design:
 *
 *   /api/alarms  the alarm engine's *current* view — what is asserted now.
 *   /api/logs    the event log — what was raised, and when, with severity and
 *                filters and pagination the gateway performs itself.
 *
 * The list and the filters are served from `/api/logs`, because that is the
 * only one of the two that has a time axis: `/api/alarms` is a snapshot with
 * no history and no notion of a date range, and the page's date filters would
 * have had nothing to act on. Statistics come from the same log query, so the
 * counts and the rows on screen can never disagree.
 *
 * THE 149-ALARM PROBLEM. The gateway's alarm engine reports configured
 * protection setpoints alongside genuine asserted states: on the commissioned
 * site it returns 149 "active alarms", of which 148 are limit registers holding
 * their proper values and exactly one is real. An operator opening that screen
 * reads "149, action needed" over a healthy plant. `isAlarmState` in the
 * gateway client is the measured filter for it — it tests both the signal name
 * and the value, because each alone leaks and they leak differently — and the
 * live-alarm path here applies it. That is a client-side guard over a gateway
 * defect; the fix belongs in the alarm engine, which should not be raising a
 * limit register as an active alarm at all.
 */

import { gw, getAlarms, isAlarmState } from "@/lib/gateway";
import type {
  AlarmStatistics, AlarmFilters, PagedData, Alarm, AlarmType, AlarmStatus,
} from "../types";
import { istDate } from "@/lib/api/time";

/**
 * Device-type filter options shown in the Alarm Monitoring toolbar.
 *
 * The gateway's own asset kinds, not a generic list. "UPS" and "Edge
 * Controller" are gone — there is no UPS asset on this build, and the edge
 * controller is the EMS. Dehumidifier and IO Module are new and do raise
 * alarms: the one genuine active alarm on the commissioned site at the time of
 * the September survey was `external_ems_2_dehumidifier.alarm_status`.
 */
export const DEVICE_TYPES = [
  "BMS", "PCS", "EMS", "Utility Meter", "Liquid Cooling",
  "Fire Protection", "Dehumidifier", "IO Module",
];

/* ── Severity and status mapping ──────────────────────────────────────────── */

/**
 * Gateway severity → the three levels the UI renders.
 *
 * The gateway labels events `critical`, `major`, `minor`, `warning`, `info`.
 * Unknown text maps to "inform" rather than to "failure": a severity this
 * build has not seen before is not evidence of a fault, and defaulting the
 * other way would paint every unrecognised event red.
 */
function severityToType(severity: string | undefined): AlarmType {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
    case "fatal":
    case "major":   return "failure";
    case "minor":
    case "warning": return "alarm";
    default:        return "inform";
  }
}

/**
 * Whether a logged event is still asserted.
 *
 * The gateway's log carries `cleared_utc` on rows whose condition has gone
 * away, and acknowledgement is not a concept it has — there is no ack endpoint
 * in the 50-endpoint inventory. So this returns "active" or "resolved" and
 * never "acknowledged". The filter option for it is left in the UI's type
 * because the type is shared; selecting it simply matches nothing, which is
 * true.
 */
function logStatus(row: Record<string, unknown>): AlarmStatus {
  return row.cleared_utc || row.cleared_at ? "resolved" : "active";
}

/** `external_ems_1_liquid_cooling` → `Liquid Cooling`. */
function assetLabel(assetId: string, sourceId: string): string {
  const base = assetId.startsWith(`${sourceId}_`) ? assetId.slice(sourceId.length + 1) : assetId;
  if (!base) return "Unknown";
  /* Acronyms stay upper — "Bms" and "Pcs" read as typos next to the rest of
     the app, which writes them the way the industry does. */
  if (/^(bms|pcs|ems|io)(_|$)/.test(base)) {
    return base.replace(/_/g, " ").replace(/^\w+/, (w) => w.toUpperCase());
  }
  return base.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── The log query ────────────────────────────────────────────────────────── */

interface LogRow {
  id?: string | number;
  event_id?: string | number;
  severity?: string;
  event_type?: string;
  source?: string;
  source_id?: string;
  asset_id?: string;
  signal_name?: string;
  display_name?: string;
  message?: string;
  timestamp_utc?: string;
  event_time?: string;
  time?: string;
  [k: string]: unknown;
}

interface LogResponse {
  rows?: LogRow[];
  items?: LogRow[];
  events?: LogRow[];
  total?: number;
  count?: number;
}

/**
 * Filters the gateway applies itself, rather than after the fact here.
 *
 * `/api/logs` takes severity, event_type, source, asset_id, from_time, to_time,
 * search, limit, offset and order. Pushing them down matters on this board: it
 * answers a bounded query in seconds and an unbounded one in a minute, and the
 * page budget is spent at the Cloudflare edge either way.
 */
function logQuery(filters: AlarmFilters, limit: number, offset: number): string {
  const p = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    order: "desc",
  });
  if (filters.powerStationId) p.set("source", filters.powerStationId);
  if (filters.startTime) p.set("from_time", filters.startTime);
  if (filters.endTime) p.set("to_time", filters.endTime);
  if (filters.deviceName) p.set("search", filters.deviceName);
  return `logs?${p}`;
}

function toAlarm(row: LogRow, index: number): Alarm {
  const sourceId = String(row.source_id ?? row.source ?? "");
  const assetId = String(row.asset_id ?? "");
  const when = String(row.timestamp_utc ?? row.event_time ?? row.time ?? "");
  const label = assetLabel(assetId, sourceId);

  return {
    /* The gateway's own id where it has one. Falling back to a composite of
       time and signal rather than to the row index alone: React keys built
       from an index re-associate every row when a page shifts by one. */
    id: String(row.id ?? row.event_id ?? `${when}-${row.signal_name ?? index}`),
    serial: offsetSerial + index + 1,
    powerStationId: sourceId,
    powerStationName: sourceId,
    deviceName: label,
    deviceType: label,
    device: assetId || label,
    alertContent: String(row.message ?? row.display_name ?? row.signal_name ?? ""),
    /* The protocol signal that raised it. The UI's "alarm code" column was a
       vendor code on UGX; here the signal name is the thing an engineer would
       actually look up in the data dictionary. */
    alarmCode: String(row.signal_name ?? row.event_type ?? ""),
    alarmType: severityToType(row.severity),
    alertTime: when,
    status: logStatus(row),
  };
}

/* Serial numbers are a display nicety and have to continue across pages; the
   list function sets this before mapping. Module scope rather than a parameter
   because `toAlarm` is also used by the live-alarm path below, which has no
   page to speak of. */
let offsetSerial = 0;

async function queryLogs(
  filters: AlarmFilters, limit: number, offset: number,
): Promise<{ rows: LogRow[]; total: number }> {
  const r = await gw<LogResponse>(logQuery(filters, limit, offset), "rows");
  const rows = r.data.rows ?? r.data.items ?? r.data.events ?? [];
  return { rows, total: r.data.total ?? r.data.count ?? rows.length };
}

/* ── Public surface ───────────────────────────────────────────────────────── */

/**
 * Active alarms for one source, right now.
 *
 * Reads `/api/alarms` rather than the log, because the station summary's
 * indicator is about the plant's present state — a fault that was raised and
 * cleared this morning is not something to put a red number on. Setpoint rows
 * are filtered out; without that this returns 149 on a healthy plant.
 *
 * Returns 0 when the endpoint is unavailable. A count of zero is the honest
 * answer when nothing was reported, and this feeds a summary card that must
 * not take the whole page down with it.
 */
export async function fetchTodayAlarmCount(stationId: string): Promise<number> {
  try {
    const r = await getAlarms();
    return r.data.alarms.filter(
      (a) => isAlarmState(a) && (!stationId || a.source_id === stationId),
    ).length;
  } catch {
    return 0;
  }
}

/**
 * Counts by type, over the same query the list uses.
 *
 * Deliberately not `/api/alarms`: that endpoint has no date range, so the
 * header would have counted all-time actives while the table below it showed
 * the week the user selected. One source for both is what keeps them honest.
 */
export async function fetchAlarmStatistics(filters: AlarmFilters = {}): Promise<AlarmStatistics> {
  /* A bounded ceiling, not "all". The log holds ninety days of events and the
     counts feed three small cards; 1,000 is far past the point where a number
     on a card stops being read precisely, and an unbounded query against this
     board is a 100-second edge timeout. */
  const { rows, total } = await queryLogs(filters, 1000, 0);
  const counts: AlarmStatistics = { failure: 0, alarm: 0, inform: 0, total };
  for (const row of rows) {
    const t = severityToType(row.severity);
    if (t === "failure") counts.failure++;
    else if (t === "alarm") counts.alarm++;
    else counts.inform++;
  }
  return counts;
}

/** Paged alarm list. Paged by the gateway, not by slicing an array here. */
export async function fetchAlarms(filters: AlarmFilters = {}): Promise<PagedData<Alarm>> {
  const page = filters.page ?? 1;
  const size = filters.size ?? 20;
  const offset = (page - 1) * size;

  const { rows, total } = await queryLogs(filters, size, offset);

  offsetSerial = offset;
  let records = rows.map(toAlarm);

  /* Filters the gateway has no parameter for, applied after the fact. Only
     these two: everything else in AlarmFilters maps to a query parameter and
     is applied at the source. */
  if (filters.deviceType) {
    records = records.filter((a) => a.deviceType === filters.deviceType);
  }
  if (filters.alarmStatus) {
    records = records.filter((a) => a.status === filters.alarmStatus);
  }

  return {
    records,
    total,
    current: page,
    size,
    pages: Math.max(1, Math.ceil(total / size)),
  };
}

/**
 * The raw log over a range, paged until exhausted or capped.
 *
 * For analysis rather than display: the recurrence screen groups these by
 * asset and signal and needs every event in the window, not a page of them.
 * It goes through `queryLogs` — the same builder the table uses — so the two
 * screens cannot disagree about what the log says, which they would the moment
 * a second query builder grew a different default.
 *
 * `LogRow` is deliberately returned unmapped. `toAlarm` flattens an event into
 * the shape a table row wants and throws away `cleared_utc`, which is exactly
 * what a time-to-clear is computed from.
 */
export async function fetchLogRange(
  filters: AlarmFilters = {},
  maxRows = 3000,
): Promise<{ rows: LogRow[]; total: number; truncated: boolean }> {
  /* 500 a page: large enough that a month of a busy plant is a handful of
     requests, small enough that one slow reply does not spend the whole edge
     budget. */
  const PAGE = 500;
  const out: LogRow[] = [];
  let total = 0;

  for (let offset = 0; offset < maxRows; offset += PAGE) {
    const page = await queryLogs(filters, Math.min(PAGE, maxRows - offset), offset);
    total = page.total;
    out.push(...page.rows);
    /* A short page is the last page. Trusting `total` alone would loop forever
       against a gateway that reports a count it cannot actually serve. */
    if (page.rows.length < PAGE) break;
  }

  return { rows: out, total, truncated: total > out.length };
}

export type { LogRow };

/**
 * Export the filtered log as CSV.
 *
 * The gateway exports it itself at `/api/logs/export.csv` with the same filter
 * parameters as the list, so the file and the screen agree by construction.
 * Fetched rather than opened in a new tab: the export is behind the proxy and
 * needs the bearer token and site header, and a bare `window.open` carries
 * neither — the old implementation opened an unauthenticated URL built from an
 * env var that no longer exists.
 */
export async function exportAlarms(filters: AlarmFilters = {}): Promise<void> {
  const p = new URLSearchParams({ order: "desc" });
  if (filters.powerStationId) p.set("source", filters.powerStationId);
  if (filters.startTime) p.set("from_time", filters.startTime);
  if (filters.endTime) p.set("to_time", filters.endTime);
  if (filters.deviceName) p.set("search", filters.deviceName);

  const r = await gw<unknown>(`logs/export.csv?${p}`);
  /* gw() parses JSON; the CSV arrives as a string in the envelope's place.
     Stringified defensively so a gateway that wraps it in an object still
     downloads something a person can open rather than "[object Object]". */
  const body = typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);

  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `alarms-${istDate()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
