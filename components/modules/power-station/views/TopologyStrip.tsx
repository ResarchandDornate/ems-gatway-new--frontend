"use client";

/**
 * The plant as the gateway reports it, over the topology drawings: how many
 * EMS controllers, PCS and BMS answer, the meters and how many are silent,
 * the PCS rated power, and whether export (anti-backflow) and demand control
 * are armed. usePlantTopology was built and never rendered (re-audit, 8 Oct).
 */

import { usePlantTopology } from "@/hooks/usePowerStation";

function Fact({ label, value, tone }: { label: string; value: string; tone?: "warn" | "muted" }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="ps-stat-k">{label}</div>
      <div className="ps-stat-v" style={{ fontSize: 14, color: tone === "warn" ? "var(--gold)" : tone === "muted" ? "var(--muted)" : "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

const onOff = (v: boolean | null) => (v == null ? "—" : v ? "Armed" : "Disabled");

export function TopologyStrip({ gatewayId }: { gatewayId: string }) {
  const { data: t } = usePlantTopology(gatewayId);
  if (!t) return null;
  return (
    <div className="surface-card" style={{ padding: "10px var(--pad)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px 18px", alignItems: "end" }}>
        <Fact label="Battery Controllers" value={String(t.emsControllers)} />
        <Fact label="PCS" value={String(t.pcsCount)} />
        <Fact label="BMS" value={String(t.bmsCount)} />
        <Fact label="Meters" value={t.meters.total ? `${t.meters.total}${t.meters.offline ? ` · ${t.meters.offline} Offline` : ""}` : "None"}
              tone={t.meters.offline ? "warn" : undefined} />
        <Fact label="PCS Rated Power" value={t.ratedKw != null ? `${Math.round(t.ratedKw)} kW` : "—"} />
        {/* An islanded site has no export to limit: shown as the gateway reports it, never assumed. */}
        <Fact label="Export Limit" value={onOff(t.exportControl)} tone={t.exportControl ? undefined : "muted"} />
        <Fact label="Demand Limit" value={onOff(t.demandControl)} tone={t.demandControl ? undefined : "muted"} />
      </div>
    </div>
  );
}
