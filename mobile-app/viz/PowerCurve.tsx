"use client";

/**
 * PowerCurve — intraday power and SOC.
 *
 * The chart itself is unchanged in kind from the web app's: same Recharts,
 * same series, same data straight from useIntradayData. It is only re-housed —
 * rounded container, theme-aware colours read from CSS variables, chrome
 * stripped back so the line is the loudest thing in the card.
 *
 * Colours come through var() because Recharts takes them as SVG attributes and
 * inline styles, neither of which can read a class. That is the same technique
 * app/globals.css already uses, so both halves of the product theme the same
 * way.
 */

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

export interface CurvePoint {
  t: string;
  power: number;
  soc: number | null;
  load: number;
}

function readVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function TooltipCard({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as CurvePoint | undefined;
  if (!p) return null;

  return (
    <div className="m-tip">
      <div className="m-tip-t">{label}</div>
      <div className="m-tip-row">
        <span>Power</span>
        <strong>{p.power?.toFixed(1)} kW</strong>
      </div>
      {/* SOC is nullable upstream and stays nullable here — no zero substitute. */}
      <div className="m-tip-row">
        <span>SOC</span>
        <strong>{p.soc == null ? "—" : `${p.soc.toFixed(0)}%`}</strong>
      </div>
    </div>
  );
}

export function PowerCurve({ data }: { data: CurvePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
        <defs>
          {/* A tall, soft fill that fades to nothing well above the axis — the
              area should suggest volume, not fence off the bottom of the card. */}
          <linearGradient id="mPowerFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--m-cyan)" stopOpacity="0.42" />
            <stop offset="58%"  stopColor="var(--m-cyan)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--m-cyan)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="mSocFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--m-primary)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--m-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <XAxis
          dataKey="t"
          tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={38}
        />
        {/* Power in kW. */}
        <YAxis
          yAxisId="kw"
          tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        {/* SOC has its own 0–100 scale, hidden. Sharing the kW axis plotted a
            97% charge at y=97 kW — the two series looked comparable and were
            not. The axis is not drawn because a second set of tick labels on a
            phone-width chart costs more than it explains; the tooltip states
            both values exactly. */}
        <YAxis yAxisId="soc" domain={[0, 100]} hide />
        <ReferenceLine yAxisId="kw" y={0} stroke="var(--m-border)" strokeWidth={1} />
        <Tooltip content={<TooltipCard />} cursor={{ stroke: "var(--m-border-strong)", strokeWidth: 1 }} />

        <Area
          yAxisId="kw"
          type="monotone"
          dataKey="power"
          stroke="var(--m-cyan)"
          strokeWidth={2.2}
          fill="url(#mPowerFill)"
          dot={false}
          activeDot={{ r: 4, fill: "var(--m-cyan)", stroke: "var(--m-bg)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
        <Area
          yAxisId="soc"
          type="monotone"
          dataKey="soc"
          stroke="var(--m-primary)"
          strokeWidth={1.6}
          strokeDasharray="3 3"
          fill="url(#mSocFill)"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
