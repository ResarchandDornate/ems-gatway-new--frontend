"use client";

/**
 * The public entry point.
 *
 * WebGL is loaded on demand and never on the server. Two separate reasons, and
 * both matter:
 *
 *   · `ssr: false` — R3F reconciles against a real GL context. Rendering it on
 *     the server does not degrade, it throws.
 *   · code splitting — three, drei and the whole scene are a large chunk, and
 *     someone who never opens this page should not pay for it. The dashboard's
 *     globe is loaded the same way, for the same reason.
 *
 * Import from here (`@/components/energy3d`), not from EnergyTwin directly, or
 * the chunk ends up in the importing route's bundle.
 */

import dynamic from "next/dynamic";

import type { EnergyTwinProps } from "./EnergyTwin";

function SceneSkeleton() {
  return (
    <div
      className="font-mono"
      style={{
        width: "100%",
        height: "100%",
        /* Lower than the scene's own 320 default: this is the placeholder that
           holds the box while the chunk loads, and it takes no props, so a floor
           it cannot be told about would overflow the one caller that packs the
           stage into a short row — a clipped card for the first second. */
        minHeight: 120,
        display: "grid",
        placeItems: "center",
        fontSize: 10,
        letterSpacing: "2px",
        textTransform: "uppercase",
        color: "var(--muted)",
      }}
    >
      Initialising digital twin…
    </div>
  );
}

export const EnergyTwin = dynamic<EnergyTwinProps>(
  () => import("./EnergyTwin").then((m) => m.EnergyTwin),
  { ssr: false, loading: SceneSkeleton },
);

export type { EnergyTwinProps } from "./EnergyTwin";
export { PowerFlow, type PowerFlowProps } from "./PowerFlow";
export default EnergyTwin;
export { SITE_CASES, DEFAULT_SITE_ASSETS, type SiteAsset, type SiteCase } from "@/lib/energy/topology";
