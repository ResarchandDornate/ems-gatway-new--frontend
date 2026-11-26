"use client";

/**
 * A SECURE energy meter tab (solar_meter / load_meter), driven by substream. Shows every
 * published register grouped by kind; an unpublished one renders as a dash.
 */
import { useMeterReadings } from "@/hooks/useMeterReadings";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Card, Row, num } from "./equipmentUi";
import { formatAge } from "@/lib/freshness";

type Item = [key: string, label: string, unit?: string];
const GROUPS: { title: string; rows: Item[] }[] = [
  { title: "Voltage", rows: [
    ["voltage_a_v", "Phase A", "V"], ["voltage_b_v", "Phase B", "V"], ["voltage_c_v", "Phase C", "V"],
    ["voltage_average_v", "Average", "V"], ["voltage_ab_v", "Line AB", "V"],
    ["voltage_bc_v", "Line BC", "V"], ["voltage_ca_v", "Line CA", "V"],
  ] },
  { title: "Current", rows: [
    ["current_a_a", "Phase A", "A"], ["current_b_a", "Phase B", "A"],
    ["current_c_a", "Phase C", "A"], ["current_neutral_a", "Neutral", "A"],
  ] },
  { title: "Power Factor", rows: [
    ["power_factor_a", "Phase A"], ["power_factor_b", "Phase B"],
    ["power_factor_c", "Phase C"], ["power_factor_total", "Total"],
  ] },
  { title: "Active Power", rows: [
    ["active_power_a_kw", "Phase A", "kW"], ["active_power_b_kw", "Phase B", "kW"],
    ["active_power_c_kw", "Phase C", "kW"], ["active_power_total_kw", "Total", "kW"],
  ] },
  { title: "Reactive Power", rows: [
    ["reactive_power_a_kvar", "Phase A", "kVAr"], ["reactive_power_b_kvar", "Phase B", "kVAr"],
    ["reactive_power_c_kvar", "Phase C", "kVAr"], ["reactive_power_total_kvar", "Total", "kVAr"],
  ] },
  { title: "Apparent Power", rows: [
    ["apparent_power_a_kva", "Phase A", "kVA"], ["apparent_power_b_kva", "Phase B", "kVA"],
    ["apparent_power_c_kva", "Phase C", "kVA"], ["apparent_power_total_kva", "Total", "kVA"],
  ] },
  { title: "Frequency & Energy", rows: [
    ["frequency_hz", "Frequency", "Hz"], ["active_energy_import_kwh", "Energy Import", "kWh"],
    ["active_energy_export_kwh", "Energy Export", "kWh"], ["active_energy_net_kwh", "Energy Net", "kWh"],
  ] },
];

const dp = (k: string) => (/power_factor/.test(k) || /_hz$/.test(k) ? 2 : 1);

export function MeterReadingsView({ gatewayId, substream, title }: {
  gatewayId: string; substream: string; title: string;
}) {
  const { data, isLoading, isError, error, refetch } = useMeterReadings(gatewayId, substream);

  if (isLoading) return <LoadingState rows={4} />;
  if (isError) {
    return <ErrorState message={error instanceof Error ? error.message : "Meter Read Failed"} onRetry={() => refetch()} />;
  }
  if (!data?.present) {
    return <EmptyState title={`No ${title} Data Yet`} description={`The gateway holds no ${substream} readings for this site.`} />;
  }

  const age = data.capturedTs != null ? Date.now() - data.capturedTs : null;
  const g = (k: string) => data.signals[k] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>
      {GROUPS.map((grp, i) => (
        <Card key={grp.title} title={grp.title} note={i === 0 && age != null ? `${formatAge(age)} ago` : undefined}>
          {grp.rows.map(([key, label, unit]) => (
            <Row key={key} label={label} value={num(g(key), dp(key))} unit={unit} />
          ))}
        </Card>
      ))}
    </div>
  );
}
