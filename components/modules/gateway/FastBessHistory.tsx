"use client";

/**
 * Live BESS's history: the cabinet's key fast-stream signals over a Day /
 * Week / Month / Year period (PeriodNav), under the live 1 Hz charts. The
 * live view stays what it is — the newest minutes, second by second — and
 * this is where the same signals are read back through time.
 */

import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { PeriodSeries } from "@/components/charts/PeriodSeries";
import { chartTokens } from "@/lib/charts/tokens";

const SIGNALS = [
  { group: "bms_values", key: "display_soc", label: "State Of Charge", unit: "%", color: chartTokens.primary },
  { group: "pcs_values", key: "total_active_power", label: "Active Power", unit: "kW", color: chartTokens.secondary, signed: true },
  { group: "pcs_values", key: "dc_voltage", label: "DC Voltage", unit: "V", color: chartTokens.primary },
  { group: "bms_values", key: "battery_max_temperature", label: "Max Cell Temperature", unit: "°C", color: chartTokens.secondary },
] as const;

export function FastBessHistory({ bessId }: { bessId: string }) {
  const nav = usePeriod("day");
  const swipe = useSwipe(nav);
  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad)" }}>
      <div style={{ marginBottom: 10 }}>
        <h2 className="card-title" style={{ margin: 0 }}>History</h2>
      </div>
      <PeriodNav state={nav} />
      <div {...swipe} className="grid gap-3 mt-3" style={{ ...swipe.style, gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        {SIGNALS.map((s) => (
          <div key={s.key}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink2)", marginBottom: 6 }}>{s.label}</div>
            <PeriodSeries
              tag={`fast:${bessId}:${s.group}::${s.key}`}
              label={s.label}
              unit={s.unit}
              color={s.color}
              period={nav.period}
              height={190}
              signed={"signed" in s && s.signed}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
