"use client";

// Station stats, the map and the station chips derive from fetchStations()
// (central backend: health.sources[] + p0094 rated power + the site overlay).
//
// Charge / discharge and the efficiency ranking come from each cabinet's own
// lifetime DC counters (pcs p0205 / p0206, via useCabinetReadings), summed per
// site. They are LIFETIME figures, not FY ones — the backend has no history to
// scope a financial year from — so those headlines say "Lifetime", not the FY.
//
// Revenue (headline, top 5, this month) is discharge × the site's diesel rate,
// the site owner's rule; Capacity MWh/mo is this month's BMS discharge. Earlier
// months need history, and Peak–Valley needs a ToD tariff — those stay empty. Inst. Energy is a commissioning fact with no register and reads
// "—" until the overlay carries it. No fabricated data is shown anywhere.
// Field-by-field: docs/dashboard-api-mapping.md.

import { useStations } from "@/hooks/useStations";
import { SITE_GEO, INDIA_CENTRE, SITE_OVERLAY_FOR } from "@/lib/api/overlay/stations";
import { fmtINRCompact } from "@/lib/format";
import type { Station } from "@/lib/api/types";
import { Battery, Building2, Layers, Zap } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import dynamic from "next/dynamic";
import { useRef, useEffect, useState, useMemo } from "react";
import { IndiaPortfolioMap, type MapSite } from "./map/IndiaPortfolioMap";
import { useFY, fyMonths } from "@/lib/context/FinancialYearContext";
import { useCabinetReadings } from "@/hooks/useDashboardCentral";
import { sumOver } from "@/lib/api/services/dashboardCentral.service";

// ── Palette ───────────────────────────────────────────────
const STEEL = "#5B8AB4";
const TEAL   = "#6FA3A0";
const BLUE   = "#3E6E93";

const tooltipStyle = {
  background: "var(--tooltip-bg)",
  border: "1px solid var(--tooltip-line)",
  borderRadius: 8,
  fontSize: 11,
  color: "var(--tooltip-ink)",
  padding: "8px 10px",
};
const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "#6B7280", fontSize: 10 },
};

/* Coordinates moved to SITE_GEO in lib/api/overlay/stations.ts and re-keyed
   on the GATEWAY id. The table here was keyed on UGX station UUIDs, which no
   central-backend id can match, so every marker fell back to the centre of the
   country and stacked on one pin. Retire SITE_GEO when GET /sites carries
   latitude and longitude. */


// ── Helper components ─────────────────────────────────────

/** Section label inside a rail card. One component so every rail heading in
 *  this screen sits at the same size, tracking and colour. */
function RailHead({ title, fyLabel }: { title: string; fyLabel?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-3.5">
      <p className="card-eyebrow">{title}</p>
      {fyLabel && (
        <span className="text-[9px] font-mono tracking-[0.1em] text-accent/70 flex-shrink-0">{fyLabel}</span>
      )}
    </div>
  );
}

function StatTile({ icon, value, unit, label }: {
  icon: React.ReactNode; value: React.ReactNode; unit: string; label: string;
}) {
  return (
    <div className="st-tile">
      <div className="k flex items-center gap-1.5">{icon} {label}</div>
      <div className="v">
        {value}
        <small>{unit}</small>
      </div>
    </div>
  );
}

/**
 * A portfolio headline figure. These are the three largest numbers on the
 * screen after the map, so they get the size — the colour is carried by a
 * small rule above the label rather than by tinting the figure itself, which
 * kept three differently-coloured 30px numbers from fighting each other.
 */
function HeroMetric({ value, unit, label, color, fyLabel }: {
  value: string; unit: string; label: string; color: string; fyLabel?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-6 h-[3px] rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="card-eyebrow">{label}</span>
      </div>
      <div className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums">
        {value}
        <span className="text-[13px] text-muted ml-1.5 font-normal tracking-normal">{unit}</span>
      </div>
      {fyLabel && (
        <div className="text-[9px] font-mono tracking-[0.12em] text-muted2 mt-2">{fyLabel}</div>
      )}
    </div>
  );
}

/**
 * A kWh counter as a headline: GWh once it is that large, MWh below. A young
 * site's lifetime is tens of MWh, which at a fixed two-decimal GWh reads as
 * "0.02" — true, and useless. Unknown is "—", never 0.00.
 */
function energyFigure(kwh: number | null): { value: string; unit: string } {
  if (kwh == null) return { value: "—", unit: "" };
  return kwh >= 1_000_000
    ? { value: (kwh / 1_000_000).toFixed(2), unit: "GWh" }
    : { value: (kwh / 1000).toFixed(1), unit: "MWh" };
}

/** One current-month figure, where a by-month chart needs history. */
function MonthFigure({ value, note }: { value: string | null; note: string }) {
  if (value == null) return <NoChartData />;
  return (
    <div className="py-2">
      <div className="text-[20px] font-semibold text-ink tabular-nums leading-tight">{value}</div>
      <p className="text-[10px] text-muted font-mono mt-1">{note}</p>
    </div>
  );
}

/** Empty state for cards whose backend aggregate doesn't exist yet. */
function NoChartData() {
  return (
    <div className="h-[88px] grid place-items-center rounded-tile border border-dashed border-line">
      <p className="text-[11px] text-muted font-mono">No data</p>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────
export function GroupScreen() {
  /* Through the shared hook rather than a bare fetch in an effect: the station
     picker is already holding this list, and a site is now a gateway, which is
     a fact this screen should not have to know. */
  const { data: stations = [] } = useStations();
  const { selectedFY, isCurrent } = useFY();

  const { data: readings } = useCabinetReadings();

  // ── Derived metrics ─────────────────────────────────────
  /* Lifetime AC counters per site: the sum over its cabinets, or null if any
     cabinet is unknown. The overlay's `accumulations` are all 0 — a
     placeholder, not a reading — so they are no longer used. */
  const lifetime = (s: Station) => {
    const discharge = sumOver(readings, s.sourceIds, (c) => c.dcDischargeKwh);
    const monthDischarge = sumOver(readings, s.sourceIds, (c) => c.monthDischargeKwh);
    /* Revenue by the site's own rule — discharge × the diesel rate it
       displaces (lib/energy/load), as the site dashboard's Total — not a
       tariff, which an islanded site doesn't have. */
    const rate = SITE_OVERLAY_FOR(s.id).dieselRateRs;
    return {
      charge:    sumOver(readings, s.sourceIds, (c) => c.dcChargeKwh),
      discharge,
      monthDischarge,
      yearCharge:    sumOver(readings, s.sourceIds, (c) => c.yearChargeKwh),
      yearDischarge: sumOver(readings, s.sourceIds, (c) => c.yearDischargeKwh),
      revenue: discharge != null && rate != null ? discharge * rate : null,
      monthRevenue: monthDischarge != null && rate != null ? monthDischarge * rate : null,
    };
  };
  const perSite = stations.map((s) => ({ s, ...lifetime(s) }));
  /** Portfolio sum, null unless every site answered. */
  const total = (pick: (x: (typeof perSite)[number]) => number | null): number | null =>
    perSite.length === 0 || perSite.some((x) => pick(x) == null)
      ? null
      : perSite.reduce((a, x) => a + (pick(x) ?? 0), 0);

  const installedCapacityMw  = stations.reduce((s, x) => s + x.installedPower,            0) / 1000;
  /* 0 is the overlay's "not written down yet", not a rating. */
  const installedEnergyKwh   = stations.reduce((s, x) => s + x.installedCapacity,         0);
  const cabinetCount         = stations.reduce((s, x) => s + x.energyStorageCabinetNum,   0);
  const totalChargeKwh       = total((x) => x.charge);
  const totalDischargeKwh    = total((x) => x.discharge);
  const onlineCount          = stations.filter((s) => s.status === "online").length;

  /* Discharged ÷ charged, lifetime and AC-side. Includes whatever SOC the bank
     has gained or lost since commissioning, which washes out over a lifetime. */
  const efficiencyData = perSite
    .filter((x) => x.charge != null && x.charge > 0 && x.discharge != null)
    .map((x) => {
      const ac = +((x.discharge! / x.charge!) * 100).toFixed(1);
      /* Over 100 % the AC counters disagree; the BMS year-to-date (DC)
         ratio stands in, labelled, rather than a dash. */
      const dc = x.yearCharge != null && x.yearCharge > 0 && x.yearDischarge != null
        ? +((x.yearDischarge / x.yearCharge) * 100).toFixed(1) : null;
      return {
        name: (x.s.powerStationEnglishName || x.s.powerStationName).split("·")[0].trim(),
        raw: ac,
        eff: ac <= 100 ? ac : dc ?? ac,
        basis: ac <= 100 ? "AC" as const : dc != null && dc <= 100 ? "DC" as const : null,
      };
    })
    .sort((a, b) => b.eff - a.eff)
    .slice(0, 5);

  /* Lifetime revenue per site, highest first; a site without a figure stays
     listed with "—". Monthly is this month only — earlier months need history. */
  const totalRevenue = total((x) => x.revenue);
  const totalMonthRevenue = total((x) => x.monthRevenue);
  const totalMonthDischarge = total((x) => x.monthDischarge);
  const topByRevenue = [...perSite]
    .sort((a, b) => (b.revenue ?? -1) - (a.revenue ?? -1))
    .slice(0, 5);

  /**
   * Globe sites.
   *
   * Values are real — installed capacity straight off the station list, the
   * same figure the Installed Power tile totals. Coordinates are not available
   * from the API, so they come from the GEO_LOOKUP table that has always
   * backed this globe; a station missing from it falls back to the centre of
   * the country rather than vanishing, which is the pre-existing behaviour.
   */
  const globeSites: MapSite[] = stations.map(s => {
    const geo = SITE_GEO[s.id] ?? INDIA_CENTRE;
    return {
      id: s.id,
      name: (s.powerStationEnglishName || s.powerStationName).split("·")[0].trim(),
      lat: geo.lat,
      lng: geo.lng,
      value: (s.installedPower ?? 0) / 1000,   // kW → MW
    };
  });

  return (
    // The screen owns its scroll: <main> is fixed-height so the header and
    // context bar stay pinned, which means overflow has to be handled here.
    <div className="h-full overflow-y-auto overflow-x-hidden pr-1">
      <div className="dash-page">

        {/* ── Portfolio headline ── the widest, largest thing above the map ── */}
        <div className="surface-card relative overflow-hidden">
          <div className="absolute -right-32 -top-32 w-80 h-80 rounded-full bg-accent/[.06] blur-3xl pointer-events-none" />
          <div className="hero-metrics relative">
            <HeroMetric {...energyFigure(totalChargeKwh)}    label="Charging Capacity"   color={TEAL}    fyLabel="LIFETIME" />
            <HeroMetric {...energyFigure(totalDischargeKwh)} label="Discharge Capacity"  color={STEEL}   fyLabel="LIFETIME" />
            <HeroMetric value={totalRevenue != null ? fmtINRCompact(totalRevenue) : "—"} unit="" label="Cumulative Revenue" color="#4E8D6E" fyLabel="LIFETIME · DIESEL RATE" />
          </div>
        </div>

        <div className="grp-grid">

          {/* ══ LEFT RAIL ══ */}
          <div className="grp-left">
            <div className="surface-card p-[var(--pad)]">
              <RailHead title="Station Statistics" />
              <div className="grid grid-cols-2 gap-2.5">
                <StatTile icon={<Zap size={10} />}      value={installedCapacityMw.toFixed(2)} unit="MW"  label="Inst. Power"  />
                <StatTile icon={<Battery size={10} />}   value={installedEnergyKwh > 0 ? (installedEnergyKwh / 1000).toFixed(2) : "—"} unit="MWh" label="Inst. Energy" />
                <StatTile icon={<Building2 size={10} />} value={stations.length}                unit="stn" label="Stations"     />
                <StatTile icon={<Layers size={10} />}    value={cabinetCount}                   unit="cab" label="Cabinets"     />
              </div>
            </div>

            <div className="surface-card p-[var(--pad)] flex-1 min-h-0">
              <RailHead title="Station Revenue Top 5" fyLabel={selectedFY.label} />
              {topByRevenue.length === 0 ? (
                <p className="text-[10px] text-muted font-mono">Loading…</p>
              ) : (
                <div className="space-y-1">
                  {topByRevenue.map(({ s, revenue }, i) => (
                    <div key={s.id} className="flex items-center gap-2.5 py-1.5 border-b border-line last:border-0">
                      <span className={[
                        "w-5 h-5 rounded-md flex-shrink-0 grid place-items-center text-[10px] font-semibold tabular-nums",
                        i === 0 ? "bg-accent/15 text-accent" : "bg-surface3 text-ink3 border border-line",
                      ].join(" ")}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11.5px] font-medium text-ink leading-tight truncate">
                          {(s.powerStationEnglishName || s.powerStationName).split("·")[0].trim()}
                        </div>
                      </div>
                      <div className="text-[10.5px] text-ink3 font-mono tabular-nums flex-shrink-0">
                        {revenue != null ? fmtINRCompact(revenue) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="surface-card p-[var(--pad)]">
              <RailHead title="Monthly Revenue" fyLabel="THIS MONTH" />
              <MonthFigure value={totalMonthRevenue != null ? fmtINRCompact(totalMonthRevenue) : null}
                note="discharge this month × diesel rate · earlier months need history" />
            </div>
          </div>

          {/* ══ HERO ══ the map is the visual anchor of the page ══ */}
          <div className="grp-hero">
            <div className="surface-card flex-1 relative overflow-hidden flex flex-col min-h-[540px]">
              <div className="card-head">
                <h3 className="card-title">Portfolio Map</h3>
                <div className="flex items-center gap-2 text-[11px] font-mono text-ink3 font-semibold">
                  <span className="live-dot" />
                  Live · {onlineCount} of {stations.length} station{stations.length !== 1 ? "s" : ""} online
                </div>
              </div>

              {/* Locked visualisation — container only, never its props.
                  Swapped from GlobalDataGlobe to the India map on 24 Sep 2026: every
                  site here is Indian, and the globe textured itself from unpkg at
                  runtime, so it rendered as a grey sphere whenever that failed. */}
              <div className="flex-1 flex items-center justify-center min-h-0">
                <IndiaPortfolioMap sites={globeSites} metric="Installed Power" unit="MW" height={520} />
              </div>

              <div className="flex flex-wrap gap-1.5 justify-center px-[var(--pad)] pb-[var(--pad)] pt-1">
                {stations.map(s => (
                  <div key={s.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-line bg-surface3/60 text-[10px] text-ink3">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: STEEL, boxShadow: `0 0 5px ${STEEL}` }} />
                    {(s.powerStationEnglishName || s.powerStationName).split("·")[0].trim()}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ══ RIGHT RAIL ══ */}
          <div className="grp-right">
            <div className="surface-card p-[var(--pad)]">
              <RailHead title="Capacity · MWh / mo" fyLabel="THIS MONTH" />
              <MonthFigure value={totalMonthDischarge != null ? `${(totalMonthDischarge / 1000).toFixed(2)} MWh` : null}
                note="discharged this month (BMS p1064) · earlier months need history" />
            </div>

            <div className="surface-card p-[var(--pad)] flex-1">
              <RailHead title="Station Efficiency Top 5" fyLabel="LIFETIME" />
              {efficiencyData.length === 0 ? (
                <p className="text-[10px] text-muted font-mono">No charge data yet</p>
              ) : (
                <div className="space-y-3.5">
                  {/* Over 100% is not an efficiency, it is counters that disagree:
                      cabinet 1's PCS reports more AC out than AC in (and more AC
                      than DC out), which the PCS vendor has been asked about.
                      The site stays listed; the figure does not. */}
                  {efficiencyData.map((s, i) => (
                    <div key={i}>
                      <div className="flex justify-between items-baseline mb-1.5">
                        <span className="text-[11px] text-ink2 truncate max-w-[140px]">{s.name}</span>
                        <span className="text-[11px] font-mono font-semibold text-ink tabular-nums">{s.basis == null ? "—" : `${s.eff}%`}</span>
                      </div>
                      {s.basis === "DC" && (
                        <p className="text-[9.5px] text-muted font-mono mb-1.5">BMS year to date (DC) · AC counters read {s.raw}%</p>
                      )}
                      {s.basis == null && (
                        <p className="text-[9.5px] text-muted font-mono mb-1.5">counters read {s.raw}% — PCS energy counters under review</p>
                      )}
                      <div className="h-1 bg-line rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${s.basis == null ? 0 : s.eff}%`,
                          background: i === 0 ? STEEL : i === 1 ? TEAL : BLUE,
                          boxShadow: `0 0 6px ${i === 0 ? STEEL : i === 1 ? TEAL : BLUE}55`,
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="surface-card p-[var(--pad)]">
              <RailHead title="Peak – Valley ₹ / kWh" />
              <NoChartData />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
