"use client";

/**
 * The digital-twin stage.
 *
 * Lives inside the (ems) group so it inherits the app shell and the station
 * picker.
 *
 * ── The simulated plant is gone ────────────────────────────────────────────
 *
 * This page used to fall back to a synthetic plant whenever no station was
 * selected — a compressed 24 h cycle that demonstrated every flow direction
 * within a minute. It was labelled "Simulated plant" on screen, which was
 * honest, but it was still invented data rendered in the same scene as real
 * readings.
 *
 * It is not needed now. The energy source reads the central backend through
 * the configured gateway rather than through the station picker, so there is
 * a live feed whether or not a station is selected. What the scene cannot
 * show it leaves blank: grid and load are null because the utility meter is
 * silent, and solar is null because this gateway has no PV asset at all.
 */

import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { useMemo, useState } from "react";
import { useStation } from "@/lib/context/StationContext";
import { EnergyTwin } from "@/components/energy3d";
import { SITE_CASES } from "@/lib/energy/topology";
import { PageHeader } from "@/components/PageHeader";
import { useSiteAssets } from "@/hooks/useSiteAssets";

/** Whole days since commissioning. null when the plant never reported one. */
function runDaysSince(operationTime: string | undefined): number | null {
  if (!operationTime) return null;
  const started = Date.parse(operationTime);
  if (Number.isNaN(started)) return null;
  return Math.max(0, Math.floor((Date.now() - started) / 86_400_000));
}

export default function EnergyTwinPage() {
  const { station: picked, stations } = useStation();

  /* Always the real feed. The source is keyed on the configured gateway, not
     on the picker, so a group-view selection is no longer a reason to invent
     a plant.

     In Group Screen mode the picker resolves no station, which left the name,
     rating and run days blank even though the site is known. There is exactly
     one site (the configured gateway — see stations.service), so the group
     view IS that site; fall back to it rather than to nothing. */
  const station = picked ?? (stations.length === 1 ? stations[0] : null);

  // installedCapacity is nameplate kWh, which is what turns SOC % into stored
  // kWh in the battery callout. Zero means "not configured", not "no battery".
  /* The cabinets on screen, not the site — see PerStation. */
  const { selected, all: allCabinets } = useSelectedCabinets();
  const ratedCapacityKwh = station?.installedCapacity
    ? (station.installedCapacity * selected.length) / Math.max(1, allCabinets.length)
    : null;
  const runDays = useMemo(() => runDaysSince(station?.operationTime), [station?.operationTime]);

  /* Which configuration to draw. "site" is what this site actually has, on its
     live feed. The five cases preview every configuration UnityESS commissions,
     on the simulated feed — a preview of a PV site drawn from a gateway with no
     PV would show nothing moving, which is not what a preview is for. */
  const [caseId, setCaseId] = useState<string>("site");
  const site = useSiteAssets(station);
  const assets = caseId === "site"
    ? site.assets
    : SITE_CASES.find((c) => c.id === caseId)?.assets;

  return (
    // page-fill: exactly the height under the chrome (measured by the shell),
    // with the stage taking what is left. h-full stopped resolving once the
    // shell became min-height, and squashed the stage to a strip.
    <div className="page-fill flex flex-col gap-3">
      <PageHeader title="Energy Flow · Digital Twin" />

      <div className="nav-track flex-wrap" role="tablist" aria-label="Site configuration">
        <button type="button" role="tab" aria-selected={caseId === "site"} onClick={() => setCaseId("site")} className={`nav-pill ${caseId === "site" ? "on" : ""}`}>
          This Site
        </button>
        {SITE_CASES.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={caseId === c.id} onClick={() => setCaseId(c.id)} className={`nav-pill ${caseId === c.id ? "on" : ""}`}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="surface-card relative min-h-0 flex-1 overflow-hidden rounded-xl">
        <EnergyTwin
          key={caseId === "site" ? "live" : "preview"}
          source={caseId === "site" ? "gateway" : "mock"}
          stationId={station?.id ?? ""}
          ratedCapacityKwh={ratedCapacityKwh}
          runDays={runDays}
          assets={assets}
        />
      </div>
    </div>
  );
}
