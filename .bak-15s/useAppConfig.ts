"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActiveGateway, subscribeActiveGateway } from "@/lib/central/activeGateway";
import { appConfigInit } from "@/lib/central/appConfig";

/**
 * Server-provided runtime config.
 *
 * Fetched once and held for the session — it cannot change without a server
 * restart, which ends the session anyway. `gatewayId` is "" until the request
 * lands, so callers must treat the empty string as "not known yet" rather than
 * as "not configured", or the screen flashes its unconfigured state on every
 * load. `isLoading` distinguishes the two.
 *
 * A configured gateway is held for the session. An EMPTY one is not: it is
 * re-asked every 30 s and on focus. Held forever, an empty answer outlived the
 * deploy that fixed it — on 28 Sep a tab opened before the gateway id shipped
 * kept rendering the Group Screen as "0 stations" until a hard refresh.
 */
export function useAppConfig() {
  const q = useQuery<{ gatewayId: string; gatewayMode?: boolean }, Error>({
    /* Never persisted: the gateway id differs per account (the demo has its
       own), and a stored one outlived sign-out into the next account. */
    queryKey: ["appConfig"],
    meta: { persist: false },
    queryFn: async () => {
      const r = await fetch("/api/app-config", appConfigInit());
      if (!r.ok) throw new Error(`Config unavailable (${r.status})`);
      return r.json();
    },
    staleTime: (q) => (q.state.data?.gatewayId ? Infinity : 0),
    refetchInterval: (q) => (q.state.data?.gatewayId ? false : 30_000),
    refetchOnWindowFocus: true,
    gcTime: Infinity,
    retry: 1,
  });
  /* The gateway picked in the site picker wins over the configured one, so
     every screen follows the picker. configuredGatewayId is what the station
     list is built from. */
  const active = useSyncExternalStore(subscribeActiveGateway, getActiveGateway, () => "");
  const configured = q.data?.gatewayId ?? "";
  return {
    gatewayId: configured ? (active || configured) : "", configuredGatewayId: configured,
    /* True on the site-scoped backend (ems-gateway-api), whose S1 has no average temperature. */
    gatewayMode: q.data?.gatewayMode === true,
    isLoading: q.isLoading,
  };
}
