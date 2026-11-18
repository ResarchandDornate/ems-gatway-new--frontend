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

import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  CartesianGrid,
} from "recharts";

export interface CurvePoint {
  /* Epoch ms, not a formatted label.
  
     It was a preformatted string, which made the x-axis categorical: Recharts
     spaces categories evenly by index, so an hour with no samples occupied no
     width at all. A 24 h window that had loaded five hours drew those five
     hours across the full card and labelled the axis 04:54-12:38, which reads
     as a five-hour chart of a complete period rather than a day with most of
     it missing. Two samples five seconds apart and two an hour apart sat the
     same distance from each other.
  
     As a number on a time axis, position carries time: a gap in the data is a
     gap on the screen, and the axis spans the window that was asked for. */
  t: number;
  /* Nullable, and it matters. This was `number`, so every caller wrote
     `powerKw ?? 0` to satisfy it — and when the history decoder stopped
     resolving values, that `?? 0` drew a clean flat line along zero across a
     plant that was cycling at 34 kW. A missing measurement now renders as a
     gap in the line, which is the one thing that cannot be mistaken for a
     reading. */
  power: number | null;
  soc: number | null;
}

/**
 * A power axis with round numbers on it that hold still.
 *
 * Pinning zero into the domain fixed the sign being unreadable and introduced
 * a worse problem: passing functions as the domain turns off Recharts\' own
 * tick rounding, so the axis came out at -46.5, -31.5, -16.5, 0 — and those
 * numbers are derived from the data, so every poll and every bucket rotation
 * moved them. An axis whose labels change while you are reading it cannot be
 * used to compare one glance to the next, which is most of what an axis is for.
 *
 * So the range is snapped outward to a round step — 1, 2, 2.5, 5 or 10 times a
 * power of ten, whichever gives about five ticks. Snapping outward is what
 * makes it stable: the data has to move past a whole step before any label
 * changes, and small movements leave the axis exactly where it was.
 *
 * Zero is always included, because on a signed power series it is the boundary
 * between charging and discharging and the baseline every magnitude is read
 * against.
 */
function niceAxis(lo: number, hi: number, targetTicks = 5): { domain: [number, number]; ticks: number[] } {
  /* Always spanning zero, and never a zero-height axis — a flat series still
     needs somewhere to sit. */
  let min = Math.min(0, lo);
  let max = Math.max(0, hi);
  if (min === max) max = min + 1;

  const raw = (max - min) / (targetTicks - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;

  /* Rounded, not just computed. `Math.floor(-0.42 / 0.2) * 0.2` is
     -0.6000000000000001, and that reaches the axis as a bound the ticks do not
     share — so the top or bottom rule sits a hair off its own label. */
  const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const from = round6(Math.floor(min / step) * step);
  const to = round6(Math.ceil(max / step) * step);

  const ticks: number[] = [];
  /* Half a step of slack on the bound, so floating point cannot drop the top
     tick and leave the axis looking truncated. */
  for (let v = from; v <= to + step / 2; v += step) {
    ticks.push(round6(v));
  }
  return { domain: [from, to], ticks };
}

/**
 * Ticks on round time boundaries, so the labels hold still.
 *
 * Same argument as niceAxis above: an axis whose labels shift with every poll
 * cannot be used to compare one glance to the next. Steps are chosen from
 * durations a person reads without decoding — never 7 or 13 minutes — and each
 * tick is aligned to a multiple of the step, so the labels only move when the
 * window itself does.
 */
const TIME_STEPS = [
  60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000,
  3600_000, 3 * 3600_000, 6 * 3600_000, 12 * 3600_000,
  86_400_000, 2 * 86_400_000, 7 * 86_400_000,
];

function timeTicks([from, to]: [number, number], target = 5): number[] {
  const span = Math.max(1, to - from);
  const step = TIME_STEPS.find((s) => span / s <= target) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return ticks;
}

/* Below a day, the time is the whole label; past it, the date is — an axis of
   six identical "00:00"s names nothing. The tooltip always carries both,
   because it is read one point at a time and has room. */
function axisLabel(ms: number, span: number): string {
  const d = new Date(ms);
  if (span > 86_400_000) {
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit",
    ...(span <= 15 * 60_000 ? { second: "2-digit" as const } : {}),
    hour12: false,
  });
}

function tipLabel(ms: number, span: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit",
    ...(span <= 15 * 60_000 ? { second: "2-digit" as const } : {}),
    hour12: false,
  });
  return span > 86_400_000
    ? `${d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ${time}`
    : time;
}

function readVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function TooltipCard({ active, payload, label, span }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as CurvePoint | undefined;
  if (!p) return null;

  return (
    <div className="m-tip">
      <div className="m-tip-t">
        {typeof label === "number" ? tipLabel(label, span ?? 0) : label}
      </div>
      {/* Power is nullable for the same reason SOC is — no zero substitute. */}
      <div className="m-tip-row">
        <span>Power</span>
        <strong>{p.power == null ? "—" : `${p.power.toFixed(1)} kW`}</strong>
      </div>
      {/* SOC is nullable upstream and stays nullable here — no zero substitute. */}
      <div className="m-tip-row">
        <span>SOC</span>
        <strong>{p.soc == null ? "—" : `${p.soc.toFixed(0)}%`}</strong>
      </div>
    </div>
  );
}

export function PowerCurve(
  { data, window }: {
    data: CurvePoint[];
    /**
     * The window that was *asked for*, epoch ms. Given, the axis spans it
     * whatever has arrived, so a partly-filled period looks partly filled
     * instead of looking like a shorter complete one. Omitted, the axis falls
     * back to the extent of the data — right for the dashboard's live strip,
     * which has no requested window, only whatever it has.
     */
    window?: [number, number];
  },
) {
  const xDomain = useMemo<[number, number]>(() => {
    if (window) return window;
    let lo = Infinity, hi = -Infinity;
    for (const d of data) { if (d.t < lo) lo = d.t; if (d.t > hi) hi = d.t; }
    return Number.isFinite(lo) && hi > lo ? [lo, hi] : [0, 1];
  }, [window, data]);
  const xSpan = xDomain[1] - xDomain[0];
  const xTicks = useMemo(() => timeTicks(xDomain), [xDomain]);

  const kw = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const d of data) {
      if (d.power == null || !Number.isFinite(d.power)) continue;
      if (d.power < lo) lo = d.power;
      if (d.power > hi) hi = d.power;
    }
    return niceAxis(lo, hi);
  }, [data]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: -22 }}>
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

        {/* Horizontal only, and quiet. A reading is compared against the axis
            across the whole width of the card; without rules that comparison
            is guesswork everywhere except the left edge. Vertical rules would
            add nothing here — the x-axis is time and the ticks already mark
            it. */}
        <CartesianGrid
          vertical={false}
          stroke="var(--m-border)"
          strokeDasharray="2 5"
        />

        {/* A real time axis. `type="number"` with an explicit domain is what
            makes horizontal distance mean elapsed time — as a category axis
            this spaced points evenly by index, so missing hours took up no
            width and a half-loaded day drew as a complete short one. */}
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={xDomain}
          ticks={xTicks}
          tickFormatter={(v: number) => axisLabel(v, xSpan)}
          tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          minTickGap={38}
        />
        {/* Power in kW, on an axis that always contains zero.
        
            Left to scale itself, Recharts fits the axis to the data — so an
            hour of steady charging came out as -49 to -21 kW, with zero off
            the chart and the ReferenceLine below marking it drawn somewhere
            nobody could see. The line then reads as an oscillation around an
            arbitrary middle, and the one thing this series is actually about
            is lost: which side of zero the plant is on, and by how much.
        
            Zero is not decoration on a signed power chart. It is the boundary
            between charging and discharging, and the baseline every magnitude
            on screen is judged against. Pinning it in view costs some vertical
            resolution on a window that never crosses it; that is the correct
            trade for a chart whose sign carries the meaning. */}
        <YAxis
          yAxisId="kw"
          domain={kw.domain}
          ticks={kw.ticks}
          tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        {/* SOC on its own 0–100 scale, and now drawn.
        
            It has always had a separate scale — sharing the kW axis plotted a
            97% charge at y=97 kW, making two incomparable series look
            comparable. But the axis was hidden, on the argument that a second
            set of tick labels costs more on a phone than it explains. That was
            wrong, and the way it failed is instructive: with the kW axis
            running -60 to +40 it spans exactly 100 units, so SOC mapped 1:1
            onto it by coincidence and a 66% charge sat at "+6" — close enough
            to the kW ticks to be read as a small power figure. A reader asked
            what the dotted line was and why it said 66% while sitting below
            20. There is no answer to that except an axis.
        
            Three ticks only, tinted to the series colour so the binding is
            unambiguous without a legend lookup. */}
        <YAxis
          yAxisId="soc"
          orientation="right"
          domain={[0, 100]}
          ticks={[0, 50, 100]}
          tick={{ fill: "var(--m-primary)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          width={30}
          unit="%"
        />
        <ReferenceLine yAxisId="kw" y={0} stroke="var(--m-border)" strokeWidth={1} />
        <Tooltip content={<TooltipCard span={xSpan} />} cursor={{ stroke: "var(--m-border-strong)", strokeWidth: 1 }} />

        <Area
          yAxisId="kw"
          type="monotone"
          dataKey="power"
          stroke="var(--m-cyan)"
          strokeWidth={2.2}
          fill="url(#mPowerFill)"
          dot={false}
          activeDot={{ r: 4, fill: "var(--m-cyan)", stroke: "var(--m-bg)", strokeWidth: 2 }}
          /* A gap stays a gap. Bridging it would draw a straight line through
             minutes nobody measured, which reads exactly like calm operation. */
          connectNulls={false}
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
