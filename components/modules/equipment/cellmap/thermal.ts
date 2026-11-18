/**
 * The thermal scale, and the rules for reading a pack.
 *
 * Kept out of the component because the ramp and the normalisation are the
 * part an engineer has to trust. If someone disputes a colour, this file is
 * the answer.
 */

import * as THREE from "three";
import type { CellData } from "@/lib/api/types";

export type CellMode = "temperature" | "voltage" | "soc";

export interface ModeSpec {
  label: string;
  unit: string;
  /** Decimals for the readout. */
  precision: number;
  /** Pulls the value this mode maps. null means the cell has no reading. */
  read: (c: CellData) => number | null;
}

/**
 * Modes are declared, not branched on.
 *
 * Only temperature is wired into the UI today, but voltage is real data on
 * this API and costs nothing to declare. socPct is deliberately included even
 * though UGX returns null for it — the firmware mirrors rack SOC into every
 * per-cell register, so there is no per-cell measurement. Declaring it means
 * the map renders every cell dormant rather than a plausible flat field, which
 * is the honest answer.
 */
export const MODES: Record<CellMode, ModeSpec> = {
  temperature: { label: "Temperature", unit: "°C", precision: 1, read: (c) => c.tempC },
  voltage:     { label: "Voltage",     unit: "mV", precision: 0, read: (c) => c.voltMv },
  soc:         { label: "SOC",         unit: "%",  precision: 1, read: (c) => c.socPct },
};

/**
 * One ramp per mode.
 *
 * All three are muted rather than saturated. A full-chroma jet ramp on a dark
 * UI vibrates and makes mid-range differences harder to judge, not easier;
 * held back in chroma, neighbouring cells stay comparable and the extremes
 * still shout.
 */
type Ramp = Array<[number, string]>;

/**
 * Cool → hot, on the jet scale CFD tools use.
 *
 * An earlier pass held this back in chroma to suit a dark UI. That was the
 * wrong instinct for this particular chart: engineers read pack thermals
 * against the same blue-green-yellow-red scale every solver prints, and a
 * muted version of it is harder to compare against a report, not easier.
 * Saturation here is doing a job.
 */
const TEMPERATURE_RAMP: Ramp = [
  [0.00, "#0a1fd0"],
  [0.14, "#1464ff"],
  [0.28, "#12b4f0"],
  [0.42, "#19e0c0"],
  [0.55, "#2ee36a"],
  [0.68, "#8ce62a"],
  [0.80, "#f2e21c"],
  [0.90, "#ff9412"],
  [1.00, "#f5211a"],
];

/**
 * Discrete steps for the legend.
 *
 * The reference legend is banded, not a smooth bar, and that is worth copying:
 * banding turns "somewhere in the green" into "between 302.0 and 302.7", which
 * is the difference between a picture and an instrument. The cells stay
 * smoothly shaded — only the key is quantised.
 */
export const LEGEND_STEPS = 10;

/**
 * Voltage. Diverging, centred on the pack mean.
 *
 * Sequential would be the wrong instrument here. What matters in a pack is not
 * that a cell is at 3.31 V, it is whether it has drifted from its neighbours —
 * so the scale is centred on the mean and normalised by the largest deviation
 * present. A balanced pack comes out uniformly green whatever its absolute
 * voltage; a drifting one grows a blue tail and a red tail, which is the thing
 * an engineer is actually looking for.
 */
const VOLTAGE_RAMP: Ramp = [
  [0.0, "#3f7fc4"],
  [0.3, "#4d9bb0"],
  [0.5, "#4aa587"],
  [0.7, "#bb9a52"],
  [1.0, "#bc4f4f"],
];

/** SOC. One hue, rising intensity — charge is a quantity, not a direction. */
const SOC_RAMP: Ramp = [
  [0.0, "#1d3a52"],
  [1.0, "#7fd6f5"],
];

const RAMPS: Record<CellMode, Ramp> = {
  temperature: TEMPERATURE_RAMP,
  voltage: VOLTAGE_RAMP,
  soc: SOC_RAMP,
};

const COMPILED: Record<CellMode, { colors: THREE.Color[]; stops: number[] }> = {
  temperature: { colors: [], stops: [] },
  voltage: { colors: [], stops: [] },
  soc: { colors: [], stops: [] },
};
(Object.keys(RAMPS) as CellMode[]).forEach((m) => {
  COMPILED[m].colors = RAMPS[m].map(([, hex]) => new THREE.Color(hex));
  COMPILED[m].stops = RAMPS[m].map(([stop]) => stop);
});

/** Colour for a normalised 0..1 position on a mode's scale. */
export function rampColor(t: number, mode: CellMode, out = new THREE.Color()): THREE.Color {
  const { colors, stops } = COMPILED[mode];
  const x = THREE.MathUtils.clamp(t, 0, 1);
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1]) i++;
  const span = stops[i + 1] - stops[i];
  const local = span <= 0 ? 0 : (x - stops[i]) / span;
  return out.copy(colors[i]).lerp(colors[i + 1], local);
}

/** CSS gradient for the legend, so the bar and the cells cannot disagree. */
export function rampCss(mode: CellMode): string {
  return `linear-gradient(to top, ${RAMPS[mode]
    .map(([stop, hex]) => `${hex} ${(stop * 100).toFixed(0)}%`)
    .join(", ")})`;
}

/**
 * Legend bands, hottest first, each with the value at its lower edge.
 *
 * Built from the same ramp function the cells use, so a band and the cells it
 * describes cannot drift apart.
 */
export function legendBands(
  stats: PackStats,
  mode: CellMode,
): Array<{ css: string; edge: number }> {
  const ends = scaleEnds(stats, mode);
  const span = ends.high - ends.low;
  const c = new THREE.Color();
  const out: Array<{ css: string; edge: number }> = [];
  for (let i = LEGEND_STEPS - 1; i >= 0; i--) {
    const t = (i + 0.5) / LEGEND_STEPS;
    rampColor(t, mode, c);
    out.push({
      css: `#${c.getHexString()}`,
      edge: ends.low + (i / LEGEND_STEPS) * span,
    });
  }
  return out;
}

/** Colour for a cell the API had no reading for. Never on the ramp. */
export const NO_READING = new THREE.Color("#39424f");

export interface PackStats {
  min: number;
  max: number;
  avg: number;
  /** max − min. The number that actually matters for pack health. */
  spread: number;
  /** Cells carrying a reading. */
  count: number;
  /** Cells the API returned null for. */
  missing: number;
  /** Largest absolute deviation from the mean. Drives the diverging scale. */
  maxDev: number;
  hottestId: string | null;
  coolestId: string | null;
}

/**
 * Summarise the pack from whatever the API returned.
 *
 * Nulls are excluded from every statistic rather than coerced to zero — a dead
 * probe is not a cold cell, and averaging it in would drag the mean toward a
 * temperature nothing is actually at. They are counted separately so the UI
 * can say how many are missing.
 *
 * Returns null when nothing is readable, so callers render an empty state
 * instead of a scale from Infinity to −Infinity.
 */
export function packStats(cells: CellData[], mode: CellMode): PackStats | null {
  const read = MODES[mode].read;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  let missing = 0;
  let hottestId: string | null = null;
  let coolestId: string | null = null;

  for (const c of cells) {
    const v = read(c);
    if (v == null || !Number.isFinite(v)) {
      missing++;
      continue;
    }
    if (v < min) { min = v; coolestId = c.cellId; }
    if (v > max) { max = v; hottestId = c.cellId; }
    sum += v;
    count++;
  }

  if (count === 0) return null;

  const avg = sum / count;
  let maxDev = 0;
  for (const c of cells) {
    const v = read(c);
    if (v == null || !Number.isFinite(v)) continue;
    maxDev = Math.max(maxDev, Math.abs(v - avg));
  }

  return { min, max, avg, spread: max - min, count, missing, maxDev, hottestId, coolestId };
}

/**
 * Position on the scale for one value, in the way that mode wants to be read.
 *
 * Temperature and SOC are sequential: min at the bottom, max at the top.
 * Voltage is diverging about the mean, so the middle of the ramp is "in line
 * with the pack" and distance from it is drift in either direction.
 *
 * Both guard a zero range. A uniform pack would otherwise divide by zero, and
 * the honest answer there is the centre of the scale: every cell the same
 * colour is correct when every cell holds the same value.
 */
export function normalise(value: number, stats: PackStats, mode: CellMode): number {
  if (mode === "voltage") {
    if (stats.maxDev <= 1e-9) return 0.5;
    return THREE.MathUtils.clamp(0.5 + (value - stats.avg) / (2 * stats.maxDev), 0, 1);
  }
  const range = stats.max - stats.min;
  if (range <= 1e-6) return 0.5;
  return (value - stats.min) / range;
}

/** Legend endpoints, which differ because the normalisations differ. */
export function scaleEnds(stats: PackStats, mode: CellMode): { low: number; mid: number; high: number } {
  if (mode === "voltage") {
    return { low: stats.avg - stats.maxDev, mid: stats.avg, high: stats.avg + stats.maxDev };
  }
  return { low: stats.min, mid: (stats.min + stats.max) / 2, high: stats.max };
}

/**
 * Rows and columns for `n` cells.
 *
 * Biased wide — a battery pack read at a 3/4 angle wants more columns than
 * rows, and a near-square grid of 300 cells turns into an unreadable block.
 */
export function packGrid(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 0, rows: 0 };
  const cols = Math.max(1, Math.round(Math.sqrt(n * 2.2)));
  return { cols, rows: Math.ceil(n / cols) };
}
