"use client";

/**
 * The whole visualisation: canvas, overlay, and the source that feeds them.
 *
 * Mount this and nothing else. It takes a source name and a station and
 * produces the scene; every other file under components/energy3d/ is an
 * implementation detail of this one.
 *
 *   <EnergyTwin source="gateway" />
 *   <EnergyTwin source="gateway" stationId={id} ratedCapacityKwh={418} />
 *
 * The canvas itself lives in EnergyStage, which takes a source rather than the
 * name of one. That is the seam a shell with its own data layer mounts — the
 * packaged mobile app reads the gateway proxy — and it exists so that naming a
 * transport here does not oblige every such build to bundle the others.
 *
 * The Canvas is deliberately not SSR'd — see the dynamic() wrapper in
 * index.tsx. WebGL has no meaning on the server, and R3F will attempt to touch
 * `window` during reconciliation if given the chance.
 */

import { useMemo } from "react";
import { useEnergy } from "@/lib/energy/context";
import { deriveFlows, FLOW_EPSILON_KW } from "@/lib/energy/flows";
import { siteLoadKw } from "@/lib/energy/load";
import type { EnergySource } from "@/lib/energy/types";
import { useBessLiveCentral, type SiteLive } from "@/hooks/useBessLiveCentral";
import { useSolarToday } from "@/hooks/useSolarToday";
import { useNamedEnergySource, type NamedSourceKind } from "@/lib/energy/EnergyProvider";
import { EnergyStage } from "./EnergyStage";
import type { SiteAsset } from "@/lib/energy/topology";
import { KpiStrip, SourceBadge, type KpiItem } from "./panels/KpiStrip";
import { hex } from "./theme";
import { useScenePalette } from "./useScenePalette";

export interface EnergyTwinProps {
  source?: NamedSourceKind;
  stationId?: string;
  ratedCapacityKwh?: number | null;
  runDays?: number | null;
  className?: string;
  /**
   * Draw the KPI strip, source badge and rotate/zoom hint over the scene.
   *
   * Off when the twin is embedded somewhere that already reports these — the
   * dashboard carries run days, capacity and a live/stale badge in its own
   * header and rails, and repeating them inside the stage is just noise on top
   * of the model.
   */
  showOverlay?: boolean;
  /** Passed straight to EnergyStage — see the note there. Defaults to 320. */
  minHeight?: number;
  /** Which assets the site has; see topology.ts. Defaults to load, BESS, PV, grid. */
  assets?: SiteAsset[];
}

/** The DOM layer. Inside the provider, outside the Canvas. */
function Overlay() {
  const p = useScenePalette();
  const { snapshot, kind } = useEnergy();
  const { site, bess, grid } = snapshot;

  const items: KpiItem[] = [
    { label: "Run Days", value: site.runDays, accent: hex(p.teal) },
    /* An estimate: lifetime discharge × the site's diesel emission factor. */
    { label: "CO₂ Avoided", value: site.co2Avoided, unit: "t", precision: 1, accent: hex(p.green) },
    /* Battery discharge, not PV yield — no endpoint carries a lifetime PV total. */
    { label: "Lifetime Discharge", value: site.lifetimeYield, unit: "MWh", accent: hex(p.cyan) },
    { label: "State Of Charge", value: bess.soc, unit: "%", precision: 1, accent: hex(p.teal) },
    { label: "Grid Frequency", value: grid.frequency, unit: "Hz", precision: 2, accent: hex(p.steel) },
  ];

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <KpiStrip items={items} />
        <SourceBadge kind={kind} stale={snapshot.stale} />
      </div>

    </div>
  );
}

export function EnergyTwin({
  /* Defaults to the live feed. It defaulted to "mock" while the synthetic
     plant was the fallback for an unselected station; with the source keyed on
     the configured gateway instead, a caller that forgets this prop should get
     an honest empty scene rather than an invented one. */
  source = "gateway",
  stationId = "",
  ratedCapacityKwh = null,
  runDays = null,
  className,
  showOverlay = true,
  minHeight,
  assets,
}: EnergyTwinProps) {
  const named = useNamedEnergySource(source, { stationId, ratedCapacityKwh, runDays, assets });
  /* Same react-query keys as the gateway source, so served from cache. */
  const site = useBessLiveCentral(stationId).site;
  const pvToday = useSolarToday(stationId).data;
  const offGrid = !!assets?.includes("pv") && !assets.includes("grid");
  const resolved = useMemo(
    () => (source === "gateway" ? withSiteSolarAndLoad(named, site, pvToday?.kwh ?? null, offGrid) : named),
    [source, named, site, pvToday?.kwh, offGrid],
  );

  return (
    <EnergyStage
      source={resolved}
      kind={source}
      className={className}
      overlay={showOverlay ? <Overlay /> : null}
      minHeight={minHeight}
      assets={assets}
    />
  );
}

/**
 * Solar and load are the site's (one inverter, one load), so they stay
 * site-wide whichever cabinet the picker shows; only the battery follows it.
 * Same rules as lib/energy/sources/gateway.ts, on the site battery.
 */
function withSiteSolarAndLoad(src: EnergySource, site: SiteLive, pvKwh: number | null, offGrid: boolean): EnergySource {
  const s = src.snapshot;
  const batt = site.battKw;
  let solarKw = site.solarKw;
  let inferred: "min" | "zero" | undefined;
  if (solarKw == null && offGrid && batt != null) {
    if (batt < -FLOW_EPSILON_KW) { solarKw = -batt; inferred = "min"; }
    else if (batt > FLOW_EPSILON_KW) { solarKw = 0; inferred = "zero"; }
  }
  const loadKw = siteLoadKw(inferred === "min" ? null : solarKw, batt);
  const balance = pvKwh != null && site.chargedKwh != null && site.dischargedKwh != null
    ? pvKwh - site.chargedKwh + site.dischargedKwh : null;
  const loadToday = balance != null && site.dischargedKwh != null
    ? Math.round(Math.max(balance, site.dischargedKwh) * 10) / 10
    : site.dischargedKwh;
  const snapshot = {
    ...s,
    solar: {
      ...s.solar,
      power: solarKw,
      inferred,
      status: solarKw == null ? "offline" as const : solarKw > 0.1 ? "generating" as const : "idle" as const,
    },
    load: {
      ...s.load,
      power: loadKw,
      energy: loadToday,
      status: loadKw == null ? "offline" as const : loadKw > 0.1 ? "consuming" as const : "idle" as const,
    },
  };
  return { ...src, snapshot, flows: deriveFlows(snapshot) };
}

export default EnergyTwin;
