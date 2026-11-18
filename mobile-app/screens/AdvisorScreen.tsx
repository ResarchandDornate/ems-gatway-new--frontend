"use client";

/**
 * AI Advisor — §9.
 *
 * The inference service does not exist, so there are no generated
 * recommendations to show and none are invented.
 *
 * What IS shown is the deterministic half of §9.3 — the feature computation
 * layer — because that part needs no model and no backend: round-trip
 * efficiency, cell temperature dispersion and telemetry availability are plain
 * arithmetic over readings the app already holds. §9.3 is explicit that no
 * number ever comes from the language model; the model only phrases a finding
 * that was computed. So these figures are exactly what the advisor would
 * reason over, shown as evidence rather than as advice.
 *
 * Nothing here is a recommendation, and the screen does not pretend otherwise.
 */

import { Sparkles, Gauge, Thermometer, Activity } from "lucide-react";
import { useMobileStation, useLive, useSummary } from "../data";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, MetricCard, StatusIndicator, Value,
  FeatureCard, Chip, ChipRow, Readout,
} from "../components";

/**
 * Round-trip efficiency = discharged ÷ charged over the lifetime counters.
 * Returns null unless both counters are real and charge is non-zero — a
 * division that cannot be performed produces an absence, not a 0%.
 */
function roundTrip(charge: number | null, discharge: number | null): number | null {
  if (charge == null || discharge == null || charge <= 0) return null;
  return (discharge / charge) * 100;
}

export function AdvisorScreen() {
  const { stationId } = useMobileStation();
  const live = useLive(stationId);
  const summary = useSummary(stationId);

  const rte = roundTrip(
    live.totalChargedKwh ?? summary.data?.totalChargeKwh ?? null,
    live.totalDischargedKwh ?? summary.data?.totalDischargeKwh ?? null,
  );

  /* Spread between the hottest cell and the pack average. A widening spread is
     the leading indicator §9.2 calls "cell imbalance" — but naming it a finding
     needs a baseline this app does not yet hold, so it is reported as a
     measurement only. */
  const tempSpread =
    live.maxCellTempC != null && live.tempC != null
      ? live.maxCellTempC - live.tempC
      : null;

  return (
    <>
      <Header />

      <FeatureCard style={{ marginBottom: 22 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Round-trip efficiency</span>
          <StatusIndicator tone="idle" label="Evidence only" />
        </div>
        <div style={{ marginTop: 10 }}>
          <Readout value={rte} unit="%" precision={1} />
        </div>
        <ChipRow>
          <Chip>Lifetime discharge ÷ charge</Chip>
          <Chip>
            {live.isStale ? "Telemetry stale" : live.isLive ? "Telemetry live" : "Telemetry absent"}
          </Chip>
        </ChipRow>
      </FeatureCard>

      {/* The honest state of this screen, stated first. */}
      <FloatingCard tone="glass">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <span className="m-metric-icon" style={{ width: 34, height: 34, borderRadius: 12 }}>
            <Sparkles size={17} />
          </span>
          <div className="m-stack" style={{ gap: 6 }}>
            <span className="m-h2 m-ink">No recommendations yet</span>
            <span className="m-body m-ink2" style={{ lineHeight: 1.5 }}>
              The advisor generates findings from telemetry history it does not have access to yet.
              Below are the deterministic measurements it will reason over — computed here, not generated.
            </span>
          </div>
        </div>
      </FloatingCard>

      <div style={{ marginTop: 26 }}>
        <SectionHeader title="Computed evidence" />
        <div className="m-grid2">
          {/* Round-trip is the feature card's headline; repeating it here would
              spend a tile on a number the eye has already read. SOH is the
              other half of the degradation picture and is genuinely distinct. */}
          <MetricCard
            label="State of health"
            icon={<Gauge size={15} />}
            loading={live.isLoading}
            value={<Value value={live.soh} unit="%" precision={1} animate />}
            footnote="Capacity vs nameplate"
          />
          <MetricCard
            label="Cell temp spread"
            icon={<Thermometer size={15} />}
            loading={live.isLoading}
            value={<Value value={tempSpread} unit="K" precision={1} animate />}
            footnote="Hottest cell vs pack average"
          />
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <SectionHeader title="What is missing" />
        <FloatingCard>
          <div className="m-body m-ink2" style={{ lineHeight: 1.6 }}>
            Per §9.6 a recommendation is never issued on an insufficient data window.
            Three inputs are outstanding:
          </div>
          <ul className="m-list">
            <li><strong>Telemetry history.</strong> Capacity fade and efficiency drift need cycles, not a snapshot. Accumulation starts with the backend in Phase 4.</li>
            <li><strong>DISCOM tariff tables.</strong> ToD arbitrage and idle-capacity findings are priced against state tariff slots we do not hold.</li>
            <li><strong>The inference service.</strong> Feature computation, detection and impact quantification — Phase 7.</li>
          </ul>
        </FloatingCard>
      </div>

      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Live inputs" />
        <FloatingCard>
          <div className="m-spread">
            <span className="m-label m-ink2"><Activity size={14} style={{ verticalAlign: -2, marginRight: 7 }} />Telemetry</span>
            <StatusIndicator
              tone={live.isStale ? "warn" : live.isLive ? "good" : "idle"}
              label={live.isStale ? "Stale" : live.isLive ? "Streaming" : "Absent"}
              live={live.isLive && !live.isStale}
            />
          </div>
        </FloatingCard>
      </div>
    </>
  );
}
