"use client";

/**
 * MetricCard — an eyebrow, one dominant reading, one quiet footnote.
 *
 * The hierarchy is the point: per §7.3 the label sits at 11 px and the value
 * at 30 px, so the eye lands on the number and reads the label only if it
 * needs to. Screens compose these two-up; the card never sets its own width.
 */

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { FloatingCard } from "./Surfaces";
import { Shimmer } from "./Status";

export function MetricCard({
  label, value, footnote, icon, loading, tone = "plain", className,
}: {
  label: string;
  value: ReactNode;
  footnote?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  tone?: "plain" | "lit";
  className?: string;
}) {
  return (
    <FloatingCard tone={tone} className={clsx("m-metric-card", className)}>
      <div className="m-metric-head">
        <span className="m-eyebrow">{label}</span>
        {icon && <span className="m-metric-icon">{icon}</span>}
      </div>

      {loading
        ? <Shimmer w="64%" h={26} r={9} />
        : <div className="m-metric m-ink">{value}</div>}

      {footnote && <div className="m-metric-foot m-label m-ink3">{footnote}</div>}
    </FloatingCard>
  );
}
