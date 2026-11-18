"use client";

/**
 * Controls — buttons, toggles, segmented control, icon button.
 *
 * All of them meet the 44 pt / 48 dp minimum target from §7.8 regardless of
 * how small the glyph inside them is, and all of them respond to touch with
 * depth rather than with a colour change (§7.6).
 */

import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  full?: boolean;
}

export function PrimaryButton({ children, full, className, ...rest }: BtnProps) {
  return (
    <button
      className={clsx("m-btn m-btn-primary", className)}
      style={full ? { width: "100%" } : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, full, className, ...rest }: BtnProps) {
  return (
    <button
      className={clsx("m-btn m-btn-secondary", className)}
      style={full ? { width: "100%" } : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, full, className, ...rest }: BtnProps) {
  return (
    <button
      className={clsx("m-btn m-btn-ghost", className)}
      style={full ? { width: "100%" } : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children, label, active, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; label: string; active?: boolean }) {
  return (
    <button
      className={clsx("m-iconbtn", active && "is-on", className)}
      aria-label={label}
      aria-pressed={active}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Toggle. `aria-checked` carries the state for TalkBack and VoiceOver — the
 * knob position alone is not an accessible affordance.
 */
export function Toggle({
  checked, onChange, label, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx("m-toggle", checked && "is-on")}
    >
      <span className="m-toggle-knob" />
    </button>
  );
}

export function Segmented<T extends string>({
  options, value, onChange, ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="m-seg" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={clsx("m-seg-item", o.value === value && "is-on")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
