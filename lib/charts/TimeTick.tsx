/**
 * A two-line X tick for time axes: the time on top, and underneath it the
 * date — on the first label, and on the first label of each new day.
 *
 * Why two lines: Recharts sizes labels by the formatter's text and then keeps
 * every Nth one to avoid overlap. A date folded into the same line would be
 * wider than what was measured, and a midnight tick ("12 Oct") is often one of
 * the ones dropped — which left "02:00" reading as the same day as "22:00".
 * Here the measured text is the time alone, and the date rides below it on
 * whichever label is actually first of its day.
 */

import { axisProps } from "./tokens";

export interface TimeTickProps {
  x?: number;
  y?: number;
  index?: number;
  payload?: { value: number };
}

/**
 * A tick renderer for one axis. `dayOf` names an instant's site day, `timeOf`
 * and `dateOf` format it; `dateOnFirst` puts the date under the first label.
 * Recharts renders the kept ticks in order from index 0, so "the day changed
 * since the last label drawn" is tracked across one pass.
 */
export function makeTimeTick(opts: {
  timeOf: (ts: number) => string;
  dateOf: (ts: number) => string;
  dayOf: (ts: number) => string;
  dateOnFirst: boolean;
}) {
  let prevDay: string | null = null;
  const { fill, fontSize } = axisProps.tick;
  function TimeTick({ x = 0, y = 0, index = 0, payload }: TimeTickProps) {
    const ts = payload?.value;
    if (typeof ts !== "number") return <g />;
    if (index === 0) prevDay = null;
    const day = opts.dayOf(ts);
    const showDate = prevDay === null ? opts.dateOnFirst : day !== prevDay;
    prevDay = day;
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy="0.71em" textAnchor="middle" fill={fill} fontSize={fontSize}>{opts.timeOf(ts)}</text>
        {showDate && (
          <text x={0} y={0} dy="1.91em" textAnchor="middle" fill={fill} fontSize={fontSize} fontWeight={600}>{opts.dateOf(ts)}</text>
        )}
      </g>
    );
  }
  return TimeTick;
}

/** No label — the upper charts of a stack keep their ticks (and grid lines) but print nothing. */
export function EmptyTick() {
  return <g />;
}
