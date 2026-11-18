"use client";

/**
 * The live readings the parked flow diagram (views/WiringDiagram.tsx) carried,
 * over the single-line drawings: PCS count and installed power from the plant
 * topology (S2), DC bus voltage, stack current and bus frequency from the
 * newest S1 sample. It used to read usePlantConfig — the disabled NorthBound
 * seam — and so showed an empty plant.
 */

import { usePlantTopology } from "@/hooks/usePowerStation";
import { useBessLiveCentral } from "@/hooks/useBessLiveCentral";
import { SITE_OVERLAY_FOR } from "@/lib/api/overlay/stations";

function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="ps-stat-k">{label}</div>
      <div className="ps-stat-v" style={{ fontSize: 14, color: value === "—" ? "var(--muted)" : "var(--ink)" }}>
        {value}{value !== "—" && unit ? <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 3 }}>{unit}</span> : null}
      </div>
    </div>
  );
}

const fx = (v: number | null | undefined, dp: number) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(dp));

export function WiringTiles({ gatewayId }: { gatewayId: string }) {
  const { data: t } = usePlantTopology(gatewayId);
  const live = useBessLiveCentral(gatewayId);
  return (
    <div className="surface-card" style={{ padding: "10px var(--pad)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "10px 18px", alignItems: "end" }}>
        <Tile label="PCS" value={t ? String(t.pcsCount) : "—"} />
        {/* The stated nameplate wins over the PCS rated-power registers (2 × 130),
            as on the dashboard and Power Station Home. */}
        <Tile label="Installed Power" value={fx(SITE_OVERLAY_FOR(gatewayId).installedPower ?? t?.ratedKw, 0)} unit="kW" />
        {/* Mean of the cabinets' DC buses; current summed. Negative = charging. */}
        <Tile label="DC Bus Voltage" value={fx(live.voltDC, 1)} unit="V" />
        <Tile label="Battery Current" value={fx(live.currA, 1)} unit="A" />
        {/* No grid on an islanded site: this is the bus the PCS forms. */}
        <Tile label="Frequency" value={fx(live.gridHz, 2)} unit="Hz" />
      </div>
    </div>
  );
}
