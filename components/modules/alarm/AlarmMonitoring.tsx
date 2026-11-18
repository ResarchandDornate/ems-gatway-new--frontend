"use client";

import { Fragment, useState, useMemo, useRef, useEffect } from "react";
import {
  Search, RotateCcw, Download, Bell,
  ChevronLeft, ChevronRight, Eye, Check,
} from "lucide-react";
import { useAlarms, useInvalidateAlarms } from "@/hooks/useAlarms";
import { PriorityBadge } from "@/components/alarms/PriorityBadge";
import { PRIORITY, priorityOf } from "@/lib/alarms/priority";
import { acknowledge } from "@/lib/alarms/ack";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useStations } from "@/hooks/useStations";
import { useStation } from "@/lib/context/StationContext";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState }   from "@/components/shared/ErrorState";
import { EmptyState }   from "@/components/shared/EmptyState";
/* The central service, not the retired gateway's: the device types here are
   the ones its rows carry, and the export is of what it read. */
import { DEVICE_TYPES, exportActiveAlarms, fetchAlarms, type CentralAlarm } from "@/lib/api/services/alarmsCentral.service";
import { useQuery } from "@tanstack/react-query";
import type { AlarmFilters, AlarmType, AlarmStatus } from "@/lib/api/types";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { istDate } from "@/lib/api/time";

/* The backend has no acknowledge endpoint, so an acknowledgement is kept in
   this app's server (app/api/alarm-acks), shared by everyone. Resolved reads
   the S4 alarm log's closed episodes. */
const NO_HISTORY = "Acknowledgements are kept by this app's server and shared with everyone on the site — the central backend has no acknowledge endpoint.";

// ── Constants ─────────────────────────────────────────────────────────────────
const ALARM_COLOR: Record<AlarmType, string> = {
  failure: "#A8505E",
  alarm:   "#5B8AB4",
  inform:  "#3E6E93",
};

const STATUS_STYLE: Record<AlarmStatus, string> = {
  active:       "bg-bad/10 text-bad border border-bad/20",
  acknowledged: "bg-warn/10 text-warn border border-warn/20",
  resolved:     "bg-good/10 text-good border border-good/20",
};

const STATUS_LABEL: Record<AlarmStatus, string> = {
  active:       "Active",
  acknowledged: "Acknowledged",
  resolved:     "Resolved",
};

const PAGE_SIZES = [10, 20, 50, 100];

// ── Sub-components ────────────────────────────────────────────────────────────
function AlarmTypeDot({ type }: { type: AlarmType }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: ALARM_COLOR[type], boxShadow: `0 0 5px ${ALARM_COLOR[type]}` }}
      />
      <span className="text-[12px] font-mono font-semibold tracking-[1px]" style={{ color: ALARM_COLOR[type] }}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </span>
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function AlarmMonitoring() {

  // ── Station context ───────────────────────────────────────────────────────
  const { sel } = useStation();
  const stationId = sel.mode === "station" ? sel.id : undefined;

  // ── Filters ──────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState<AlarmFilters>({ page: 1, size: 10, powerStationId: stationId });
  const [applied, setApplied] = useState<AlarmFilters>({ page: 1, size: 10, powerStationId: stationId });

  // Keep filters in sync when the active station changes
  useEffect(() => {
    const id = sel.mode === "station" ? sel.id : undefined;
    setDraft(prev => ({ ...prev, powerStationId: id, page: 1 }));
    setApplied(prev => ({ ...prev, powerStationId: id, page: 1 }));
  }, [sel]);

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Jump-to-page ──────────────────────────────────────────────────────────
  const jumpRef = useRef<HTMLInputElement>(null);

  // ── Data ─────────────────────────────────────────────────────────────────
  const alarms   = useAlarms(applied);
  const invalidate = useInvalidateAlarms();
  const stations = useStations();
  const { gatewayId } = useAppConfig();

  const { records = [], total = 0, current = 1, size = 10, pages = 1, stats, coverage } = alarms.data ?? {};

  /* "Active Now" is what is raised right now — active and acknowledged, every
     cabinet — whatever the filters below show. The same query (and cache
     entry) as the header bell, so the two always agree. */
  const raisedNow = useQuery({
    queryKey: ["central", "alarmCount", gatewayId],
    queryFn: () => fetchAlarms(gatewayId, { page: 1, size: 200 }),
    enabled: gatewayId.length > 0,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 110_000,
    retry: false,
  });
  const raisedNowCount = raisedNow.data?.total;

  /* One open detail row at a time — the evidence behind a flag. */
  const [openId, setOpenId] = useState<string | null>(null);

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleSearch() {
    setSelected(new Set());
    setApplied({ ...draft, page: 1 });
  }

  function handleReset() {
    const blank: AlarmFilters = { page: 1, size: applied.size ?? 10, powerStationId: sel.mode === "station" ? sel.id : undefined };
    setDraft(blank);
    setApplied(blank);
    setSelected(new Set());
  }

  function setPage(page: number) {
    if (page < 1 || page > pages) return;
    setApplied(prev => ({ ...prev, page }));
    setSelected(new Set());
  }

  function setPageSize(sz: number) {
    setApplied(prev => ({ ...prev, size: sz, page: 1 }));
    setDraft(prev => ({ ...prev, size: sz }));
    setSelected(new Set());
  }

  function handleJump() {
    const v = parseInt(jumpRef.current?.value ?? "");
    if (!isNaN(v)) setPage(Math.max(1, Math.min(v, pages)));
  }

  function toggleRow(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === records.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(records.map(r => r.id)));
    }
  }

  const stationOptions = useMemo(
    () => [
      { id: "", name: "All" },
      ...(stations.data ?? []).map(s => ({ id: s.id, name: s.powerStationEnglishName })),
    ],
    [stations.data]
  );

  const allChecked = records.length > 0 && selected.size === records.length;
  const someChecked = selected.size > 0 && selected.size < records.length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 overflow-hidden page-fill-inner">

      {/* ── Hero strip ─────────────────────────────────────────────────── */}
      {/* Replaces a sidebar that held exactly one destination. */}
      <PageHeader title="Alarm Monitoring">
                <PageStat label="Active Now" value={raisedNowCount == null ? "—" : raisedNowCount} color={raisedNowCount ? "#9C844A" : undefined} />
                <PageStat label="Failures" value={stats ? stats.failure : "—"} color={stats?.failure ? ALARM_COLOR.failure : undefined} />
          {/* What a zero above is worth: flags actually read on this pass.
              Thresholds are read too and deliberately not counted. */}
          <div title={coverage ? `${(coverage.s2FlagsRead + coverage.s1FlagsRead).toLocaleString("en-IN")} alarm and fault signals checked across every device (${coverage.settingsSkipped} threshold settings not counted)` : undefined}>
            <div className="ps-stat-k">Signals Checked</div>
            <div className="ps-stat-v" style={{ color: "var(--ink)" }}>
                          {coverage?.flagsRead || "—"}
                        </div>
                      </div>
            </PageHeader>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden">

        {/* ── Filter row ─────────────────────────────────────────────── */}
        <div className="surface-card p-3 flex-none">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-2 items-end">

            {/* Site */}
            <div>
              <label className="filter-label">Site</label>
              <select
                value={draft.powerStationId ?? ""}
                onChange={e => setDraft(d => ({ ...d, powerStationId: e.target.value || undefined }))}
                className="filter-input"
              >
                {stationOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>

            {/* Device Name */}
            <div>
              <label className="filter-label">Device Name</label>
              <input
                type="text"
                placeholder="Please Select"
                value={draft.deviceName ?? ""}
                onChange={e => setDraft(d => ({ ...d, deviceName: e.target.value || undefined }))}
                className="filter-input"
              />
            </div>

            {/* Device Type */}
            <div>
              <label className="filter-label">Device Type</label>
              <select
                value={draft.deviceType ?? ""}
                onChange={e => setDraft(d => ({ ...d, deviceType: e.target.value || undefined }))}
                className="filter-input"
              >
                <option value="">Please Select</option>
                {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Alert Status */}
            <div>
              <label className="filter-label">Alert Status</label>
              <select
                value={draft.alarmStatus ?? ""}
                onChange={e => setDraft(d => ({ ...d, alarmStatus: (e.target.value as AlarmStatus) || undefined }))}
                className="filter-input"
              >
                <option value="">Please Select</option>
                <option value="active">Active</option>
                <option value="acknowledged" title={NO_HISTORY}>Acknowledged</option>
                <option value="resolved">Resolved (Alarm Log)</option>
              </select>
            </div>

            {/* Date range */}
            <div title="Filters by when the alarm was raised (IST)" className="min-w-0 col-span-2 max-w-[420px]">
              <label className="filter-label">Raised Between</label>
              {/* min-w-0 + flex-1: a date input's intrinsic width (~150 px) would
                  otherwise push the second box out past the card's edge. */}
              <div className="flex items-center gap-1 min-w-0">
                <input
                  type="date"
                  max={draft.endTime ?? istDate()}
                  value={draft.startTime ?? ""}
                  onChange={e => setDraft(d => ({ ...d, startTime: e.target.value || undefined }))}
                  className="filter-input min-w-0 flex-1"
                />
                <span className="text-muted text-[11px] flex-shrink-0">–</span>
                <input
                  type="date"
                  min={draft.startTime}
                  max={istDate()}
                  value={draft.endTime ?? ""}
                  onChange={e => setDraft(d => ({ ...d, endTime: e.target.value || undefined }))}
                  className="filter-input min-w-0 flex-1"
                />
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-2">
            <button onClick={handleReset}  className="btn-outline"><RotateCcw size={12} />Reset</button>
            <button onClick={handleSearch} className="btn-primary"><Search size={12} />Search</button>
            <button
              onClick={() => exportActiveAlarms(gatewayId, applied)}
              disabled={!gatewayId}
              title="The alarms raised right now, as CSV"
              className="btn-outline"
            >
              <Download size={12} />Export
            </button>
          </div>

          {/* A source that could not be read leaves its flags unknown, and an
              empty table must not be read as "all clear" for them. */}
          {coverage && (coverage.unreadSubstreams.length > 0 || coverage.s1Unread) && (
            <div className="mt-2 text-[11.5px] text-warn">
              Not Read:{" "}
              {[...coverage.unreadSubstreams, ...(coverage.s1Unread ? ["fast-BESS (S1)"] : [])].join(", ")}
            </div>
          )}
        </div>

        {/* ── Table card ─────────────────────────────────────────────── */}
        <div className="surface-card overflow-hidden flex-1 flex flex-col">

          {/* Loading */}
          {alarms.isLoading && (
            <div className="px-5 py-4 flex-1">
              <LoadingState message="Fetching Alarms…" rows={8} />
            </div>
          )}

          {/* Error */}
          {alarms.isError && (
            <div className="flex-1 flex items-center justify-center">
              <ErrorState message="Could Not Load Alarms" onRetry={() => alarms.refetch()} />
            </div>
          )}

          {/* Table */}
          {!alarms.isLoading && !alarms.isError && (
            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line bg-surface2/40">
                    {/* Checkbox */}
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={el => { if (el) el.indeterminate = someChecked; }}
                        onChange={toggleAll}
                        className="w-3.5 h-3.5 accent-accent cursor-pointer"
                      />
                    </th>
                    {["Serial", "Priority", "Device Name", "Device Type", "Alert Content", "Alarm Code", "Raised", "Status", "Action"].map(h => (
                      <th
                        key={h}
                        className="text-left py-3 px-3 text-[11px] font-mono tracking-[1.3px] text-muted font-semibold whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-16 text-center">
                        <EmptyState title="Empty Data" description="" />
                      </td>
                    </tr>
                  ) : (
                    (records as CentralAlarm[]).map(alarm => (
                      <Fragment key={alarm.id}>
                      <tr
                        className={[
                          "border-b border-line/50 last:border-none transition-colors",
                          selected.has(alarm.id) ? "bg-accent/[.04]" : "hover:bg-surface2/50",
                        ].join(" ")}
                      >
                        {/* Checkbox */}
                        <td className="py-3.5 px-4">
                          <input
                            type="checkbox"
                            checked={selected.has(alarm.id)}
                            onChange={() => toggleRow(alarm.id)}
                            className="w-3.5 h-3.5 accent-accent cursor-pointer"
                          />
                        </td>

                        {/* Serial */}
                        <td className="py-3.5 px-3 text-muted font-mono tabular-nums">{alarm.serial}</td>

                        {/* Priority */}
                        <td className="py-3.5 px-3"><PriorityBadge p={alarm.priority ?? priorityOf(alarm)} /></td>

                        {/* Device Name */}
                        <td className="py-3.5 px-3">
                          <div className="font-medium text-ink leading-tight truncate max-w-[180px]" title={alarm.device}>{alarm.deviceName}</div>
                          <div className="text-[11px] text-muted mt-0.5 truncate max-w-[180px]">{alarm.powerStationName.split("·")[0].trim()}</div>
                        </td>

                        {/* Device Type */}
                        <td className="py-3.5 px-3 text-ink3">{alarm.deviceType}</td>

                        {/* Alert Content */}
                        <td className="py-3.5 px-3 text-ink2 max-w-[240px]">
                          <div className="truncate">{alarm.alertContent}</div>
                        </td>

                        {/* Alarm Code */}
                        <td className="py-3.5 px-3">
                          <AlarmTypeDot type={alarm.alarmType} />
                          <div className="text-[10.5px] text-muted font-mono mt-0.5" title={alarm.rawCode}>{alarm.alarmCode}</div>
                        </td>

                        {/* Raised at, where the S4 alarm log has an open event
                            for this flag; otherwise when the flag was last read
                            raised, marked as such. */}
                        <td
                          className="py-3.5 px-3 text-muted font-mono text-[11.5px] whitespace-nowrap"
                          title={alarm.raisedAt
                            ? "When the alarm was raised, from the backend's alarm log (S4)."
                            : "When the flag was last read raised. The alarm log has no open event for it, so no raised-at time is known."}
                        >
                          {(() => {
                            const t = alarm.raisedAt ?? alarm.alertTime;
                            if (!t || Number.isNaN(Date.parse(t))) return "—";
                            const shown = new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
                              year: "numeric", month: "2-digit", day: "2-digit",
                              hour: "2-digit", minute: "2-digit", second: "2-digit",
                              hour12: false,
                            });
                            return alarm.raisedAt ? shown : <>{shown} <span className="text-[10px]">(Last Seen)</span></>;
                          })()}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10.5px] font-semibold ${STATUS_STYLE[alarm.status]}`}>
                            {STATUS_LABEL[alarm.status]}
                          </span>
                        </td>

                        {/* Action */}
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          {alarm.status !== "resolved" && (
                            <button
                              title={alarm.status === "acknowledged" ? `Acknowledged${alarm.ackedBy ? ` by ${alarm.ackedBy}` : ""} — click to undo` : "Acknowledge (shared with everyone on the site)"}
                              onClick={() => { acknowledge(alarm, alarm.status !== "acknowledged"); invalidate(); }}
                              className={[
                                "w-7 h-7 inline-grid place-items-center rounded-lg hover:bg-surface3 transition-colors",
                                alarm.status === "acknowledged" ? "text-good" : "text-muted hover:text-ink",
                              ].join(" ")}
                            >
                              <Check size={13} />
                            </button>
                          )}
                          <button
                            title="View detail"
                            onClick={() => setOpenId(id => (id === alarm.id ? null : alarm.id))}
                            className={[
                              "w-7 h-7 inline-grid place-items-center rounded-lg hover:bg-surface3 hover:text-ink transition-colors",
                              openId === alarm.id ? "text-ink bg-surface3" : "text-muted",
                            ].join(" ")}
                          >
                            <Eye size={13} />
                          </button>
                        </td>
                      </tr>
                      {openId === alarm.id && <AlarmDetail alarm={alarm} />}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Pagination footer ─────────────────────────────────────── */}
          {!alarms.isLoading && !alarms.isError && (
            <div className="px-5 py-3.5 border-t border-line flex items-center gap-3 flex-wrap">

              {/* Total */}
              <span className="text-[12px] text-muted mr-auto">
                Total {total} Item{total !== 1 ? "s" : ""}
              </span>

              {/* Page size selector */}
              <div className="flex items-center gap-1.5">
                <select
                  value={size}
                  onChange={e => setPageSize(Number(e.target.value))}
                  className="h-7 px-2 bg-surface border border-line rounded-lg text-[11.5px] text-ink2 outline-none cursor-pointer"
                >
                  {PAGE_SIZES.map(n => (
                    <option key={n} value={n}>{n} / Page</option>
                  ))}
                </select>
              </div>

              {/* Page navigation */}
              <div className="flex items-center gap-1">
                <PagBtn onClick={() => setPage(current - 1)} disabled={current <= 1}>
                  <ChevronLeft size={13} />
                </PagBtn>

                {pageNumbers(current, pages).map((p, i) =>
                  p === "…" ? (
                    <span key={i} className="w-7 text-center text-muted text-[12px]">…</span>
                  ) : (
                    <PagBtn
                      key={p}
                      active={p === current}
                      onClick={() => setPage(p as number)}
                    >
                      {p}
                    </PagBtn>
                  )
                )}

                <PagBtn onClick={() => setPage(current + 1)} disabled={current >= pages}>
                  <ChevronRight size={13} />
                </PagBtn>
              </div>

              {/* Jump to page */}
              <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <span>Jump To</span>
                <input
                  ref={jumpRef}
                  type="number"
                  min={1} max={pages}
                  defaultValue={current}
                  onKeyDown={e => e.key === "Enter" && handleJump()}
                  className="w-10 h-7 px-2 bg-surface border border-line rounded-lg text-center text-[11.5px] text-ink2 outline-none"
                />
                <span>/ {pages}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The evidence behind one row: where it was read, what it read, and what the
 * BMS recorded at its last alarm. Raised-at, cleared-at, duration and
 * acknowledgement are listed as absent rather than left out, so nobody goes
 * looking for them on another screen.
 */
function AlarmDetail({ alarm }: { alarm: CentralAlarm }) {
  const rows: [string, string][] = [
    ["Source", alarm.source === "S1" ? "S1 Fast-BESS (1 Hz)" : alarm.source === "S2" ? "S2 General Telemetry" : alarm.status === "resolved" ? "S4 Alarm Log" : "S4 Alarm Log (No Matching Flag)"],
    ["Asset", alarm.deviceName],
    ["Point", alarm.source === "S2" ? `${alarm.rawCode ?? ""} · ${alarm.signal}` : alarm.signal || alarm.rawCode || "—"],
    ["Value Read", alarm.rawValue || "—"],
    ["Severity", alarm.logSeverity ? `${alarm.logSeverity} (Alarm Log)` : `${alarm.alarmType} (Derived From The Signal Name)`],
    ["Raised At", alarm.raisedAt ? new Date(alarm.raisedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) : "—"],
    ...(alarm.status === "resolved"
      ? [
          ["Cleared At", alarm.clearedAt ? new Date(alarm.clearedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) : "—"],
          ["Duration", alarm.raisedAt && alarm.clearedAt ? `${Math.max(0, Math.round((Date.parse(alarm.clearedAt) - Date.parse(alarm.raisedAt)) / 60_000))} min` : "—"],
        ] as [string, string][]
      : [["Duration So Far", alarm.raisedAt ? `${Math.max(0, Math.round((Date.now() - Date.parse(alarm.raisedAt)) / 60_000))} min` : "—"]] as [string, string][]),
    ["Priority", `P${alarm.priority ?? priorityOf(alarm)} · ${PRIORITY[alarm.priority ?? priorityOf(alarm)].name}`],
    ["Acknowledged", alarm.ackedAt ? `${alarm.ackedBy ? `${alarm.ackedBy} · ` : ""}${new Date(alarm.ackedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })}${alarm.ackLocal ? " · Not Saved Yet" : ""}` : "—"],
  ];
  return (
    <tr className="border-b border-line/50 bg-surface2/30">
      <td />
      <td colSpan={9} className="py-3 px-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-[11.5px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-2 min-w-0">
              <span className="text-muted flex-shrink-0 w-[190px]">{k}</span>
              <span className="text-ink2 font-mono truncate">{v}</span>
            </div>
          ))}
        </div>
        {alarm.context.length > 0 && (
          <div className="mt-2">
            <div className="text-[11px] font-mono tracking-[1.3px] text-muted font-semibold mb-1">
              Recorded By The BMS At Its Last Alarm
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-[11.5px]">
              {alarm.context.map(c => (
                <div key={c.label} className="flex gap-2 min-w-0">
                  <span className="text-muted flex-shrink-0 w-[190px] truncate">{c.label}</span>
                  <span className="text-ink2 font-mono">{c.value}{c.unit ? ` ${c.unit}` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

function PagBtn({
  children, onClick, disabled, active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "min-w-[28px] h-7 px-1.5 grid place-items-center rounded-lg text-[12px] font-medium transition-colors",
        active
          ? "bg-accent/15 text-accent ring-1 ring-accent/30"
          : "hover:bg-surface2 text-ink3 disabled:opacity-30 disabled:cursor-not-allowed",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function pageNumbers(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}
