/**
 * When a cell's drift is an issue.
 *
 * Drift is a cell's distance from the pack's average cell voltage, in mV
 * (cellTrend.service: cell − pack average, negative below family). It is an
 * issue — flagged, counted, shown as a warning — only at 100 mV or more either
 * way. Below that it is normal spread, and the screens show it as a reading,
 * never as a warning. 100 mV = 0.1 V.
 *
 * The one place the threshold lives. No imports, so the rule can be tested
 * with node's own runner (cellDrift.test.ts).
 */

export const CELL_DRIFT_THRESHOLD_MV = 100;

/** Y range the drift chart opens on: the threshold with room either side. */
export const CELL_DRIFT_AXIS_MV = 150;

/** True when a drift of `mv` millivolts is a drift issue (|mv| ≥ 100). */
export function isDriftIssue(mv: number | null | undefined): boolean {
  return typeof mv === "number" && Number.isFinite(mv) && Math.abs(mv) >= CELL_DRIFT_THRESHOLD_MV;
}

/** Volts, for a caller holding V rather than mV: 0.1 V is the threshold. */
export const isDriftIssueV = (v: number | null | undefined): boolean =>
  typeof v === "number" && isDriftIssue(v * 1000);

/**
 * The drift chart's Y domain: ±150 mV, widened only when a reading lies
 * outside it, so an outlier is never clipped off the chart.
 */
export function driftAxisDomain(values: number[]): [number, number] {
  let lo = -CELL_DRIFT_AXIS_MV, hi = CELL_DRIFT_AXIS_MV;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = Math.floor(v / 50) * 50;
    if (v > hi) hi = Math.ceil(v / 50) * 50;
  }
  return [lo, hi];
}

/** Ticks every 50 mV across a domain from driftAxisDomain. */
export function driftAxisTicks([lo, hi]: [number, number]): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += 50) out.push(v);
  return out;
}

/**
 * The worst cell's drift at each envelope sample: whichever of the pack
 * minimum and maximum is farther from the pack average, signed. This covers
 * every cell, not just the traced one — no cell can be farther from the
 * average than the pack's extremes.
 */
export function worstDrift(
  sample: { min: number | null; avg: number | null; max: number | null },
): number | null {
  const { min, avg, max } = sample;
  if (avg == null) return null;
  const below = min == null ? null : min - avg;
  const above = max == null ? null : max - avg;
  if (below == null) return above;
  if (above == null) return below;
  return Math.abs(below) >= Math.abs(above) ? below : above;
}
