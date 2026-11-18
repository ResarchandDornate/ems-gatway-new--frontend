"use client";

import { useStationSummary, useEnergyBuckets } from "@/hooks/usePowerStation";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { BucketBars } from "@/components/charts/BucketChart";
import { LoadingState } from "@/components/shared/LoadingState";
import { useRevenueRate } from "../revenueRate";
import { useAlarms } from "@/hooks/useAlarms";
import { activeAlarmFilters } from "@/components/dashboard/ActiveAlarms";

// ── Theme ─────────────────────────────────────────────────────────────────────
const BG      = "var(--bg)";
const CARD    = "var(--surface2)";
const BORDER  = "var(--line)";
const CYAN    = "#5B8AB4";
const AMBER   = "#9C844A";
const MUTED   = "#5A6880";       // mid slate — legible on both paper and near-black
const INK     = "var(--ink)";
const INK2    = "var(--ink2)";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtInr(n: number) {
  return "₹" + n.toLocaleString("en-IN");
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>
        {value}
        {unit && value !== "—" && <span style={{ fontSize: 12, fontWeight: 500, color: INK2, marginLeft: 4 }}>{unit}</span>}
      </div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{ height: 240, display: "grid", placeItems: "center", fontSize: 12, color: MUTED, fontWeight: 600 }}>
      {text}
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div style={{
      textAlign: "center", fontSize: 10, fontWeight: 700, color: CYAN,
      padding: "10px 0 6px"
    }}>
      {title}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function SingleStationData({ stationId }: { stationId: string }) {

  /* One Day / Week / Month / Year period for both charts, so they always show
     the same stretch of time (PeriodNav). Week first: a day's energy reads
     best against the days around it. */
  const nav = usePeriod("week");
  const swipe = useSwipe(nav);
  const { period } = nav;

  const { data: s }   = useStationSummary(stationId);
  /* Charge / discharge from the PCS DC energy counters (p0205 / p0206), per hour
     of a Day, day of a Week / Month, month of a Year (fetchEnergyBuckets).
     Revenue is the same discharge priced at the diesel rate it displaces
     (lib/energy/load) — the rule the Today / Total revenue tiles use. */
  const { data: energy, isLoading: energyLoading } = useEnergyBuckets(stationId, period);
  /* ₹ per kWh discharged: Settings → Revenue (cost replaced − cost of
     charging) when saved, else the diesel rate — the rule Financials and the
     dashboard's Revenue card use (../revenueRate). */
  const { rate, priceOf } = useRevenueRate(stationId);
  /* Raised now (active or acknowledged) — the dashboard's count, not today's raises. */
  const { data: activeAlarms } = useAlarms(activeAlarmFilters(stationId));

  /* KPI values.
     `??` is NOT used on these: null means the meter behind them is silent, and
     substituting 0 would put a measurement on screen. Each falls through to an
     em dash, the same as revenue already did. */
  const scaled = (v: number | null | undefined, div: number, dp: number) =>
    v == null ? "—" : (v / div).toFixed(dp);

  /* Lifetime totals are the PCS DC counters (p0205/p0206, both cabinets).
     At ~19 MWh the site is far from a GWh, and "0.02 GWh" hides the figure in
     its rounding — so the unit steps down to MWh below 1 GWh. */
  const lifeUnit = (v: number | null | undefined) => (v != null && Math.abs(v) >= 1e6 ? "GWh" : "MWh");
  const lifeDiv  = (v: number | null | undefined) => (lifeUnit(v) === "GWh" ? 1e6 : 1e3);
  const totalCharge    = scaled(s?.totalChargeKwh,    lifeDiv(s?.totalChargeKwh),    2);
  const totalDischarge = scaled(s?.totalDischargeKwh, lifeDiv(s?.totalDischargeKwh), 2);
  /* kWh below 1 MWh: a partial-day estimate of tens of kWh read "0.0 MWh". */
  const todayUnit = (v: number | null | undefined) => (v != null && Math.abs(v) >= 1000 ? "MWh" : "kWh");
  const todayCharge    = scaled(s?.todayChargeKwh,    todayUnit(s?.todayChargeKwh) === "MWh" ? 1000 : 1, 1);
  const todayDischarge = scaled(s?.todayDischargeKwh, todayUnit(s?.todayDischargeKwh) === "MWh" ? 1000 : 1, 1);
  // null revenue = no billing source; render "—" rather than a figure.
  const totalRev       = priceOf(s?.totalDischargeKwh);
  const yestRev        = priceOf(s?.yesterdayDischargeKwh);
  const totalRevenue   = totalRev != null ? fmtInr(totalRev) : "—";
  const yestRevenue    = yestRev != null ? fmtInr(yestRev) : "—";
  const alarms         = activeAlarms?.total != null ? String(activeAlarms.total) : "—";
  const efficiency     = s?.stationEfficiencyPct != null ? `${s.stationEfficiencyPct.toFixed(1)}%` : "—";

  const buckets = energy ?? [];
  const cdHasData = buckets.some((b) => b.charge != null || b.discharge != null);
  const revRows = buckets.map((b) => ({
    label: b.label,
    dischargeRevenue: priceOf(b.discharge),
  }));
  const revHasData = revRows.some((r) => r.dischargeRevenue != null);

  return (
    <div style={{
      // Fills the panel it now sits inside; it used to be a top-level view and
      // sized itself against the viewport, which forced the panel over-tall.
      background: BG, color: INK, minHeight: "100%",
      padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12,
      fontFamily: "Chivo, Inter, sans-serif",
    }}>

      {/* ── Site title ─────────────────────────────────────────────────── */}
      <div style={{
        textAlign: "center", fontSize: "clamp(14px, 1.4vw, 20px)", fontWeight: 800,
        letterSpacing: "1px", color: INK, padding: "4px 0 2px",
        borderBottom: `1px solid ${BORDER}`, paddingBottom: 10,
      }}>
        {s?.stationName ?? stationId}
        <span style={{ fontSize: 11, color: MUTED, fontWeight: 400, marginLeft: 12 }}>
          {s?.stationLocation ?? ""}
        </span>
      </div>

      {/* ── Metric field (4 × 2) ─────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 12 }}>
        <Metric label="Total Charge"                    value={totalCharge}    unit={lifeUnit(s?.totalChargeKwh)} />
        <Metric label="Total Discharge"                 value={totalDischarge} unit={lifeUnit(s?.totalDischargeKwh)} />
        <Metric label="Today's Charge"              value={todayCharge}    unit={todayUnit(s?.todayChargeKwh)} />
        <Metric label="Today's Discharge"             value={todayDischarge} unit={todayUnit(s?.todayDischargeKwh)} />
        <Metric label="Total Revenue"                   value={totalRevenue} />
        <Metric label="Yesterday's Revenue"             value={yestRevenue} />
        <Metric label="Active Alarms"                   value={alarms} />
        <Metric label="Station Efficiency"              value={efficiency} />
      </div>

      {/* ── Time Series section ─────────────────────────────────────────── */}
      <SectionTitle title="Daily History" />

      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "12px 16px" }}>
        <PeriodNav state={nav} />
      </div>

      <div {...swipe} style={{ ...swipe.style, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))", gap: 14, flex: 1 }}>

        {/* Chart 1 — Charge / Discharge */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: CYAN, letterSpacing: "1px", marginBottom: 8 }}>
            Charge / Discharge
          </div>
          {energyLoading ? <LoadingState rows={3} />
            : !cdHasData ? <EmptyNote text={`No Energy Readings For ${period.label}`} />
            : (
              <BucketBars rows={buckets} unit="kWh" period={period} height={260}
                series={[{ key: "charge", name: "Charge", color: CYAN }, { key: "discharge", name: "Discharge", color: AMBER }]} />
            )}
        </div>

        {/* Chart 2 — Discharge Revenue */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: AMBER, letterSpacing: "1px", marginBottom: 8 }}>
            Discharge Revenue
          </div>
          {rate == null && (
            <div style={{ fontSize: 10.5, lineHeight: "16px", color: MUTED, marginBottom: 6 }}>
              No Rates Set
            </div>
          )}
          {energyLoading ? <LoadingState rows={3} />
            : !revHasData ? <EmptyNote text={`No Revenue For ${period.label}`} />
            : (
              <BucketBars rows={revRows} unit="₹" period={period} height={240} format={fmtInr}
                series={[{ key: "dischargeRevenue", name: "Revenue", color: AMBER }]} />
            )}
        </div>

      </div>
    </div>
  );
}
