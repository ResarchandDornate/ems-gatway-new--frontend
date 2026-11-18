"use client";
import { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { usePcsCurve } from "@/hooks/useCurveReport";
import { useHierarchy } from "@/hooks/useEquipment";
import { LoadingState } from "@/components/shared/LoadingState";
import { RotateCcw, Search } from "lucide-react";
import { istDate } from "@/lib/api/time";

const STEEL="#5B8AB4", TEAL="#6FA3A0", BLUE="#3E6E93", GREEN="#4E8D6E", LINE="var(--chart-grid)";
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

export function SingleCabinetPcs({ stationId }: { stationId: string }) {
  const today = istDate();
  const hierarchy = useHierarchy(stationId);
  const grids = hierarchy.data?.grids ?? [];

  const [cabinetId, setCabinetId] = useState("");
  // Empty until the hierarchy resolves — never show a placeholder device name as the selection
  const [cabinetLabel, setCabinetLabel] = useState("");
  const [invN, setInvN] = useState(1);
  const [date, setDate] = useState(today);
  const [searchDate, setSearchDate] = useState(today);

  const allCabinets = useMemo(() =>
    grids.flatMap(g => g.matrices.flatMap(m => m.cabinets.map(c => ({ id: c.id, label: `${g.name}-${m.name}-${c.name}`, piles: c.piles })))),
    [grids]
  );

  // Inverter indices available for the selected cabinet (parsed from pile IDs)
  const availableInverters = useMemo(() => {
    const cab = allCabinets.find(c => c.id === cabinetId);
    if (!cab || !cab.piles?.length) return [1];
    return cab.piles
      .map(p => parseInt(p.id.match(/-p(\d+)$/)?.[1] ?? "1", 10))
      .sort((a, b) => a - b);
  }, [cabinetId, allCabinets]);

  useEffect(() => {
    if (allCabinets.length && !cabinetId) {
      setCabinetId(allCabinets[0].id);
      setCabinetLabel(allCabinets[0].label);
    }
  }, [allCabinets.length]);

  // Reset invN to 1 whenever cabinet changes
  useEffect(() => { setInvN(1); }, [cabinetId]);

  const { data, isLoading } = usePcsCurve(cabinetId, searchDate, invN, stationId);
  const d = data ?? [];
  // UGX v1.0 has no PCS temperature keys — hide temp chart when all values are 0
  const hasTemps = d.some(p => p.tempA !== 0 || p.tempB !== 0 || p.tempC !== 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Selector bar */}
      <div className="surface-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <select value={cabinetId} onChange={e=>{const c=allCabinets.find(x=>x.id===e.target.value);if(c){setCabinetId(c.id);setCabinetLabel(c.label);}}} className="filter-input w-auto min-w-[280px]">
            {allCabinets.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} className="filter-input h-8 text-[11.5px] w-[140px]"/>
          <button onClick={()=>{setDate(today);setSearchDate(today);}} className="btn-outline"><RotateCcw size={12}/>Reset</button>
          <button onClick={()=>setSearchDate(date)} className="btn-primary"><Search size={12}/>Search</button>
        </div>

        {/* Inverter selector — shown only when cabinet has more than 1 inverter */}
        {availableInverters.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-ink3 shrink-0">Inverter:</span>
            {availableInverters.map(n => (
              <button
                key={n}
                onClick={() => setInvN(n)}
                className={[
                  "px-3 py-1 rounded text-[11.5px] font-medium transition-colors border",
                  n === invN
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-line text-ink3 hover:text-ink hover:bg-surface2",
                ].join(" ")}
              >
                Inv {n}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Power">
          {isLoading?<LoadingState rows={3}/>:(
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={d} margin={{top:4,right:4,left:12,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false}/>
                <XAxis dataKey="t" {...ax} interval={Math.floor(d.length/8)||1}/>
                <YAxis {...ax} tickFormatter={v=>`${v}kW`}/>
                <Tooltip contentStyle={tooltip} formatter={(v:number)=>[`${v.toFixed(1)} kW`]}/>
                <Line type="linear" dataKey="power" name="Power (kW)" stroke={STEEL} strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Temperature Curve">
          {isLoading ? <LoadingState rows={3}/> : !hasTemps ? (
            <div className="h-[200px] flex flex-col items-center justify-center gap-2">
              <span className="text-[12px] text-muted">IGBT temperature is read live but not logged — the historian records 63 of the gateway's signals and these are not among them</span>
              <span className="text-[10px] text-muted2 font-mono">Requires PCS firmware key: igbt_temp_a/b/c</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={d} margin={{top:4,right:4,left:12,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false}/>
                <XAxis dataKey="t" {...ax} interval={Math.floor(d.length/8)||1}/>
                <YAxis {...ax} tickFormatter={v=>`${v}°C`}/>
                <Tooltip contentStyle={tooltip} formatter={(v:number)=>[`${v.toFixed(1)} °C`]}/>
                <Legend wrapperStyle={{fontSize:10,paddingTop:4}} iconType="line" iconSize={12}/>
                <Line type="linear" dataKey="tempA" name="IGBT-A" stroke={STEEL} strokeWidth={1.5} dot={false}/>
                <Line type="linear" dataKey="tempB" name="IGBT-B" stroke={TEAL}   strokeWidth={1.5} dot={false}/>
                <Line type="linear" dataKey="tempC" name="IGBT-C" stroke={BLUE}   strokeWidth={1.5} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Three-Phase Current">
          {isLoading?<LoadingState rows={3}/>:(
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={d} margin={{top:4,right:4,left:12,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false}/>
                <XAxis dataKey="t" {...ax} interval={Math.floor(d.length/8)||1}/>
                <YAxis {...ax} tickFormatter={v=>`${v.toFixed(0)}A`}/>
                <Tooltip contentStyle={tooltip} formatter={(v:number)=>[`${v.toFixed(1)} A`]}/>
                <Legend wrapperStyle={{fontSize:10,paddingTop:4}} iconType="line" iconSize={12}/>
                <Line type="linear" dataKey="phaseACurrent" name="Phase A" stroke={STEEL} strokeWidth={1.5} dot={false}/>
                <Line type="linear" dataKey="phaseBCurrent" name="Phase B" stroke={TEAL}   strokeWidth={1.5} dot={false}/>
                <Line type="linear" dataKey="phaseCCurrent" name="Phase C" stroke={BLUE}   strokeWidth={1.5} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Three-Phase Voltage">
          {isLoading?<LoadingState rows={3}/>:(
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={d} margin={{top:4,right:4,left:12,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false}/>
                <XAxis dataKey="t" {...ax} interval={Math.floor(d.length/8)||1}/>
                <YAxis {...ax} domain={["auto","auto"]} tickFormatter={v=>`${v}V`}/>
                <Tooltip contentStyle={tooltip} formatter={(v:number)=>[`${v.toFixed(1)} V`]}/>
                <Legend wrapperStyle={{fontSize:10,paddingTop:4}} iconType="line" iconSize={12}/>
                <Line type="linear" dataKey="phaseAVoltage" name="Phase A" stroke={STEEL} strokeWidth={1.5} dot={false}/>
                <Line type="linear" dataKey="phaseBVoltage" name="Phase B" stroke={TEAL}   strokeWidth={1.5} dot={false}/>
                <Line type="linear" dataKey="phaseCVoltage" name="Phase C" stroke={BLUE}   strokeWidth={1.5} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
