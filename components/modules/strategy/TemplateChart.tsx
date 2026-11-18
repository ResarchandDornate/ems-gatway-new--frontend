"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea } from "recharts";
import { actionMovesPower, type PolicySlot } from "@/lib/api/services/policyTemplate.service";

const CHARGE    = "#8E7CC3";
const DISCHARGE = "#6FA3A0";
const IDLE_FILL = "var(--surface2)";
const GRID  = "var(--chart-grid)";
const tooltipStyle = { background:"var(--tooltip-bg)", border:"1px solid var(--tooltip-line)", borderRadius:8, fontSize:11, color:"var(--tooltip-ink)", padding:"8px 10px" };
const ax = { tickLine:false, axisLine:false, tick:{ fill:"#6B7280", fontSize:10 } };

const DAY = 24 * 60;

function toMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
}
/** A time picker cannot say 24:00, so an end of 00:00 is midnight tonight. */
function endMin(hm: string): number {
  const v = toMin(hm);
  return v === 0 ? DAY : v;
}
function hhmm(m: number): string {
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

interface Band { from: number; to: number; slot: PolicySlot }

/**
 * The template as a day-long power profile: charging on one line, discharging
 * on the other, both stepped because a set point holds for its whole slot.
 *
 * The chart is drawn from the rows as they are being typed, so a half-filled
 * row simply does not appear rather than breaking the shape.
 */
export function TemplateChart({ slots }: { slots: PolicySlot[] }) {
  const bands: Band[] = slots
    .map(slot => ({ from: toMin(slot.start), to: endMin(slot.end), slot }))
    .filter(b => Number.isFinite(b.from) && Number.isFinite(b.to) && b.to > b.from)
    .sort((a, b) => a.from - b.from);

  if (!bands.length) {
    return (
      <div className="eq-card grid place-items-center h-[180px] text-[11.5px] text-muted">
        Fill a row to see the day&rsquo;s power profile.
      </div>
    );
  }

  const valueAt = (m: number, side: "charging" | "discharging") => {
    const b = bands.find(x => x.from <= m && m < x.to);
    if (!b || b.slot.action !== side || !actionMovesPower(b.slot.action)) return 0;
    return Number(b.slot.powerKw) || 0;
  };

  /* One point per boundary, not per minute: with stepAfter each value holds
     until the next point, which is exactly how a set point behaves. */
  const xs = [...new Set([0, ...bands.flatMap(b => [b.from, b.to]), DAY])].sort((a, b) => a - b);
  const data = xs.map(m => ({
    m,
    charging:    valueAt(m === DAY ? DAY - 1 : m, "charging"),
    discharging: valueAt(m === DAY ? DAY - 1 : m, "discharging"),
  }));

  // A real time axis, so a slot's width reads as its length and the ticks stay
  // at round hours however the rows are cut up.
  const TICKS = Array.from({ length: 7 }, (_, i) => i * 4 * 60);

  // Standby and shutdown carry no power; shade them so the flat line reads as
  // deliberate rather than as a hole in the schedule.
  const idle = bands.filter(b => !actionMovesPower(b.slot.action));

  return (
    <div className="eq-card p-3">
      {/* Unit as a caption, not on every tick — "140 kW" on a 44px axis clips
          to ".40 kW". */}
      <p className="text-[10px] font-mono uppercase tracking-[1.2px] text-muted ml-1">kW</p>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          {idle.map((b, i) => (
            <ReferenceArea key={i} x1={b.from} x2={b.to} fill={IDLE_FILL} fillOpacity={0.6} />
          ))}
          <XAxis dataKey="m" type="number" domain={[0, DAY]} ticks={TICKS} tickFormatter={hhmm} {...ax} />
          <YAxis {...ax} width={52} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} kW`]} labelFormatter={(m: number) => `From ${hhmm(m)}`} />
          <Legend wrapperStyle={{ fontSize: 10.5, paddingTop: 6 }} iconType="plainline" iconSize={16} />
          <Line type="stepAfter" dataKey="charging"    name="Charging Power"    stroke={CHARGE}    strokeWidth={2} dot={false} />
          <Line type="stepAfter" dataKey="discharging" name="Discharging Power" stroke={DISCHARGE} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
