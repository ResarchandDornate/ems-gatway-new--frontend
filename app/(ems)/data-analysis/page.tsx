"use client";

/**
 * Data Analysis — the derived views.
 *
 * The page was parked behind a Coming Soon panel while the single-tag point
 * history it used to hold was rebuilt. That tag browser is still parked and
 * still intact (components/modules/data-analysis/DataAnalysis.tsx); what has
 * changed is what this page is FOR.
 *
 * A tag browser is a way of looking at one number at a time, which every other
 * page in this app already offers in some form. This page answers questions
 * instead — what the demand charge will be, whether the pack is losing
 * efficiency — which is derived analysis rather than telemetry display, and is
 * the distinction the page now exists on.
 *
 * The two views are deliberately separate rather than stacked. They read
 * different stores at different cadences (demand refreshes every five minutes,
 * efficiency once an hour), and one is about the connection while the other is
 * about a cabinet — a single scrolling page would imply they share a subject.
 */

import { useState } from "react";
import { useStation } from "@/lib/context/StationContext";
import { useMaxDemand } from "@/hooks/useMaxDemand";
import { useRoundTrip } from "@/hooks/useRoundTrip";
import { useEnergyFlows } from "@/hooks/useEnergyFlows";
import { useFleet } from "@/hooks/useFleet";
import { MaximumDemand } from "@/components/modules/data-analysis/MaximumDemand";
import { RoundTripTrend } from "@/components/modules/data-analysis/RoundTripTrend";
import { EnergyFlows } from "@/components/modules/data-analysis/EnergyFlows";
import { FleetBenchmark } from "@/components/modules/data-analysis/FleetBenchmark";
import { EmptyState } from "@/components/shared/EmptyState";
import { useCabinetCounters, useEmsLimits } from "@/hooks/useAnalysisCentral";
import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { CabinetCountersCard, EmsLimitsCard } from "@/components/modules/data-analysis/LiveCounters";
import { PageHeader } from "@/components/PageHeader";

type View = "demand" | "efficiency" | "flows" | "fleet";

const VIEWS: { id: View; label: string }[] = [
  {
    id: "demand",
    label: "Maximum Demand",
  },
  {
    id: "efficiency",
    label: "Round-Trip Efficiency",
  },
  {
    id: "flows",
    label: "Self-Consumption & Export",
  },
  {
    id: "fleet",
    label: "Fleet",
  },
];

export default function DataAnalysisPage() {
  const { station, stations } = useStation();
  const [view, setView] = useState<View>("demand");

  /* Demand is a property of the site's single grid connection, so it needs
     every source behind the gateway to sum the battery's contribution.
     Efficiency is a property of one pack and is deliberately NOT averaged
     across cabinets — averaging would hide the one that is degrading, which
     is the whole thing it is looking for. */
  const stationId = station?.id ?? stations[0]?.id ?? "";
  /* BESS 1 / BESS 2 pick the cabinet; Total keeps the station's default. */
  const { isTotal, selected, all } = useSelectedCabinets();
  const picked = isTotal ? null : selected.map((c) => c.sourceId);
  const sourceId = picked?.length === 1 && stations.some((s) => s.id === picked[0]) ? picked[0] : stationId;
  const inPick = <T extends { sourceId: string }>(rows: T[] | undefined) =>
    picked ? rows?.filter((r) => picked.includes(r.sourceId)) : rows;
  /* Demand and energy flows read the grid meter and the cabinets by their
     source ids (external_ems_N). The station is the site's gateway now, so its
     id names neither: the meter is read off the picked cabinet, else the
     first, and the battery side is summed over every cabinet. */
  const cabinetSources = all.map((c) => c.sourceId);
  const meterSource = picked?.length === 1 ? picked[0] : cabinetSources[0] ?? "";

  const demand = useMaxDemand(meterSource, cabinetSources);
  /* Efficiency is per pack, read by source id (external_ems_N) — the station
     id is the site's gateway now, which names no pack. On Total, the first
     cabinet, and the view says which. */
  const packSource = picked?.length === 1 ? picked[0] : all[0]?.sourceId ?? "";
  const packLabel = (picked?.length === 1 ? selected[0]?.label : all[0]?.label) ?? "";
  const efficiency = useRoundTrip(view === "efficiency" ? packSource : "");
  /* Site-wide like demand: one grid connection, one meter, one load — but the
     battery summed across cabinets, which is why it takes the full list. */
  const flows = useEnergyFlows(view === "flows" ? meterSource : "", cabinetSources);
  /* The only view with no single subject: it takes the whole source list and
     compares its members, so the station picker above it selects nothing. */
  const fleet = useFleet(all.map((c) => c.sourceId), view === "fleet");

  /* What the central backend answers without history: the cabinets' own
     month / year / lifetime counters, and the EMS's live limiter settings.
     Shown under a view only while that view has no history of its own, so
     the day the history lands they step aside rather than duplicate it. */
  const counters = useCabinetCounters(view === "efficiency" || view === "fleet");
  const limits = useEmsLimits(view === "demand" || view === "flows");

  /* The limiter settings, from the live central read rather than the history
     services' own (they ask the retired gateway seam, which answers nothing). */
  const meterLimits = limits.data?.find((r) => r.sourceId === meterSource);
  const withLimits = (d: typeof demand.data) =>
    d && meterLimits ? { ...d, emsLimiter: { enabled: meterLimits.demandEnabled, demandKw: meterLimits.demandKw, limitPct: meterLimits.demandLimitPct } } : d;
  const withExportLimit = (d: typeof flows.data) =>
    d && meterLimits ? { ...d, antiReverseFlow: { enabled: meterLimits.antiReverseEnabled, upperKw: meterLimits.antiReverseUpperKw } } : d;

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <div className="page-fill" style={{ overflowY: "auto", paddingRight: 4, display: "flex", flexDirection: "column", gap: 12 }}>
      <PageHeader title={current.label} />

      <div className="nav-track" style={{ alignSelf: "flex-start" }}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`nav-pill ${view === v.id ? "on" : ""}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {!sourceId ? (
        <div className="surface-card flex-1 grid place-items-center">
          <EmptyState title="No Site Selected" description="Choose a station above." />
        </div>
      ) : view === "demand" ? (
        <>
          <MaximumDemand data={withLimits(demand.data)} loading={demand.isLoading} />
          {!demand.isLoading && !demand.data?.window && <EmsLimitsCard rows={inPick(limits.data)} kind="demand" />}
        </>
      ) : view === "efficiency" ? (
        <>
          <RoundTripTrend data={efficiency.data} loading={efficiency.isLoading} />
          {!efficiency.isLoading && !efficiency.data?.window && <CabinetCountersCard rows={inPick(counters.data)} loading={counters.isLoading} />}
        </>
      ) : view === "flows" ? (
        <>
          <EnergyFlows data={withExportLimit(flows.data)} loading={flows.isLoading} />
          {!flows.isLoading && !flows.data?.window && <EmsLimitsCard rows={inPick(limits.data)} kind="export" />}
        </>
      ) : (
        <>
          <FleetBenchmark data={fleet.data} loading={fleet.isLoading} />
          {!fleet.isLoading && !fleet.data?.window && <CabinetCountersCard rows={counters.data} loading={counters.isLoading} />}
        </>
      )}
    </div>
  );
}
