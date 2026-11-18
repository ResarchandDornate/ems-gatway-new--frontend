"use client";

/**
 * The part of each analysis view that does not need history.
 *
 * Every view on this page is built on days of stored telemetry, and the
 * central backend holds about half an hour. What it CAN give is the counters
 * the cabinets keep themselves (month, year, lifetime) and the EMS's live
 * limiter settings — so an otherwise empty view shows those, labelled for
 * exactly what they are, instead of nothing. See analysisCentral.service.ts.
 */

import { ShieldCheck, ShieldOff } from "lucide-react";
import { ratioPct, type CabinetCounters, type EmsLimits } from "@/lib/api/services/analysisCentral.service";
import { bessLabel } from "@/lib/api/services/bessLabel";

/** `external_ems_2` → `BESS 2`, as the header's picker names it. */
const cabinetName = bessLabel;

const kwh = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString("en-IN"));
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

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

type Row = { label: string; hint?: string; get: (c: CabinetCounters) => string; strong?: boolean };

const ROWS: Row[] = [
  { label: "Charged This Month",      hint: "BMS p1063 · kWh", get: (c) => kwh(c.monthChargeKwh) },
  { label: "Discharged This Month",   hint: "BMS p1064 · kWh", get: (c) => kwh(c.monthDischargeKwh) },
  { label: "Discharge ÷ Charge, Month", hint: "Uncorrected",   get: (c) => pct(ratioPct(c.monthDischargeKwh, c.monthChargeKwh)), strong: true },
  { label: "Charged This Year",       hint: "BMS p1065 · kWh", get: (c) => kwh(c.yearChargeKwh) },
  { label: "Discharged This Year",    hint: "BMS p1066 · kWh", get: (c) => kwh(c.yearDischargeKwh) },
  { label: "Discharge ÷ Charge, Year",  hint: "BMS p1066 ÷ p1065", get: (c) => pct(c.yearRatioPct) },
  { label: "Charged, Lifetime (DC)",  hint: "PCS p0205 · kWh", get: (c) => kwh(c.dcChargeKwh) },
  { label: "Discharged, Lifetime (DC)", hint: "PCS p0206 · kWh", get: (c) => kwh(c.dcDischargeKwh) },
  { label: "Discharge ÷ Charge, Lifetime DC", hint: "PCS p0206 ÷ p0205", get: (c) => pct(ratioPct(c.dcDischargeKwh, c.dcChargeKwh)), strong: true },
];

/**
 * Per-cabinet counters, cabinets as columns — so reading across a row is the
 * comparison, the same orientation as the Fleet table.
 */
export function CabinetCountersCard({ rows, loading }: { rows: CabinetCounters[] | undefined; loading?: boolean }) {
  if (loading && !rows) return null;
  if (!rows?.length) return null;

  return (
    <Card title="BESS Counters" note="Read Live">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 9.5, color: "var(--muted)", fontWeight: 600 }}>
                Counter
              </th>
              {rows.map((c) => (
                <th key={c.sourceId} style={{ textAlign: "right", padding: "8px 10px", fontSize: 11.5, color: "var(--ink)", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {cabinetName(c.sourceId)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 10px", color: "var(--ink2)", whiteSpace: "nowrap" }}>
                  {r.label}
                  {r.hint && <span style={{ color: "var(--muted)", fontSize: 10.5, marginLeft: 6 }}>{r.hint}</span>}
                </td>
                {rows.map((c) => (
                  <td key={c.sourceId} style={{
                    padding: "8px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums",
                    fontWeight: r.strong ? 700 : 500, color: "var(--ink)",
                  }}>
                    {r.get(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** The EMS's live limiter settings, one line per cabinet. */
export function EmsLimitsCard({ rows, kind }: { rows: EmsLimits[] | undefined; kind: "demand" | "export" }) {
  if (!rows?.length) return null;
  const title = kind === "demand" ? "Demand Limiter" : "Export Limiting";

  return (
    <Card title={title} note="Read Live From The Battery Controller">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => {
          const on = kind === "demand" ? r.demandEnabled : r.antiReverseEnabled;
          return (
            <div key={r.sourceId} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {on
                ? <ShieldCheck size={16} style={{ color: "var(--good)", flexShrink: 0, marginTop: 2 }} />
                : <ShieldOff size={16} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />}
              <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.6 }}>
                <span style={{ color: "var(--ink3)", marginRight: 6 }}>{cabinetName(r.sourceId)}</span>
                <strong style={{ color: on ? "var(--good)" : "var(--accent)" }}>
                  {on == null ? "State Unknown"
                    : kind === "demand"
                      ? on ? "Demand Limit Is On" : "Demand Limit Is Off"
                      : on ? "Export Limit Is On" : "Export Limit Is Off"}
                </strong>
                {kind === "demand" ? (
                  <>
                    {r.demandKw != null && <> · Demand Setting {Math.round(r.demandKw)} kW</>}
                    {r.demandLimitPct != null && <> · Limit {Math.round(r.demandLimitPct)}%</>}
                  </>
                ) : (
                  <>
                    {r.antiReverseLowerKw != null && r.antiReverseUpperKw != null
                      ? <> · Keeps Export Between {Math.round(r.antiReverseLowerKw)}–{Math.round(r.antiReverseUpperKw)} kW</>
                      : r.antiReverseUpperKw != null && <> · Limit {Math.round(r.antiReverseUpperKw)} kW</>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
