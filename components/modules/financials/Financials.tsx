"use client";

/**
 * Financials — what the battery earned, by period and by month, opened from
 * the dashboard's Revenue card. The numbers are useFinancials': units
 * discharged × (cost of the source replaced − cost of charging).
 */

import Link from "next/link";
import type { Station } from "@/lib/api/types";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { useFinancials, type FinancialRow } from "@/hooks/useFinancials";
import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { fmtINRCompact } from "@/lib/format";

const inr = (n: number | null) => (n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const kwh = (n: number | null) => (n == null ? "—" : `${Math.round(n).toLocaleString("en-IN")} kWh`);
const rate = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })} / kWh`;

export function Financials({ station }: { station: Station }) {
  const { selected, all } = useSelectedCabinets();
  const wholeSite = selected.length === all.length;
  const { rates, periods, byMonth } = useFinancials(station.id, selected.map((c) => c.sourceId), wholeSite);
  const get = (id: string) => periods.find((p) => p.id === id);

  return (
    <div className="dash-page" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, minWidth: 0 }}>
      <PageHeader title="Financials">
        <PageStat label="This Month" value={get("month")?.revenueRs == null ? "—" : fmtINRCompact(get("month")!.revenueRs!)} />
        <PageStat label="This Year" value={get("year")?.revenueRs == null ? "—" : fmtINRCompact(get("year")!.revenueRs!)} />
        <PageStat label="Lifetime" value={get("lifetime")?.revenueRs == null ? "—" : fmtINRCompact(get("lifetime")!.revenueRs!)} />
      </PageHeader>

      <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad)" }}>
        <h3 className="card-title" style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          Rates
          <Link href="/settings" style={{ fontSize: 11.5, fontWeight: 500, color: "var(--accent)" }}>Edit In Settings ›</Link>
        </h3>
        {rates ? (
          <div className="fin-rates">
            <Rate letter="A" label={`Cost Of Charging${rates.chargeSource !== "—" ? ` · ${rates.chargeSource}` : ""}`} value={rate(rates.chargeRs)} />
            <Rate letter="B" label={`Cost Of Discharging · ${rates.replacedSource}`} value={rate(rates.dischargeRs)} />
            <Rate letter="C" label="Saving Per Unit" value={rate(rates.savingRs)} strong warn={rates.savingRs < 0} />
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            No rates yet. <Link href="/settings" style={{ color: "var(--accent)" }}>Fill In Settings ›</Link>
          </div>
        )}
        {rates?.from === "diesel" && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
            Using the site&apos;s diesel rate until rates are saved in Settings.
          </div>
        )}
      </div>

      <Table title="By Period" rows={periods} />
      <Table title="By Month" rows={byMonth} />
    </div>
  );
}

function Rate({ letter, label, value, strong, warn }: { letter: string; label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{
        display: "inline-grid", placeItems: "center", width: 20, height: 20, borderRadius: 999, flex: "0 0 auto",
        fontSize: 10.5, fontWeight: 700, color: "var(--accent)", border: "1px solid var(--line2)",
      }}>{letter}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
        <div style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? 700 : 600, color: warn ? "var(--red)" : "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      </div>
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: FinancialRow[] }) {
  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad)" }}>
      <h3 className="card-title" style={{ marginBottom: 6 }}>{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <table className="fin-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Units Discharged</th>
              <th>Avoided Cost</th>
              <th>Charging Cost</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.label}
                  {r.basis === "typed" && <span className="fin-tag">Entered</span>}
                </td>
                <td>{kwh(r.kwh)}</td>
                <td>{inr(r.avoidedRs)}</td>
                <td>{inr(r.chargingRs)}</td>
                <td style={{ fontWeight: 700, color: r.revenueRs != null && r.revenueRs < 0 ? "var(--red)" : "var(--ink)" }}>{inr(r.revenueRs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
