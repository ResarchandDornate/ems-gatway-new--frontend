"use client";

/**
 * StatusIndicator — a dot and a word, always both.
 *
 * §7.8: "Status never encoded by colour alone." The dot carries the colour for
 * the glance; the label carries the meaning for everyone else, including
 * screen readers and the roughly 8% of men with a colour vision deficiency who
 * would otherwise see three identical grey pills.
 */

import { clsx } from "clsx";

export type Tone = "good" | "warn" | "bad" | "idle";

export function StatusIndicator({
  tone, label, live, className,
}: { tone: Tone; label: string; live?: boolean; className?: string }) {
  return (
    <span className={clsx("m-status", `is-${tone}`, className)}>
      <span className={clsx("m-status-dot", live && tone !== "idle" && "m-pulse")} />
      {label}
    </span>
  );
}

/** Shimmer placeholder sized to the value it will be replaced by (§7.6). */
export function Shimmer({ w = "100%", h = 14, r }: { w?: string | number; h?: number; r?: number }) {
  return (
    <span
      className="m-shimmer"
      style={{ display: "block", width: w, height: h, borderRadius: r ?? 8 }}
      aria-hidden
    />
  );
}
