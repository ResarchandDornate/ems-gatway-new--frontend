/**
 * S4 alarm events, off the central backend.
 *
 *   GET /gateways/{id}/alarms?limit=&severity=&state=&asset_id=
 *
 * The first alarm LOG this backend has published. Until it landed, the Alarms
 * page could only say which fault flags were raised right now (S1/S2, see
 * alarmsCentral.service) — never when one was raised, when it cleared, or how
 * often it comes back. S4 answers all three.
 *
 * ── An alarm is two rows ───────────────────────────────────────────────────
 *
 * Each transition is its own row, newest first: one ACTIVE when the alarm is
 * raised, one CLEARED when it goes away, joined by `correlation_id`. So an
 * occurrence is a pair, and one still open has only its ACTIVE row. Counting
 * rows would count every alarm twice; `occurrences()` below pairs them.
 *
 * `dedupe_key` names the alarm itself (source:asset:signal) across
 * occurrences, and is what recurrence counts by.
 *
 * ── Empty is not the same as unavailable ───────────────────────────────────
 *
 * Checked 28 September 2026: the route is deployed and answers 200 [] for this
 * gateway — no event of any state or severity has been recorded yet. That is a
 * backend with nothing logged, and screens say so in those words rather than
 * implying the site has had no alarms.
 */

import { getSession } from "./session";
import { centralUrl } from "./serverScope";
import { CentralReadError } from "./gateways";
import { fetchHistory, mergeRows } from "./history";

export const ALARMS_MAX_LIMIT = 1000;

/* "Warning" also arrives (dehumidifier, 6 Oct 2026); the filter takes these three. */
export type AlarmSeverity = "High" | "Medium" | "Low";
export type AlarmState = "ACTIVE" | "CLEARED";

/** `AlarmEventRecord`: everything but the two timestamps and `data` is nullable. */
export interface AlarmEvent {
  event_id: string | null;
  correlation_id: string | null;
  source_id: string | null;
  asset_id: string | null;
  signal_name: string | null;
  event_type: string | null;
  severity: string | null;
  state: string | null;
  message: string | null;
  dedupe_key: string | null;
  occurrence_count: number | null;
  event_time_utc: string;
  /**
   * When the alarm cleared (Oct 2026 reference). Set on clear; absent on rows
   * from before it was promoted, where a CLEARED row's event time stands in.
   */
  cleared_at_utc?: string | null;
  received_at_utc: string;
  data: Record<string, unknown>;
}

export async function fetchAlarmEvents(
  gatewayId: string,
  opts: { limit?: number; severity?: AlarmSeverity; state?: AlarmState; assetId?: string } = {},
): Promise<AlarmEvent[]> {
  const s = getSession();
  if (!s) throw new CentralReadError("Not signed in");

  const limit = Math.max(1, Math.min(opts.limit ?? ALARMS_MAX_LIMIT, ALARMS_MAX_LIMIT));
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.severity) qs.set("severity", opts.severity);
  if (opts.state) qs.set("state", opts.state);
  if (opts.assetId) qs.set("asset_id", opts.assetId);

  const r = await fetch(
    centralUrl(`/api/central/gateways/${encodeURIComponent(gatewayId)}/alarms?${qs}`),
    { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" },
  );
  if (r.status === 422) throw new CentralReadError("Gateway id or filter rejected by the backend", 422);
  if (!r.ok) throw new CentralReadError(`Central backend answered ${r.status}`, r.status);

  const body: unknown = await r.json();
  /* Newest first by event time. A gateway that was offline uploads its alarm
     backlog on reconnect, so arrival order is not event order — and
     occurrences() keeps the first ACTIVE/CLEARED it sees per correlation_id. */
  const live = Array.isArray(body) ? (body as AlarmEvent[]) : [];
  /* A full, unfiltered read also takes the server's stored log (the
     collector), so history reaches past the backend's newest 1,000 events. */
  const stored = limit >= ALARMS_MAX_LIMIT && !opts.severity && !opts.state && !opts.assetId
    ? await fetchHistory<AlarmEvent>("alarms", { fromMs: Date.now() - 31 * 86_400_000 })
    : [];
  return mergeRows(live, stored,
    (e) => e.event_id ?? `${e.dedupe_key}|${e.state}|${e.event_time_utc}`,
    (e) => ms(e.event_time_utc) ?? 0);
}

/* ── Occurrences ──────────────────────────────────────────────────────────── */

/** One raised-and-maybe-cleared alarm, built from its ACTIVE/CLEARED pair. */
export interface AlarmOccurrence {
  /** The ACTIVE row — or the CLEARED row alone, if the raise fell outside the read. */
  event: AlarmEvent;
  /** Epoch ms raised, or null when only the clear was read. */
  raisedTs: number | null;
  /** Epoch ms cleared, or null while still active. */
  clearedTs: number | null;
}

const ms = (iso: string | null | undefined): number | null => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? null : t;
};

const isCleared = (e: AlarmEvent) => (e.state ?? "").toUpperCase() === "CLEARED";

/** When this row says the alarm cleared: cleared_at_utc, else a CLEARED row's own time. */
const clearedAt = (e: AlarmEvent): number | null =>
  ms(e.cleared_at_utc) ?? (isCleared(e) ? ms(e.event_time_utc) : null);

/**
 * Pair ACTIVE and CLEARED rows by correlation_id.
 *
 * A row without a correlation_id cannot be paired and stands alone. A CLEARED
 * row whose ACTIVE is older than the 1,000 rows read is kept with a null
 * raise time rather than dropped — it still says the alarm happened.
 */
export function occurrences(events: AlarmEvent[]): AlarmOccurrence[] {
  const byCorr = new Map<string, { active?: AlarmEvent; cleared?: AlarmEvent }>();
  const loose: AlarmOccurrence[] = [];

  for (const e of events) {
    if (!e.correlation_id) {
      loose.push({
        event: e,
        raisedTs: isCleared(e) ? null : ms(e.event_time_utc),
        clearedTs: clearedAt(e),
      });
      continue;
    }
    const pair = byCorr.get(e.correlation_id) ?? {};
    /* Newest first, so the first sighting of each state is the latest one. */
    if (isCleared(e)) pair.cleared ??= e; else pair.active ??= e;
    byCorr.set(e.correlation_id, pair);
  }

  const paired: AlarmOccurrence[] = [...byCorr.values()].map(({ active, cleared }) => ({
    event: (active ?? cleared)!,
    raisedTs: active ? ms(active.event_time_utc) : null,
    clearedTs: (cleared && clearedAt(cleared)) ?? (active && clearedAt(active)) ?? null,
  }));

  return [...paired, ...loose].sort(
    (a, b) => (b.raisedTs ?? b.clearedTs ?? 0) - (a.raisedTs ?? a.clearedTs ?? 0),
  );
}

/**
 * Still-open alarms: those whose NEWEST event is a raise.
 *
 * Grouped by the alarm (dedupe_key, else asset + signal), not by
 * correlation_id. The log does not always pair them: on 6 Oct 2026 a
 * dehumidifier raise at 15:29 UTC never got a CLEARED with its id — the next
 * clear carried another — and two clears had no raise at all. Pairing by id
 * kept that 15:29 raise open for good, beside the real one, though the alarm
 * had cleared and come back several times since. An alarm's latest
 * transition is what says whether it is up now.
 */
export function openOccurrences(events: AlarmEvent[]): AlarmOccurrence[] {
  const newest = new Map<string, AlarmEvent>();
  for (const e of events) {                       // newest first
    const k = e.dedupe_key ?? `${e.asset_id ?? ""}:${e.signal_name ?? ""}`;
    if (!newest.has(k)) newest.set(k, e);
  }
  return [...newest.values()]
    .filter((e) => !isCleared(e) && clearedAt(e) == null)
    .map((e) => ({ event: e, raisedTs: ms(e.event_time_utc), clearedTs: null }));
}

/* ── Episodes: each alarm's history, read in time order ───────────────────── */

/** One raise of an alarm and what ended it. */
export interface AlarmEpisode {
  /** The ACTIVE row that started it. */
  event: AlarmEvent;
  raisedTs: number;
  /** When it cleared, or null when no clear was logged. */
  clearedTs: number | null;
  /**
   * Still raised: this is the alarm's newest event. A raise followed by
   * another raise with no clear between them ended unlogged — it is over,
   * not open — so only the latest raise can be open.
   */
  open: boolean;
}

/**
 * Every raise of every alarm, built per alarm (dedupe_key, else asset +
 * signal) by walking its events oldest first: ACTIVE starts an episode,
 * CLEARED ends the current one.
 *
 * Not by correlation_id, which the log does not keep reliably (see
 * openOccurrences): pairing by it left a 15:29 UTC dehumidifier raise open
 * for good on 6 Oct, through several clears and re-raises. A CLEARED with no
 * raise in the rows read (its raise is older than the 1,000 rows) is skipped.
 */
export function episodes(events: AlarmEvent[]): AlarmEpisode[] {
  const byAlarm = new Map<string, AlarmEvent[]>();
  for (const e of events) {
    const k = e.dedupe_key ?? `${e.asset_id ?? ""}:${e.signal_name ?? ""}`;
    const list = byAlarm.get(k) ?? [];
    list.push(e);
    byAlarm.set(k, list);
  }
  const out: AlarmEpisode[] = [];
  for (const list of byAlarm.values()) {
    list.sort((a, b) => (ms(a.event_time_utc) ?? 0) - (ms(b.event_time_utc) ?? 0));
    let current: AlarmEpisode | null = null;
    for (const e of list) {
      const t = ms(e.event_time_utc);
      if (t == null) continue;
      if (isCleared(e)) {
        if (current) { current.clearedTs = clearedAt(e) ?? t; out.push(current); current = null; }
        continue;
      }
      if (current) out.push(current);            // re-raised with no clear logged: over, not open
      current = { event: e, raisedTs: t, clearedTs: null, open: false };
      /* A raise that carries its own clear time is already over. */
      const c = clearedAt(e);
      if (c != null) { current.clearedTs = c; out.push(current); current = null; }
    }
    if (current) { current.open = true; out.push(current); }
  }
  return out.sort((a, b) => b.raisedTs - a.raisedTs);
}
