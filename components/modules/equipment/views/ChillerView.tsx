"use client";

/**
 * Chiller — the liquid-cooling unit, to the reference EMS layout.
 *
 * Live, from the gateway's liquid_cooling asset — 226 signals, the richest
 * single asset on the plant after the BMS. The alarm grid is derived from the
 * asset's own fault bits rather than a hand-written list, so a register the
 * vendor adds appears without this file changing.
 */

import { useEquipmentReadings } from "@/hooks/useEquipment";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, Row, StatusTile, StateGrid, num } from "./equipmentUi";

/**
 * @param sourceId The cabinet the page's drill-down has selected
 *   (`external_ems_1`). Omitted, the global unit picker decides.
 */
export function ChillerView({ stationId, sourceId }: { stationId: string; sourceId?: string }) {
  const { data, isLoading, isError } = useEquipmentReadings(stationId, sourceId);

  if (isLoading) return <LoadingState rows={4} />;
  if (isError || !data) {
    return <EmptyState title="Cooling Unit Unavailable" description="The gateway did not answer a telemetry read for this source." />;
  }
  if (!data.assets.includes("liquid_cooling")) {
    return <EmptyState title="No Cooling Unit On This Source" description="The gateway reported no liquid_cooling asset behind this EMS." />;
  }
  const C = data.chiller;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

      <Card title="Unit Status">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <StatusTile label="Online Status" state={data.comm.cooling.state} at={data.comm.cooling.at} />
          <StatusTile label="Power Switch"  state={C.powerSwitch === "on" ? "On" : "Off"} />
          <StatusTile label="Work Mode"     state={C.workMode} />
          {/* Unit Control Mode (p1173) hidden: no published meaning for its codes. */}
        </div>
      </Card>

      <div style={{ display: "grid", gap: "var(--gap-sm)", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
        {/* Loop first: inlet and outlet paired so the delta between them — the
            number that says whether the loop is doing any work — is a glance
            down the card rather than a subtraction. */}
        <Card title="Water Loop">
          <Row label="Inlet Water Pressure"   value={num(C.inletPressureBar)}  unit="Bar" />
          <Row label="Outlet Water Pressure"  value={num(C.outletPressureBar)} unit="Bar" />
          <Row label="Inlet Water Temperature"  value={num(C.inletTempC, 1)}  unit="°C" />
          <Row label="Outlet Water Temperature" value={num(C.outletTempC, 1)} unit="°C" />
          <Row label="Inlet–Outlet Difference"  value={num(C.inletOutletTempDiffC, 1)} unit="°C" />
          <Row label="Outdoor Temperature"      value={num(C.outdoorTempC, 1)} unit="°C" />
          {/* Frequencies, in Hz as the unit reports them — not relabelled rpm. */}
          <Row label="Compressor A Frequency"   value={num(C.compressorAHz, 1)} unit="Hz" />
          <Row label="Compressor B Frequency"   value={num(C.compressorBHz, 1)} unit="Hz" />
        </Card>

        {/* cooling_/heating_battery_*_temperature (p1156–p1160) sit between the
            set temperatures and their hysteresis registers in the point map and
            read 28 / 25 / 12 / 15 °C on both cabinets whatever the pack does:
            they are the battery temperatures the unit starts cooling or heating
            at, not measurements. The measured ones are the BMS's. */}
        <Card title="Battery Temperatures">
          <Row label="Minimum" value={num(data.bms.batteryTempC.min, 1)} unit="°C" />
          <Row label="Average" value={num(data.bms.batteryTempC.avg, 1)} unit="°C" />
          <Row label="Maximum" value={num(data.bms.batteryTempC.max, 1)} unit="°C" />
        </Card>

        <Card title="Set Points & Thresholds">
          <Row label="Cooling Set Temperature"        value={num(C.coolingSetTempC, 1)} unit="°C" />
          <Row label="Heating Set Temperature"        value={num(C.heatingSetTempC, 1)} unit="°C" />
          <Row label="Cooling Set Point · Max Battery" value={num(C.coolingMaxBattTempC, 1)} unit="°C" />
          <Row label="Cooling Set Point · Avg Battery" value={num(C.coolingAvgBattTempC, 1)} unit="°C" />
          <Row label="Heating Set Point · Min Battery" value={num(C.heatingMinBattTempC, 1)} unit="°C" />
          <Row label="Heating Set Point · Avg Battery" value={num(C.heatingAvgBattTempC, 1)} unit="°C" />
          <Row label="Outlet High Temp Alarm"     value={num(C.outletHighTempAlarmC, 1)} unit="°C" />
          <Row label="Outlet Low Temp Alarm"      value={num(C.outletLowTempAlarmC, 1)}  unit="°C" />
          <Row label="Outlet High Pressure Alarm" value={num(C.outletHighPressureAlarmBar)} unit="Bar" />
          <Row label="Inlet Low Pressure Alarm"   value={num(C.inletLowPressureAlarmBar)}  unit="Bar" />
        </Card>
      </div>

      <Card title="Alarm Status" note={`${C.alarms.filter((a) => !a.ok).length} Active`}>
        <StateGrid items={C.alarms} />
      </Card>
    </div>
  );
}
