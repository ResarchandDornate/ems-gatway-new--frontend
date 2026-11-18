"use client";

/**
 * Dashboard — §6.
 *
 * Answers, in under three seconds and one-handed: is my system healthy, what
 * is it doing, what has it earned me?
 *
 * Every figure on this screen comes from the existing hooks against live UGX.
 * Where UGX has no key — SOC on some firmware, revenue on any station without a
 * settlement source — the value arrives as null and renders as an explicit
 * dash. Nothing here substitutes a zero for an absence (§6.3).
 */

import dynamic from "next/dynamic";
import { useMemo } from "react";
import {
  ArrowDownToLine, ArrowUpFromLine, Activity, TriangleAlert, Cpu, Thermometer,
  SlidersHorizontal, Sparkles, Bell,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { formatAge } from "@/lib/freshness";

import { useMobileStation, useLive, useSummary, useCurve, useDevices, useAlarmStats } from "../data";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, MetricCard, ListItem,
  StatusIndicator, Shimmer, Value, Rupees, type Tone,
  FeatureCard, Chip, ChipRow, ActionPill, ActionRow, Readout,
} from "../components";
import { PowerCurve } from "../viz/PowerCurve";
import { Ring } from "../viz/Ring";
import { useTheme } from "../useTheme";

/* three.js must not run on the server, and the hero is the heaviest thing on
   the screen — deferring it lets the readings paint first. */
const SocCore = dynamic(() => import("../viz/SocCore").then((m) => m.SocCore), {
  ssr: false,
  loading: () => <div className="m-shimmer" style={{ width: "100%", height: "100%", borderRadius: 20 }} />,
});

/** What the battery is doing right now, in the plainest words available. */
function dispatchState(kw: number | null): { label: string; tone: Tone } {
  if (kw == null)   return { label: "Unknown",     tone: "idle" };
  if (kw > 0.5)     return { label: "Discharging", tone: "good" };
  if (kw < -0.5)    return { label: "Charging",    tone: "good" };
  return { label: "Standby", tone: "idle" };
}

export function DashboardScreen() {
  const { stationId } = useMobileStation();
  const { theme } = useTheme();
  const router = useRouter();
  /* Quick actions stay inside the demo mount when that is where we are, so a
     tap does not silently drop the reviewer onto the live, gated app. */
  const base = usePathname().startsWith("/m/demo") ? "/m/demo" : "/m";

  const live      = useLive(stationId);
  const summary   = useSummary(stationId);
  const intraday  = useCurve(stationId);
  const devices   = useDevices(stationId);
  const alarms    = useAlarmStats();

  const state = dispatchState(live.battKw);

  const online = useMemo(
    () => devices.data.filter((d) => d.status === "online").length,
    [devices.data],
  );
  const totalDevices = devices.data.length;

  const age = live.lastTs ? formatAge(Date.now() - live.lastTs) : null;

  // Today's energy: prefer the live counters, fall back to the summary's
  // aggregate. Both are real; neither is invented.
  const chargeKwh    = live.chargedKwh    ?? summary.data?.todayChargeKwh    ?? null;
  const dischargeKwh = live.dischargedKwh ?? summary.data?.todayDischargeKwh ?? null;

  const curve = intraday.data;

  return (
    <>
      <Header />

      {/* ── Hero ─────────────────────────────────────────────────────────
          The one saturated surface on the screen. It answers the three-second
          question — what is the state, what is it doing, is it current — and
          then offers the three places you would go next. */}
      <FeatureCard>
        <div className="m-spread">
          <span className="m-eyebrow">State of charge</span>
          <StatusIndicator
            tone={live.isStale ? "warn" : state.tone}
            label={live.isStale ? "Stale" : state.label}
            live={!live.isStale && live.isLive}
          />
        </div>

        <div className="m-hero-canvas">
          <SocCore soc={live.soc} power={live.battKw} theme={theme} />
        </div>

        {live.isLoading
          ? <Shimmer w={150} h={42} r={12} />
          : <Readout value={live.soc} unit="%" precision={1} />}

        <ChipRow>
          <Chip icon={<Activity size={13} />}>
            <Value value={live.battKw} unit="kW" precision={1} animate />
          </Chip>
          <Chip>
            {summary.data?.capacityKwh
              ? `${summary.data.capacityKwh.toLocaleString("en-IN")} kWh installed`
              : "Capacity —"}
          </Chip>
          <Chip>{age ? `Updated ${age} ago` : "Awaiting telemetry"}</Chip>
        </ChipRow>

        <ActionRow>
          <ActionPill
            icon={<SlidersHorizontal size={17} strokeWidth={1.9} />}
            label="Control"
            onClick={() => router.push(`${base}/control`)}
          />
          <ActionPill
            icon={<Sparkles size={17} strokeWidth={1.9} />}
            label="Advisor"
            onClick={() => router.push(`${base}/advisor`)}
          />
          <ActionPill
            icon={<Bell size={17} strokeWidth={1.9} />}
            label="Alarms"
            onClick={() => router.push(`${base}/alarms`)}
          />
        </ActionRow>
      </FeatureCard>

      {/* Telemetry that has gone quiet is stated once, loudly, rather than
          being implied by values that quietly stop moving. */}
      {live.isStale && (
        <div className="m-banner is-warn" style={{ marginTop: 12 }}>
          <TriangleAlert size={15} style={{ flex: "none", marginTop: 1 }} />
          <span>
            This plant last reported {age} ago. Live readings are withheld rather than shown stale —
            open Historical Data on the web app to review them with a time range attached.
          </span>
        </div>
      )}

      {/* ── Today's energy ───────────────────────────────────────────────
          A ring rather than two tiles: charge and discharge are two halves of
          one number, and the proportion between them is the thing worth
          seeing. The centre carries the round-trip for the day. */}
      <div style={{ marginTop: 26 }}>
        <SectionHeader title="Today" />
        <FloatingCard>
          {live.isLoading && summary.isLoading ? (
            <Shimmer w={168} h={168} r={84} />
          ) : (
            <>
              <Ring
                size={168}
                thickness={18}
                segments={[
                  { label: "Charged",    value: chargeKwh ?? 0,    color: "var(--m-cyan)" },
                  { label: "Discharged", value: dischargeKwh ?? 0, color: "var(--m-good)" },
                ]}
                center={
                  <>
                    <Readout
                      value={chargeKwh != null && dischargeKwh != null ? chargeKwh + dischargeKwh : null}
                      unit="kWh"
                      precision={0}
                      className="m-ring-value"
                    />
                    <span className="m-ring-caption">Throughput</span>
                  </>
                }
              />
              <div className="m-ring-legend">
                <Chip icon={<ArrowDownToLine size={13} />}>
                  <Value value={chargeKwh} unit="kWh" precision={1} animate />
                </Chip>
                <Chip icon={<ArrowUpFromLine size={13} />} tone="good">
                  <Value value={dischargeKwh} unit="kWh" precision={1} animate />
                </Chip>
              </div>
            </>
          )}
        </FloatingCard>
      </div>

      {/* ── Savings ──────────────────────────────────────────────────────────
          UGX v1.0 carries no tariff keys (§3.3), so revenue is null on any
          station without a settlement source. The card states that rather than
          rendering ₹0, which would read as "earned nothing today". */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Savings · ex-GST" />
        <FloatingCard>
          <div className="m-spread" style={{ alignItems: "flex-start" }}>
            <div className="m-stack">
              <span className="m-eyebrow">Today</span>
              <span className="m-metric m-ink" style={{ marginTop: 6 }}>
                <Rupees value={summary.data?.todayRevenueInr ?? null} animate />
              </span>
            </div>
            <div className="m-stack" style={{ alignItems: "flex-end" }}>
              <span className="m-eyebrow">Lifetime</span>
              <span className="m-h2 m-ink2" style={{ marginTop: 8 }}>
                <Rupees value={summary.data?.totalRevenueInr ?? null} />
              </span>
            </div>
          </div>
          {summary.data && summary.data.todayRevenueInr == null && (
            <div className="m-label m-ink3" style={{ marginTop: 14, lineHeight: 1.45 }}>
              No tariff source is bound to this station yet, so savings cannot be computed.
              The figure stays blank rather than being estimated.
            </div>
          )}
        </FloatingCard>
      </div>

      {/* ── Power curve ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Intraday power" />
        <FloatingCard>
          {intraday.isLoading ? (
            <Shimmer w="100%" h={172} r={16} />
          ) : curve.length === 0 ? (
            <div className="m-empty">
              <span className="m-empty-mark"><Activity size={19} /></span>
              <span className="m-body m-ink3">No intraday series for this station today.</span>
            </div>
          ) : (
            <>
              <div className="m-chart"><PowerCurve data={curve} /></div>
              <div className="m-chart-legend">
                <span className="m-legend-key">
                  <span className="m-legend-swatch" style={{ background: "var(--m-cyan)" }} />Power kW
                </span>
                <span className="m-legend-key">
                  <span className="m-legend-swatch" style={{ background: "var(--m-primary)" }} />SOC %
                </span>
              </div>
            </>
          )}
        </FloatingCard>
      </div>

      {/* ── Alarms ───────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Active alarms" />
        <FloatingCard style={{ paddingTop: 6, paddingBottom: 6 }}>
          {alarms.isLoading ? (
            <div style={{ padding: "14px 0" }}><Shimmer w="72%" h={16} /></div>
          ) : (alarms.data?.total ?? 0) === 0 ? (
            <div className="m-empty">
              <span className="m-empty-mark"><Activity size={19} /></span>
              <span className="m-body m-ink3">No active alarms.</span>
            </div>
          ) : (
            <>
              <ListItem
                leading={<TriangleAlert size={17} />}
                title="Faults"
                subtitle="Require attention"
                trailing={<span className="m-h2 m-ink"><Value value={alarms.data?.failure ?? null} /></span>}
              />
              <ListItem
                leading={<TriangleAlert size={17} />}
                title="Alarms"
                subtitle="Threshold exceeded"
                trailing={<span className="m-h2 m-ink"><Value value={alarms.data?.alarm ?? null} /></span>}
              />
              <ListItem
                leading={<Activity size={17} />}
                title="Informational"
                subtitle="Logged, no action"
                trailing={<span className="m-h2 m-ink2"><Value value={alarms.data?.inform ?? null} /></span>}
              />
            </>
          )}
        </FloatingCard>
      </div>

      {/* ── Health ───────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="System health" />
        <div className="m-grid2">
          <MetricCard
            label="Devices"
            icon={<Cpu size={15} />}
            loading={devices.isLoading}
            value={
              totalDevices === 0
                ? <span className="m-ink3">—</span>
                : <>{online}<span className="m-unit">/ {totalDevices}</span></>
            }
          />
          <MetricCard
            label="Cell temp · avg"
            icon={<Thermometer size={15} />}
            loading={live.isLoading}
            value={<Value value={live.tempC} unit="°C" precision={1} animate />}
            footnote={live.maxCellTempC != null ? <>Max {live.maxCellTempC.toFixed(1)} °C</> : undefined}
          />
        </div>
      </div>
    </>
  );
}
