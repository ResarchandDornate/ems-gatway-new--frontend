"use client";

import { useQuery } from "@tanstack/react-query";
import { getSolis } from "@/mobile_app_kunal_backend/gateway/client";

/**
 * The site's PV inverter, live.
 *
 * `/api/solis/status` sits outside the telemetry snapshot, which is why the
 * northbound profile declares `site.solarPower` unmapped and why every screen
 * in this app has been drawing the Solar PV node as offline over a plant with
 * a real, producing array. Nothing called this endpoint at all — `getSolis`
 * had zero call sites.
 *
 * Polled on the live cadence because it IS a live reading, and kept separate
 * from the metric layer rather than bolted into it: the resolver reads one
 * payload and this is a second endpoint, so pretending otherwise would mean
 * teaching the profile to fetch.
 */
export function useSolis(enabled = true) {
  return useQuery({
    queryKey: ["solis"],
    queryFn: () => getSolis(),
    enabled,
    refetchInterval: 30_000,
    staleTime: 25_000,
    /* A site with no PV integration answers `available: false`, which is not
       an error and must not retry into one. */
    retry: 1,
  });
}
