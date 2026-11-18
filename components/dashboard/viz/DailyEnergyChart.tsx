"use client";

import { useEnergyBuckets } from "@/hooks/usePowerStation";
import { PeriodNav, useSwipe } from "@/components/charts/PeriodNav";
import { useCardPeriod } from "@/components/charts/SharedPeriod";
import { BucketBars } from "@/components/charts/BucketChart";
import { chartTokens } from "@/lib/charts/tokens";
import { ChartCardHead, Reading } from "./ChartCardHead";
import { ReadingsRow, useBoxHeight } from "./PeriodCurves";
import { HoverStamp, bucketLabelAt, bucketWindow, useHoverSync } from "@/components/charts/HoverSync";

/**
 * Charge vs discharge, Day / Week / Month / Year — the same navigation as
 * Power Station Home and the history screens (PeriodNav), opening on Week.
 *
 * One pair of bars per hour of a Day, day of a Week / Month, month of a Year:
 * each the rise of the PCS DC energy counters (p0205 / p0206) across it
 * (fetchEnergyBuckets), over the cabinets picked. A bucket the counters cannot
 * answer is left empty, never drawn as zero.
 *
 * The round trip is discharge over charge for the period, shown only when it
 * is a ratio of energy that went in and came out within it (≤ 100 %).
 */

function kwh(v: number): string {
  return v >= 1000
    ? `${(v / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} MWh`
    : `${Math.round(v).toLocaleString("en-IN")} kWh`;
}

export function DailyEnergyChart({ stationId }: { stationId: string }) {
  const { nav, shared } = useCardPeriod("week");
  const [boxRef, boxH] = useBoxHeight();
  const swipe = useSwipe(nav);
  const { period } = nav;
  const { data, isLoading, isFetching, isFetchedAfterMount } = useEnergyBuckets(stationId, period);
  /* Nothing from an earlier period may sit under this period's label. */
  const loading = isLoading || (isFetching && !isFetchedAfterMount);
  const rows = loading ? [] : data ?? [];

  /* While any chart on the page is hovered, the bar holding that moment
     stands in for the period (HoverSync). */
  const { hover } = useHoverSync();
  const hoveredLabel = hover ? bucketLabelAt(period, rows.map((r) => r.label), hover.from) : null;
  const shown = hover ? rows.filter((r) => r.label === hoveredLabel) : rows;
  const hoveredWindow = hoveredLabel != null ? bucketWindow(period, hoveredLabel) : null;

  const sum = (k: "charge" | "discharge") => {
    const vals = shown.map((r) => r[k]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const charge = sum("charge"), discharge = sum("discharge");
  const trip = charge != null && discharge != null && charge > 0 ? (discharge / charge) * 100 : null;

  return (
    <div className="surface-card chart-card" style={{ padding: "var(--pad-sm) var(--pad)", position: "relative" }}>
      <ChartCardHead title="Charge & Discharge" />
      {!shared && <PeriodNav state={nav} />}
      <ReadingsRow>
        <HoverStamp hover={hover && hoveredWindow ? { ...hoveredWindow, source: "" } : hover} />
        <Reading swatch={chartTokens.primary}   label="Charge"    value={charge == null ? "—" : kwh(charge)} />
        <Reading swatch={chartTokens.secondary} label="Discharge" value={discharge == null ? "—" : kwh(discharge)} />
        {trip != null && trip <= 100 && <Reading swatch="var(--green)" label="Round-Trip Efficiency" value={`${trip.toFixed(1)}%`} />}
      </ReadingsRow>
      {/* The plot takes whatever height the card has left (.chart-body), as the
          SOC and Power cards do — a fixed height ran past the card's bottom in
          the dashboard's fit layout. */}
      <div ref={boxRef} className="chart-body" {...swipe} style={{ ...swipe.style, position: "relative" }}>
        {loading && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 1, display: "grid", placeItems: "center", pointerEvents: "none",
            fontSize: 12, fontWeight: 600, color: "var(--muted)",
          }}>
            Loading…
          </div>
        )}
        {boxH > 0 && (
          <div style={{ position: "absolute", inset: 0 }}>
            <BucketBars rows={rows} unit="kWh" period={period} height={boxH} legend={false}
              series={[
                { key: "charge", name: "Charge", color: chartTokens.primary },
                { key: "discharge", name: "Discharge", color: chartTokens.secondary },
              ]} />
          </div>
        )}
      </div>
    </div>
  );
}
