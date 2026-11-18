"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Line, LineChart, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// ── Theme ─────────────────────────────────────────────────────────────────────
const steel  = "#5B8AB4";
const teal    = "#6FA3A0";
const blue    = "#3E6E93";
const muted   = "#6B7280";
const grid    = "var(--chart-grid)";

const tooltipStyle = {
  background:   "var(--tooltip-bg)",
  border:       "1px solid var(--tooltip-line)",
  borderRadius: 8,
  fontSize:     11,
  color:        "var(--tooltip-ink)",
  padding:      "8px 10px",
  boxShadow:    "var(--tooltip-shadow)",
};

const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: muted, fontSize: 10.5 },
} as const;

// ── Shared sub-components ─────────────────────────────────────────────────────

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11.5px] text-ink3">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label}
    </div>
  );
}

function StatsFooter({
  rows,
}: {
  rows: { label: string; color: string; min: number; max: number; latest: number; unit: string }[];
}) {
  function fmt(v: number, unit: string) {
    if (unit === "₹") {
      return v >= 1_000_000 ? `₹${(v / 1_000_000).toFixed(1)}M`
           : v >= 1_000     ? `₹${(v / 1_000).toFixed(1)}k`
           : `₹${v.toFixed(0)}`;
    }
    return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} ${unit}`;
  }
  return (
    <div className="border-t border-line pt-2.5 mt-1">
      <div className="grid grid-cols-4 text-[10px] font-mono text-muted mb-1 px-0.5">
        <span />
        <span className="text-right">Min</span>
        <span className="text-right">Max</span>
        <span className="text-right">Latest</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-4 items-center py-0.5 px-0.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
            <span className="text-ink2 truncate">{r.label}</span>
          </div>
          <span className="text-right font-mono text-ink">{fmt(r.min, r.unit)}</span>
          <span className="text-right font-mono text-ink">{fmt(r.max, r.unit)}</span>
          <span className="text-right font-mono font-semibold" style={{ color: r.color }}>
            {fmt(r.latest, r.unit)}
          </span>
        </div>
      ))}
    </div>
  );
}

function seriesStats(vals: number[]) {
  const nums = vals.filter((v) => v !== undefined && v !== null && !isNaN(v));
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums), latest: nums[nums.length - 1] };
}

// ── Revenue chart ─────────────────────────────────────────────────────────────

export function RevenueChart({ data, height = 180, showStats = true }: { data: { date: string; revenue: number }[]; height?: number | string; showStats?: boolean }) {
  const vals  = data.map((d) => d.revenue);
  const stats = seriesStats(vals);
  const tickInterval = Math.max(0, Math.ceil(data.length / 8) - 1);

  return (
    <div className={height === "100%" ? "h-full flex flex-col gap-1.5" : "space-y-2"}>
      <div className="flex items-center gap-5 flex-none">
        <LegendDot color={steel} label="Revenue (₹)" />
      </div>

      <div className={height === "100%" ? "flex-1 min-h-0" : ""}>
      <ResponsiveContainer width="100%" height={height === "100%" ? "100%" : height}>
        <AreaChart data={data} margin={{ top: 6, right: 6, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="grad-rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={steel} stopOpacity={0.28} />
              <stop offset="100%" stopColor={steel} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="date" {...axisProps} interval={tickInterval} />
          <YAxis
            {...axisProps} width={58}
            tickFormatter={(v: number) =>
              v >= 1_000_000 ? `₹${(v / 1_000_000).toFixed(1)}M`
              : v >= 1_000   ? `₹${(v / 1_000).toFixed(0)}k`
              : `₹${v}`
            }
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Revenue"]}
            cursor={{ stroke: steel, strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          <Area
            type="linear" dataKey="revenue" stroke={steel} strokeWidth={2}
            fill="url(#grad-rev)" dot={false}
            activeDot={{ r: 4, fill: steel, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>

      {showStats && stats && (
        <StatsFooter rows={[{ label: "Revenue", color: steel, ...stats, unit: "₹" }]} />
      )}
    </div>
  );
}

// ── Power + SOC chart ─────────────────────────────────────────────────────────

export function PowerSocChart({
  data,
  showSoc = true,
  height = 240,
  showStats = true,
}: {
  data:       { t: string; power: number; soc: number }[];
  showSoc?:   boolean;
  height?:    number | string;
  showStats?: boolean;
}) {
  const sampled = data.filter((_, i) => i % 2 === 0);

  const powerVals = sampled.map((d) => d.power);
  const socVals   = sampled.map((d) => d.soc);
  const statsP    = seriesStats(powerVals);
  const statsS    = showSoc ? seriesStats(socVals) : null;

  const tickInterval = Math.max(0, Math.ceil(sampled.length / 12) - 1);

  const allPower = powerVals.filter((v) => !isNaN(v));
  const rawMin   = allPower.length ? Math.min(...allPower, 0) : 0;
  const rawMax   = allPower.length ? Math.max(...allPower, 0) : 400;
  const pad      = (rawMax - rawMin) * 0.1 || 40;
  const domain: [number, number] = [Math.floor(rawMin - pad), Math.ceil(rawMax + pad)];

  return (
    <div className={height === "100%" ? "h-full flex flex-col gap-1.5" : "space-y-2"}>
      <div className="flex items-center gap-5 flex-none">
        <LegendDot color={steel} label="Power (kW)" />
        {showSoc && <LegendDot color={teal} label="SOC (%)" />}
      </div>

      <div className={height === "100%" ? "flex-1 min-h-0" : ""}>
      <ResponsiveContainer width="100%" height={height === "100%" ? "100%" : height}>
        <LineChart data={sampled} margin={{ top: 6, right: 6, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="t" {...axisProps} interval={tickInterval} />
          <YAxis
            yAxisId="p" {...axisProps} width={60}
            domain={domain}
            tickFormatter={(v: number) => `${v} kW`}
          />
          {showSoc && (
            <YAxis
              yAxisId="s" orientation="right" {...axisProps} width={40}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
            />
          )}
          {rawMin < 0 && (
            <ReferenceLine yAxisId="p" y={0} stroke="var(--chart-ref)" strokeDasharray="4 4" />
          )}
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ stroke: muted, strokeDasharray: "3 3" }}
            formatter={(v: number, name: string) =>
              name === "Power (kW)"
                ? [`${v.toFixed(1)} kW`, name]
                : [`${v.toFixed(1)}%`, name]
            }
          />
          <Line
            yAxisId="p" type="linear" dataKey="power" name="Power (kW)"
            stroke={steel} strokeWidth={2.2} dot={false}
            activeDot={{ r: 4, fill: steel, strokeWidth: 0 }}
          />
          {showSoc && (
            <Line
              yAxisId="s" type="linear" dataKey="soc" name="SOC (%)"
              stroke={teal} strokeWidth={2.2} dot={false}
              activeDot={{ r: 4, fill: teal, strokeWidth: 0 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      </div>

      {showStats && (statsP || statsS) && (
        <StatsFooter rows={[
          ...(statsP ? [{ label: "Power", color: steel, ...statsP, unit: "kW" }] : []),
          ...(statsS ? [{ label: "SOC",   color: teal,   ...statsS, unit: "%"  }] : []),
        ]} />
      )}
    </div>
  );
}

// ── Charge / discharge chart ──────────────────────────────────────────────────

export function ChargeDischargeChart({
  data,
  chargeLabel    = "Charge",
  dischargeLabel = "Discharge",
  height = 180,
  showStats = true,
}: {
  data:            { date: string; charge: number; discharge: number }[];
  chargeLabel?:    string;
  dischargeLabel?: string;
  height?:         number | string;
  showStats?:      boolean;
}) {
  const chargeVals    = data.map((d) => d.charge);
  const dischargeVals = data.map((d) => d.discharge);
  const statsC        = seriesStats(chargeVals);
  const statsD        = seriesStats(dischargeVals);

  const tickInterval = Math.max(0, Math.ceil(data.length / 8) - 1);

  return (
    <div className={height === "100%" ? "h-full flex flex-col gap-1.5" : "space-y-2"}>
      <div className="flex items-center gap-5 flex-none">
        <LegendDot color={teal}   label={`${chargeLabel} (kWh)`}    />
        <LegendDot color={steel} label={`${dischargeLabel} (kWh)`} />
      </div>

      <div className={height === "100%" ? "flex-1 min-h-0" : ""}>
      <ResponsiveContainer width="100%" height={height === "100%" ? "100%" : height}>
        <BarChart data={data} margin={{ top: 6, right: 6, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
          <XAxis dataKey="date" {...axisProps} interval={tickInterval} />
          <YAxis
            {...axisProps} width={58}
            tickFormatter={(v: number) => `${v} kWh`}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: "rgba(91, 138, 180,.06)" }}
            formatter={(v: number, name: string) => [
              `${v.toLocaleString("en-IN")} kWh`, name,
            ]}
          />
          <Bar dataKey="charge"    fill={teal}   radius={[4, 4, 0, 0]} maxBarSize={24} name={chargeLabel} />
          <Bar dataKey="discharge" fill={steel} radius={[4, 4, 0, 0]} maxBarSize={24} name={dischargeLabel} />
        </BarChart>
      </ResponsiveContainer>
      </div>

      {showStats && (statsC || statsD) && (
        <StatsFooter rows={[
          ...(statsC ? [{ label: chargeLabel,    color: teal,   ...statsC, unit: "kWh" }] : []),
          ...(statsD ? [{ label: dischargeLabel, color: steel, ...statsD, unit: "kWh" }] : []),
        ]} />
      )}
    </div>
  );
}

// ── Alarm donut ───────────────────────────────────────────────────────────────

export function AlarmDonut({
  failure, alarm, inform, height = 180,
}: { failure: number; alarm: number; inform: number; height?: number }) {
  const total = failure + alarm + inform;
  const data = [
    { name: "failure", value: failure, color: "#A8505E" },
    { name: "alarm",   value: alarm,   color: steel    },
    { name: "inform",  value: inform,  color: blue      },
  ];

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={total === 0 ? [{ name: "empty", value: 1, color: grid }] : data}
            cx="50%" cy="50%"
            innerRadius={60} outerRadius={82}
            paddingAngle={total === 0 ? 0 : 3}
            dataKey="value"
            stroke="none"
          >
            {(total === 0 ? [{ color: grid }] : data).map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="text-center">
          <div className="text-[32px] font-semibold leading-none text-ink tracking-tight">{total}</div>
          <div className="text-[10px] uppercase tracking-[1.4px] text-muted mt-1.5 font-semibold font-mono">
            Total alarms
          </div>
        </div>
      </div>
    </div>
  );
}
