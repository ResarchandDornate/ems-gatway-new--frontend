"use client";

/**
 * The floating readout tethered to a piece of equipment.
 *
 * These are DOM, not sprites or SDF text. Three reasons, in order of weight:
 * numbers stay crisp at any zoom without a texture atlas; they are selectable
 * and screen-readable, which a canvas glyph is not; and they inherit the app's
 * type and spacing tokens for free, so the panels match the rest of the EMS
 * rather than approximating it.
 *
 * `occlude` is deliberately off. drei can hide a panel behind geometry, and on
 * this scene that reads as a bug — the label vanishes when a pylon drifts in
 * front of it. These are annotations over the model, not objects inside it.
 */

import { Html } from "@react-three/drei";
import { hex } from "../theme";
import { useScenePalette } from "../useScenePalette";

export interface CalloutRow {
  label: string;
  value: string;
  /** Dims the row when the underlying reading is missing. */
  muted?: boolean;
}

export interface AssetCalloutProps {
  position: [number, number, number];
  title: string;
  /** The headline figure, e.g. "8.2 kW". */
  primary: string;
  /** Short status word shown under the headline. */
  status: string;
  accent: number;
  rows?: CalloutRow[];
  /** Greys the whole panel — the asset has no data at all. */
  offline?: boolean;
  /**
   * Panel size relative to full scale, 0–1.
   *
   * These are DOM, so they do not shrink with the model the way geometry does.
   * Embedded in the dashboard stage the model got small while the panels
   * stayed put and buried it. Scaling them with the canvas keeps the ratio the
   * full-screen view established.
   */
  uiScale?: number;
  /**
   * Narrow stage (a phone): the reading goes on its own line under the
   * headline and the extra line is dropped, so the chip stays inside the
   * canvas instead of running off its edges.
   */
  compact?: boolean;
}

/**
 * Which way the chip extends from its anchor. The anchor is a corner of the
 * asset's slab, so extending outward keeps the chip off the equipment.
 */
export type CalloutAlign = "left" | "right" | "above";

const PLACE: Record<CalloutAlign, { transform: string; origin: string }> = {
  left:  { transform: "translate(calc(-100% - 10px), -50%)", origin: "right center" },
  right: { transform: "translate(10px, -50%)",               origin: "left center" },
  above: { transform: "translate(-50%, calc(-100% - 10px))", origin: "center bottom" },
};

export function AssetCallout({
  position,
  title,
  primary,
  status,
  accent,
  rows = [],
  offline = false,
  uiScale = 1,
  compact = false,
  align = "right",
}: AssetCalloutProps & { align?: CalloutAlign }) {
  const { css } = useScenePalette();
  const tint = offline ? css.inkDim : hex(accent);
  /* Compact: a side chip extends INWARD — outward runs off a phone's canvas.
     It sits over the equipment's edge instead, which a phone can afford. */
  const side = compact && align !== "above" ? (align === "left" ? "right" : "left") : align;
  const place = PLACE[side];
  /* One reading beside the headline; any others with a value go on one small
     second line — still a label, not a panel. They were computed and dropped. */
  const extra = rows[0];
  const more = rows.slice(1).filter((r) => !r.muted);

  return (
    <Html
      position={position}
      zIndexRange={[20, 0]}
      style={{ pointerEvents: "none", userSelect: "none" }}
    >
      <div
        className="font-sans"
        style={{
          transform: `${place.transform} scale(${uiScale})`,
          transformOrigin: place.origin,
          whiteSpace: "nowrap",
          padding: "5px 9px 6px",
          borderRadius: 8,
          background: css.panelBg,
          border: `1px solid ${css.panelBorder}`,
          boxShadow: css.panelShadow,
          opacity: offline ? 0.7 : 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: css.inkDim }}>
          <span
            style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: tint, boxShadow: offline ? "none" : `0 0 6px ${tint}`,
            }}
          />
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: css.ink, fontVariantNumeric: "tabular-nums" }}>
            {primary}
          </span>
          <span style={{ fontSize: 10, fontWeight: 600, color: tint }}>{status.replace(/\b\w/g, (c) => c.toUpperCase())}</span>
          {extra && !compact && (
            <span style={{ fontSize: 10, color: extra.muted ? css.inkDim : css.ink, fontVariantNumeric: "tabular-nums" }}>
              · {extra.label} {extra.value}
            </span>
          )}
        </div>
        {extra && compact && (
          <div style={{ fontSize: 9.5, color: extra.muted ? css.inkDim : css.ink, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
            {extra.label} {extra.value}
          </div>
        )}
        {more.length > 0 && !compact && (
          <div style={{ fontSize: 9.5, color: css.inkDim, marginTop: 1, fontVariantNumeric: "tabular-nums" }}>
            {more.map((r) => `${r.label} ${r.value}`).join(" · ")}
          </div>
        )}
      </div>
    </Html>
  );
}

export default AssetCallout;
