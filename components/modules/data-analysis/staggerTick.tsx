import { xAxis } from "@/lib/charts/axes";

/* Every bucket labelled — each day of a Week or Month, each month of a Year —
   as on the other period charts. Past 14 the labels alternate between two
   rows so a 31-day month stays legible. */
function StaggerTick({ x, y, payload, index }: { x?: number; y?: number; payload?: { value?: string | number }; index?: number }) {
  return (
    <text x={x} y={(y ?? 0) + ((index ?? 0) % 2 ? 22 : 10)} textAnchor="middle"
      fill={xAxis.tick.fill} fontSize={xAxis.tick.fontSize}>
      {payload?.value}
    </text>
  );
}

/** X-axis props that label every bucket. */
export const everyBucketX = (n: number) => ({
  ...xAxis, dataKey: "label", interval: 0 as const, minTickGap: 0,
  ...(n > 14 ? { tick: <StaggerTick />, height: 34, tickMargin: 0 } : {}),
});
