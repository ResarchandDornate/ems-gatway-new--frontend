/**
 * Chart tokens.
 *
 * Every chart colour in the app comes from here, and every value resolves to a
 * CSS custom property defined once per theme in globals.css. That indirection
 * is the whole point: Recharts takes colours as SVG attributes and inline
 * styles, neither of which can read a Tailwind class — but both accept
 * `var()`, so a chart that references these follows the theme with no React
 * state, no re-render and no second theme system.
 *
 * ── Why not a hook ──────────────────────────────────────────────────────────
 *
 * A `useChartTokens()` that read resolved values through getComputedStyle
 * would need to re-run on every theme switch, re-render every chart, and would
 * hand Recharts a stale colour for one frame. These are plain `var()` strings,
 * so the browser repaints the SVG itself the moment the `light` class flips.
 * Nothing to subscribe to, nothing to invalidate.
 *
 * ── The one thing that cannot be a var() ────────────────────────────────────
 *
 * SVG `<linearGradient>` stops accept var() fine, but a gradient still has to
 * be declared with a unique id per chart or two charts on one page collide.
 * `gradientDefs` below emits that markup; see AreaGradient.
 */

export const chartTokens = {
  background: "var(--chart-bg)",
  grid: "var(--chart-grid)",
  border: "var(--chart-border)",
  reference: "var(--chart-ref)",
  crosshair: "var(--chart-crosshair)",

  text: "var(--chart-text)",
  textMuted: "var(--chart-text-muted)",

  primary: "var(--chart-primary)",
  primaryFill: "var(--chart-primary-fill)",
  primaryEdge: "var(--chart-primary-edge)",
  secondary: "var(--chart-secondary)",
  secondaryFill: "var(--chart-secondary-fill)",
  secondaryEdge: "var(--chart-secondary-edge)",

  glow: "var(--chart-glow)",
  glowSecondary: "var(--chart-glow-secondary)",

  tooltipBackground: "var(--tooltip-bg)",
  tooltipText: "var(--tooltip-ink)",
  tooltipBorder: "var(--tooltip-line)",
  tooltipShadow: "var(--tooltip-shadow)",
} as const;

export type ChartSeries = "primary" | "secondary";

/** Stroke, fill and glow for one series, so callers pick a role not a colour. */
export function series(role: ChartSeries) {
  return role === "primary"
    ? {
        stroke: chartTokens.primary,
        fill: chartTokens.primaryFill,
        edge: chartTokens.primaryEdge,
        glow: chartTokens.glow,
      }
    : {
        stroke: chartTokens.secondary,
        fill: chartTokens.secondaryFill,
        edge: chartTokens.secondaryEdge,
        glow: chartTokens.glowSecondary,
      };
}

/** Recharts axis props. Spread onto <XAxis>/<YAxis> so ticks follow the theme. */
export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: chartTokens.textMuted, fontSize: 10 },
} as const;

/** Recharts tooltip chrome. */
export const tooltipStyle = {
  background: chartTokens.tooltipBackground,
  border: `1px solid ${chartTokens.tooltipBorder}`,
  borderRadius: 8,
  fontSize: 11,
  color: chartTokens.tooltipText,
  padding: "8px 10px",
  boxShadow: chartTokens.tooltipShadow,
} as const;

/** Cursor line shown on hover. */
export const cursorStyle = {
  stroke: chartTokens.crosshair,
  strokeWidth: 1,
  strokeDasharray: "3 3",
} as const;
