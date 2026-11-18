"use client";

/**
 * Surfaces — the floating-card family (Layer 2 of the depth system).
 *
 * Three variants, and the choice between them is deliberate rather than
 * decorative. §7.4: glass is used selectively — dock, sheets, modals, selected
 * cards, overlay controls. Ordinary content cards are opaque elevated
 * surfaces. Glass everywhere destroys hierarchy and costs measurable frame
 * time on the Android floor device.
 */

import { clsx } from "clsx";
import type { ReactNode, HTMLAttributes } from "react";

type Tone = "plain" | "glass" | "lit";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  pressable?: boolean;
  children: ReactNode;
}

function toneClass(tone: Tone) {
  return tone === "glass" ? "is-glass" : tone === "lit" ? "is-lit" : undefined;
}

/** The default content surface: opaque, elevated, generous padding. */
export function FloatingCard({ tone = "plain", pressable, className, children, ...rest }: CardProps) {
  return (
    <div
      className={clsx("m-card", toneClass(tone), pressable && "m-pressable", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Translucent + backdrop blur. Reserve for floating and overlay UI. */
export function GlassCard({ pressable, className, children, ...rest }: Omit<CardProps, "tone">) {
  return (
    <div className={clsx("m-card is-glass", pressable && "m-pressable", className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * SectionHeader — an eyebrow, an optional action, and nothing else.
 *
 * The eyebrow names the field quietly so the values beneath it can be the loud
 * part of the screen. This is the hierarchy rule from §7.3 expressed as a
 * component so screens cannot restate it differently.
 */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="m-section-head">
      <span className="m-eyebrow">{title}</span>
      {action}
    </div>
  );
}
