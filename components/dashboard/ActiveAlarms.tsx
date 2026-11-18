"use client";

import { useAlarms, useRecentlyCleared } from "@/hooks/useAlarms";
import type { AlarmEpisode } from "@/lib/central";
import type { Alarm, AlarmFilters, AlarmType } from "@/lib/api/types";
import { istDate } from "@/lib/api/time";
import { useInvalidateAlarms } from "@/hooks/useAlarms";
import { PriorityBadge } from "@/components/alarms/PriorityBadge";
import { priorityOf } from "@/lib/alarms/priority";
import { acknowledge } from "@/lib/alarms/ack";
import type { CentralAlarm } from "@/lib/api/services/alarmsCentral.service";

/**
 * Active alarms for one station.
 *
 * This screen already counted alarms in the hero strip ("Alarms today: 0") but
 * never said what any of them were, so the number was a prompt to go and look
 * somewhere else. The list answers the obvious follow-up in place.
 *
 * Scoped server-side: fetchAlarms filters customers by powerStationId and drops
 * anything whose status is not `active`, so this cannot leak another station's
 * alarms into a station view.
 */

/** How many rows the list shows, and so how many the shared query asks for. */
export const ACTIVE_ALARM_LIMIT = 8;

/**
 * The filter object both this list and the dashboard's "Active alarms" figure
 * pass to useAlarms.
 *
 * Shared rather than written out twice because react-query keys on the filters
 * themselves: two callers asking the same question with a differently-spelled
 * `size` are two requests for the same rows, and the count in the hero strip
 * could then disagree with the list directly beneath it. One object, one key,
 * one answer.
 */
export const activeAlarmFilters = (
  stationId: string,
  size: number = ACTIVE_ALARM_LIMIT,
): AlarmFilters => ({ powerStationId: stationId, size });
/* No status filter on purpose: "raised" is active AND acknowledged — an
   acknowledged alarm is still raised, still counted, and has to stay on the
   card so it can be un-acknowledged. Resolved rows only come back when a
   caller asks for them. */

/** Severity → the palette's status colour. */
const SEVERITY: Record<AlarmType, { color: string; label: string }> = {
  failure: { color: "var(--red)",    label: "Failure" },
  alarm:   { color: "var(--amber)",  label: "Alarm"   },
  inform:  { color: "var(--accent)", label: "Info"    },
};

/** Same day → clock time; otherwise the date. Absolute either way — a relative
 *  age on an alarm list invites reading a stale row as a fresh one. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameDay = istDate(d.getTime()) === istDate();
  return sameDay
    ? d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
}

/** How many cleared alarms the card lists under the active ones. */
const CLEARED_LIMIT = 5;

/** `external_ems_2_dehumidifier` → `BESS 2 · Dehumidifier`, as every other screen names the cabinet. */
function deviceOf(assetId: string | null): string {
  const m = /^external_ems_(\d+)_(.+)$/.exec(assetId ?? "");
  if (!m) return assetId ?? "—";
  const kind = m[2].replace(/_\d+$/, "").replace(/_/g, " ");
  const pretty = /^(bms|pcs|ems|io)\b/.test(kind) ? kind.replace(/^\w+/, (w) => w.toUpperCase()) : kind.charAt(0).toUpperCase() + kind.slice(1);
  return `BESS ${m[1]} · ${pretty}`;
}
/** `alarm_status` on a dehumidifier → `Dehumidifier alarm`; `cell_temp_diff_level_1` → `Cell temp diff level 1`. */
const signalOf = (e: AlarmEpisode["event"]) => {
  const raw = (e.signal_name ?? e.event_type ?? "alarm").toLowerCase();
  if (/^(alarm_status|alarm|fault|fault_status)$/.test(raw)) {
    const device = deviceOf(e.asset_id).split(" · ")[1];
    if (device) return `${device} ${raw.startsWith("fault") ? "fault" : "alarm"}`;
  }
  const s = raw.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const clockOf = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const dayOf = (ms: number) =>
  new Date(ms).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
/** 15:06–21:51 today; "7 Oct, 15:06–21:51" on another day; both days when it crossed midnight. */
function span(from: number, to: number): string {
  const today = istDate();
  const sameDay = istDate(from) === istDate(to);
  if (sameDay) return istDate(to) === today ? `${clockOf(from)}–${clockOf(to)}` : `${dayOf(to)}, ${clockOf(from)}–${clockOf(to)}`;
  return `${dayOf(from)} ${clockOf(from)} – ${dayOf(to)} ${clockOf(to)}`;
}

/** The S4 raise time an active row carries (alarmsCentral matches it), epoch ms. */
const raisedOf = (a: Alarm): number | null => {
  const t = Date.parse((a as Alarm & { raisedAt?: string }).raisedAt ?? "");
  return Number.isNaN(t) ? null : t;
};

/** 14 min · 2 h 5 min · 45 s */
function lasted(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const min = Math.round(ms / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

export function ActiveAlarms({ stationId, limit = ACTIVE_ALARM_LIMIT }: { stationId: string; limit?: number }) {
  const { data, isLoading } = useAlarms(activeAlarmFilters(stationId, limit));
  /* What cleared in the last day, from S4's ACTIVE/CLEARED history — the list
     above shows only what is raised now. Acknowledgements are shared
     through this app's server (app/api/alarm-acks). */
  const cleared = useRecentlyCleared();
  const clearedRows = (cleared.data ?? []).slice(0, CLEARED_LIMIT);
  const clearedMore = (cleared.data?.length ?? 0) - clearedRows.length;

  const invalidate = useInvalidateAlarms();
  const rows = (data?.records ?? []) as CentralAlarm[];
  const total = data?.total ?? 0;

  return (
    <div
      className="surface-card dash-grow"
      style={{ padding: "var(--pad-sm) var(--pad) var(--pad)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <h3 className="card-title">Active Alarms</h3>
        {total > 0 && (
          <span className="pill red" style={{ fontSize: 10.5, padding: "2px 9px" }}>{total}</span>
        )}
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            flex: 1, minHeight: 96, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center",
          }}
        >
          {!isLoading && (
            <span style={{
              width: 26, height: 26, borderRadius: 999, display: "grid", placeItems: "center",
              background: "rgb(var(--color-good) / 0.14)", color: "var(--green)", fontSize: 13,
            }}>
              ✓
            </span>
          )}
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {isLoading ? "Loading…" : "No Active Alarms"}
          </span>
        </div>
      ) : (
        <div style={{ flex: "0 1 auto", minHeight: 0, overflowY: "auto", marginRight: -6, paddingRight: 6 }}>
          {rows.map((a) => {
            const sev = SEVERITY[a.alarmType] ?? SEVERITY.inform;
            const acked = a.status === "acknowledged";
            return (
              <div
                key={a.id}
                title={`${sev.label}${acked ? ` · acknowledged${a.ackedBy ? ` by ${a.ackedBy}` : ""}` : ""}`}
                style={{
                  display: "flex", gap: 9, padding: "9px 0",
                  borderTop: "1px solid var(--line)", opacity: acked ? 0.55 : 1,
                }}
              >
                <span style={{ marginTop: 1 }}><PriorityBadge p={a.priority ?? priorityOf(a)} size="xs" /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 11.5, color: "var(--ink)", lineHeight: 1.35,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {a.alertContent}
                  </div>
                  <div style={{
                    fontSize: 10.5, color: "var(--muted)", marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {/* The type only when the name doesn't already say it ("BESS 2 · Dehumidifier"). */}
                    {a.deviceName}{a.deviceType && !a.deviceName.toLowerCase().includes(a.deviceType.toLowerCase()) ? ` · ${a.deviceType}` : ""}
                    {raisedOf(a) != null && ` · Active ${lasted(Date.now() - raisedOf(a)!)}`}
                  </div>
                </div>
                <span style={{
                  fontSize: 10.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap", marginTop: 1,
                }}>
                  {/* The S4 raise time where one matched; else when the flag was seen. */}
                  {when(raisedOf(a) != null ? new Date(raisedOf(a)!).toISOString() : a.alertTime)}
                </span>
                <button
                  onClick={() => { acknowledge(a, !acked); invalidate(); }}
                  title={acked ? `Acknowledged${a.ackedBy ? ` by ${a.ackedBy}` : ""} — click to undo` : "Acknowledge (shared with everyone on the site)"}
                  style={{
                    flex: "none", width: 20, height: 20, borderRadius: 6, marginTop: -1,
                    display: "grid", placeItems: "center", fontSize: 11, lineHeight: 1,
                    border: "1px solid var(--line)", cursor: "pointer",
                    background: acked ? "rgb(var(--color-good) / 0.14)" : "transparent",
                    color: acked ? "var(--green)" : "var(--muted)",
                  }}
                >✓</button>
              </div>
            );
          })}
          {total > rows.length && (
            <div style={{ fontSize: 10.5, color: "var(--muted)", paddingTop: 9, borderTop: "1px solid var(--line)" }}>
              +{total - rows.length} more on Alarm Monitoring
            </div>
          )}
        </div>
      )}

      {clearedRows.length > 0 && (
        /* Shrinks to whatever height the card has left and scrolls inside it —
           unbounded, five rows spill out under the cards below. It gives way
           first (the large shrink factor): what is raised now outranks what
           cleared, so the active rows keep their height. */
        <div style={{ marginTop: 12, flex: "0 10000 auto", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink3)" }}>Recently cleared</span>
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>last 24 h</span>
          </div>
          <div style={{ minHeight: 0, overflowY: "auto", marginRight: -6, paddingRight: 6 }}>
          {clearedRows.map((e, i) => (
            <div
              key={`${e.event.event_id ?? e.raisedTs}-${i}`}
              style={{ display: "flex", gap: 9, padding: "8px 0", borderTop: "1px solid var(--line)" }}
              title={e.event.message ?? undefined}
            >
              <span style={{ marginTop: 1, opacity: 0.6 }}>
                <PriorityBadge size="xs" p={priorityOf({
                  logSeverity: e.event.severity, signal: e.event.signal_name, alertContent: e.event.message,
                  alarmType: ({ high: "failure", medium: "alarm", low: "inform" } as Record<string, string>)[(e.event.severity ?? "").toLowerCase()] ?? "alarm",
                })} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11.5, color: "var(--ink2)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {signalOf(e.event)}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {deviceOf(e.event.asset_id)} · lasted {lasted(e.clearedTs! - e.raisedTs)}
                </div>
              </div>
              <span style={{ fontSize: 10.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", marginTop: 1, textAlign: "right" }}>
                {span(e.raisedTs, e.clearedTs!)}
              </span>
            </div>
          ))}
          {clearedMore > 0 && (
            <div style={{ fontSize: 10.5, color: "var(--muted)", paddingTop: 8, borderTop: "1px solid var(--line)" }}>
              +{clearedMore} more cleared · Alarms → Recurrence
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
