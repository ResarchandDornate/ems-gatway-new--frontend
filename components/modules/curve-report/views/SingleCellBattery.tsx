"use client";
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useCellCurve } from "@/hooks/useCurveReport";
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

export function SingleCellBattery({ stationId }: { stationId: string }) {
  const today = istDate();
  const weekAgo = istDate(Date.now()-7*86400000);
  const [start, setStart] = useState(weekAgo);
  const [end,   setEnd]   = useState(today);
  const [searchStart, setSearchStart] = useState(weekAgo);
  const [searchEnd,   setSearchEnd]   = useState(today);

  // Resolve real rackId from the equipment hierarchy (deviceUUID-r1)
  const { data: hierarchy } = useHierarchy(stationId);
  const grid      = hierarchy?.grids[0];
  const matrix    = grid?.matrices[0];
  const cabinet   = matrix?.cabinets[0];
  const pile      = cabinet?.piles[0];
  const firstRack = pile?.racks[0];
  // cellId must be "{deviceId}-r{N}-cell{M}" — matching the format in fetchCellDataReal
  const cellId = firstRack ? `${firstRack.id}-cell1` : "";
  // Device path label — derived from the live hierarchy, never a fabricated placeholder.
  // Empty when the hierarchy exposes no matching cell node (e.g. synthesised racks with no cells).
  const cell = firstRack?.cells?.find(c => c.id === cellId);
  const cellPath = grid && matrix && cabinet && pile && firstRack && cell
    ? [grid.name, matrix.name, cabinet.name, pile.name, firstRack.name, cell.name].join("-")
    : "";

  const { data, isLoading } = useCellCurve(cellId, searchStart, searchEnd);
  const d = data ?? [];

  if (!cellId) return <div className="p-5"><LoadingState rows={4} /></div>;

  return (
    <div className="flex flex-col gap-4">
      {/* Selector */}
      <div className="surface-card p-4 flex items-center gap-3 flex-wrap">
        <div className="filter-input bg-surface2 text-ink2 text-[11.5px] flex items-center min-w-[360px] h-8 px-3">
          {cellPath || "—"}
        </div>
        <input type="date" value={start} onChange={e=>setStart(e.target.value)} className="filter-input h-8 text-[11.5px] w-[130px]"/>
        <span className="text-muted text-[11px]">–</span>
        <input type="date" value={end}   onChange={e=>setEnd(e.target.value)}   className="filter-input h-8 text-[11.5px] w-[130px]"/>
        <button onClick={()=>{setStart(weekAgo);setEnd(today);setSearchStart(weekAgo);setSearchEnd(today);}} className="btn-outline"><RotateCcw size={12}/>Reset</button>
        <button onClick={()=>{setSearchStart(start);setSearchEnd(end);}} className="btn-primary"><Search size={12}/>Search</button>
      </div>

      <ChartCard title="Cell Voltage">
        {isLoading?<LoadingState rows={3}/>:(
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d} margin={{top:4,right:4,left:12,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false}/>
              <XAxis dataKey="t" {...ax} interval={Math.floor(d.length/8)||1}/>
              <YAxis {...ax} domain={["auto","auto"]} tickFormatter={v=>`${v}mV`}/>
              <Tooltip contentStyle={tooltip} formatter={(v:number)=>[`${v.toFixed(1)} mV`,"Voltage"]}/>
              <Line type="linear" dataKey="voltage" name="Cell Voltage (mV)" stroke={STEEL} strokeWidth={2} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Cell Temperature">
        {isLoading?<LoadingState rows={3}/>:(
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d} margin={{top:4,right:4,left:12,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false}/>
              <XAxis dataKey="t" {...ax} interval={Math.floor(d.length/8)||1}/>
              <YAxis {...ax} tickFormatter={v=>`${v}°C`}/>
              <Tooltip contentStyle={tooltip} formatter={(v:number)=>[`${v.toFixed(1)} °C`,"Temperature"]}/>
              <Line type="linear" dataKey="temperature" name="Cell Temperature (°C)" stroke={TEAL} strokeWidth={2} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
