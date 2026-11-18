"use client";

import { useRevenueMaster } from "@/hooks/useRevenueMaster";
import { SITE_OVERLAY_FOR } from "@/lib/api/overlay/stations";

/**
 * ₹ per kWh discharged: Settings → Revenue (cost replaced − cost of charging)
 * when saved, else the site's diesel rate. One rule for every revenue figure
 * on the Power Station screens, so Home and Single Station Data agree.
 */
export function useRevenueRate(stationId: string) {
  const { data: master } = useRevenueMaster();
  const dieselRate = SITE_OVERLAY_FOR(stationId).dieselRateRs;
  const rate = master ? master.dischargeCostRs - master.chargeCostRs : dieselRate ?? null;
  const priceOf = (kwh: number | null | undefined) =>
    kwh == null || rate == null ? null : Math.round(kwh * rate);
  return { rate, master, priceOf };
}
