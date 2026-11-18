"use client";
import { useState } from "react";
import { useProfitReport } from "@/hooks/useCurveReport";
import { LoadingState } from "@/components/shared/LoadingState";
import { RotateCcw, Search, Download } from "lucide-react";
import type { ProfitRow } from "@/lib/api/types";
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
/** ₹, and what the rupees are: the ToD rate card, or diesel displaced at a flat rate. */
function unitOf(basis: "tod" | "diesel" | "settings" | null | undefined) {
  return basis === "settings" ? "₹ · At The Rate In Settings" : basis === "diesel" ? "₹ · Valued As Diesel Saved, At One Rate" : basis === "tod" ? "₹ · At Time-Of-Day Tariff" : "₹";
}
function sum(rows: ProfitRow[], key: keyof ProfitRow) { return rows.reduce((a,r) => a + (r[key] as number), 0); }

function ProfitTable({ title, unit, rows, showActual, emptyText = "Empty Data" }: { title:string; unit:string; rows:ProfitRow[]; showActual?:boolean; emptyText?:string }) {
  const any = rows.some(r => !r.missing);
  return (
    <div className="flex-1 eq-card">
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
              {showActual && <th className="text-right py-2.5 px-3 text-[11px] font-mono tracking-[1.2px] text-muted">Actual Revenue</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length===0
              ? <tr><td colSpan={showActual?7:6} className="text-center py-8 text-muted text-[12px]">{emptyText}</td></tr>
              : rows.map((r,i)=>(
                <tr key={r.date} className={`border-b border-line/40 last:border-none ${i%2===0?"bg-surface2/15":""}`}>
                  <TodDateCell row={r} />
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{todValue(r, r.peak)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{todValue(r, r.shoulder)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{todValue(r, r.flat)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-ink2">{todValue(r, r.valley)}</td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-ink">{todValue(r, r.total)}</td>
                  {showActual && <td className="py-2 px-3 text-right font-mono tabular-nums text-good font-semibold">{todValue(r, r.actualRevenue)}</td>}
                </tr>
              ))
            }
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-surface2/40">
              <td className="py-2 px-3 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold">Total</td>
              {(["peak","shoulder","flat","valley","total"] as const).map(k=>(
                <td key={k} className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-accent">{any ? sum(rows,k).toFixed(2) : "—"}</td>
              ))}
              {showActual && <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-good">{any ? sum(rows,"actualRevenue").toFixed(2) : "—"}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function ProfitReportView({ stationId }: { stationId: string }) {
  const today = istDate();
  const monthStart = today.slice(0,8)+"01";
  const [start, setStart] = useState(monthStart);
  const [end,   setEnd]   = useState(today);
  const [searchStart, setSearchStart] = useState(monthStart);
  const [searchEnd,   setSearchEnd]   = useState(today);

  const { data, isLoading } = useProfitReport(stationId, searchStart, searchEnd);

  return (
    <div className="flex flex-col gap-4">
      <div className="surface-card p-4 flex items-center gap-3 flex-wrap">
        <input type="date" value={start} onChange={e=>setStart(e.target.value)} className="filter-input h-8 text-[11.5px] w-[130px]"/>
        <span className="text-muted text-[11px]">–</span>
        <input type="date" value={end}   onChange={e=>setEnd(e.target.value)}   className="filter-input h-8 text-[11.5px] w-[130px]"/>
        <button onClick={()=>{setStart(monthStart);setEnd(today);setSearchStart(monthStart);setSearchEnd(today);}} className="btn-outline"><RotateCcw size={12}/>Reset</button>
        <button onClick={()=>{setSearchStart(start);setSearchEnd(end);}} className="btn-primary"><Search size={12}/>Search</button>
        <button
          className="btn-outline"
          disabled={!data}
          onClick={() => {
            if (!data) return;
            const head = ["table", "date", "peak", "shoulder", "flat", "valley", "total", "actual_revenue", "note"];
            const f = (r: ProfitRow, v: number) => r.missing ? "" : v.toFixed(2);
            const out = (name: string, rows: ProfitRow[], actual: boolean) =>
              rows.map(r => [name, r.date, f(r, r.peak), f(r, r.shoulder), f(r, r.flat), f(r, r.valley), f(r, r.total), actual ? f(r, r.actualRevenue) : "", todRowNote(r)]);
            downloadCsv(`profit-${searchStart}_${searchEnd}.csv`, [
              head,
              ...out("charge_cost_rs", data.chargeCost ?? [], false),
              ...out("discharge_revenue_rs", data.dischargeRevenue ?? [], true),
            ]);
          }}
        ><Download size={12}/>Export</button>
      </div>

      {isLoading ? <LoadingState rows={5}/> : (
        <div className="flex flex-col lg:flex-row gap-4">
          <ProfitTable title="Daily Charge Cost" unit={unitOf(data?.rates.chargeBasis)} rows={data?.chargeCost ?? []}
            emptyText={data && !data.rates.charge ? "No Charge Tariff Configured For This Site" : undefined} />
          <ProfitTable title="Daily Discharge Revenue" unit={unitOf(data?.rates.dischargeBasis)} rows={data?.dischargeRevenue ?? []} showActual
            emptyText={data && !data.rates.discharge ? "No Tariff Configured For This Site" : undefined} />
        </div>
      )}
    </div>
  );
}
