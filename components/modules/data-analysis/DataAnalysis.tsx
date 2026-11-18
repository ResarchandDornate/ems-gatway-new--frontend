"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { BarChart3, Table2, Search, Download } from "lucide-react";
import { usePointList, usePointHistory } from "@/hooks/useDataAnalysis";
import { LoadingState }   from "@/components/shared/LoadingState";
import { EmptyState }     from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { istDateTimeInput } from "@/lib/api/time";

const STEEL = "#5B8AB4", LINE = "var(--chart-grid)";
const tooltipStyle = { background:"var(--tooltip-bg)",border:"1px solid var(--tooltip-line)",borderRadius:8,fontSize:11,color:"var(--tooltip-ink)",padding:"8px 10px" };
const axisProps = { tickLine:false, axisLine:false, tick:{ fill:"#6B7280", fontSize:10 } };

type ViewMode = "chart" | "table";

/* The input shows IST wall time, whatever zone the browser is in. */
function toDatetimeLocal(dt: Date) {
  return istDateTimeInput(dt.getTime());
}

export function DataAnalysis({ stationId }: { stationId: string }) {

  const now     = new Date();
  const weekAgo = new Date(now.getTime() - 7*24*3600_000);
  const [startDt, setStartDt]   = useState(toDatetimeLocal(weekAgo));
  const [endDt,   setEndDt]     = useState(toDatetimeLocal(now));
  const [searchStart, setSearchStart] = useState(toDatetimeLocal(weekAgo));
  const [searchEnd,   setSearchEnd]   = useState(toDatetimeLocal(now));
  const [tagId,   setTagId]     = useState("");
  const [searchTag, setSearchTag] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("chart");


  const points  = usePointList(stationId);
  const history = usePointHistory(searchTag, searchStart, searchEnd);

  const selectedPoint = points.data?.find(p => p.tagId === searchTag);
  const histData = history.data ?? [];
  // Sample for chart performance
  const sampled = histData.filter((_,i) => i % 2 === 0);

  function handleSearch() {
    setSearchStart(startDt);
    setSearchEnd(endDt);
    setSearchTag(tagId);
  }

  return (
    <div className="flex flex-col gap-3 overflow-hidden page-fill">

      {/* ── Hero strip ───────────────────────────────────────────────── */}
      {/* Replaces a sidebar holding a single, permanently-active button. */}
      <PageHeader title="Data Analysis" info="Historical telemetry for a single tag over a chosen range, as chart or table." />

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0 overflow-hidden">

        {/* Controls row */}
        <div className="surface-card p-3 flex flex-col gap-2 flex-none">

          {/* Row 1: Time + view toggle + Search + Export */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11.5px] text-ink3 flex-shrink-0">Time Select:</span>
            <input
              type="datetime-local" value={startDt} onChange={e => setStartDt(e.target.value)}
              className="filter-input h-8 text-[11.5px] w-[180px]"
            />
            <span className="text-muted text-[11px]">–</span>
            <input
              type="datetime-local" value={endDt} onChange={e => setEndDt(e.target.value)}
              className="filter-input h-8 text-[11.5px] w-[180px]"
            />

            {/* Chart / Table toggle */}
            <div className="flex items-center gap-0.5 bg-surface/80 ring-1 ring-line rounded-md p-0.5 ml-2">
              <button
                onClick={() => setViewMode("chart")}
                className={["flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-colors",
                  viewMode==="chart" ? "bg-accent/15 text-accent ring-1 ring-accent/20" : "text-muted hover:text-ink"
                ].join(" ")}
              >
                <BarChart3 size={13}/> Chart
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={["flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-colors",
                  viewMode==="table" ? "bg-accent/15 text-accent ring-1 ring-accent/20" : "text-muted hover:text-ink"
                ].join(" ")}
              >
                <Table2 size={13}/> Table
              </button>
            </div>

            <button onClick={handleSearch} className="btn-primary"><Search size={12}/>Search</button>
            <button className="btn-outline"><Download size={12}/>Export</button>
          </div>

          {/* Row 2: Point Select */}
          <div className="flex items-center gap-3">
            <span className="text-[11.5px] text-ink3 flex-shrink-0">Point Select:</span>
            <select
              value={tagId} onChange={e => setTagId(e.target.value)}
              className="filter-input flex-1 h-9"
            >
              <option value="">Please Select</option>
              {(points.data ?? []).map(p => (
                <option key={p.tagId} value={p.tagId}>{p.name} ({p.unit})</option>
              ))}
            </select>
          </div>
        </div>

        {/* Point History Data */}
        <div className="surface-card overflow-hidden flex-1 min-h-0 flex flex-col">
          <div className="px-5 py-4 border-b border-line flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-accent" />
            <h3 className="text-[13px] font-semibold text-ink">Point History Data</h3>
            {selectedPoint && (
              <span className="ml-2 text-[11px] text-muted font-mono">
                {selectedPoint.name} · {selectedPoint.unit}
              </span>
            )}
          </div>

          {/* No point selected */}
          {!searchTag && (
            <div className="p-5">
              <EmptyState
                title="No Point Selected"
                description="Select a measurement point from the dropdown above, then click Search."
              />
            </div>
          )}

          {/* Loading */}
          {searchTag && history.isLoading && (
            <div className="p-4"><LoadingState rows={6} /></div>
          )}

          {/* Chart view */}
          {searchTag && !history.isLoading && viewMode === "chart" && (
            <div className="p-5">
              {sampled.length === 0 ? (
                <EmptyState title="No Data" description="No data available for the selected time range." />
              ) : (
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={sampled} margin={{top:8,right:8,left:14,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false}/>
                    <XAxis dataKey="t" {...axisProps} interval={Math.floor(sampled.length/8)}/>
                    <YAxis {...axisProps} tickFormatter={v => `${v}${selectedPoint?.unit ?? ""}`}/>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v:number) => [`${v} ${selectedPoint?.unit ?? ""}`, selectedPoint?.name ?? "Value"]}
                    />
                    <Line
                      type="linear" dataKey="value" name={selectedPoint?.name ?? "Value"}
                      stroke={STEEL} strokeWidth={2} dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Table view */}
          {searchTag && !history.isLoading && viewMode === "table" && (
            <div className="overflow-x-auto">
              {histData.length === 0 ? (
                <EmptyState title="No Data" description="No data available for the selected time range." />
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface2/40">
                      <th className="text-left py-3 px-4 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold">Timestamp</th>
                      <th className="text-right py-3 px-4 text-[11px] font-mono tracking-[1.2px] text-muted font-semibold">
                        {selectedPoint?.name ?? "Value"} ({selectedPoint?.unit ?? "—"})
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {histData.map((row, i) => (
                      <tr key={row.t} className={`border-b border-line/40 last:border-none ${i%2===0?"bg-surface2/15":""}`}>
                        <td className="py-2.5 px-4 font-mono text-ink3">{row.t}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-ink">
                          {row.value.toFixed(2)} <span className="text-muted font-normal">{selectedPoint?.unit}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
