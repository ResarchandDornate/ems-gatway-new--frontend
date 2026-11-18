"use client";

/**
 * The feature-surface family: the saturated blue card that carries a screen's
 * headline reading, plus the pieces that live on it.
 */

import type { ReactNode, ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";

/** The deep-blue gradient card. At most one per screen. */
export function FeatureCard({ className, children, ...rest }: {
  className?: string; children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("m-feature", className)} {...rest}>{children}</div>;
}

/** A small pill qualifying the headline value — a delta, a rate, a window. */
export function Chip({ tone, icon, children, className }: {
  tone?: "good" | "warn" | "bad";
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={clsx("m-chip", tone && `is-${tone}`, className)}>
      {icon}
      {children}
    </span>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="m-chip-row">{children}</div>;
}

/** Icon over label, on a translucent tile. Rendered in equal-width rows. */
export function ActionPill({
  icon, label, ...rest
}: { icon: ReactNode; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="m-action" {...rest}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function ActionRow({ children }: { children: ReactNode }) {
  return <div className="m-actions">{children}</div>;
}

/** Circular initials, for a device or station row. */
export function Monogram({ text, className }: { text: string; className?: string }) {
  // Two characters maximum — three stops being readable at 38 px.
  const initials = text
    .split(/[\s·\-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return <span className={clsx("m-mono", className)} aria-hidden>{initials || "—"}</span>;
}

/** A card with a folder tab across its top carrying the row's kind. */
export function TabCard({
  kind, meta, children, className,
}: { kind: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("m-card m-tabcard", className)}>
      <div className="m-tabcard-head">
        <span>{kind}</span>
        {meta && <span className="m-tabcard-meta">{meta}</span>}
      </div>
      <div className="m-tabcard-body">{children}</div>
    </div>
  );
}
