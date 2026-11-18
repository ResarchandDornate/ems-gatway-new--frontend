"use client";

/**
 * Alarm recurrence — the log, grouped and asked the questions a list cannot.
 *
 * The table is ordered by how much attention a group deserves rather than by
 * how often it fired, which for most plants is close to the reverse. See
 * attentionScore in the service: an alarm explained by the clock sorts last
 * however loud it is, and a worsening one sorts first however quiet.
 *
 * The 24-hour strip on each row is the load-bearing element. A fault that
 * arrives at random shows a flat strip; one driven by the dispatch schedule
 * shows a single spike, and that spike is the difference between changing a
 * setpoint and sending somebody to site.
 */

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { TrendingUp, Clock, Minus, TrendingDown, AlertCircle } from "lucide-react";
import type { AlarmGroup, AlarmPattern, AlarmRecurrence as Recurrence } from "@/lib/api/services/alarmRecurrence.service";
import { chartTokens, axisProps, tooltipStyle } from "@/lib/charts/tokens";
import { PeriodNav, usePeriod, useSwipe, type PeriodState } from "@/components/charts/PeriodNav";
import { dailyToBuckets, ymdOf, type DayBucketRow } from "@/lib/charts/period";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { bessLabel } from "@/lib/api/services/bessLabel";

const PATTERN: Record<AlarmPattern, {
  label: string; tone: "bad" | "warn" | "good" | "muted"; icon: typeof Clock;
}> = {
  accelerating: {
    label: "Getting Worse", tone: "bad", icon: TrendingUp,
  },
  steady: {
    label: "Recurring", tone: "warn", icon: Minus,
  },
  fading: {
    label: "Easing Off", tone: "good", icon: TrendingDown,
  },
  "one-off": {
    label: "One-off", tone: "muted", icon: AlertCircle,
  },
  scheduled: {
    label: "Same Time Daily", tone: "muted", icon: Clock,
  },
};

const SEV_COLOUR: Record<string, string> = {
  critical: "var(--bad)", fatal: "var(--bad)", major: "var(--bad)",
  minor: "var(--accent)", warning: "var(--accent)", info: "var(--muted)",
};

const toneColour = (t: "bad" | "warn" | "good" | "muted") =>
  t === "bad" ? "var(--bad)" : t === "warn" ? "var(--accent)" : t === "good" ? "var(--good)" : "var(--muted)";

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const dt = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Minutes, said the way somebody would say them. */
function mins(m: number | null): string {
  if (m == null) return "—";
  if (m < 90) return `${Math.round(m)} min`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;
}

/** The 24-hour strip. Bars, not a chart — it has to read at row height. */
function HourStrip({ byHour, colour }: { byHour: number[]; colour: string }) {
  const max = Math.max(1, ...byHour);
  return (
    <div
      style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 22, width: 120 }}
      title={byHour.map((n, h) => (n ? `${hh(h)} ×${n}` : null)).filter(Boolean).join("  ")}
    >
      {byHour.map((n, h) => (
        <span
          key={h}
          style={{
            flex: 1,
            /* A floor of 2px on empty hours, so the strip reads as a
               24-hour axis rather than as a few floating bars. */
            height: n ? `${Math.max(12, (n / max) * 100)}%` : 2,
            background: n ? colour : "var(--line)",
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: tone ?? "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

export function AlarmRecurrence({
  data, loading, unavailable, emptyNote,
}: {
  data: Recurrence | undefined;
  loading: boolean;
  /** Why there is no history to show. Kept apart from "no events": a source
   *  that is absent or failed is not a clean record, and must not read as one. */
  unavailable?: string;
  /** Replaces the default empty-window wording, for a source that is live but has logged nothing. */
  emptyNote?: { title: string; description: string };
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const selected = useMemo(
    () => data?.groups.find((g) => g.key === openKey) ?? null,
    [data, openKey],
  );

  const hourChart = useMemo(
    () => (selected ? selected.byHour.map((n, h) => ({ hour: hh(h), n })) : []),
    [selected],
  );
  /* The by-day timeline follows Day / Week / Month / Year (PeriodNav): days
     of a Week or Month, monthly totals for a Year, a Day as its one count. */
  const nav = usePeriod("week");
  const { period } = nav;
  const dayChart = useMemo(() => {
    if (!selected || !data) return [];
    const rows = data.dayKeys.map((k, i) => ({ date: k, n: selected.byDay[i] ?? 0 }));
    if (period.range === "day") {
      const r = rows.find((x) => x.date === ymdOf(period.from));
      return [{ label: period.label, ts: period.from, n: r?.n ?? null }];
    }
    return dailyToBuckets(rows, period, { n: "sum" });
  }, [selected, data, period]);

  if (unavailable) return <EmptyState title={unavailable} description="" />;
  if (loading) return <LoadingState rows={8} />;
  if (!data?.window || !data.groups.length) {
    return (
      <EmptyState
        title={emptyNote?.title ?? "No Events In This Window"}
        description={emptyNote?.description ?? ""}
      />
    );
  }

  const { window: w, groups } = data;
  const recurring = groups.filter((g) => g.pattern !== "one-off");
  const worsening = groups.filter((g) => g.pattern === "accelerating");
  const clockDriven = groups.filter((g) => g.pattern === "scheduled");
  const clockShare = data.totalEvents
    ? clockDriven.reduce((s, g) => s + g.count, 0) / data.totalEvents
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)", minHeight: 0, overflowY: "auto" }}>

      {/* ── What the window holds ─────────────────────────────────────────── */}
      <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad) var(--pad)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <h3 className="card-title">Recurring Alarms</h3>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {data.totalEvents.toLocaleString("en-IN")} Events Over {w.days} Day{w.days === 1 ? "" : "s"} · {dt(w.fromTs)} → {dt(w.toTs)}
            {data.truncated && " · Log Truncated"}
          </span>
        </div>
        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          <Stat label="Distinct Alarms" value={String(groups.length)} />
          <Stat label="Recurring" value={String(recurring.length)} />
          <Stat
            label="Getting Worse"
            value={String(worsening.length)}
            tone={worsening.length ? "var(--bad)" : undefined}
          />
          <Stat
            label="Same Time Every Day"
            value={`${Math.round(clockShare * 100)}%`}
            tone="var(--muted)"
          />
        </div>
      </div>

      {/* ── The table ─────────────────────────────────────────────────────── */}
      <div className="surface-card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              {["Alarm", "Equipment", "Pattern", "Times Raised", "Days Seen", "Time Of Day", "Typical Time To Clear", "Still Open"].map((h, i) => (
                <th key={h} style={{
                  textAlign: i >= 3 && i !== 5 ? "right" : "left",
                  padding: "9px 12px", fontSize: 9.5, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap"
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const p = PATTERN[g.pattern];
              const Icon = p.icon;
              const open = g.key === openKey;
              return (
                <tr
                  key={g.key}
                  onClick={() => setOpenKey(open ? null : g.key)}
                  style={{
                    borderBottom: "1px solid var(--line)",
                    cursor: "pointer",
                    background: open ? "var(--surface2)" : undefined,
                  }}
                >
                  <td style={{ padding: "9px 12px", color: "var(--ink)", fontWeight: open ? 600 : 400, whiteSpace: "nowrap" }}>
                    <span style={{
                      display: "inline-block", width: 6, height: 6, borderRadius: 999, marginRight: 8,
                      background: SEV_COLOUR[g.severity] ?? "var(--muted)", verticalAlign: "middle",
                    }} />
                    <span title={g.signal}>{g.label}</span>
                  </td>
                  <td style={{ padding: "9px 12px", color: "var(--ink3)", whiteSpace: "nowrap" }}>{g.assetLabel}</td>
                  <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: 10.5, fontWeight: 600, color: toneColour(p.tone),
                    }}>
                      <Icon size={12} />{p.label}
                    </span>
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{g.count}</td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink3)" }}>
                    {g.daysSeen}/{w.days}
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <HourStrip byHour={g.byHour} colour={SEV_COLOUR[g.severity] ?? "var(--muted)"} />
                      <span style={{ fontSize: 10.5, color: "var(--ink3)", whiteSpace: "nowrap" }}>
                        {g.pattern === "scheduled"
                          ? `${Math.round(g.clustering * 100)}% At ${hh(g.clusterStartHour)}–${hh((g.clusterStartHour + 2) % 24)}`
                          : "Any Time"}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink3)", whiteSpace: "nowrap" }}>
                    {mins(g.medianClearMin)}
                  </td>
                  <td style={{ padding: "9px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: g.openCount ? "var(--accent)" : "var(--ink3)" }}>
                    {g.openCount || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── One group, in detail ──────────────────────────────────────────── */}
      {selected && <GroupDetail group={selected} hourChart={hourChart} dayChart={dayChart} windowDays={w.days} nav={nav} />}
    </div>
  );
}

function GroupDetail({ group, hourChart, dayChart, windowDays, nav }: {
  group: AlarmGroup;
  hourChart: { hour: string; n: number }[];
  dayChart: DayBucketRow[];
  windowDays: number;
  nav: PeriodState;
}) {
  const swipe = useSwipe(nav);
  const p = PATTERN[group.pattern];
  const colour = SEV_COLOUR[group.severity] ?? "var(--muted)";

  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad) var(--pad)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <h3 className="card-title">{group.label}</h3>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          <span title={group.signal}>{group.assetLabel}</span>
          {Object.keys(group.bySource).length > 0 && (
            <> · {Object.entries(group.bySource)
              .map(([src, n]) => `${bessLabel(src)}: ${n}`)
              .join(" · ")}</>
          )}
        </span>
      </div>

      <p style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.55, marginBottom: 14 }}>
        <strong style={{ color: toneColour(p.tone) }}>{p.label}</strong>
      </p>

      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", marginBottom: 16 }}>
        <Stat label="Occurrences" value={String(group.count)} />
        <Stat label="On Days" value={`${group.daysSeen} Of ${windowDays}`} />
        <Stat
          label="Rate, First Half"
          value={`${group.rateEarly.toFixed(2)}/Day`}
        />
        <Stat
          label="Rate, Second Half"
          value={`${group.rateLate.toFixed(2)}/Day`}
          tone={group.rateZ >= 1.64 ? "var(--bad)" : group.rateZ <= -1.64 ? "var(--good)" : undefined}
        />
        <Stat
          label="Evidence"
          value={`${group.rateZ > 0 ? "+" : ""}${group.rateZ.toFixed(1)}σ`}
          tone={Math.abs(group.rateZ) >= 1.64 ? (group.rateZ > 0 ? "var(--bad)" : "var(--good)") : "var(--muted)"}
        />
        <Stat label="Typical Time To Clear" value={mins(group.medianClearMin)} />
        <Stat label="Last Seen" value={dt(group.lastTs)} />
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 6 }}>
            By Hour Of Day — {group.pattern === "scheduled"
              ? `${Math.round(group.clustering * 100)}% Inside ${hh(group.clusterStartHour)}–${hh((group.clusterStartHour + 2) % 24)}`
              : "No Hour Stands Out"}
          </div>
          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourChart} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={chartTokens.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" interval={3} {...axisProps} />
                <YAxis width={32} allowDecimals={false} {...axisProps} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-grid)", opacity: 0.25 }} />
                <Bar dataKey="n" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                  {hourChart.map((d, i) => (
                    /* The cluster hours are highlighted only when there IS a
                       cluster. Every distribution has a busiest pair of hours,
                       and colouring them on an alarm that arrives at random
                       invents a pattern for the reader to explain — the
                       opposite of what this chart is for. */
                    <Cell
                      key={i}
                      fill={
                        group.pattern === "scheduled"
                        && (i === group.clusterStartHour || i === (group.clusterStartHour + 1) % 24)
                          ? colour
                          : group.pattern === "scheduled" ? chartTokens.grid : colour
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 6 }}>
            By Day — First Half {group.countEarly} · Second Half {group.countLate}
            {Math.abs(group.rateZ) >= 1.64 && ` · ${Math.abs(group.rateZ).toFixed(1)}σ`}
          </div>
          <div style={{ marginBottom: 8 }}><PeriodNav state={nav} /></div>
          <div {...swipe} style={{ ...swipe.style, height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dayChart} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={chartTokens.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" {...axisProps} interval="equidistantPreserveStart" minTickGap={6} />
                <YAxis width={32} allowDecimals={false} {...axisProps} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-grid)", opacity: 0.25 }} formatter={(v) => [v ?? "—", "Alarms"]} />
                <Bar dataKey="n" fill={colour} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
