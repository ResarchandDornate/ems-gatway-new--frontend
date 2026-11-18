"use client";

/**
 * Keeping time-series charts still while new data arrives.
 *
 * Two things made the charts jump on every refresh:
 *
 *   • the Y scale was recomputed from whatever the window held, so a reading
 *     going from 19 to 21 kW flipped the axis from ±20 to ±30 and squashed
 *     the whole line;
 *   • the window's end moved only when a poll landed, 15–60 s at a time, and
 *     line animations morphed the path between the two states.
 *
 * useNow gives a clock that ticks every second, so a window ending "now"
 * slides continuously instead of stepping. useStableTicks makes the scale
 * sticky: it grows at once when the data needs more room, and shrinks only
 * when the data has fallen well inside it, so ordinary ups and downs leave it
 * where it is.
 */

import { useEffect, useRef, useState } from "react";

/** Date.now(), refreshed every `intervalMs`. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Shrink only when the data uses less than this share of the current range. */
const SHRINK_BELOW = 0.45;

/**
 * Ticks that change only when they must.
 *
 * @param ticks    the ticks the current data asks for (ascending)
 * @param resetKey change it (range, unit, cabinet) to drop the remembered scale
 */
export function useStableTicks(ticks: number[], resetKey = ""): number[] {
  const kept = useRef<{ key: string; ticks: number[] } | null>(null);
  const span = (t: number[]) => (t.length ? t[t.length - 1] - t[0] : 0);
  const prev = kept.current;
  let next = ticks;
  if (prev && prev.key === resetKey && ticks.length) {
    const grow = ticks[0] < prev.ticks[0] || ticks[ticks.length - 1] > prev.ticks[prev.ticks.length - 1];
    const shrink = span(ticks) < span(prev.ticks) * SHRINK_BELOW;
    next = grow || shrink ? ticks : prev.ticks;
  }
  kept.current = { key: resetKey, ticks: next };
  return next;
}
