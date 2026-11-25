"use client";

import { useState } from "react";

/**
 * Five breakpoints defining a red → amber → green → amber → red gradient:
 *   ≤ critLow           → critical (red)
 *   critLow  … nomLow    → ramping into the nominal band
 *   nomLow … perfect     → ramping toward the target value
 *   perfect … nomHigh    → ramping back out of the target
 *   nomHigh … critHigh   → ramping into critical
 *   ≥ critHigh           → critical (red)
 *
 * Unlike colouring by where a value falls within the *current batch's*
 * min/max, a fixed threshold set means a cell reads as healthy whenever it
 * genuinely is — regardless of what the rest of the pack is doing — and a
 * spread of merely-noisy-but-safe readings does not paint itself red→green
 * end to end.
 */
export interface ColorThresholds {
  critLow: number;
  nomLow: number;
  perfect: number;
  nomHigh: number;
  critHigh: number;
}

/**
 * A starting point derived from the data itself — not an invented safety
 * spec for hardware this app has no authority to characterise.
 *
 * Deliberately padded WELL OUTSIDE the observed min/max, so nothing reads as
 * critical on first load. Clamping critLow/critHigh to this batch's own
 * extremes (an earlier version of this did exactly that) guarantees the
 * single lowest and highest reading render pure red every time, on any
 * dataset — healthy or not — because they ARE the extremes by definition.
 * "What counts as red" is the user's engineering judgement, not something a
 * data-derived default should assert; until they set it, everything reads
 * amber-to-green (closer to / further from the observed average).
 */
export function defaultThresholds(min: number, max: number, avg: number): ColorThresholds {
  const range = max - min || 1;
  const pad = Math.max(range, 1);
  return {
    critLow:  Math.round(min - pad),
    nomLow:   Math.round(min),
    perfect:  Math.round(avg),
    nomHigh:  Math.round(max),
    critHigh: Math.round(max + pad),
  };
}

/** Persisted, user-editable thresholds, keyed by storage key per metric. */
export function useColorThresholds(storageKey: string, fallback: ColorThresholds) {
  const [thresholds, setThresholdsState] = useState<ColorThresholds>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return {
        critLow:  parsed.critLow  ?? fallback.critLow,
        nomLow:   parsed.nomLow   ?? fallback.nomLow,
        perfect:  parsed.perfect  ?? fallback.perfect,
        nomHigh:  parsed.nomHigh  ?? fallback.nomHigh,
        critHigh: parsed.critHigh ?? fallback.critHigh,
      };
    } catch {
      return fallback;
    }
  });

  function setThresholds(next: ColorThresholds) {
    setThresholdsState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    }
  }

  function reset() {
    setThresholds(fallback);
  }

  return { thresholds, setThresholds, reset };
}

type Hsl = readonly [number, number, number];
// Single-hue blue scale: deep/saturated at the critical bounds, lightest at
// the target value, so "further from perfect" reads as "darker" rather than
// as a different hue.
const DEEP: Hsl = [215, 75, 32];
const MID: Hsl  = [210, 60, 50];
const LIGHT: Hsl = [200, 55, 78];

function mix(a: Hsl, b: Hsl, f: number): string {
  const l = (x: number, y: number) => x + (y - x) * f;
  return `hsl(${Math.round(l(a[0], b[0]))},${Math.round(l(a[1], b[1]))}%,${Math.round(l(a[2], b[2]))}%)`;
}

/** Map a raw value through the five-point threshold gradient. */
export function thresholdToColor(v: number, t: ColorThresholds): string {
  if (v <= t.critLow) return mix(DEEP, DEEP, 0);
  if (v <= t.nomLow)  return mix(DEEP, MID, t.nomLow > t.critLow ? (v - t.critLow) / (t.nomLow - t.critLow) : 1);
  if (v <= t.perfect)  return mix(MID, LIGHT, t.perfect > t.nomLow ? (v - t.nomLow) / (t.perfect - t.nomLow) : 1);
  if (v <= t.nomHigh)  return mix(LIGHT, MID, t.nomHigh > t.perfect ? (v - t.perfect) / (t.nomHigh - t.perfect) : 0);
  if (v <= t.critHigh) return mix(MID, DEEP, t.critHigh > t.nomHigh ? (v - t.nomHigh) / (t.critHigh - t.nomHigh) : 1);
  return mix(DEEP, DEEP, 0);
}

/** CSS linear-gradient string spanning [critLow, critHigh], for legend bars. */
export function thresholdGradientCss(t: ColorThresholds): string {
  const span = t.critHigh - t.critLow || 1;
  const pct = (v: number) => `${Math.round(((v - t.critLow) / span) * 100)}%`;
  const stops = [
    [t.critLow, mix(DEEP, DEEP, 0)],
    [t.nomLow, mix(DEEP, MID, 1)],
    [t.perfect, mix(MID, LIGHT, 1)],
    [t.nomHigh, mix(LIGHT, MID, 1)],
    [t.critHigh, mix(MID, DEEP, 1)],
  ] as const;
  return `linear-gradient(to right, ${stops.map(([v, c]) => `${c} ${pct(v as number)}`).join(", ")})`;
}
