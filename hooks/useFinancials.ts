"use client";

/**
 * Revenue by period, for the dashboard's Revenue card and the Financials page.
 *
 * Rates come from Settings → Revenue (lib/revenue/master): units discharged ×
 * (cost of the source replaced − cost of charging). Before anyone has filled
 * that in, the site's diesel rate stands in, with charging taken as free.
 *
 * Units discharged: today from the PCS DC counters; this month from the PCS
 * DC lifetime counter's rise since the 1st (or the BMS month counter, whichever
 * is more complete — lib/revenue/monthly bestMonthKwh); this year from the
 * BMS year counter; lifetime from the PCS DC lifetime counter; past months from
 * what the server recorded — or, for months before it did, what was typed
 * into Settings (whole site only).
 */

import { useMemo } from "react";
import { SITE_OVERLAY_FOR } from "@/lib/api/overlay/stations";
import { useCabinetReadings } from "@/hooks/useDashboardCentral";
import { sumOver } from "@/lib/api/services/dashboardCentral.service";
import { useBessLiveCentral as useBessLive } from "@/hooks/useBessLiveCentral";
import { useMonthlyDischarge, useRevenueMaster } from "@/hooks/useRevenueMaster";
import { bestMonthKwh, istMonth, prevIstMonth } from "@/lib/revenue/monthly";

export interface Rates {
  /** (A) ₹/kWh charged. */
  chargeRs: number;
  /** (B) ₹/kWh of the source replaced. */
  dischargeRs: number;
  /** (C) = B − A. */
  savingRs: number;
  chargeSource: string;
  replacedSource: string;
  from: "settings" | "diesel";
}

export interface FinancialRow {
  id: string;
  label: string;
  kwh: number | null;
  /** E × B — what the discharged units would have cost from the source replaced. */
  avoidedRs: number | null;
  /** E × A — what charging those units cost. */
  chargingRs: number | null;
  /** E × C. */
  revenueRs: number | null;
  /** Where the kWh came from, when it is not a live counter. */
  basis?: "recorded" | "typed";
}

const monthName = (m: string) =>
  new Date(`${m}-15T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export function useFinancials(stationId: string, sourceIds: string[], wholeSite: boolean) {
  const { data: master, isLoading: masterLoading } = useRevenueMaster();
  const { data: monthly } = useMonthlyDischarge();
  const { data: readings } = useCabinetReadings();
  const live = useBessLive(stationId);
  const diesel = SITE_OVERLAY_FOR(stationId).dieselRateRs;
  const key = sourceIds.join("|");

  return useMemo(() => {
    const rates: Rates | null = master
      ? {
          chargeRs: master.chargeCostRs, dischargeRs: master.dischargeCostRs,
          savingRs: master.dischargeCostRs - master.chargeCostRs,
          chargeSource: master.chargeSource === "solar" ? "Solar" : "Grid",
          replacedSource: master.replacedSource === "dg" ? "DG" : "Grid",
          from: "settings",
        }
      : diesel != null
        ? { chargeRs: 0, dischargeRs: diesel, savingRs: diesel, chargeSource: "—", replacedSource: "DG", from: "diesel" }
        : null;

    const row = (id: string, label: string, kwh: number | null, basis?: FinancialRow["basis"]): FinancialRow => ({
      id, label, kwh, basis,
      avoidedRs: rates && kwh != null ? kwh * rates.dischargeRs : null,
      chargingRs: rates && kwh != null ? kwh * rates.chargeRs : null,
      revenueRs: rates && kwh != null ? kwh * rates.savingRs : null,
    });

    /* A past month: recorded at its end, else typed in (whole site only). */
    const pastMonth = (m: string): { kwh: number | null; basis?: FinancialRow["basis"] } => {
      const rec = bestMonthKwh(monthly, m, sourceIds);
      if (rec != null) return { kwh: rec, basis: "recorded" };
      const typed = wholeSite ? master?.manualDischargeKwh?.[m] : undefined;
      return typed != null ? { kwh: typed, basis: "typed" } : { kwh: null };
    };

    const now = Date.now();
    const thisMonth = istMonth(now), lastMonth = prevIstMonth(now);
    /* The running month: the lifetime counter's rise since the 1st where the
       server caught the 1st, guarding against a BMS month counter that has
       stopped reporting (it sat at its 9 Oct value for days). */
    const monthKwh = bestMonthKwh(monthly, thisMonth, sourceIds, {
      nowKwh: sumOver(readings, sourceIds, (c) => c.dcDischargeKwh),
      bmsNowKwh: sumOver(readings, sourceIds, (c) => c.monthDischargeKwh),
    });
    const last = pastMonth(lastMonth);

    const periods: FinancialRow[] = [
      row("today", "Today", live.dischargedKwh ?? null),
      row("month", "This Month", monthKwh),
      row("lastMonth", "Last Month", last.kwh, last.basis),
      row("year", "This Year", sumOver(readings, sourceIds, (c) => c.yearDischargeKwh)),
      /* DC lifetime counter — the AC pair is inconsistent (dashboardCentral POINTS). */
      row("lifetime", "Lifetime", sumOver(readings, sourceIds, (c) => c.dcDischargeKwh)),
    ];

    /* Every month with a figure, newest first; the running month from the live counter. */
    const months = new Set<string>([thisMonth, ...Object.keys(monthly?.months ?? {}), ...Object.keys(monthly?.lifetime ?? {}), ...(wholeSite ? Object.keys(master?.manualDischargeKwh ?? {}) : [])]);
    const byMonth: FinancialRow[] = [...months].sort().reverse().map((m) => {
      if (m === thisMonth) return row(m, `${monthName(m)} (To Date)`, monthKwh);
      const p = pastMonth(m);
      return row(m, monthName(m), p.kwh, p.basis);
    }).filter((r) => r.kwh != null || r.id === lastMonth);

    return { rates, periods, byMonth, loading: masterLoading };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master, masterLoading, monthly, readings, live.dischargedKwh, diesel, key, wholeSite]);
}
