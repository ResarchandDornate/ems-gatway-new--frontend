"use client";

/**
 * EnergyProfile — what the plant moved over a calendar period, slot by slot.
 *
 * The other two charts in this app answer "what was the plant doing at an
 * instant". This one answers "what did it do between breakfast and lunch",
 * which is the question a bill is made of and the one a line chart is worst
 * at: a line says nothing about area, and area is the whole quantity here.
 *
 * Three decisions worth keeping in front of whoever changes this.
 *
 * **The slots are the period's, not the data's.** A day is twenty-four bars
 * whether or not the gateway has twenty-four hours to put in them, and the
 * caller bins the server's buckets into them. That is deliberately the
 * opposite of PowerCurve, which plots on a numeric time axis so that a gap
 * takes up width. Both rules exist for the same reason — a partly-loaded
 * period must not draw as a complete short one — and on a fixed grid of
 * calendar slots a category axis already satisfies it: every slot is present,
 * so a missing one is a hole in the row rather than a silently narrower chart.
 *
 * **A slot with no data is null, not zero.** Recharts draws nothing for a null
 * and a flat nothing for a zero, and those must not look the same: one means
 * the plant was idle, the other means nobody has read that hour yet. This is
 * the same rule the rest of the app follows and it is the one that a `?? 0`
 * broke last time.
 *
 * **Charge is drawn below the axis.** Not as a colour convention to be learnt,
 * but because energy in and energy out are opposite directions and mirroring
 * them makes a cycle legible at a glance: the day's shape says how much went
 * in against how much came out without reading a single number.
 */

import { useMemo } from "react";
import {
  Bar, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip,
  XAxis, YAxis, ReferenceLine,
} from "recharts";

export interface EnergySlot {
  /** Start of the slot, epoch ms. Used for the tooltip, never for position. */
  t: number;
  /** Axis label. Short — "09", "Mon", "14". */
  label: string;
  /** kWh into the battery over this slot, or null where nothing was read. */
  chargedKwh: number | null;
  /** kWh out of the battery over this slot, or null where nothing was read. */
  dischargedKwh: number | null;
  /** Mean SOC across the slot, %. Null where nothing was read. */
  soc: number | null;
}

const IN = "var(--m-series-2)";
const OUT = "var(--m-series-1)";
const SOC = "var(--m-ink-3)";

/**
 * A symmetric kWh axis with round numbers on it.
 *
 * Handing Recharts a raw `[-52.63, 52.63]` lets it choose its own ticks, and
 * it chose −53, −23, 7, 37 — an axis with no zero on it, no even spacing
 * either side of the baseline, and labels derived from the data, so every poll
 * moved them. Through the `Math.abs` formatter that reached the screen as
 * "53 23 7 53", which is not a scale.
 *
 * This is the same argument, and very nearly the same arithmetic, as
 * PowerCurve's niceAxis — kept separate rather than shared because the two
 * differ in the one way that matters here: this axis is forced symmetric about
 * zero. A bar's height has to mean the same quantity above the line as below
 * it, or the comparison the chart exists for is wrong before a reader starts.
 *
 * Snapping outward is what makes the labels hold still: the data has to grow
 * past a whole step before any of them change. It also costs headroom, which
 * is why three ticks a side rather than two: at two, a 52.6 kWh month rounds
 * its step up to 50 and its bound to 100, and every bar draws at half the
 * height it has earned. Three puts the step at 20 and the bound at 60, so the
 * chart uses the card it was given.
 */
function niceBound(max: number, targetTicksPerSide = 3): { bound: number; ticks: number[] } {
  const raw = max / targetTicksPerSide;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;

  /* Rounded, not just computed. Math.ceil(52.63 / 25) * 25 is exact here, but
     a step of 0.2 produces 0.6000000000000001 and the bound then disagrees
     with the tick that is supposed to sit on it. */
  const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const bound = round6(Math.ceil(max / step) * step);

  const ticks: number[] = [];
  for (let v = -bound; v <= bound + step / 2; v += step) ticks.push(round6(v));
  return { bound, ticks };
}

/**
 * Every nth slot label, so a month's worth does not collide.
 *
 * Chosen from the count rather than measured, because the alternative is a
 * resize observer for a decision that only has three sensible answers on a
 * phone-width axis.
 */
function labelInterval(n: number): number {
  if (n <= 8) return 0;
  if (n <= 14) return 1;
  if (n <= 26) return 2;
  return Math.ceil(n / 10);
}

function Tip({ active, payload }: {
  active?: boolean;
  payload?: { payload?: EnergySlot }[];
}) {
  const s = active ? payload?.[0]?.payload : undefined;
  if (!s) return null;

  /* Both null means the slot was never read. Saying so is the point of this
     tooltip existing on an empty bar at all — without it, an untouched hour
     and an idle hour are the same blank column. */
  const unread = s.chargedKwh == null && s.dischargedKwh == null;

  return (
    <div className="m-tip">
      <div className="m-tip-t">
        {new Date(s.t).toLocaleString("en-IN", {
          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
        })}
      </div>
      {unread ? (
        <div className="m-tip-row"><span>Not read yet</span></div>
      ) : (
        <>
          <div className="m-tip-row">
            <span>Charged</span>
            <strong>{s.chargedKwh == null ? "—" : `${s.chargedKwh.toFixed(1)} kWh`}</strong>
          </div>
          <div className="m-tip-row">
            <span>Discharged</span>
            <strong>{s.dischargedKwh == null ? "—" : `${s.dischargedKwh.toFixed(1)} kWh`}</strong>
          </div>
          <div className="m-tip-row">
            <span>SOC</span>
            <strong>{s.soc == null ? "—" : `${s.soc.toFixed(0)}%`}</strong>
          </div>
        </>
      )}
    </div>
  );
}

export function EnergyProfile({ slots }: { slots: EnergySlot[] }) {
  /* Charge is negated for plotting only. The sign never leaves this file —
     every figure the screen states, and every number in the tooltip above, is
     the magnitude the server measured. */
  const rows = useMemo(
    () =>
      slots.map((s) => ({
        ...s,
        inPlot: s.chargedKwh == null ? null : -s.chargedKwh,
        outPlot: s.dischargedKwh,
      })),
    [slots],
  );

  /* Symmetric about zero, so a bar of a given height means the same amount of
     energy whichever side of the axis it is on. An axis scaled independently
     top and bottom would make a 3 kWh charge look larger than a 4 kWh
     discharge, which is the one thing this chart exists to compare. */
  const kwh = useMemo(() => {
    let m = 0;
    for (const s of slots) {
      if (s.chargedKwh != null) m = Math.max(m, s.chargedKwh);
      if (s.dischargedKwh != null) m = Math.max(m, s.dischargedKwh);
    }
    /* An all-zero period still needs somewhere to draw its baseline. */
    return niceBound(m > 0 ? m : 1);
  }, [slots]);

  const interval = labelInterval(slots.length);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 6, right: -14, bottom: 0, left: -24 }}>
        <CartesianGrid vertical={false} stroke="var(--m-border)" strokeDasharray="2 5" />

        <XAxis
          dataKey="label"
          interval={interval}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
        />

        <YAxis
          yAxisId="kwh"
          domain={[-kwh.bound, kwh.bound]}
          ticks={kwh.ticks}
          tickLine={false}
          axisLine={false}
          width={44}
          tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
          /* Magnitudes, not signed values. The sign is carried by which side
             of the baseline a bar is on and by the legend beneath the chart;
             printing "-25" as well would label the direction twice and imply
             the plant charged a negative quantity. */
          tickFormatter={(v: number) => String(Math.abs(v))}
        />

        {/* SOC rides its own axis and is always 0-100, never fitted to the
            data. A percentage that rescales cannot be compared between two
            days, and comparing days is what this screen is for. */}
        <YAxis
          yAxisId="soc"
          orientation="right"
          domain={[0, 100]}
          ticks={[0, 50, 100]}
          tickLine={false}
          axisLine={false}
          width={30}
          tick={{ fill: "var(--m-ink-3)", fontSize: 10 }}
        />

        <ReferenceLine yAxisId="kwh" y={0} stroke="var(--m-border)" />

        <Tooltip content={<Tip />} cursor={{ fill: "var(--m-border)" }} />

        {/* One stack, not two bars side by side.

            Recharts splits a category band between every unstacked series, so
            a month drew each day as two ~2px slivers with a gap down the
            middle — legible as ink on a screen, useless as a quantity. Sharing
            a stackId gives both series the whole band, and because the two
            values already have opposite signs the "stack" resolves to one bar
            up and one bar down from the same baseline. Twice the width, and
            the charge and discharge for a day now line up on one column
            instead of sitting next to each other pretending to be different
            days. */}
        <Bar yAxisId="kwh" stackId="kwh" dataKey="outPlot" fill={OUT} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Bar yAxisId="kwh" stackId="kwh" dataKey="inPlot" fill={IN} radius={[0, 0, 3, 3]} isAnimationActive={false} />

        {/* connectNulls stays false: a stretch nobody has read must break the
            line rather than be bridged across. A bridged SOC line is a claim
            that the charge went smoothly from one end of the gap to the other,
            which is exactly the sort of invention this app refuses. */}
        <Line
          yAxisId="soc"
          type="monotone"
          dataKey="soc"
          stroke={SOC}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
