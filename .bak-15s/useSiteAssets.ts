"use client";

import { useQuery } from "@tanstack/react-query";
import { detectSiteAssets } from "@/lib/energy/detectAssets";
import type { SiteAsset } from "@/lib/energy/topology";
import type { Station } from "@/lib/api/types";

/** Drawn while detection runs or if it fails: the common UnityESS C&I site. */
const FALLBACK: SiteAsset[] = ["load", "bess", "grid"];

export interface SiteAssets {
  assets: SiteAsset[];
  /** Where the list came from. */
  source: "config" | "detected" | "fallback";
  /** Per asset, what proved it — only for detected lists. */
  evidence?: Partial<Record<SiteAsset, string>>;
}

/**
 * Which assets a site has, for the energy twin.
 *
 * The site overlay's `assets`, when set, wins — it is the override for a site
 * where detection gets it wrong. Otherwise the gateway's streams decide
 * (lib/energy/detectAssets). What a site has changes when equipment is
 * commissioned, not minute to minute, so the answer is held for an hour.
 */
export function useSiteAssets(station: Station | null | undefined): SiteAssets {
  const gatewayId = station?.gatewayId ?? "";
  const configured = station?.assets;

  const q = useQuery({
    queryKey: ["siteAssets", gatewayId],
    queryFn: () => detectSiteAssets(gatewayId),
    enabled: !!gatewayId && !configured,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  if (configured?.length) return { assets: configured, source: "config" };
  if (q.data?.assets.length) return { assets: q.data.assets, source: "detected", evidence: q.data.evidence };
  return { assets: FALLBACK, source: "fallback" };
}
