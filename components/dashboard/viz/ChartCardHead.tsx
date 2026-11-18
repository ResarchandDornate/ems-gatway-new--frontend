"use client";

import type { ReactNode } from "react";

/**
 * The head every dashboard chart card shares: title and a muted note on the
 * first line (controls after the note), the card's readings on the second.
 *
 * One component so the three cards in the chart row line up — same title
 * size, same note placement, same readout row, so the plots start at the
 * same height. They had drifted: throughput had its own head with keys under
 * the title and a caption below the plot, the day curves a bare title.
 */
export function ChartCardHead({
  title, note, noteTitle, controls, readings,
}: {
  title: string;
  note?: string;
  /** Hover text for the note, when it needs more words than fit. */
  noteTitle?: string;
  controls?: ReactNode;
  readings?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      {/* Wraps on a phone: title on one line, note and range buttons under it.
          A fixed height pushed the buttons off the card's right edge. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", columnGap: 10, rowGap: 6, minHeight: 29, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "var(--fs-title)", fontWeight: 600, color: "var(--ink)", margin: 0, letterSpacing: "-0.012em", whiteSpace: "nowrap" }}>
          {title}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {note && (
            <span style={{ fontSize: 11, color: "var(--muted)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={noteTitle ?? note}>
              {note}
            </span>
          )}
          {controls}
        </div>
      </div>
      {readings != null && readings !== false && (
        <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap", minHeight: 17 }}>
          {readings}
        </div>
      )}
    </div>
  );
}

/** A swatch, a label and its figure — the readout row's one element. */
export function Reading({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: swatch, flex: "0 0 8px" }} />
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

/**
 * The Y axis's unit, once, above its ticks — in place of a unit on every tick.
 * Place inside a position: relative plot box drawn with PLOT_MARGIN.
 */
export function AxisUnit({ unit }: { unit: string }) {
  return (
    <span style={{ position: "absolute", top: 0, left: 0, width: 40, textAlign: "right", paddingRight: 6, fontSize: 10, color: "var(--chart-text-muted)", pointerEvents: "none" }}>
      {unit}
    </span>
  );
}
