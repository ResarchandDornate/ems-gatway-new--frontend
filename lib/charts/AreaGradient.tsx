"use client";

/**
 * The gradient wash under an area series.
 *
 * The reference's depth comes almost entirely from this: a saturated stop at
 * the curve fading to nothing at the baseline, so the fill reads as light
 * falling away rather than as a coloured block. A flat `fillOpacity` cannot do
 * it — the bottom edge stays visible as a hard horizontal line.
 *
 * Both stops are theme tokens, so the same component produces the dark
 * theme's luminous 22% wash and the light theme's restrained 14% tint with no
 * branching here.
 *
 * `id` must be unique per chart. Two charts on one page that both declare
 * `#areaPrimary` will silently share whichever SVG the browser resolved first,
 * and the second chart's fill turns into the first one's colour.
 */

import { series, type ChartSeries } from "./tokens";

export function AreaGradient({ id, role }: { id: string; role: ChartSeries }) {
  const s = series(role);
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={s.fill} />
      <stop offset="100%" stopColor={s.edge} />
    </linearGradient>
  );
}

export default AreaGradient;
