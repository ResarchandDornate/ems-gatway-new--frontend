/**
 * One axis style for every chart that sits in a row.
 *
 * The dashboard's three chart cards each did their own: units on every tick
 * ("1200 kWh" wrapped to two lines), uneven ticks (18 / 9 / −9), three
 * different Y widths and tick counts, so no grid line met its neighbour's.
 * Here: five round ticks, the unit once above the axis (see AxisUnit), one
 * Y width, and a faint baseline under X.
 */

import { axisProps, chartTokens } from "./tokens";

export const TICK_COUNT = 5;
export const Y_AXIS_WIDTH = 40;
/** Room above the plot for the unit label. Every chart in a row uses it. */
export const PLOT_MARGIN = { top: 18, right: 8, left: 0, bottom: 0 } as const;

export const yAxis = { ...axisProps, width: Y_AXIS_WIDTH, tickMargin: 6, interval: 0 as const } as const;
export const xAxis = {
  ...axisProps,
  axisLine: { stroke: chartTokens.grid },
  tickMargin: 8,
  height: 26,
} as const;

/* Round step sizes, × a power of ten. 3 and 6 are in so a 1,060 kWh bar gets
   a 1.2k top tick, not 2k with half the plot empty. */
const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The smallest round step at least `raw`. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return (STEPS.find((k) => k * mag >= raw - 1e-9) ?? 10) * mag;
}

/** 0 … max in four round steps. */
export function zeroBasedTicks(max: number | null | undefined): number[] {
  const step = niceStep((max ?? 0) / (TICK_COUNT - 1));
  return Array.from({ length: TICK_COUNT }, (_, i) => i * step);
}

/** −m … 0 … +m in round steps, 0 in the middle — for signed power. */
export function symmetricTicks(maxAbs: number | null | undefined): number[] {
  const step = niceStep((maxAbs ?? 0) / 2);
  return [-2, -1, 0, 1, 2].map((k) => k * step);
}

/** A tick figure, compact: 1200 → 1.2k, 2.5 → 2.5, 100 → 100. */
export function tickLabel(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return `${+(v / 1000).toFixed(1)}k`;
  /* Two places: a 0.15 step rounded to one read 136.1 / 136.2 / 136.3 / 136.5. */
  return Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
}

/**
 * Five round ticks around [min, max] for a reading that does not start at 0
 * (SOC near 95 %, DC voltage near 870 V), so its movement stays visible.
 * Steps up until the five ticks cover the data.
 */
export function rangeTicks(min: number | null | undefined, max: number | null | undefined): number[] {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return zeroBasedTicks(1);
  let lo = Math.min(min, max), hi = Math.max(min, max);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  let step = niceStep((hi - lo) / (TICK_COUNT - 1));
  for (let i = 0; i < 20; i++) {
    const start = Math.floor(lo / step) * step;
    if (start + step * (TICK_COUNT - 1) >= hi - 1e-9) {
      return Array.from({ length: TICK_COUNT }, (_, k) => +(start + k * step).toFixed(6));
    }
    step = niceStep(step * 1.0001 + 1e-12);
  }
  return Array.from({ length: TICK_COUNT }, (_, k) => lo + ((hi - lo) * k) / (TICK_COUNT - 1));
}
