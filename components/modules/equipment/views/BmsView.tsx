"use client";

/**
 * BMS — the battery screen, rebuilt to the reference EMS layout, with the cell
 * thermal map kept underneath it.
 *
 * Figures come live from the gateway's bms_1 asset; see readings.ts for what a real
 * backend replaces and which register backs each one.
 *
 * The pack selector across the top is the reference screen's, and it currently
 * selects nothing: there is one set of readings until per-pack data exists.
 * It is rendered rather than deferred because the aggregate/per-pack split is
 * the thing that decides how the new backend has to shape its response, and a
 * screen that hides that question answers it by accident.
 */

import { useState } from "react";
import { BMS_PACKS } from "../readings";
import { useEquipmentReadings, useCellData, useCellTrend, useProbeTemps } from "@/hooks/useEquipment";
import { timeTooltipLabel } from "@/lib/charts/timeAxis";
import { useUnit } from "@/lib/context/UnitContext";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { BatteryCellMap } from "../cellmap/BatteryCellMap";
import { CellDriftPanel } from "../cellmap/CellDriftPanel";
import { PackLayout, PackLegend, PackTempLegend, CELLS_PER_PACK } from "../cellmap/PackLayout";

/** The 3D cell map. Off for now; the card's code below is kept intact. */
const SHOW_CELL_MAP = false;

/** "PACK3" → "Pack 3"; the selector's values stay as BMS_PACKS spells them. */
const packLabel = (p: string) => p.replace(/^PACK(\d+)$/, "Pack $1");

const n = (v: number | null, dp = 2) => (v == null ? "—" : v.toFixed(dp));

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad) var(--pad)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 11 }}>
        <h3 className="card-title">{title}</h3>
        {note && <span style={{ fontSize: 11, color: "var(--muted)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", justifyContent: "space-between",
      gap: 10, padding: "6px 0", borderTop: "1px solid var(--line)",
    }}>
      <span style={{ fontSize: 11.5, color: "var(--ink3)", minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--ink)", whiteSpace: "nowrap" }}>
        {value}{unit && <small style={{ fontSize: 10, fontWeight: 500, color: "var(--muted)" }}> {unit}</small>}
      </span>
    </div>
  );
}

const PILL: Record<string, { cls: string; label: string }> = {
  online: { cls: "pill green", label: "Online" },
  offline: { cls: "pill red", label: "Offline" },
  normal: { cls: "pill green", label: "Normal" },
  "charge-disabled": { cls: "pill amber", label: "Charge Disabled" },
  "discharge-disabled": { cls: "pill amber", label: "Discharge Disabled" },
  standby: { cls: "pill gray", label: "Standby" },
  shutdown: { cls: "pill gray", label: "Shutdown" },
  idle: { cls: "pill gray", label: "Idle" },
  charging: { cls: "pill cyan", label: "Charging" },
  discharging: { cls: "pill green", label: "Discharging" },
  unknown: { cls: "pill gray", label: "Unknown" },
};

function StatusTile({ label, state, at }: { label: string; state: string; at?: number | null }) {
  const p = PILL[state] ?? PILL[state.toLowerCase()]
    ?? (state === "Communication Lost" ? { cls: "pill red", label: state } : { cls: "pill gray", label: state });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 600, textAlign: "center" }}>
        {label}
      </span>
      <span className={p.cls} style={{ fontSize: 11.5 }}><span className="dot" /> {p.label}</span>
      {at != null && (
        <span style={{ fontSize: 10, color: "var(--muted)" }}>
          Captured {new Date(at).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })}
        </span>
      )}
    </div>
  );
}

/** A bounded percentage as a ring. Same role the reference screen gives SOC and
 *  SOH, and the one case where a dial beats a figure: it reads against a fixed
 *  maximum without the reader having to know what the maximum is. */
function Ring({ label, value }: { label: string; value: number | null }) {
  const size = 78, stroke = 8, r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ display: "block", transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--color-surface3))" strokeWidth={stroke} />
          {value != null && (
            <circle
              cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${c * pct} ${c}`}
            />
          )}
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--ink)",
        }}>
          {value == null ? "—" : `${value.toFixed(0)}%`}
        </div>
      </div>
      <span style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 600 }}>
        {label}
      </span>
    </div>
  );
}

/**
 * @param sourceId The cabinet the page's drill-down has selected
 *   (`external_ems_1`). Omitted, the global unit picker decides.
 */
export function BmsView({ stationId, sourceId }: { stationId: string; sourceId?: string }) {
  const [pack, setPack] = useState<string>(BMS_PACKS[0]);
  const { data, isLoading, isError } = useEquipmentReadings(stationId, sourceId);
  /* The cluster this BMS reports, in the id shape cabinetCentral's
     fetchCellData parses the cabinet back out of (`external_ems_1_bms_cluster`).
     It was `${stationId}_bms_1-r1` — the NorthBound shape — and the station is
     the site's gateway id, so no cabinet could be parsed out of it and the map
     said "No per-cell data" for a pack publishing 260 cell voltages. Hooks run
     before the early returns below, because they have to. */
  const { unit, units } = useUnit();
  const cabinet = sourceId || unit.sourceId || units.find((u) => u.sourceId)?.sourceId || "";
  const { data: cells, isLoading: cellsLoading } = useCellData(
    cabinet ? `${cabinet}_bms_cluster` : "",
    stationId,
  );
  const { data: probeTemps, isLoading: probesLoading } = useProbeTemps(cabinet, stationId);
  /* When the cell registers could not be read fresh, the service serves the
     last snapshot it saw; its age goes in the card notes. */
  const cellTimes = (cells ?? []).map((c) => Date.parse(c.sampleTime ?? "")).filter(Number.isFinite);
  const cellsAt = cellTimes.length ? Math.min(...cellTimes) : NaN;   // the oldest reading shown
  const cellsAsOf = "";

  /* Which cell the drift chart traces. Undefined means "whichever the BMS's
     own minimum-cell register says is weakest", and the service resolves that
     itself — so the panel opens on the cell somebody would have picked anyway
     without this component having to ask twice for the same five signals. */
  const [traced, setTraced] = useState<number | undefined>(undefined);
  /* Pack layout colour: temperature (the probes) or cell voltage. */
  const [layoutMode, setLayoutMode] = useState<"temperature" | "voltage">("temperature");
  const { data: trend, isLoading: trendLoading } = useCellTrend(stationId, traced, cabinet);

  if (isLoading) return <LoadingState rows={4} />;
  if (isError || !data) {
    return <EmptyState title="Battery Unavailable" description="The gateway did not answer a telemetry read for this source." />;
  }
  if (!data.assets.includes("bms_1")) {
    return <EmptyState title="No Battery On This Source" description="The gateway reported no bms_1 asset behind this EMS." />;
  }
  const B = data.bms;

  /* Cell voltage min / avg / max from ONE source. The registers mix S1's
     extremes with S2's average a snapshot apart, and the average fell below
     the minimum (3354 against 3359 mV) while the pack layout read 3362–3364.
     With every cell in hand, all three — and the cell numbers — come from
     the per-cell voltages the pack layout draws; otherwise the registers,
     whose average is dropped when it lies outside them (readBms). */
  const cellVolts = (cells ?? [])
    .map((c) => ({ no: Number(/(\d+)$/.exec(c.cellId)?.[1] ?? 0), mv: c.voltMv }))
    .filter((c): c is { no: number; mv: number } => c.mv != null && c.no > 0);
  const expectedCells = Math.max((BMS_PACKS.length - 1) * CELLS_PER_PACK, ...cellVolts.map((c) => c.no));
  const cv = cellVolts.length >= expectedCells
    ? (() => {
        let lo = cellVolts[0], hi = cellVolts[0], sum = 0;
        for (const c of cellVolts) {
          if (c.mv < lo.mv) lo = c;
          if (c.mv > hi.mv) hi = c;
          sum += c.mv;
        }
        return { min: lo.mv, avg: sum / cellVolts.length, max: hi.mv, minNo: lo.no, maxNo: hi.no };
      })()
    : { ...B.cellVoltageMv, minNo: B.minCellVoltageNo, maxNo: B.maxCellVoltageNo };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

      {/* Pack selector, in the recessed track the app uses for every other
          segmented control rather than a second tab language. */}
      <div className="nav-track" style={{ alignSelf: "flex-start", flexWrap: "wrap", maxWidth: "100%" }}>
        {BMS_PACKS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPack(p)}
            className={`nav-pill ${pack === p ? "on" : ""}`}
          >
            {packLabel(p)}
          </button>
        ))}
      </div>

      <Card
        title={pack === "BMS" ? "Cluster" : `${packLabel(pack)} · Cluster Readings`}
      >
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", alignItems: "center" }}>
          <StatusTile label="Online Status" state={data.comm.bms.state} at={data.comm.bms.at} />
          <StatusTile label="System Status" state={B.systemStatus} />
          <StatusTile label="Charge / Discharge" state={B.chargeState} />
          <Ring label="SOC" value={B.socPct} />
          <Ring label="SOH" value={B.sohPct} />
          <div>
            <Row label="Total Voltage"   value={n(B.totalVoltageV)}  unit="V" />
            <Row label="Total Current"   value={n(B.totalCurrentA)}  unit="A" />
            <Row label="High-Voltage Box Max Temp" value={n(B.hvBoxMaxTempC, 1)} unit="°C" />
          </div>
        </div>
      </Card>

      {/* A PACK tab: that pack's own figures, computed from its 52 cell
          voltages and 32 temperature probes (no per-pack registers exist). */}
      {/^PACK\d+$/.test(pack) && (() => {
        const k = Number(pack.slice(4));
        const cellNo = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
        const mv = (cells ?? [])
          .filter((c) => { const no = cellNo(c.cellId); return no > (k - 1) * CELLS_PER_PACK && no <= k * CELLS_PER_PACK; })
          .map((c) => c.voltMv).filter((v): v is number => v != null);
        const tc = (probeTemps?.probes ?? [])
          .filter((p) => p.probe > (k - 1) * 32 && p.probe <= k * 32).map((p) => p.tempC);
        const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
        const lo = mv.length ? Math.min(...mv) : null, hi = mv.length ? Math.max(...mv) : null;
        return (
          <Card title={`${packLabel(pack)} · From Its Cells`}
                note={`${mv.length} Of ${CELLS_PER_PACK} Cells · ${tc.length} Of 32 Temperature Sensors${cellsAsOf}`}>
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <div>
                <Row label="Pack Voltage (Σ Cells)" value={mv.length === CELLS_PER_PACK ? n(mv.reduce((a, b) => a + b, 0) / 1000, 1) : "—"} unit="V" />
                <Row label="Cell Spread" value={lo != null && hi != null ? n(hi - lo, 0) : "—"} unit="mV" />
              </div>
              <div>
                <Row label="Min Cell" value={n(lo, 0)} unit="mV" />
                <Row label="Avg Cell" value={n(avg(mv), 0)} unit="mV" />
                <Row label="Max Cell" value={n(hi, 0)} unit="mV" />
              </div>
              <div>
                <Row label="Min Sensor" value={n(tc.length ? Math.min(...tc) : null, 1)} unit="°C" />
                <Row label="Avg Sensor" value={n(avg(tc), 1)} unit="°C" />
                <Row label="Max Sensor" value={n(tc.length ? Math.max(...tc) : null, 1)} unit="°C" />
              </div>
            </div>
          </Card>
        );
      })()}

      <div style={{ display: "grid", gap: "var(--gap-sm)", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
        <Card title="Cell Voltage">
          <Row label="Minimum" value={n(cv.min, 0)} unit="mV" />
          <Row label="Average" value={n(cv.avg, 0)} unit="mV" />
          <Row label="Maximum" value={n(cv.max, 0)} unit="mV" />
          <Row label="Lowest Cell #" value={n(cv.minNo, 0)} />
          <Row label="Highest Cell #" value={n(cv.maxNo, 0)} />
        </Card>

        <Card title="Battery Temperature">
          <Row label="Minimum" value={n(B.batteryTempC.min, 1)} unit="°C" />
          <Row label="Average" value={n(B.batteryTempC.avg, 1)} unit="°C" />
          <Row label="Maximum" value={n(B.batteryTempC.max, 1)} unit="°C" />
          <Row label="Coolest Sensor #" value={n(B.minBatteryTempNo, 0)} />
          <Row label="Hottest Sensor #" value={n(B.maxBatteryTempNo, 0)} />
        </Card>

        <Card title="Limits & Headroom">
          <Row label="Max Acceptable Charge Current"    value={n(B.maxAcceptableChargeA, 0)}    unit="A" />
          <Row label="Max Acceptable Discharge Current" value={n(B.maxAcceptableDischargeA, 0)} unit="A" />
          <Row label="Available Charge Power"           value={n(B.availableChargeKw)}          unit="kW" />
          <Row label="Available Discharge Power"        value={n(B.availableDischargeKw)}       unit="kW" />
        </Card>

        <Card title="High-Voltage Box Temperatures">
          {B.hvBoxTempC.map((t, i) => (
            <Row key={i} label={`High-Voltage Box Temp ${i + 1}`} value={n(t, 1)} unit="°C" />
          ))}
        </Card>

        <Card title="Accumulated Energy">
          <Row label="Monthly Charge"    value={n(B.monthlyChargeKwh, 0)}    unit="kWh" />
          <Row label="Monthly Discharge" value={n(B.monthlyDischargeKwh, 0)} unit="kWh" />
          <Row label="Annual Charge"     value={n(B.annualChargeKwh, 0)}     unit="kWh" />
          <Row label="Annual Discharge"  value={n(B.annualDischargeKwh, 0)}  unit="kWh" />
          <Row label="Total Charge"      value={n(B.totalChargeAh, 0)}       unit="Ah" />
          <Row label="Total Discharge"   value={n(B.totalDischargeAh, 0)}    unit="Ah" />
        </Card>
      </div>

      {/* The packs as built: 52 cells in series, four strips of thirteen. The
          map below says which cells are out of line; this says where they are.
          "BMS" shows every pack; a PACK tab shows that one. */}
      {(cells?.length || probeTemps?.probes.length) ? (() => {
        /* Every cell in its numbered slot, all packs drawn. PackLayout slices
           by position, so a partial read (BESS 2: 99 of 260 while the S2
           stream was stalled) used to shift cells into the wrong slots and,
           counted by length, draw 2 packs instead of 5. Cells with no reading
           — or no cell data at all — are placeholders. */
        const probeList = probeTemps?.probes ?? [];
        const cellNo = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
        const byNo = new Map((cells ?? []).map((c) => [cellNo(c.cellId), c]));
        const highest = Math.max(0, ...byNo.keys(), ...probeList.map((p) => Math.ceil(p.probe / 32) * CELLS_PER_PACK));
        const packCount = Math.max(BMS_PACKS.length - 1, Math.ceil(highest / CELLS_PER_PACK));
        const layoutCells = Array.from({ length: packCount * CELLS_PER_PACK }, (_, k) =>
          byNo.get(k + 1) ?? { cellId: `${cabinet}_cell_${k + 1}`, name: `Cell ${k + 1}`, voltMv: null, tempC: null, socPct: null });
        const readings = layoutCells.map((c) => c.voltMv).filter((v): v is number => v != null);
        const mean = readings.length ? readings.reduce((a, b) => a + b, 0) / readings.length : null;
        const probeArr: (number | null)[] = [];
        for (const p of probeList) probeArr[p.probe - 1] = p.tempC;
        const meanC = probeList.length ? probeList.reduce((a, p) => a + p.tempC, 0) / probeList.length : null;
        const temp = layoutMode === "temperature" && probeList.length > 0;
        const probesAsOf = undefined;
        const only = /^PACK(\d+)$/.exec(pack);
        const shown = only
          ? [Number(only[1])].filter((n) => n <= packCount)
          : Array.from({ length: packCount }, (_, i) => i + 1);
        return (
          <Card
            title="Pack Layout"
            note={temp ? probesAsOf : cellsAsOf.replace(/^ · /, "") || undefined}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {(["temperature", "voltage"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setLayoutMode(m)}
                  className={`nav-pill ${layoutMode === m ? "on" : ""}`}>
                  {m === "temperature" ? "Temperature" : "Voltage"}
                </button>
              ))}
            </div>
            {/* Placeholder cells carry no reading; say so, or a hover that
                answers "—" on every cell looks like a broken hover. */}
            {!temp && !readings.length && (
              <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 10px", marginBottom: 10, borderRadius: 6, background: "var(--surface2)" }}>
                No Cell Voltages Received
              </div>
            )}
            <div style={{
              display: "grid", gap: "var(--gap)",
              gridTemplateColumns: only ? "1fr" : "repeat(auto-fit, minmax(min(460px, 100%), 1fr))",
            }}>
              {shown.map((n) => (
                <PackLayout key={n} cells={layoutCells} pack={n} clusterMeanMv={mean} onSelectCell={setTraced} selected={traced}
                  mode={temp ? "temperature" : "voltage"} probes={probeArr} clusterMeanC={meanC} />
              ))}
            </div>
            <div style={{ marginTop: 10 }}>{temp ? <PackTempLegend /> : <PackLegend />}</div>
          </Card>
        );
      })() : null}

      {/* The cell thermal map, measured.

          It used to render 104 cells generated from the pack's min/avg/max with
          a sine wave between them — a plausible-looking thermal gradient that
          was arithmetic, not measurement. That was removed, correctly: on a
          battery screen a fabricated map is something somebody could plan an
          intervention from.

          It was then left empty on the grounds that the gateway "publishes the
          battery as one aggregate asset". That was true of /api/bms/racks,
          which is absent from build 0.10.0-operator-control, and it was never
          true of the cells: bms_extended carries cell_voltage_1..260 in the
          ordinary S2 snapshot (the per-probe temperatures the NorthBound
          dictionary had are not published on the central backend). Every
          cell drawn below is a register read, and a probe that answered null
          is drawn in the no-reading grey rather than interpolated. */}
      {/* Commented out on request, 12 Oct 2026 — flip SHOW_CELL_MAP to bring it back. */}
      {SHOW_CELL_MAP && <Card
        title="Cell Map"
        note={cells?.length ? `${cells.length} Cells${cellsAsOf}` : undefined}
      >
        {/* No mode selector here: BatteryCellMap carries its own TEMP/VOLT/SOC
            control, and a second one outside it would be two places to read
            the same state from. `mode` is the initial one only. */}
        {cellsLoading
          ? <LoadingState rows={3} />
          : cells?.length
            /* Opens on voltage: S2 publishes 260 cell_voltage_N registers and
               no per-probe battery_temperature_N at all, so the temperature
               mode would open on a pack of no-reading grey. The selector
               inside the map still offers it. */
            ? <BatteryCellMap cells={cells} mode={cells.some((c) => c.tempC != null) ? "temperature" : "voltage"} rackSoc={B.socPct} height={420} />
            : (
              <EmptyState
                title="No Per-Cell Data"
                description="This source answered no per-cell registers on the last poll. The pack extremes above are the measured figures."
              />
            )}
      </Card>}

      {/* The map above is a snapshot; this is the same pack over time.

          Separated rather than folded into the map's card because they answer
          different questions off different stores — the map reads the live
          telemetry snapshot, this reads /api/storage/points — and because this
          one costs six gateway reads and is polled at a fifteenth of the rate.
          A single card would imply they refresh together. */}
      <Card title="Cell Drift">
        <CellDriftPanel trend={trend} loading={trendLoading} onSelectCell={setTraced} sourceId={cabinet} cells={cells} />
      </Card>
    </div>
  );
}
