"use client";

/**
 * Environment — cabinet climate and fire protection, to the reference layout.
 *
 * The dehumidifier half maps cleanly onto the gateway: all eight readings have
 * registers on the `dehumidifier` asset. The fire-protection half does not, and
 * the screen says so — see the note on the detector table.
 */

import { useEquipmentReadings } from "@/hooks/useEquipment";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, Row, StatusTile, StateGrid, num } from "./equipmentUi";

/**
 * @param sourceId The cabinet the page's drill-down has selected
 *   (`external_ems_1`). Omitted, the global unit picker decides.
 */
export function EnvironmentView({ stationId, sourceId }: { stationId: string; sourceId?: string }) {
  const { data, isLoading, isError } = useEquipmentReadings(stationId, sourceId);

  if (isLoading) return <LoadingState rows={3} />;
  if (isError || !data) {
    return <EmptyState title="Environment Unavailable" description="The gateway did not answer a telemetry read for this source." />;
  }
  const E = data.environment;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

      <Card title="Dehumidifier">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14, marginBottom: 12 }}>
          <StatusTile label="Dehumidifier Online"  state={data.comm.dehumidifier.state} at={data.comm.dehumidifier.at} />
          {/* DH Work Mode (p1283) hidden: no published meaning for its codes. */}
          <StatusTile label="Dehumidifier Alarm"   state={E.dhAlarm === "normal" ? "Normal" : "Alarm"} />
          <StatusTile label="Temperature Control"  state={E.tempControlStatus} />
          {/* Humidity Control (p1292 humidity_control_method) hidden: a method
              code, not an on/off bit, and no published meaning for its values. */}
          <StatusTile label="Dehumidification"     state={E.dehumidificationStatus} />
        </div>
        <Row label="Current Temperature" value={num(E.currentTempC, 1)} unit="°C" />
        <Row label="Current Humidity"    value={num(E.currentHumidityPct, 1)} unit="%" />
      </Card>

      <Card title="Fire Protection">
        {/* Fire panel is hard-wired to the IO module on some sites and reports
            no comm link — show this status only when the gateway actually
            sends fire telemetry (otherwise it would read a misleading "Offline"). */}
        {data.comm.fire.at != null && (
          <div style={{ marginBottom: 12 }}>
            <StatusTile label="Fire Protection Communication" state={data.comm.fire.state} at={data.comm.fire.at} />
          </div>
        )}

        {/*
          The reference EMS shows a per-detector table — Battery Box 1..5 and an
          external detector, each with a warning level, fault type, start type
          and sub-valve status. This gateway has no registers behind any of it:
          the fire_protection asset carries 23 signals and every one is an
          aggregate for the whole cabinet.

          Six rows reading "Normal / No Fault / Reserved / Closed" used to be
          rendered here from literals. On a fire panel that is the worst place
          in this app to show a reassuring fiction, so the table is gone and the
          asset's real signals are shown instead — every alarm and fault bit it
          actually publishes, live.
        */}
        <StateGrid items={E.fireSignals} badLabel="Alarm" unknown={E.fireLost} />
      </Card>
    </div>
  );
}
