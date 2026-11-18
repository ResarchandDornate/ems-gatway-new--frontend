"use client";
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useTotalActivePower } from "@/hooks/useCurveReport";
import { LoadingState } from "@/components/shared/LoadingState";
import { Radio } from "lucide-react";
import { istDate } from "@/lib/api/time";

const STEEL = "#5B8AB4", LINE = "var(--chart-grid)";
const tooltipStyle = { background:"var(--tooltip-bg)",border:"1px solid var(--tooltip-line)",borderRadius:8,fontSize:11,color:"var(--tooltip-ink)",padding:"8px 10px" };
const axisProps = { tickLine:false, axisLine:false, tick:{ fill:"#6B7280", fontSize:10 } };

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="w-1 h-5 rounded-full bg-accent" />
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
    </div>
  );
}

/** Returns "YYYY-MM-DDT00:00:00" for the midnight start of a date string */
function midnightOf(dateStr: string): string {
  return `${dateStr}T00:00:00`;
}

/** Returns end-of-day ISO string for past dates; current time for today */
function endOf(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return new Date().toISOString();
  return `${dateStr}T23:59:59`;
}

/** Strip the date prefix so we only show HH:MM on the X-axis for single-day views */
function toHm(t: string): string {
  // "2026-05-15 14:32" → "14:32"  |  "14:32" → "14:32"
  const parts = t.split(" ");
  return parts.length === 2 ? parts[1] : t;
}

export function WholeStationPower({ stationId }: { stationId: string }) {
  const todayStr = istDate(); // "2026-05-15"

  // Single date state for the Total Active Power chart (defaults to today)
  const [totalDate, setTotalDate] = useState(todayStr);

  // ── Real-Time chart: always today, midnight → now, polls every 60 s ──────
  const rtStart = midnightOf(todayStr);
  const rtEnd   = endOf(todayStr, todayStr); // always "now"
  const rt = useTotalActivePower(stationId, rtStart, rtEnd, 60_000);
  const rtData = (rt.data ?? []).map(d => ({ ...d, t: toHm(d.t) }));

  // ── Total Active Power chart: user-selected single date ──────────────────
  const isToday     = totalDate === todayStr;
  const totalStart  = midnightOf(totalDate);
  const totalEnd    = endOf(totalDate, todayStr);
  const total       = useTotalActivePower(stationId, totalStart, totalEnd, isToday ? 60_000 : undefined);
  const totalData   = (total.data ?? []).map(d => ({ ...d, t: toHm(d.t) }));

  return (
    <div className="flex flex-col gap-6">

      {/* ── Real-Time Total Active Power ─────────────────────────────────── */}
      <div className="surface-card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <SectionTitle title="Real-Time Total Active Power" />
          <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-emerald-400">
            <Radio size={10} className="animate-pulse" />
            LIVE · {todayStr}
          </div>
        </div>

        {rt.isLoading ? <LoadingState rows={3} /> : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rtData} margin={{ top:4, right:4, left:12, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
              <XAxis dataKey="t" {...axisProps} interval={Math.floor(rtData.length / 10) || 1} />
              <YAxis {...axisProps} tickFormatter={v => `${v}kW`} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v} kW`, "Power"]}
                labelFormatter={label => `Time: ${label}`}
              />
              <Line type="linear" dataKey="power" name="Real-Time Power (kW)" stroke={STEEL} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {rtData.length === 0 && !rt.isLoading && (
          <p className="text-center text-[12px] text-muted py-6">No data yet for today.</p>
        )}
      </div>

      {/* ── Total Active Power ─────────────────────────────────────────────── */}
      <div className="surface-card p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <SectionTitle title="Total Active Power" />

          {/* Single date picker */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={totalDate}
              max={todayStr}
              onChange={e => setTotalDate(e.target.value)}
              className="filter-input h-7 text-[11px] w-[130px]"
            />
            {isToday && (
              <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                <Radio size={9} className="animate-pulse" /> LIVE
              </div>
            )}
          </div>
        </div>

        {total.isLoading ? <LoadingState rows={3} /> : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={totalData} margin={{ top:4, right:4, left:12, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
              <XAxis dataKey="t" {...axisProps} interval={Math.floor(totalData.length / 10) || 1} />
              <YAxis {...axisProps} tickFormatter={v => `${v}kW`} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v} kW`, "Power"]}
                labelFormatter={label => `Time: ${label}`}
              />
              <Line type="linear" dataKey="power" name="Total Active Power (kW)" stroke={STEEL} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {totalData.length === 0 && !total.isLoading && (
          <p className="text-center text-[12px] text-muted py-6">No data for {totalDate}.</p>
        )}
      </div>
    </div>
  );
}
