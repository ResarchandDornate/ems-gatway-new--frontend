"use client";

/**
 * Value — renders a reading, or an explicit absence.
 *
 * This component exists to make §6.3 impossible to violate by accident: "No
 * value is fabricated. Where a figure cannot be computed the UI shows an
 * explicit unavailable state — never a zero."
 *
 * `null` is not 0, and the difference matters commercially: a customer reading
 * 0 kW believes the plant is idle, when in fact the plant has stopped
 * reporting. Every numeric on every screen goes through here.
 */

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

interface ValueProps {
  value: number | null | undefined;
  unit?: string;
  /** Decimal places. Ignored when the value is absent. */
  precision?: number;
  /** Animate between readings (§7.6 "animated numeric interpolation"). */
  animate?: boolean;
  /** Indian digit grouping — 12,34,567 rather than 1,234,567. */
  grouping?: "indian" | "standard";
  className?: string;
}

/** Placeholder for a value UGX has not supplied. Never a zero. */
const ABSENT = "—";

function format(n: number, precision: number, grouping: "indian" | "standard") {
  return n.toLocaleString(grouping === "indian" ? "en-IN" : "en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/**
 * Eases to a new reading over ~520 ms. Purely presentational — the displayed
 * number always converges on the real one, and the real one is what any
 * screenshot a second later will show.
 *
 * That last sentence used to be false, and the way it failed is worth keeping
 * written down. The starting point was only ever advanced when a run reached
 * t === 1. A target that changed mid-ease cancelled the frame first, so the
 * start point kept the value of the last *completed* run while the display was
 * left at whatever intermediate number the cancelled one had reached — and the
 * next run's `a === b` short-circuit then returned without touching the
 * display, stranding that intermediate number permanently.
 *
 * It stayed invisible while readings changed slowly. The History screen fills
 * progressively and updates its totals every second and a half, which strands
 * one immediately: a card read "174.03 kWh" beside a chip reading "831.9 kWh"
 * for the same quantity, and the card was the headline. A presentational easing
 * is allowed to lag a real figure. It is not allowed to end on a different one.
 *
 * So the start point is now what is actually on screen, written every frame,
 * and every run finishes by setting the target exactly.
 */
function useEased(target: number | null | undefined, on: boolean) {
  const [shown, setShown] = useState<number>(target ?? 0);
  const raf = useRef<number | undefined>(undefined);
  /** What the display currently reads — not what the last full run ended on. */
  const at = useRef<number>(target ?? 0);

  useEffect(() => {
    if (!on || target == null) { setShown(target ?? 0); at.current = target ?? 0; return; }
    const a = at.current;
    const b = target;
    /* Already there: snap rather than return, so an interrupted run cannot
       leave the display holding a number nobody measured. */
    if (a === b) { setShown(b); return; }

    const start = performance.now();
    const settle = () => { at.current = b; setShown(b); };

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 520);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        const v = a + (b - a) * eased;
        at.current = v;
        setShown(v);
        raf.current = requestAnimationFrame(tick);
      } else {
        settle();
      }
    };

    /* Convergence cannot be left to the frame loop. requestAnimationFrame stops
       while a page is backgrounded — and, as this app's own preview proves, a
       document reporting visibilityState "visible" is still not a guarantee
       that frames are being produced. Where that happened the eased value
       simply stopped, and the card held a number that was never measured: a
       tile read 40.95 kWh beside a chip reading 832.6 kWh for the same figure.
       So the timer, not the frame loop, owns the promise in this function's
       docblock. The easing is decoration; landing on the real number is not. */
    raf.current = requestAnimationFrame(tick);
    const guard = setTimeout(settle, 620);

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      clearTimeout(guard);
    };
  }, [target, on]);

  return on && target != null ? shown : target;
}

export function Value({
  value, unit, precision = 0, animate = false,
  grouping = "standard", className,
}: ValueProps) {
  const shown = useEased(value, animate);

  if (shown == null || Number.isNaN(shown)) {
    return (
      <span className={clsx("m-num", className)}>
        <span className="m-ink3" aria-label="not available">{ABSENT}</span>
        {unit && <span className="m-unit">{unit}</span>}
      </span>
    );
  }

  return (
    <span className={clsx("m-num", className)}>
      {format(shown, precision, grouping)}
      {unit && <span className="m-unit">{unit}</span>}
    </span>
  );
}

/** Rupees, Indian grouping, ex-GST. Absent stays absent. */
export function Rupees({ value, precision = 0, className, animate }: {
  value: number | null | undefined; precision?: number; className?: string; animate?: boolean;
}) {
  if (value == null) return <span className={clsx("m-num m-ink3", className)}>{ABSENT}</span>;
  return (
    <span className={clsx("m-num", className)}>
      <span className="m-rupee">₹</span>
      <Value value={value} precision={precision} grouping="indian" animate={animate} />
    </span>
  );
}
