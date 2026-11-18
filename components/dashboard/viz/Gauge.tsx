"use client";

import { chartTokens } from "@/lib/charts/tokens";

/**
 * Radial gauge for a bounded 0–100 reading (SOC, SOH).
 *
 * Bounded percentages are the one case where a dial genuinely beats a number:
 * the arc encodes "how full" against a fixed maximum without the reader having
 * to know what the maximum is. Unbounded readings (kW, kWh, volts) stay as
 * figures — a dial for those would need an invented ceiling.
 *
 * `value` of null renders the track and an em dash. It never guesses a
 * position, because a needle resting at zero reads as a measurement of zero
 * rather than as an absent reading.
 */
export function Gauge({
  value, label, unit = "%", size = 128, stroke = 12, accent = chartTokens.primary,
}: {
  value: number | null;
  label: string;
  unit?: string;
  size?: number;
  stroke?: number;
  accent?: string;
}) {
  const r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  // A 270° dial: the 90° gap sits at the bottom, so the two ends of the scale
  // are visually distinct and the reader can tell empty from full at a glance.
  const sweep = 0.75;
  const arc = c * sweep;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ display: "block", transform: "rotate(135deg)" }}>
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="rgb(var(--color-surface3))" strokeWidth={stroke}
            strokeDasharray={`${arc} ${c}`} strokeLinecap="round"
          />
          {value != null && (
            <circle
              cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={accent} strokeWidth={stroke}
              strokeDasharray={`${arc * pct} ${c}`} strokeLinecap="round"
              style={{ transition: "stroke-dasharray 0.6s ease" }}
            />
          )}
        </svg>
        <div
          style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          }}
        >
          <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
            {value == null ? "—" : value.toFixed(1)}
            {value != null && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, marginLeft: 1 }}>{unit}</span>}
          </div>
        </div>
      </div>
      <div className="card-eyebrow">{label}</div>
    </div>
  );
}
