"use client";
import { useState } from "react";
import { useAvailableCounters, useEnergyCounters, useDayStoredDelta } from "@/hooks/useCurveReport";
import { SITE_OVERLAY_FOR } from "@/lib/api/overlay/stations";
import { useStations } from "@/hooks/useStations";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { RotateCcw, Search, Download } from "lucide-react";
import type { TodRow } from "@/lib/api/types";
import type { EnergyCounter } from "@/lib/api/services/curveReport.service";
import { istDate } from "@/lib/api/time";
import { downloadCsv } from "@/lib/csv";
import { TodDateCell, todValue, todRowNote } from "./todRowNote";

/* Tariff (time-of-day) periods, in the words a bill uses; the tooltip says what each is. */
const TOD = ["Peak","Shoulder","Normal","Off-Peak","Total"] as const;
const TOD_TITLE: Record<string, string> = {
  Peak: "The most expensive tariff hours",
  Shoulder: "Hours priced between peak and normal",
  Normal: "Hours at the standard rate",
  "Off-Peak": "The cheapest tariff hours, usually overnight",
  Total: "All hours of the day",
};

function sum(rows: TodRow[], key: keyof TodRow) { return rows.reduce((a,r) => a + (r[key] as number), 0); }

function TodTable({ title, unit, rows }: { title:string; unit:string; rows:TodRow[] }) {
  return (
    <div className="eq-card min-w-0">
      <div className="px-4 py-3 border-b border-line">
        <p className="text-[12.5px] font-semibold text-ink">{title}</p>
        <p className="text-[11px] font-mono text-muted tracking-[1.2px] mt-0.5">{unit}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line bg-surface2/40">
              <th className="text-left py-2.5 px-3 text-[11px] font-mono tracking-[1.2px] text-muted">Date</th>
              {TOD.map(h=><th key={h} title={TOD_TITLE[h]} className="text-right py-2.5 px-3 text-[11px] font-mono tracking-[1.2px] text-muted">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={6} className="text-center py-8 text-muted text-[12px]">Empty Data</td></tr>
              : rows.map((r,i)=>(
                <tr key={r.date} className={`border-b border-line/40 last:border-none ${i%2===0?"bg-surface2/15":""}`}>
                  <TodDateCell row={r} />
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{todValue(r, r.peak)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{todValue(r, r.shoulder)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{todValue(r, r.flat)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{todValue(r, r.valley)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-ink">{todValue(r, r.total)}</td>
                </tr>
              ))
            }
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-surface2/40">
              <td className="py-2 px-3 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold">Total</td>
              {(["peak","shoulder","flat","valley","total"] as const).map(k=>(
                <td key={k} className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-accent">{rows.some(r => !r.missing) ? sum(rows,k).toFixed(2) : "—"}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Report catalogue ─────────────────────────────────────────────────────────
//
// Every report is built from the station's cumulative kWh counters. A table is
// either one counter as read, or the ToD-band difference of two (a − b).

type TableSpec = { title: string } & ({ counter: EnergyCounter } | { minus: [EnergyCounter, EnergyCounter]; floorZero?: boolean });

interface ReportSpec {
  key: string;
  label: string;
  group: string;
  tables: TableSpec[];
  /** Adds the daily charge/discharge round-trip table. */
  efficiency?: boolean;
  /** Show whichever tables the site can fill, instead of needing all of them. */
  partial?: boolean;
}

const COUNTER_LABEL: Record<EnergyCounter, string> = {
  charge: "Charge", discharge: "Discharge", solar: "Solar Generation",
  gridImport: "Grid Import", gridExport: "Grid Export",
};

const ALL_FLOWS: TableSpec[] = (Object.keys(COUNTER_LABEL) as EnergyCounter[])
  .map(c => ({ title: `Daily ${COUNTER_LABEL[c]} (kWh)`, counter: c }));

function reportsFor(hasBess: boolean, hasGrid = true): ReportSpec[] {
  return [
    { key: "station-total", label: "Station Total Energy", group: "Overview",
      tables: hasBess
        ? [{ title: "Daily Charge (kWh)", counter: "charge" }, { title: "Daily Discharge (kWh)", counter: "discharge" }]
        : [{ title: "Daily Generation (kWh)", counter: "solar" }, { title: "Daily Export (kWh)", counter: "gridExport" }] },
    { key: "all-flows", label: "All Energy Flows", group: "Overview", tables: ALL_FLOWS, partial: true },

    { key: "charge",       label: "Charge Energy",         group: "Battery Storage", tables: [ALL_FLOWS[0]] },
    { key: "discharge",    label: "Discharge Energy",      group: "Battery Storage", tables: [ALL_FLOWS[1]] },
    { key: "net-storage",  label: "Net Storage Energy",    group: "Battery Storage",
      tables: [{ title: "Daily Net Discharge − Charge (kWh)", minus: ["discharge", "charge"] }] },
    { key: "efficiency",   label: "Round-Trip Efficiency", group: "Battery Storage", tables: [], efficiency: true },

    { key: "solar",        label: "Solar Generation",      group: "Solar", tables: [ALL_FLOWS[2]] },
    { key: "self-use",     label: "Solar Self-Consumption", group: "Solar",
      /* With no grid nothing can be exported, so every kWh the inverter made
         was used on site (by the load or the battery). */
      tables: hasGrid
        ? [{ title: "Daily Solar Used On Site (kWh)", minus: ["solar", "gridExport"], floorZero: true }]
        : [{ title: "Daily Solar Used On Site (kWh) · No Grid, So All Of It", counter: "solar" }] },

    { key: "grid-import",  label: "Grid Import",           group: "Grid", tables: [ALL_FLOWS[3]] },
    { key: "grid-export",  label: "Grid Export",           group: "Grid", tables: [ALL_FLOWS[4]] },
    { key: "net-grid",     label: "Net Grid Energy",       group: "Grid",
      tables: [{ title: "Daily Net Import − Export (kWh)", minus: ["gridImport", "gridExport"] }] },
  ];
}

/** Counters a report cannot run without. */
function requiredOf(r: ReportSpec): EnergyCounter[] {
  return r.partial ? [] : countersOf(r);
}

function countersOf(r: ReportSpec): EnergyCounter[] {
  const cs = r.tables.flatMap(t => "counter" in t ? [t.counter] : t.minus);
  if (r.efficiency) cs.push("charge", "discharge");
  return [...new Set(cs)];
}

const BANDS = ["peak","shoulder","flat","valley"] as const;

function minusRows(a: TodRow[], b: TodRow[], floorZero = false): TodRow[] {
  const byDate = new Map(b.map(r => [r.date, r]));
  const dates  = [...new Set([...a.map(r => r.date), ...b.map(r => r.date)])].sort();
  const aBy    = new Map(a.map(r => [r.date, r]));
  return dates.map(date => {
    const x = aBy.get(date), y = byDate.get(date);
    const row: TodRow = { date, peak: 0, shoulder: 0, flat: 0, valley: 0, total: 0 };
    if (!x || !y || x.missing || y.missing) return { ...row, missing: true, coverage: 0 };
    row.coverage = Math.min(x.coverage ?? 1, y.coverage ?? 1);
    for (const k of BANDS) {
      const v = (x?.[k] ?? 0) - (y?.[k] ?? 0);
      row[k] = floorZero ? Math.max(0, v) : v;
    }
    row.total = row.peak + row.shoulder + row.flat + row.valley;
    return row;
  });
}

/**
 * Round trip corrected for state-of-charge drift: η = D ÷ (C − ΔStored),
 * ΔStored from S1 SOC at the day's two edges × each cabinet's capacity. A day
 * whose SOC edges are unknown, whose throughput is under 20 kWh, or whose
 * correction is more than 35 % of its charge shows "—" with the reason, not
 * the raw ratio (which reads over 100 % on any day that ends emptier).
 */
function EfficiencyTable({ charge, discharge, stored }: { charge: TodRow[]; discharge: TodRow[]; stored?: Record<string, number | null> }) {
  const dis   = new Map(discharge.filter(r => !r.missing).map(r => [r.date, r.total]));
  const dates = [...new Set([...charge.map(r => r.date), ...discharge.map(r => r.date)])].sort();
  const cha   = new Map(charge.filter(r => !r.missing).map(r => [r.date, r.total]));
  /* The SOC edges span the whole day; energy on a partly sampled day does not,
     so the correction would compare different stretches of time. */
  const partialDay = new Set([...charge, ...discharge]
    .filter(r => !r.missing && !r.metered && (r.coverage ?? 1) < 0.98).map(r => r.date));
  const rte = (c: number, d: number, ds: number | null | undefined, date?: string): { v: string; why?: string } => {
    if (date && partialDay.has(date)) return { v: "—", why: "Partial Day" };
    if (ds == null) return { v: "—", why: stored ? "SOC Edges Unknown" : "Reading SOC…" };
    if (c + d < 20) return { v: "—", why: "Too Little Throughput" };
    if (Math.abs(ds) > 0.35 * Math.max(c, 1)) return { v: "—", why: "SOC Drift Dominates" };
    const den = c - ds;
    const p = den > 1 ? (d / den) * 100 : NaN;
    if (!Number.isFinite(p) || p < 60 || p > 100) return { v: "—", why: `Out Of Range (${Number.isFinite(p) ? p.toFixed(0) : "?"}%)` };
    return { v: `${p.toFixed(1)}%` };
  };
  const tc = sum(charge, "total"), td = sum(discharge, "total");
  const known = dates.filter(d => cha.has(d) && dis.has(d));
  const tds = stored && known.length && known.every(d => stored[d] != null && !partialDay.has(d))
    ? known.reduce((a, d) => a + (stored[d] as number), 0) : null;
  const th = "text-right py-2.5 px-3 text-[11px] font-mono tracking-[1.2px] text-muted";
  return (
    <div className="eq-card min-w-0">
      <div className="px-4 py-3 border-b border-line">
        <p className="text-[12.5px] font-semibold text-ink">Daily Round-Trip Efficiency</p>
        <p className="text-[11px] font-mono text-muted tracking-[1.2px] mt-0.5">Discharge ÷ (Charge − ΔStored) · SOC-Corrected</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line bg-surface2/40">
              <th className={th.replace("text-right","text-left")}>Date</th>
              <th className={th}>Charge (kWh)</th><th className={th}>Discharge (kWh)</th><th className={th}>ΔStored (kWh)</th><th className={th}>Efficiency</th>
            </tr>
          </thead>
          <tbody>
            {dates.length===0
              ? <tr><td colSpan={5} className="text-center py-8 text-muted text-[12px]">Empty Data</td></tr>
              : dates.map((d,i)=>{
                const c = cha.get(d), x = dis.get(d);
                const none = c == null || x == null;
                const ds = stored?.[d];
                const e = none ? { v: "—" } : rte(c, x, ds, d);
                return (
                  <tr key={d} className={`border-b border-line/40 last:border-none ${i%2===0?"bg-surface2/15":""}`}>
                    <td className="py-2 px-3 text-ink2 whitespace-nowrap">{d}{none && <div className="text-[10.5px] font-mono text-muted">No Data</div>}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{c == null ? "—" : c.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{x == null ? "—" : x.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{ds == null ? "—" : ds.toFixed(1)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-ink">
                      {e.v}{e.why && <div className="text-[10px] font-normal text-muted">{e.why}</div>}
                    </td>
                  </tr>
                );
              })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-surface2/40">
              <td className="py-2 px-3 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold">Total</td>
              <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-accent">{tc.toFixed(2)}</td>
              <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-accent">{td.toFixed(2)}</td>
              <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-accent">{tds == null ? "—" : tds.toFixed(1)}</td>
              <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-accent">{(() => { const e = known.some(d => partialDay.has(d)) ? { v: "—", why: "Includes Partial Days" } : rte(tc, td, tds); return <>{e.v}{e.why && <div className="text-[10px] font-normal text-muted">{e.why}</div>}</>; })()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function PowerQuantityReport({ stationId }: { stationId: string }) {
  const today = istDate();
  const monthStart = today.slice(0,8)+"01";
  const [start, setStart] = useState(monthStart);
  const [end,   setEnd]   = useState(today);
  const [searchStart, setSearchStart] = useState(monthStart);
  const [searchEnd,   setSearchEnd]   = useState(today);
  const [reportKey, setReportKey] = useState("station-total");
  const stations = useStations();
  const hasBess = stations.data?.find(s => s.id === stationId)?.hasBess ?? true;

  const hasGrid   = SITE_OVERLAY_FOR(stationId).assets?.includes("grid") ?? true;
  const reports   = reportsFor(hasBess, hasGrid);
  const available = useAvailableCounters(stationId).data;
  // Until key discovery answers, every report stays selectable.
  const canRun    = (r: ReportSpec) => !available || (r.partial
    ? countersOf(r).some(c => available.includes(c))
    : requiredOf(r).every(c => available.includes(c)));
  const chosen    = reports.find(r => r.key === reportKey) ?? reports[0];
  // Land on something this site can show rather than a disabled option.
  const report    = canRun(chosen) ? chosen : reports.find(canRun) ?? chosen;
  const groups    = [...new Set(reports.map(r => r.group))];

  // A partial report only shows the counters this site actually has.
  const tables = report.partial && available
    ? report.tables.filter(t => "counter" in t && available.includes(t.counter))
    : report.tables;
  const counters = countersOf({ ...report, tables });
  const { data, isLoading } = useEnergyCounters(stationId, canRun(report) ? counters : [], searchStart, searchEnd);
  const stored = useDayStoredDelta(stationId, searchStart, searchEnd, !!report.efficiency);

  const rowsFor = (t: TableSpec): TodRow[] =>
    "counter" in t
      ? data?.[t.counter] ?? []
      : minusRows(data?.[t.minus[0]] ?? [], data?.[t.minus[1]] ?? [], t.floorZero);

  const missing = report.partial
    ? (canRun(report) ? [] : countersOf(report))
    : requiredOf(report).filter(c => available && !available.includes(c));

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="surface-card p-4 flex items-center gap-3 flex-wrap">
        <select
          value={report.key}
          onChange={e=>setReportKey(e.target.value)}
          aria-label="Report"
          className="filter-input h-8 text-[11.5px] w-auto min-w-[200px]"
        >
          {groups.map(g => (
            <optgroup key={g} label={g}>
              {reports.filter(r => r.group === g).map(r => (
                <option key={r.key} value={r.key} disabled={!canRun(r)}>
                  {r.label}{canRun(r) ? "" : " — Not Metered"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <input type="date" value={start} onChange={e=>setStart(e.target.value)} className="filter-input h-8 text-[11.5px] w-[130px]"/>
        <span className="text-muted text-[11px]">–</span>
        <input type="date" value={end}   onChange={e=>setEnd(e.target.value)}   className="filter-input h-8 text-[11.5px] w-[130px]"/>
        <button onClick={()=>{setStart(monthStart);setEnd(today);setSearchStart(monthStart);setSearchEnd(today);setReportKey("station-total");}} className="btn-outline"><RotateCcw size={12}/>Reset</button>
        <button onClick={()=>{setSearchStart(start);setSearchEnd(end);}} className="btn-primary"><Search size={12}/>Search</button>
        <button
          className="btn-outline"
          disabled={!data || missing.length > 0}
          onClick={() => {
            const rows: unknown[][] = [["table", "date", "peak", "shoulder", "flat", "valley", "total", "note"]];
            for (const t of tables)
              for (const r of rowsFor(t))
                rows.push([t.title, r.date, ...[r.peak, r.shoulder, r.flat, r.valley, r.total].map(v => r.missing ? "" : v.toFixed(2)), todRowNote(r)]);
            if (report.efficiency) {
              const dis = new Map((data?.discharge ?? []).filter(r => !r.missing).map(r => [r.date, r.total]));
              for (const c of data?.charge ?? []) {
                const d = dis.get(c.date);
                const ds = stored.data?.[c.date];
                const den = ds != null ? c.total - ds : NaN;
                const p = !c.missing && d != null && den > 1 ? (d / den) * 100 : NaN;
                const ok = Number.isFinite(p) && p >= 60 && p <= 100;
                rows.push(["Daily Round-trip Efficiency (%, SOC-corrected)", c.date, "", "", "", "", ok ? p.toFixed(1) : "",
                  c.missing || d == null ? "no data" : ds == null ? "SOC edges unknown" : ok ? `dStored ${ds} kWh` : "not reportable"]);
              }
            }
            downloadCsv(`${report.key}-${searchStart}_${searchEnd}.csv`, rows);
          }}
        ><Download size={12}/>Export</button>
      </div>

      {missing.length > 0 ? (
        <EmptyState
          title="Not Metered At This Station"
          description=""
        />
      ) : isLoading ? <LoadingState rows={5}/> : tables.length === 0 && !report.efficiency ? (
        <EmptyState title="No Energy Counters" description="" />
      ) : (
        <div className={`grid gap-4 ${tables.length + (report.efficiency ? 1 : 0) > 1 ? "lg:grid-cols-2" : ""}`}>
          {tables.map(t => <TodTable key={t.title} title={t.title} unit="kWh" rows={rowsFor(t)} />)}
          {report.efficiency && <EfficiencyTable charge={data?.charge ?? []} discharge={data?.discharge ?? []} stored={stored.data} />}
        </div>
      )}
    </div>
  );
}
