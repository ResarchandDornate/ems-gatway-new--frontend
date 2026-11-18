"use client";

/**
 * Fleet benchmarking.
 *
 * A metric-per-row table rather than a unit-per-row one, because the question
 * is "which unit is behind on this" and not "what are unit 1's numbers" —
 * every other screen in the app already answers the second. Reading across a
 * row compares like with like; reading down a column would compare a
 * percentage with a temperature.
 *
 * No composite score. See the service header: a single ranked number over
 * efficiency, duty, thermals and alarms would rank the fleet authoritatively
 * and hide every reason for the ranking, with weights invented here rather
 * than derived from anything.
 */

import { useMemo } from "react";
import { AlertTriangle, Trophy } from "lucide-react";
import type { Fleet, FleetMetric } from "@/lib/api/services/fleet.service";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";

const dt = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad) var(--pad)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 11 }}>
        <h3 className="card-title">{title}</h3>
        {note && <span style={{ fontSize: 11, color: "var(--muted)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/** How a metric's value should read, given its unit. */
function fmt(v: number | null, unit: string): string {
  if (v == null) return "—";
  if (unit === "kWh") return v >= 10_000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString("en-IN");
  if (unit === "%") return v.toFixed(v < 10 ? 1 : 0);
  if (unit === "") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return v.toFixed(1);
}

function MetricRow({ m, unitCount }: { m: FleetMetric; unitCount: number }) {
  /* A bar per unit, scaled to the largest value in the row, so the comparison
     is visible before the numbers are read. Scaled within the row only —
     across rows the quantities are not commensurable and a shared scale would
     invite exactly the wrong comparison. */
  const present = m.values.filter((v): v is number => v != null);
  const max = present.length ? Math.max(...present.map(Math.abs)) : 0;

  return (
    <tr style={{ borderBottom: "1px solid var(--line)" }}>
      <td style={{ padding: "9px 12px", fontSize: 12, color: "var(--ink2)", whiteSpace: "nowrap" }}>
        {m.label}
        {m.unit && <span style={{ color: "var(--muted)", marginLeft: 5 }}>({m.unit})</span>}
        {!m.higherIsBetter && (
          <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>Lower Is Better</span>
        )}
      </td>
      {m.values.map((v, i) => {
        const best = m.bestIndex === i && unitCount > 1;
        const worst = m.worstIndex === i && unitCount > 1 && m.gap != null && m.gap > 0;
        return (
          <td key={i} style={{ padding: "7px 12px", minWidth: 130 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: 13, fontWeight: best || worst ? 700 : 500, fontVariantNumeric: "tabular-nums",
                minWidth: 54, textAlign: "right",
                color: worst ? "var(--bad)" : best ? "var(--good)" : "var(--ink)",
              }}>
                {fmt(v, m.unit)}
              </span>
              <span style={{ flex: 1, height: 5, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                {v != null && max > 0 && (
                  <span style={{
                    display: "block", height: "100%", borderRadius: 999,
                    width: `${Math.max(2, (Math.abs(v) / max) * 100)}%`,
                    background: worst ? "var(--bad)" : best ? "var(--good)" : "var(--muted)",
                    opacity: worst || best ? 0.85 : 0.4,
                  }} />
                )}
              </span>
            </div>
          </td>
        );
      })}
      {/* The gap, and whether it clears the threshold for this metric.
          Without that mark a reader has to know that 0.5 is a lot for an
          efficiency and nothing for a temperature. */}
      <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11.5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        <span style={{ color: m.isMaterial ? "var(--ink)" : "var(--ink3)", fontWeight: m.isMaterial ? 700 : 400 }}>
          {m.gap == null ? "—" : fmt(m.gap, m.unit)}
        </span>
        {m.gap != null && (
          <span style={{ fontSize: 9.5, color: "var(--muted)", marginLeft: 5 }}>
            {m.isMaterial ? "Significant" : "Normal Variation"}
          </span>
        )}
      </td>
    </tr>
  );
}

export function FleetBenchmark({ data, loading }: { data: Fleet | undefined; loading: boolean }) {
  const units = data?.units ?? [];

  const headline = useMemo(() => {
    const rte = data?.metrics.find((m) => m.key === "rte");
    return rte && rte.gap != null && rte.bestIndex != null && rte.worstIndex != null
      ? { gap: rte.gap, best: units[rte.bestIndex]?.name, worst: units[rte.worstIndex]?.name }
      : null;
  }, [data, units]);

  if (loading) return <LoadingState rows={8} />;

  if (!data?.window || units.length === 0) {
    return (
      <EmptyState
        title="Nothing To Benchmark"
        description=""
      />
    );
  }

  if (units.length === 1) {
    return (
      <EmptyState
        title="Only One Unit On This Gateway"
        description=""
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

      {/* ── What the comparison is worth ──────────────────────────────────── */}
      <Card
        title="Side-By-Side Comparison"
        note={`${units.length} Units · ${data.window.days} Day${data.window.days === 1 ? "" : "s"} · ${dt(data.window.fromTs)} → ${dt(data.window.toTs - 1)}`}
      >
        <p style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.6, margin: 0 }}>
          {headline && headline.gap > 0
            ? <>Efficiency Difference · <strong>{headline.best}</strong> vs <strong>{headline.worst}</strong> · <strong>{headline.gap.toFixed(2)} percentage points</strong></>
            : headline ? "No Efficiency Difference" : "Efficiency Difference · —"}
        </p>
      </Card>

      {/* ── Differences larger than the noise ─────────────────────────────── */}
      {data.findings.length > 0 ? (
        <div className="surface-card" style={{
          padding: "12px var(--pad)", display: "flex", gap: 10, alignItems: "flex-start",
          background: "rgb(var(--color-accent) / 0.07)", border: "1px solid rgb(var(--color-accent) / 0.25)",
        }}>
          <AlertTriangle size={15} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.6, minWidth: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {data.findings.length} Measure{data.findings.length === 1 ? " Shows" : "s Show"} A Real Difference Between The Units
            </div>
            {data.findings.map((f) => (
              <div key={f.metricKey}>
                <strong>{f.label}</strong> · {f.name} Behind By{" "}
                <strong>{fmt(f.gap, f.unit)}{f.unit && ` ${f.unit}`}</strong>
                {f.severity >= 2 && ` · ${f.severity.toFixed(1)}× More Than Normal Variation`}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="surface-card" style={{ padding: "12px var(--pad)", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Trophy size={15} style={{ color: "var(--good)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.55, fontWeight: 600 }}>
            No Metric Separates These Units
          </div>
        </div>
      )}

      {/* ── The table ─────────────────────────────────────────────────────── */}
      <div className="surface-card" style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{
                textAlign: "left", padding: "10px 12px", fontSize: 9.5, color: "var(--muted)", fontWeight: 600
              }}>
                Metric
              </th>
              {units.map((u) => (
                <th key={u.sourceId} style={{
                  textAlign: "left", padding: "10px 12px", fontSize: 11.5,
                  color: "var(--ink)", fontWeight: 600, whiteSpace: "nowrap",
                }}>
                  {u.name}
                  <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 400, marginTop: 2 }}>
                    {u.capacityKwh ? `${u.capacityKwh} kWh` : "Capacity Not Set"}
                    {u.coveragePct != null && u.coveragePct < 95 && ` · ${u.coveragePct}% Coverage`}
                  </div>
                </th>
              ))}
              <th style={{
                textAlign: "right", padding: "10px 12px", fontSize: 9.5, color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap"
              }}>
                Difference
              </th>
            </tr>
          </thead>
          <tbody>
            {data.metrics.map((m) => <MetricRow key={m.key} m={m} unitCount={units.length} />)}
          </tbody>
        </table>
      </div>

      {/* ── Efficiency trend per unit, which a single figure cannot show ──── */}
      <Card title="Efficiency Trend" note="Per Unit">
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {units.map((u) => (
            <div key={u.sourceId}>
              <div style={{ fontSize: 11.5, color: "var(--ink3)", marginBottom: 4 }}>{u.name}</div>
              <div style={{
                fontSize: 19, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                color: !u.rteTrendConfident ? "var(--muted)"
                  : (u.rteTrendPctPerMonth ?? 0) < -0.15 ? "var(--bad)" : "var(--good)",
              }}>
                {u.rteTrendPctPerMonth == null ? "—"
                  : u.rteTrendConfident
                    ? `${u.rteTrendPctPerMonth > 0 ? "+" : ""}${u.rteTrendPctPerMonth.toFixed(2)} points/month`
                    : "No Clear Trend Yet"}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--ink3)", marginTop: 3 }}>
                {u.rtePct == null ? "No Efficiency Figure" : `Now ${u.rtePct.toFixed(1)}% · ${u.daysReported} Day${u.daysReported === 1 ? "" : "s"}`}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {data.skipped.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--ink3)", padding: "0 2px" }}>
          {data.skipped.length} Further Source{data.skipped.length === 1 ? "" : "s"} Not Read
        </p>
      )}
    </div>
  );
}
