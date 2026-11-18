"use client";

/**
 * The plant-level figures across the top of the frame.
 *
 * These sit outside the Canvas as ordinary DOM. They do not move with the
 * camera and they do not belong to any one asset, so tethering them to the 3D
 * scene would only make them harder to lay out and slower to draw.
 *
 * Values animate on change rather than snapping. A counter that ticks tells you
 * a new reading landed; one that jumps does not, and on a wall display nobody
 * is watching closely enough to catch the difference otherwise.
 */

import { useSiteFreshness } from "@/hooks/useSiteFreshness";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { hex } from "../theme";
import { useScenePalette } from "../useScenePalette";

export interface KpiItem {
  label: string;
  value: number | null;
  unit?: string;
  /** Decimal places. Defaults to 0. */
  precision?: number;
  accent?: string;
}

/**
 * Tween a number toward its new value; render "—" while it is unknown.
 *
 * Two things this has to get right, both learned the hard way against a 4 Hz
 * feed:
 *
 *   · The FIRST reading is written directly, not tweened up from zero. A
 *     counter that animates 0 → 50.01 on mount spends most of that time
 *     displaying a grid frequency the site has never run at, and at 4 Hz the
 *     next reading restarts the climb before it ever arrives.
 *   · Subsequent tweens are short and overwrite each other, so the display
 *     tracks the feed instead of trailing a queue of stale animations.
 */
const TWEEN_SECONDS = 0.35;

function Counter({ value, precision = 0 }: { value: number | null; precision?: number }) {
  const { css } = useScenePalette();
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef<number | null>(null);

  const format = (v: number) =>
    v.toLocaleString(undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });

  useEffect(() => {
    if (value == null || !ref.current) return;

    // First real reading: show it, do not animate to it.
    if (current.current == null) {
      current.current = value;
      ref.current.textContent = format(value);
      return;
    }

    const target = { v: current.current };
    const tween = gsap.to(target, {
      v: value,
      duration: TWEEN_SECONDS,
      ease: "power2.out",
      overwrite: true,
      onUpdate: () => {
        current.current = target.v;
        if (ref.current) ref.current.textContent = format(target.v);
      },
    });
    return () => {
      tween.kill();
    };
    // `format` closes over precision, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, precision]);

  if (value == null) return <span style={{ color: css.inkDim }}>—</span>;
  return <span ref={ref} />;
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  const { css, teal } = useScenePalette();
  const fallback = hex(teal);
  return (
    <div
      className="font-sans"
      style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        pointerEvents: "none",
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 13px 7px 10px",
            borderRadius: 8,
            background: css.panelBg,
            border: `1px solid ${css.panelBorder}`,
            backdropFilter: "blur(6px)",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: item.accent ?? fallback,
              boxShadow: `0 0 8px ${item.accent ?? fallback}`,
              flexShrink: 0,
            }}
          />
          <div style={{ lineHeight: 1.15 }}>
            <div
              style={{
                fontSize: 8.5,
                fontWeight: 600,
                letterSpacing: "1.1px",
                textTransform: "uppercase",
                color: css.inkDim,
                whiteSpace: "nowrap",
              }}
            >
              {item.label}
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: css.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <Counter value={item.value} precision={item.precision} />
              {item.unit && (
                <span style={{ fontSize: 9.5, fontWeight: 600, color: css.inkDim, marginLeft: 3 }}>
                  {item.unit}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Small badge naming the feed behind the scene — mock vs. live plant. */
export function SourceBadge({ kind, stale }: { kind: string; stale: boolean }) {
  const { css, ...pal } = useScenePalette();
  /* The same Live / Delayed / Offline / No data the station bar shows, so the
     twin cannot call a plant live that the header calls offline. */
  const fresh = useSiteFreshness();
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const id = window.setInterval(() => setPulse((p) => !p), 1000);
    return () => window.clearInterval(id);
  }, []);

  /* "gateway", not "ugx". The source kind was renamed with the backend, and
     a stale comparison here would have shown a live plant as SIMULATED —
     silently, because both branches render a perfectly plausible badge. */
  const live = kind === "gateway";
  const f = fresh.label;
  const tone = !live ? hex(pal.steel)
    : f === "Live" && !stale ? hex(pal.teal)
    : f === "Delayed" || (f === "Live" && stale) ? hex(pal.amber)
    : f === "No data" ? hex(pal.steel) : "#A8505E";
  const text = !live ? "SIMULATED"
    : f === "Live" && !stale ? "LIVE · GATEWAY"
    : f === "Live" ? "STALE"
    : f.toUpperCase();

  return (
    <div
      className="font-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        borderRadius: 6,
        background: css.panelBg,
        border: `1px solid ${tone}55`,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "1.2px",
        color: tone,
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tone,
          opacity: pulse ? 1 : 0.35,
          transition: "opacity 500ms ease",
        }}
      />
      {text}
    </div>
  );
}

export default KpiStrip;
