"use client";

/**
 * Readout — the headline number, with its decimals set smaller and dimmed.
 *
 * Splitting the fraction is not decoration: at 44 px a four-figure reading
 * plus two decimals is too wide for a 375 px screen, and the decimals are the
 * least useful part at a glance. Dimming them keeps the magnitude instant and
 * the precision available.
 *
 * Absence still renders as an em-dash, never a zero — same contract as Value.
 */

import { clsx } from "clsx";

export function Readout({
  value, unit, precision = 1, grouping = "standard", prefix, className,
}: {
  value: number | null | undefined;
  unit?: string;
  precision?: number;
  grouping?: "indian" | "standard";
  prefix?: string;
  className?: string;
}) {
  if (value == null || Number.isNaN(value)) {
    return (
      <span className={clsx("m-readout", className)}>
        <span style={{ opacity: .5 }} aria-label="not available">—</span>
        {unit && <span className="m-unit">{unit}</span>}
      </span>
    );
  }

  const locale = grouping === "indian" ? "en-IN" : "en-US";
  const whole = Math.trunc(Math.abs(value));
  const sign = value < 0 ? "-" : "";
  const wholeText = sign + whole.toLocaleString(locale);

  const frac = precision > 0
    ? (Math.abs(value) - whole).toFixed(precision).slice(1)   // ".2"
    : "";

  return (
    <span className={clsx("m-readout", className)}>
      {prefix && <span className="m-unit" style={{ marginLeft: 0, marginRight: ".12em" }}>{prefix}</span>}
      {wholeText}
      {frac && <span className="m-frac">{frac}</span>}
      {unit && <span className="m-unit">{unit}</span>}
    </span>
  );
}
