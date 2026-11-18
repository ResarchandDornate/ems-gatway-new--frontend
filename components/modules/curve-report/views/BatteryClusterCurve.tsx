"use client";
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useClusterCurve, useClusterStat } from "@/hooks/useCurveReport";
import { useHierarchy } from "@/hooks/useEquipment";
import { LoadingState } from "@/components/shared/LoadingState";
import { RotateCcw, Search } from "lucide-react";
import { istDate } from "@/lib/api/time";

const STEEL="#5B8AB4", TEAL="#6FA3A0", LINE="var(--chart-grid)";
const tooltip = { background:"var(--tooltip-bg)",border:"1px solid var(--tooltip-line)",borderRadius:8,fontSize:11,color:"var(--tooltip-ink)",padding:"8px 10px" };
const ax = { tickLine:false, axisLine:false, tick:{ fill:"#6B7280", fontSize:10 } };

function ChartCard({ title, children }: { title:string; children:React.ReactNode }) {
  return (
    <div className="surface-card p-5">
      <div className="flex items-center gap-2 mb-4"><div className="w-1 h-5 rounded-full bg-accent"/><h3 className="text-[13px] font-semibold text-ink">{title}</h3></div>
      {children}
    </div>
  );
}

export function BatteryClusterCurve({ stationId }: { stationId: string }) {
  const today = istDate();
  const weekAgo = istDate(Date.now()-7*86400000);
  const [start, setStart] = useState(weekAgo);
  const [end,   setEnd]   = useState(today);
  const [searchStart, setSearchStart] = useState(weekAgo);
  const [searchEnd,   setSearchEnd]   = useState(today);

  // Resolve real rackId from hierarchy — must be "{deviceId}-r{N}"
  const { data: hierarchy } = useHierarchy(stationId);
  const grid    = hierarchy?.grids[0];
  const matrix  = grid?.matrices[0];
  const cabinet = matrix?.cabinets[0];
  const pile    = cabinet?.piles[0];
  const rack    = pile?.racks[0];
  const rackId  = rack?.id ?? "";
  // Device path label — derived from the live hierarchy, never a fabricated placeholder
  const rackPath = grid && matrix && cabinet && pile && rack
    ? [grid.name, matrix.name, cabinet.name, pile.name, rack.name].join("-")
    : "";

  const stat   = useClusterStat(rackId);
  const { data, isLoading } = useClusterCurve(rackId, searchStart, searchEnd);
  const d = data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Selector */}
      <div className="surface-card p-4 flex items-center gap-3 flex-wrap">
        <div className="filter-input bg-surface2 text-ink2 text-[11.5px] flex items-center min-w-[320px] h-8 px-3">
          {rackPath || "—"}
        </div>
        <input type="date" value={start} onChange={e=>setStart(e.target.value)} className="filter-input h-8 text-[11.5px] w-[130px]"/>
        <span className="text-muted text-[11px]">–</span>
        <input type="date" value={end}   onChange={e=>setEnd(e.target.value)}   className="filter-input h-8 text-[11.5px] w-[130px]"/>
        <button onClick={()=>{setStart(weekAgo);setEnd(today);setSearchStart(weekAgo);setSearchEnd(today);}} className="btn-outline"><RotateCcw size={12}/>Reset</button>
        <button onClick={()=>{setSearchStart(start);setSearchEnd(end);}} className="btn-primary"><Search size={12}/>Search</button>
      </div>

      {/* Battery Cluster Temp Info */}
      <div className="surface-card p-5">
        <div className="flex items-center gap-2 mb-4"><div className="w-1 h-5 rounded-full bg-accent"/><h3 className="text-[13px] font-semibold text-ink">Battery Cluster Temp Info</h3></div>
        <div className="flex gap-12">
          <div><span className="text-[28px] font-semibold text-ink">{stat.data?.clusterMaxTempC?.toFixed(1) ?? "—"}</span><span className="text-[12px] text-muted ml-1">°C</span><div className="text-[10px] text-muted font-mono mt-1">Cluster Max Temp</div></div>
          <div><span className="text-[28px] font-semibold text-ink">{stat.data?.clusterMinTempC?.toFixed(1) ?? "—"}</span><span className="text-[12px] text-muted ml-1">°C</span><div className="text-[10px] text-muted font-mono mt-1">Cluster Min Temp</div></div>
        </div>
      </div>

      <ChartCard title="Cluster Max Temp">
        {isLoading?<LoadingState rows={3}/>:(
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={d} margin={{top:4,right:4,left:12,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false}/>
              <XAxis dataKey="t" {...ax} interval={Math.floor(d.length/6)||1}/>
              <YAxis {...ax} tickFormatter={v=>`${v.toFixed(0)}°C`}/>
              <Tooltip contentStyle={tooltip} formatter={(v:number)=>[`${v.toFixed(1)} °C`]}/>
              <Legend wrapperStyle={{fontSize:10,paddingTop:4}} iconType="line" iconSize={12}/>
              <Line type="linear" dataKey="maxTemp" name="Max Temp" stroke={STEEL} strokeWidth={2} dot={false}/>
              <Line type="linear" dataKey="minTemp" name="Min Temp" stroke={TEAL}   strokeWidth={2} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Battery Cluster Voltage Info */}
      <div className="surface-card p-5">
        <div className="flex items-center gap-2 mb-4"><div className="w-1 h-5 rounded-full bg-accent"/><h3 className="text-[13px] font-semibold text-ink">Battery Cluster Voltage Info</h3></div>
        <div className="flex gap-12">
          <div><span className="text-[28px] font-semibold text-ink">{stat.data?.clusterMaxVoltDiffMv?.toFixed(0) ?? "—"}</span><span className="text-[12px] text-muted ml-1">mV</span><div className="text-[10px] text-muted font-mono mt-1">Cluster Max Voltage Diff</div></div>
          <div><span className="text-[28px] font-semibold text-ink">{stat.data?.clusterMinVoltDiffMv?.toFixed(0) ?? "—"}</span><span className="text-[12px] text-muted ml-1">mV</span><div className="text-[10px] text-muted font-mono mt-1">Cluster Min Voltage Diff</div></div>
        </div>
      </div>

      <ChartCard title="Cluster Voltage Diff">
        {isLoading?<LoadingState rows={3}/>:(
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={d} margin={{top:4,right:4,left:12,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false}/>
              <XAxis dataKey="t" {...ax} interval={Math.floor(d.length/6)||1}/>
              <YAxis {...ax} tickFormatter={v=>`${v.toFixed(0)}mV`}/>
              <Tooltip contentStyle={tooltip} formatter={(v:number)=>[`${v.toFixed(1)} mV`]}/>
              <Legend wrapperStyle={{fontSize:10,paddingTop:4}} iconType="line" iconSize={12}/>
              {/* Only the maximum spread is measured. The "Min Volt Diff" series
                  that used to sit here was 30% of this one, not a reading. */}
              <Line type="linear" dataKey="maxVoltDiff" name="Max Volt Diff" stroke={STEEL} strokeWidth={2} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
