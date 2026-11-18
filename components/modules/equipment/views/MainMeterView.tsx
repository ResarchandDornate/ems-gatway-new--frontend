"use client";

/**
 * Main Electricity Meter — the site meter at the point of common coupling.
 *
 * Same screen as the cabinet's Sub Meter, and unlike that one this instrument is
 * fully mapped: every quantity here has a register on the gateway's
 * `utility_meter` asset, checked field by field against the 2026-08-10
 * dictionary —
 *
 *   Online status        communication_status   · 2707
 *   Frequency            frequency              · 2761
 *   Total power factor   total_power_factor     · 2759
 *   Total active/reactive/apparent   2735 / 2743 / 2751
 *   Phase A/B/C voltage              2709 / 2711 / 2713
 *   Phase A/B/C current              2721 / 2723 / 2725
 *   Phase A/B/C active power         2729 / 2731 / 2733
 *   Phase A/B/C reactive, apparent and power factor all present too
 *
 * It is now wired: every figure is read live from that asset, and the claim
 * above was tested by doing it — the layout did not change.
 *
 * This replaced a view that showed time-of-use energy buckets — Peak, Shoulder,
 * Flat, Valley. Those are a billing summary rather than a meter, and they belong
 * with the tariff reporting, not on the instrument's own screen.
 */

import { useEquipmentReadings, useMeterTrace } from "@/hooks/useEquipment";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { MeterScreen } from "./MeterScreen";
import type { MeterReadings } from "../readings";
import { useCabinetSource } from "../periodHistory";

/** Every reading of a silent meter as unknown. */
function blank(m: MeterReadings): MeterReadings {
  const n = null;
  return {
    ...m,
    frequencyHz: n, totalPowerFactor: n, totalActiveKw: n, totalReactiveKvar: n, totalApparentKva: n,
    forwardEnergyKwh: n, reverseEnergyKwh: n,
    phases: m.phases.map((p) => ({ ...p, voltageV: n, currentA: n, activeKw: n, reactiveKvar: n, apparentKva: n, powerFactor: n })),
    chart: [],
  };
}

export function MainMeterView({ stationId }: { stationId: string }) {
  const { data, isLoading, isError } = useEquipmentReadings(stationId);
  /* The trace is its own read — three point-filtered S2 queries reaching back
     ~35 minutes — so the live figures do not wait on it. */
  const { data: trace } = useMeterTrace();
  const sourceId = useCabinetSource();

  if (isLoading) return <LoadingState rows={4} />;
  if (isError || !data) {
    return <EmptyState title="Meter Unavailable" description="The gateway did not answer a telemetry read for this source." />;
  }
  if (!data.assets.includes("utility_meter")) {
    return <EmptyState title="No Meter On This Source" description="The gateway reported no utility_meter asset behind this EMS." />;
  }

  const offline = data.meter.online !== "online";
  /* Offline, the registers hold zeros — shown as "—", not as 0.00, which reads
     as a measurement of no flow. The bus frequency and voltages are still
     known, from the PCS on the same 415 V bus, and are shown labelled so. */
  const m = offline ? blank(data.meter) : { ...data.meter, chart: trace ?? [] };
  const bus = {
    frequencyHz: data.pcs.gridFrequencyHz,
    phaseV: data.pcs.phases.map((p) => ({ label: p.label, v: p.voltageV })),
  };

  return (
    <MeterScreen
      comm={data.comm.meter}
      m={m}
      bus={bus}
      traceAsset={offline || !sourceId ? undefined : `${sourceId}_grid_meter`}
      tone={offline ? "amber" : "neutral"}
      banner={
        offline ? (
          <>
            <strong style={{ color: "var(--ink)" }}>Meter not communicating.</strong>{" "}
            Its communication_status (p1354) reads 0 and the EMS controller&rsquo;s
            grid_meter_communication_status agrees, so its figures are shown as &ldquo;—&rdquo;:
            the zeros it holds are not a measurement of zero flow. On this islanded site it is
            likely the bus meter (MFM-01). The bus frequency and voltages below come from the
            PCS instead.
          </>
        ) : (
          <>
            <strong style={{ color: "var(--ink)" }}>Live.</strong>{" "}
            Read from the gateway&rsquo;s utility_meter asset at the point of common coupling.
          </>
        )
      }
    />
  );
}
