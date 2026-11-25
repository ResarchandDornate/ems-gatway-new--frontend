"use client";

/**
 * PCS — the converter screen, rebuilt to the reference EMS layout.
 *
 * Live from the gateway; see components/modules/equipment/readings.ts
 * for what a real backend replaces and which register backs each figure.
 *
 * Promoted out of Sub-device Monitoring, where PCS was one of four tabs behind
 * a nav item that named none of them. It is equipment in its own right and now
 * sits in the sidebar as such.
 */

import { useEquipmentReadings } from "@/hooks/useEquipment";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, Row, StatusTile, PhaseTable, StateGrid, num, CommLostScope } from "./equipmentUi";
import { MultiSeriesPeriodCard } from "@/components/dashboard/viz/MultiSeriesPeriodCard";
import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { series } from "@/lib/charts/tokens";
import { SITE_TZ } from "@/lib/api/time";

/** The enum values spelled the way an operator reads them. */
const TITLE: Record<string, string> = {
  standby: "Standby", running: "Running", shutdown: "Shutdown", fault: "Fault", stopped: "Stopped", unknown: "Unknown",
  "grid-connected": "Grid-Connected", "off-grid": "Off-Grid", invalid: "Invalid",
  online: "Online", offline: "Offline",
};

/** A 1/0 register as words, or "—". */
const flag = (v: number | null | undefined, on: string, off: string) => (v == null ? "—" : v !== 0 ? on : off);

/**
 * @param sourceId The cabinet the page's drill-down has selected
 *   (`external_ems_1`). Omitted, the global unit picker decides.
 */
export function PcsView({ stationId, sourceId }: { stationId: string; sourceId?: string }) {
  const { data, isLoading, isError } = useEquipmentReadings(stationId, sourceId);
  /* The cabinet this converter sits in, for its fast-stream history tags. */
  const { all } = useSelectedCabinets();
  const cab = sourceId ? all.find((c) => c.sourceId === sourceId) : all[0];

  if (isLoading) return <LoadingState rows={4} />;
  if (isError || !data) {
    return <EmptyState title="Converter Unavailable" description="The gateway did not answer a telemetry read for this source." />;
  }
  if (!data.assets.includes("pcs_1")) {
    return <EmptyState title="No Converter On This Source" description="The gateway reported no pcs_1 asset behind this EMS." />;
  }
  const P = data.pcs;

  return (
    <CommLostScope lost={data.comm.pcs.state === "Communication Lost"}>
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

      {/* Status first: what the converter is doing governs how every figure
          below it should be read — 0 kW means something different in Standby
          than it does in Running. */}
      <Card title="Converter Status">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <StatusTile label="Operating Status"   state={TITLE[P.operatingStatus]} />
          <StatusTile label="Grid On/Off Status" state={TITLE[P.gridTie]} />
          <StatusTile label="Online Status"      state={data.comm.pcs.state} at={data.comm.pcs.at} />
        </div>
      </Card>

      {/* Phases down, quantities across — an imbalance is spotted by reading a
          column, not a row. Shown only when the gateway sends per-phase data. */}
      {P.phases.some((ph) => ph.voltageV != null || ph.currentA != null || ph.activeKw != null) && (
        <Card title="AC — Per Phase">
          <PhaseTable phases={P.phases} />
        </Card>
      )}

      <div style={{ display: "grid", gap: "var(--gap-sm)", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <Card title="Line Voltage">
          <Row label="AB Line Voltage" value={num(P.lineVoltage.ab)} unit="V" />
          <Row label="BC Line Voltage" value={num(P.lineVoltage.bc)} unit="V" />
          <Row label="CA Line Voltage" value={num(P.lineVoltage.ca)} unit="V" />
        </Card>

        <Card title="Totals">
          <Row label="Total Active Power"   value={num(P.totalActiveKw)}     unit="kW" />
          <Row label="Total Reactive Power" value={num(P.totalReactiveKvar)} unit="kVAR" />
          <Row label="Total Apparent Power" value={num(P.totalApparentKva)}  unit="kVA" />
          <Row label="Total Power Factor"   value={num(P.totalPowerFactor)} />
          <Row label="Grid Frequency"       value={num(P.gridFrequencyHz)}   unit="Hz" />
          <Row label="DC Power"             value={num(P.dcPowerKw)}         unit="kW" />
        </Card>

        {/* Operating Mode (p0239) and Control Mode (p0153) are hidden: the PCS
            register map publishes no meaning for their codes. Restore them
            with words once the vendor's table is in. */}
        <Card title="Mode & Contactors">
          <Row label="Grid Forming (V/F)"    value={flag(P.mode?.vfOffGrid, "Yes · Off-Grid", "No")} />
          <Row label="Derating"              value={P.mode?.derating == null ? "—" : P.mode.derating !== 0 ? `Yes · Flag ${P.mode.derating}` : "No"} />
          <Row label="Overload Derating"     value={flag(P.mode?.overloadDerating, "Yes", "No")} />
          <Row label="Positive Contactor"    value={flag(P.mode?.positiveContactor, "Closed", "Open")} />
          <Row label="Negative Contactor"    value={flag(P.mode?.negativeContactor, "Closed", "Open")} />
          <Row label="Pre-Charge Contactor"  value={flag(P.mode?.preChargeContactor, "Closed", "Open")} />
        </Card>

        <Card title="DC Side & Insulation">
          <Row label="DC Bus Voltage"        value={num(P.dc?.totalV ?? null, 1)} unit="V" />
          <Row label="Upper Capacitor"       value={num(P.dc?.upperV ?? null, 1)} unit="V" />
          <Row label="Lower Capacitor"       value={num(P.dc?.lowerV ?? null, 1)} unit="V" />
          <Row label="Leakage Current"       value={num(P.dc?.leakageA ?? null, 2)} unit="A" />
          <Row label="Insulation Resistance" value={P.dc?.insulationKohm == null ? "—" : Math.round(P.dc.insulationKohm).toLocaleString("en-IN")} unit="kΩ" />
          <Row label="Neutral Current"       value={num(P.dc?.neutralA ?? null, 1)} unit="A" />
        </Card>

        <Card title="Temperatures">
          {(P.temperatures ?? []).map((x) => (
            <Row key={x.label} label={x.label} value={num(x.c, 1)} unit="°C" />
          ))}
        </Card>

        <Card title="Setpoints & Lifetime Energy">
          <Row label="Manual Charge Setpoint"    value={num(P.manualChargeKw)}    unit="kW" />
          <Row label="Manual Discharge Setpoint" value={num(P.manualDischargeKw)} unit="kW" />
          <Row label="DC Lifetime Charge"        value={num(P.dcHistoricalChargeKwh, 0)}    unit="kWh" />
          <Row label="DC Lifetime Discharge"     value={num(P.dcHistoricalDischargeKwh, 0)} unit="kWh" />
          <Row label="AC Lifetime Charge"        value={num(P.acHistoricalChargeKwh, 0)}    unit="kWh" />
          <Row label="AC Lifetime Discharge"     value={num(P.acHistoricalDischargeKwh, 0)} unit="kWh" />
        </Card>
      </div>

      {/* Line voltage over time — AB / BC / CA as three lines. Off the 1 s fast
          stream (grid_voltage_*_v); the numbers above are its latest sample. */}
      {cab && (
        <MultiSeriesPeriodCard
          title="Line Voltage" cabinets={[cab]} unit="V"
          specs={[
            { label: "AB", color: series("primary").stroke,   combine: "max", tagOf: (c) => `fast:${c.bessId}:pcs_values::grid_voltage_ab_v` },
            { label: "BC", color: series("secondary").stroke, combine: "max", tagOf: (c) => `fast:${c.bessId}:pcs_values::grid_voltage_bc_v` },
            { label: "CA", color: "var(--green)",             combine: "max", tagOf: (c) => `fast:${c.bessId}:pcs_values::grid_voltage_ca_v` },
          ]}
        />
      )}

      {/* Faults last, and as a dense grid rather than a list: twenty-four of
          them reading "Normal" is the ordinary case, so the block should be
          scannable in one pass and only break that rhythm when something is
          actually wrong. */}
      <Card title="Fault Status" note={`${P.faults.filter((f) => !f.ok).length} Active`}>
        <StateGrid items={P.faults} badLabel="Fault" />
      </Card>
    </div>
    </CommLostScope>
  );
}
