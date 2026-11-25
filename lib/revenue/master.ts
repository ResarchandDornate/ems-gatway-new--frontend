/**
 * Revenue master — the customer's own rates, from which revenue is worked out.
 *
 *   (A) Cost of charging    ₹/kWh, from solar or the grid
 *   (B) Cost of discharging ₹/kWh, of the source the battery replaces: grid or DG
 *   (C) Saving per unit     = B − A
 *   (E) Units discharged    kWh over the period
 *   (D) Revenue             = E × C
 *
 * One cycle is one full charge and one full discharge, so a cycle's E is the
 * battery's rated capacity.
 */

export type ChargeSource = "solar" | "grid";
export type ReplacedSource = "grid" | "dg";

export interface RevenueMaster {
  chargeSource: ChargeSource;
  /** (A) ₹ per kWh charged. */
  chargeCostRs: number;
  replacedSource: ReplacedSource;
  /** (B) ₹ per kWh discharged, the cost of the source it replaces. */
  dischargeCostRs: number;
  /** The ToD template the rates were filled from, kept so the form reopens on it. */
  state?: string;
  /**
   * Discharge typed in for months the server never recorded — those before
   * the collector kept month-end totals (lib/revenue/monthly). "YYYY-MM" → kWh,
   * for the whole site.
   */
  manualDischargeKwh?: Record<string, number>;
  /** Who saved it last, and when (epoch ms). Set by the server. */
  updatedBy?: string;
  updatedAt?: number;
}

export const CHARGE_SOURCES: { id: ChargeSource; label: string }[] = [
  { id: "solar", label: "Solar" },
  { id: "grid", label: "Grid" },
];
export const REPLACED_SOURCES: { id: ReplacedSource; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "dg", label: "DG" },
];

/** (C) ₹ saved per kWh discharged. */
export function savingPerUnit(m: Pick<RevenueMaster, "chargeCostRs" | "dischargeCostRs">): number {
  return m.dischargeCostRs - m.chargeCostRs;
}

/** (D) ₹ for `kwh` discharged. Null when the units are unknown. */
export function revenueFor(m: Pick<RevenueMaster, "chargeCostRs" | "dischargeCostRs"> | null | undefined, kwh: number | null): number | null {
  if (!m || kwh == null) return null;
  return kwh * savingPerUnit(m);
}

/** A form's values, checked: both rates finite and not negative. Null when not. */
export function parseMaster(v: unknown): RevenueMaster | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const rate = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 10_000 ? x : null);
  const a = rate(o.chargeCostRs), b = rate(o.dischargeCostRs);
  if (a == null || b == null) return null;
  if (o.chargeSource !== "solar" && o.chargeSource !== "grid") return null;
  if (o.replacedSource !== "grid" && o.replacedSource !== "dg") return null;
  const out: RevenueMaster = { chargeSource: o.chargeSource, chargeCostRs: a, replacedSource: o.replacedSource, dischargeCostRs: b };
  if (o.manualDischargeKwh != null) {
    if (typeof o.manualDischargeKwh !== "object") return null;
    const manual: Record<string, number> = {};
    for (const [month, kwh] of Object.entries(o.manualDischargeKwh as Record<string, unknown>)) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || typeof kwh !== "number" || !Number.isFinite(kwh) || kwh < 0 || kwh > 1e9) return null;
      manual[month] = kwh;
    }
    if (Object.keys(manual).length) out.manualDischargeKwh = manual;
  }
  return out;
}
