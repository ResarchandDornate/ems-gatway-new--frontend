"use client";

/**
 * Day / Week / Month / Year navigation, after Apple Health: a segmented range
 * control, the period's name, and ‹ › to step one period back or forward.
 * Swipe a chart left or right for the same (useSwipe). Never steps into the
 * future: › is disabled on the period that holds now.
 *
 * State lives in usePeriod, so every graph showing one asset and range shares
 * one period and their axes stay in step.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RANGES, GENIE_RANGES, periodOf, shift, switchRange, isLatest, type Period, type Range, type RangeOption } from "@/lib/charts/period";

export function usePeriod(initial: Range = "day", ranges: RangeOption[] = RANGES) {
  const [period, setPeriod] = useState<Period>(() =>
    periodOf(ranges.some((r) => r.id === initial) ? initial : ranges[0].id, Date.now()));
  const now = Date.now();
  const latest = isLatest(period, now);
  /* The latest hour rolls on: each five-minute mark moves it forward, so it
     stays the last sixty minutes rather than going stale. */
  useEffect(() => {
    if (period.range !== "hour" || !latest) return;
    const id = setInterval(() => setPeriod((p) =>
      p.range === "hour" && p.to <= Date.now() ? periodOf("hour", Date.now()) : p), 15_000);
    return () => clearInterval(id);
  }, [period.range, latest]);
  return {
    period,
    latest,
    ranges,
    setRange: useCallback((r: Range) => setPeriod((p) => (p.range === r ? p : switchRange(p, r, Date.now()))), []),
    back: useCallback(() => setPeriod((p) => shift(p, -1)), []),
    forward: useCallback(() => setPeriod((p) => (isLatest(p, Date.now()) ? p : shift(p, 1))), []),
    today: useCallback(() => setPeriod((p) => periodOf(p.range, Date.now())), []),
    /** Show a given period (e.g. the day a parameter last reported). */
    jumpTo: useCallback((p: Period) => setPeriod(p), []),
  };
}

export type PeriodState = ReturnType<typeof usePeriod>;

export function PeriodNav({ state, note }: { state: PeriodState; note?: string }) {
  const { period, latest, setRange, back, forward, today, ranges } = state;
  return (
    /* One row: the period and its steps on the left, a compact range pill on
       the right. Wraps the pill under the period on a narrow card. */
    <div className="flex items-center justify-between gap-x-3 gap-y-2 flex-wrap">
      <div className="flex items-center gap-2 min-w-0 flex-1" onKeyDown={(e) => {
        if (e.key === "ArrowLeft") back();
        if (e.key === "ArrowRight") forward();
      }}>
        <button type="button" onClick={back} aria-label={`Previous ${period.range}`}
          className="h-7 w-7 grid place-items-center rounded-full text-ink2 hover:bg-surface2 border border-line shrink-0">
          <ChevronLeft size={14} />
        </button>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink tracking-[-0.01em] truncate" aria-live="polite">{period.label}</div>
          {note && <div className="text-[11px] text-muted truncate">{note}</div>}
        </div>
        <button type="button" onClick={forward} disabled={latest} aria-label={`Next ${period.range}`}
          className="h-7 w-7 grid place-items-center rounded-full text-ink2 hover:bg-surface2 border border-line shrink-0 disabled:opacity-30 disabled:cursor-not-allowed">
          <ChevronRight size={14} />
        </button>
        {!latest && (
          <button type="button" onClick={today} className="text-[11.5px] text-accent font-semibold px-1 hover:underline shrink-0">
            {period.range === "day" ? "Today" : period.range === "hour" ? "Now" : period.range === "days28" ? "Latest" : `This ${GENIE_RANGES.find((x) => x.id === period.range)?.label ?? period.range}`}
          </button>
        )}
      </div>

      {/* The range: a compact pill, the selection a raised segment inside it. */}
      <div role="tablist" aria-label="Time range"
        className="flex p-0.5 rounded-[10px] bg-surface3/80 border border-line shrink-0">
        {ranges.map((r) => {
          const on = r.id === period.range;
          return (
            <button key={r.id} type="button" role="tab" aria-selected={on} onClick={() => setRange(r.id)}
              className={`min-w-[52px] px-2.5 py-1 rounded-[8px] text-[11.5px] font-semibold transition-all duration-200
                ${on ? "bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink3 hover:text-ink"}`}>
              {r.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Swipe a chart to step periods: a horizontal drag of 60 px or more that is
 * mostly sideways. Spread the handlers on the chart's wrapper. A tap or a
 * vertical scroll never navigates.
 */
export function useSwipe(state: PeriodState) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: RPointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: RPointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx > 0) state.back(); else state.forward();
    },
    style: { touchAction: "pan-y" as const },
  };
}
