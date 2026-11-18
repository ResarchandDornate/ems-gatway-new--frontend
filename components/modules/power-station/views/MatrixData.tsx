"use client";

/**
 * MatrixData — per-matrix energy, power, current, SOC and cabinet breakdown.
 *
 * Restyled to the northbound-ems view language (tile grids + semantic panels).
 * Data: useHierarchy + useMatrixData → central backend
 * (lib/api/services/powerStationCentral.service.ts).
 *
 * A register the plant does not publish renders as an em dash, never as 0 —
 * "0.0 kW" on a live matrix reads as a real measurement of no power.
 */

import { useState, useMemo, useEffect } from "react";
import { useMatrixData } from "@/hooks/usePowerStation";
import { useHierarchy }  from "@/hooks/useEquipment";
import { LoadingState }  from "@/components/shared/LoadingState";
import { ErrorState }    from "@/components/shared/ErrorState";
import { EmptyState }    from "@/components/shared/EmptyState";
import { estimateNote } from "@/lib/api/services/dailyEnergyCentral.service";

const DASH = "—";
const dash = (v: number | null | undefined, digits = 1): string =>
  v == null ? DASH : v.toFixed(digits);
const dashAbs = (v: number | null | undefined, digits = 1): string =>
  v == null ? DASH : Math.abs(v).toFixed(digits);

function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="st-tile">
      <div className="k">{label}</div>
      <div className="v">{value}{unit && value !== DASH && <small>{unit}</small>}</div>
    </div>
  );
}

/** A kWh figure, or an em dash when the instrument behind it is silent. */
const kwh = (v: number | null): string => (v === null ? "\u2014" : v.toFixed(1));

export function MatrixData({ stationId }: { stationId: string }) {
  const hierarchy = useHierarchy(stationId);
  const grids = hierarchy.data?.grids ?? [];

  const [gridId,   setGridId]   = useState("");
  const [matrixId, setMatrixId] = useState("");

  // Auto-select first
  useEffect(() => {
    if (grids.length && !gridId) {
      const g = grids[0]; setGridId(g.id);
      const m = g.matrices[0]; if (m) setMatrixId(m.id);
    }
  }, [grids.length]);

  const matrices = useMemo(() => grids.find((g) => g.id === gridId)?.matrices ?? [], [grids, gridId]);

  const { data, isLoading, isError, refetch } = useMatrixData(stationId, matrixId);

  if (hierarchy.isLoading || isLoading) return <LoadingState rows={6} />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const e = data.energy, p = data.power, c = data.current;
  const socPct = data.totalSocPct;

  return (
    <div className="view-stack">

      {/* Grid / matrix selector */}
      <div className="sub-panel" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Matrix</span>
        <select value={gridId} onChange={(ev) => setGridId(ev.target.value)} className="filter-input" style={{ width: "auto" }}>
          {grids.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <span style={{ color: "var(--muted)" }}>–</span>
        <select value={matrixId} onChange={(ev) => setMatrixId(ev.target.value)} className="filter-input" style={{ width: "auto" }}>
          {matrices.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      {/* Energy info */}
      <div className="sub-panel">
        <div className="sub-panel-head"><h3>Energy Info</h3></div>
        <div className="stack-tiles">
          {/* kwh() renders an em dash for null. Remaining = SOC × rated capacity,
              and capacity is unconfigured (site overlay); today's pair needs a
              midnight counter reading the backend cannot reach. Unknown, not
              zero — "0.0 kWh" beside a discharging battery reads as a measurement. */}
          <Tile label="Remaining Discharge" value={kwh(e.remainingDischargeKwh)} unit="kWh" />
          <Tile label="Remaining Charge"    value={kwh(e.remainingChargeKwh)}    unit="kWh" />
          <Tile label={`Today's Charge${estimateNote(e.todayEstimatedSince)}`}    value={kwh(e.todayChargeKwh)}    unit="kWh" />
          <Tile label={`Today's Discharge${estimateNote(e.todayEstimatedSince)}`} value={kwh(e.todayDischargeKwh)} unit="kWh" />
        </div>
      </div>

      {/* Power info */}
      <div className="sub-panel">
        <div className="sub-panel-head">
          <h3>Power Info</h3>
          {/* Zero is idle, not discharging — a sign test alone mislabels a
              resting matrix as actively exporting. */}
          <span className="note">
            {p.totalActivePowerKw == null ? ""
              : p.totalActivePowerKw < -0.05 ? "Charging"
              : p.totalActivePowerKw > 0.05 ? "Discharging"
              : "Idle"}
          </span>
        </div>
        <div className="stack-tiles">
          <Tile label="Total Active Power"    value={dashAbs(p.totalActivePowerKw, 1)}     unit="kW" />
          <Tile label="Total Reactive Power"  value={dashAbs(p.totalReactivePowerKvar, 1)} unit="kVAr" />
          <Tile label="Max Chargeable Power"  value={dash(p.maxChargeablePowerKw, 0)}      unit="kW" />
          <Tile label="Max Dischargeable"     value={dash(p.maxDischargePowerKw, 0)}       unit="kW" />
          <Tile label="Total SOC"             value={dash(socPct, 1)}                      unit="%" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>

        {/* Phase currents */}
        <div className="sub-panel">
          <div className="sub-panel-head"><h3>Phase Measurements</h3></div>
          <table className="ps-table">
            <thead>
              <tr><th>Phase</th><th className="num">Current (A)</th></tr>
            </thead>
            <tbody>
              {([["L1", c.phaseA], ["L2", c.phaseB], ["L3", c.phaseC]] as const).map(([label, val]) => (
                <tr key={label}>
                  <td style={{ fontWeight: 600, color: "var(--ink)" }}>{label}</td>
                  <td className="num">{dash(val, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Total SOC */}
        <div className="sub-panel" style={{ display: "flex", flexDirection: "column" }}>
          <div className="sub-panel-head"><h3>Total SOC</h3></div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 14 }}>
            <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
              {dash(socPct, 1)}
              {socPct != null && <span style={{ fontSize: 17, color: "var(--muted)", marginLeft: 3 }}>%</span>}
            </div>
            <div style={{ width: "100%", height: 6, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${socPct ?? 0}%`, borderRadius: 999, background: "linear-gradient(90deg, #4E8D6E, #5B8AB4)", transition: "width 0.6s ease" }} />
            </div>
          </div>
        </div>

        {/* Edge controller */}
        <div className="sub-panel">
          <div className="sub-panel-head"><h3>Edge Controller</h3></div>
          {data.edgeController ? (
            <table className="ps-table">
              <tbody>
                <tr>
                  <td style={{ color: "var(--muted)" }}>Name</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: "var(--ink)" }}>{data.edgeController.name}</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--muted)" }}>Run Status</td>
                  <td style={{ textAlign: "right" }}>
                    <span className={`pill ${data.edgeController.runStatus === "normal" ? "green" : "red"}`}>
                      <span className="dot" /> {data.edgeController.runStatus === "normal" ? "Normal" : "Abnormal"}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>No Edge Controller Reported For This Station</p>
          )}
        </div>
      </div>

      {/* ESS cabinets */}
      <div className="sub-panel">
        <div className="sub-panel-head">
          <h3>ESS Cabinet Data</h3>
          <span className="note">{data.cabinets.length} Cabinet{data.cabinets.length === 1 ? "" : "s"}</span>
        </div>
        {data.cabinets.length === 0 ? (
          <EmptyState title="No Cabinets" description="This matrix reports no ESS cabinets." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Cabinet</th>
                  <th>State</th>
                  <th className="num">Power (kW)</th>
                  <th className="num">SOC (%)</th>
                  <th style={{ width: "26%" }}>Charge Level</th>
                </tr>
              </thead>
              <tbody>
                {data.cabinets.map((cab) => {
                  /* Same ±0.05 kW dead band as the Power info note: a resting
                     cabinet read 0.0 and was labelled "Discharging". */
                  const charging = cab.powerKw != null && cab.powerKw < -0.05;
                  const idle     = cab.powerKw != null && Math.abs(cab.powerKw) <= 0.05;
                  return (
                    <tr key={cab.id}>
                      <td style={{ fontWeight: 600, color: "var(--ink)" }}>{cab.name}</td>
                      <td>
                        <span className={`pill ${cab.powerKw == null || idle ? "gray" : charging ? "green" : "amber"}`}>
                          {cab.powerKw == null ? "—" : idle ? "Idle" : charging ? "Charging" : "Discharging"}
                        </span>
                      </td>
                      <td className="num">{dashAbs(cab.powerKw, 1)}</td>
                      <td className="num">{dash(cab.socPct, 1)}</td>
                      <td>
                        <div style={{ height: 5, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${cab.socPct ?? 0}%`, borderRadius: 999, background: "linear-gradient(90deg, #4E8D6E, #5B8AB4)" }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
