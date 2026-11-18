"use client";

/**
 * Alarms — the log, and what the log adds up to.
 *
 * Two views over the same events. The existing table answers "what happened",
 * which is the right shape for responding to something now. Recurrence answers
 * "is this the fourth time this week or the fortieth, and is it getting
 * worse", which the table cannot show however it is sorted.
 *
 * They read the same rows through the same query builder (see fetchLogRange),
 * so the two cannot disagree about what the log says.
 *
 * ── Where the log comes from ──────────────────────────────────────────────
 * The event log was the retired NorthBound gateway's `/api/logs`. The central
 * backend now publishes S4 (`/gateways/{id}/alarms`, ACTIVE/CLEARED rows), and
 * Recurrence reads it. The first view still lists the flags raised right now
 * (alarmsCentral.service), with S4's raise time and severity where an open
 * event matches. On 28 Sep 2026 S4 answered an empty list — deployed, nothing
 * logged yet — and the empty state says exactly that rather than "no alarms".
 */

import { useMemo, useState } from "react";
import { AlarmMonitoring } from "@/components/modules/alarm/AlarmMonitoring";
import { AlarmRecurrence } from "@/components/modules/alarm/AlarmRecurrence";
import { AnomalyDetection } from "@/components/modules/alarm/AnomalyDetection";
import { useAlarmRecurrence } from "@/hooks/useAlarmRecurrence";
import { ALARM_HISTORY_AVAILABLE } from "@/lib/api/services/alarmCatalog.service";
import { PageHeader } from "@/components/PageHeader";

type View = "log" | "recurrence" | "anomaly";

/**
 * How far back recurrence looks.
 *
 * Wider than the log table's default on purpose. A pattern needs enough window
 * for its two halves to be worth comparing: over a fortnight the rate in each
 * half rests on a handful of events and Poisson noise alone moves it by a
 * quarter, so a genuinely worsening alarm and a quiet one look the same. Sixty
 * days is within the gateway's ninety-day retention and long enough that a
 * rate change has to be real to show.
 */
const RECURRENCE_DAYS = 60;

export default function AlarmsPage() {
  const [view, setView] = useState<View>("log");

  /* SITE-WIDE, with no station filter, which is the one place this page
     deliberately ignores the picker above it.

     Recurrence pools identical assets across cabinets — two dehumidifiers are
     one fault mode — and a source filter would undo exactly that, halving
     every sample the rate test runs on. Measured here: a humidity alarm rising
     sixfold scored 2.8σ pooled and 0.9σ per cabinet, so the filtered view
     reported nothing wrong. The per-cabinet split is still carried on each
     group, so a problem confined to one unit is not hidden.

     Rebuilt only when the day changes: a range recomputed on every render
     would change the query key each time and refetch sixty days of log on a
     re-render, which is the kind of thing that looks like a slow gateway. */
  const filters = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - RECURRENCE_DAYS * 86_400_000);
    return { startTime: from.toISOString(), endTime: to.toISOString() };
  }, []);

  const recurrence = useAlarmRecurrence(filters, ALARM_HISTORY_AVAILABLE && view === "recurrence");

  return (
    <div className="flex flex-col gap-3 overflow-hidden page-fill">
      <div className="nav-track" style={{ alignSelf: "flex-start", flex: "none" }}>
        <button type="button" onClick={() => setView("log")} className={`nav-pill ${view === "log" ? "on" : ""}`}>
          Active Alarms
        </button>
        <button type="button" onClick={() => setView("recurrence")} className={`nav-pill ${view === "recurrence" ? "on" : ""}`}>
          Recurrence
        </button>
        <button type="button" onClick={() => setView("anomaly")} className={`nav-pill ${view === "anomaly" ? "on" : ""}`}>
          Anomaly Detection
        </button>
      </div>

      {view === "log" ? (
        <AlarmMonitoring />
      ) : view === "anomaly" ? (
        <AnomalyDetection />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <PageHeader title="Alarm Recurrence" />
          <AlarmRecurrence
            emptyNote={{
              title: "No Alarm Events Logged Yet",
              description: "",
            }}
            data={recurrence.data}
            loading={ALARM_HISTORY_AVAILABLE && recurrence.isLoading}
            unavailable={
              !ALARM_HISTORY_AVAILABLE
                ? "No Alarm Log Configured"
                : recurrence.isError
                  ? "Could Not Read Alarm History"
                  : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
