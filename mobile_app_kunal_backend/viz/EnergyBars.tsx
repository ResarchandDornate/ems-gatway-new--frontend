"use client";

/**
 * EnergyBars — how much each unit actually moved over the window.
 *
 * The curves answer what the plant was doing at an instant. This answers what
 * it did in total, which is the other question a comparison gets asked and the
 * one a line chart is worst at: two units can trace similar-looking shapes and
 * differ by half in throughput.
 *
 * Integrated over every raw row on the server, not summed off the plotted
 * line — the curve is a mean over its bucket and totalling it would quietly
 * under-report a unit that spiked between samples.
 *
 * Zero is a real answer here, unlike everywhere else in this app: a unit that
 * was idle for the window genuinely charged nothing, and the server counted
 * the rows that say so. A unit with no rows at all is not drawn.
 */

import {
  Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";

export interface EnergyBar {
  /** "BESS 1" */
  label: string;
  chargedKwh: number;
  dischargedKwh: number;
}

const IN = "var(--m-series-1)";
const OUT = "var(--m-series-2)";

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="m-tip">
      <div className="m-tip-t">{label}</div>
      {payload.map((p: { name?: string; dataKey?: string; value?: number }) => (
        <div className="m-tip-row" key={String(p.dataKey)}>
          <span>{p.dataKey === "chargedKwh" ? "Charged" : "Discharged"}</span>
          <strong>{(p.value ?? 0).toFixed(1)} kWh</strong>
        </div>
      ))}
    </div>
  );
}

export function EnergyBars({ data }: { data: EnergyBar[] }) {
  return (
    <>
      <div className="m-chart is-short">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 14, right: 4, bottom: 0, left: -22 }} barGap={4}>
            <CartesianGrid vertical={false} stroke="var(--m-border)" strokeDasharray="2 5" />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--m-ink-2)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip content={<Tip />} cursor={{ fill: "var(--m-glass)" }} />
            <Bar dataKey="chargedKwh" fill={IN} radius={[5, 5, 0, 0]} isAnimationActive={false}>
              <LabelList
                dataKey="chargedKwh"
                position="top"
                formatter={(v: number) => v.toFixed(1)}
                style={{ fill: "var(--m-ink-3)", fontSize: 10 }}
              />
            </Bar>
            <Bar dataKey="dischargedKwh" fill={OUT} radius={[5, 5, 0, 0]} isAnimationActive={false}>
              <LabelList
                dataKey="dischargedKwh"
                position="top"
                formatter={(v: number) => v.toFixed(1)}
                style={{ fill: "var(--m-ink-3)", fontSize: 10 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="m-chart-legend">
        <span className="m-legend-key">
          <span className="m-legend-swatch" style={{ background: IN }} /> Charged, kWh
        </span>
        <span className="m-legend-key">
          <span className="m-legend-swatch" style={{ background: OUT }} /> Discharged, kWh
        </span>
      </div>
    </>
  );
}
