"use client";

/**
 * WiringDiagram — main AC/DC single line.
 *
 * Restyled to the northbound-ems view language: the live isometric power-flow
 * stage, with the site's configured topology summarised beneath it.
 *
 * The previous schematic carried fixed voltage labels ("11 kV / 50 Hz",
 * "415V AC", "750V DC") that were never read from the plant. They are gone
 * rather than restyled — a drawn figure that looks like a measurement but is
 * not one is exactly what this codebase renders as "—" everywhere else. The
 * topology summary below is real: it comes from the plant's device_config.
 */

import { usePlantConfig } from "@/hooks/usePlantConfig";
import { useBessLiveCentral as useBessLive }    from "@/hooks/useBessLiveCentral";
import { PowerFlowDiagram } from "@/components/dashboard/PowerFlowDiagram";

export function WiringDiagram({ stationId }: { stationId: string }) {
  const { data: plantConfig } = usePlantConfig(stationId);
  const live = useBessLive(stationId);

  const inverterCount = plantConfig?.inverters.length ?? 0;
  const ratedKw = plantConfig?.derivedInstalledKw ?? null;

  return (
    <div className="view-stack">
      <div className="sub-panel">
        <div className="sub-panel-head">
          <h3>Main Wiring · AC/DC Single Line</h3>
          <span className="note">Animated Where Flowing</span>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 14px", lineHeight: 1.5 }}>
          Utility grid → point of common coupling → PCS / inverter → BMS → battery stack.
          Conduits animate in the direction power is actually flowing; a branch with no
          reading stays dim rather than showing zero.
        </p>
        <div style={{ minHeight: 300 }}>
          <PowerFlowDiagram
            gridKw={live.gridKw} loadKw={live.loadKw} battKw={live.battKw} solarKw={live.solarKw}
            soc={live.soc} soh={live.soh} maxCellTempC={live.maxCellTempC} gridHz={live.gridHz}
          />
        </div>
      </div>

      <div className="sub-panel">
        <div className="sub-panel-head"><h3>Configured Topology</h3></div>
        <div className="stack-tiles">
          <div className="st-tile">
            <div className="k">PCS / Inverters</div>
            <div className="v">{inverterCount === 0 ? "—" : inverterCount}</div>
          </div>
          <div className="st-tile">
            <div className="k">Installed Power</div>
            <div className="v">{ratedKw == null || ratedKw === 0 ? "—" : <>{ratedKw}<small>kW</small></>}</div>
          </div>
          <div className="st-tile">
            <div className="k">DC Bus Voltage</div>
            <div className="v">{live.voltDC == null ? "—" : <>{live.voltDC.toFixed(0)}<small>V</small></>}</div>
          </div>
          <div className="st-tile">
            <div className="k">Battery Current</div>
            <div className="v">{live.currA == null ? "—" : <>{live.currA.toFixed(1)}<small>A</small></>}</div>
          </div>
          <div className="st-tile">
            <div className="k">Grid Frequency</div>
            <div className="v">{live.gridHz == null ? "—" : <>{live.gridHz.toFixed(2)}<small>Hz</small></>}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
