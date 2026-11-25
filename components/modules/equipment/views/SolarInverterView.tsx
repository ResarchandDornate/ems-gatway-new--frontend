"use client";

/**
 * The site's PV combiner box (HopeCombox), from the S2 solar_inverter stream.
 *
 * This tab was first built on the Solis inverter stream (lib/central/solis.ts),
 * which carries nothing for a CleanEdge gateway — PV arrives as the combiner's
 * own registers instead. Shown here: array state and AC output now, today's and
 * lifetime yield, and the PCC meter beside it. Anything the combiner does not
 * publish renders as a dash, not an invented figure.
 */
import { useSolarReadings } from "@/hooks/useSolarReadings";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Card, Row, StatusTile, num } from "./equipmentUi";
import { formatAge } from "@/lib/freshness";

const trio = (xs: (number | null)[], dp = 1) => xs.map((x) => num(x, dp)).join(" / ");

export function SolarInverterView({ gatewayId }: { gatewayId: string }) {
  const { data: s, isLoading, isError, error, refetch } = useSolarReadings(gatewayId);

  if (isLoading) return <LoadingState rows={4} />;
  if (isError) {
    return <ErrorState message={error instanceof Error ? error.message : "Solar Read Failed"} onRetry={() => refetch()} />;
  }
  if (!s?.present) {
    return <EmptyState title="No Solar Data Yet" description="The gateway holds no combiner-box readings for this site." />;
  }

  const age = s.capturedTs != null ? Date.now() - s.capturedTs : null;
  const m = s.meter;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>
      <Card title="PV Combiner" note={age != null ? `${formatAge(age)} ago` : undefined}>
        <div style={{ display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <StatusTile label="Array" state={s.arrayRunning == null ? "Not Reported" : s.arrayRunning ? "Running" : "Stopped"} />
          <StatusTile label="Grid" state={s.onGrid == null ? "Not Reported" : s.onGrid ? "On-Grid" : "Off-Grid"} />
          <StatusTile label="Fault" state={s.faulted == null ? "Not Reported" : s.faulted ? "Fault" : "Normal"} />
        </div>
        <Row label="Active Power" value={num(s.acActiveKw, 1)} unit="kW" />
        <Row label="Reactive Power" value={num(s.acReactiveKvar, 1)} unit="kVAr" />
        <Row label="On-Grid Power" value={num(s.onGridActiveKw, 1)} unit="kW" />
        <Row label="Generated Today" value={num(s.dailyYieldKwh, 1)} unit="kWh" />
        <Row label="Lifetime Yield" value={num(s.lifetimeYieldKwh, 0)} unit="kWh" />
        <Row label="Total Feed-In" value={num(s.feedInKwh, 0)} unit="kWh" />
        <Row label="Purchased From Grid" value={num(s.purchasedKwh, 0)} unit="kWh" />
      </Card>

      <Card title="Grid Meter (PCC)">
        <Row label="Status" value={m.online == null ? "—" : m.online ? "Online" : "Offline"} />
        <Row label="Frequency" value={num(m.frequencyHz, 2)} unit="Hz" />
        <Row label="Phase Voltage" value={num(m.phaseVoltageV, 1)} unit="V" />
        <Row label="Line Voltage" value={num(m.lineVoltageV, 1)} unit="V" />
        <Row label="Average Current" value={num(m.currentA, 1)} unit="A" />
        <Row label="Apparent Power" value={num(m.apparentKva, 1)} unit="kVA" />
        <Row label="Reactive Power" value={num(m.reactiveKvar, 1)} unit="kVAr" />
        <Row label="Power Factor" value={num(m.powerFactor, 2)} />
        <Row label="PCC Export Power" value={num(m.pccExportKw, 1)} unit="kW" />
        <Row label="Meter Phase A / B / C" value={trio(m.phaseKw)} unit="kW" />
      </Card>
    </div>
  );
}
