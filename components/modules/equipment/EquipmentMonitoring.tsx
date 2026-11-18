"use client";

import { useState, useMemo, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { deviceLabel, deviceTitle } from "@/lib/deviceNames";
import { useHierarchy } from "@/hooks/useEquipment";
import { useCommDevices } from "@/hooks/usePowerStation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useUnit } from "@/lib/context/UnitContext";
import { EssCabinetView }  from "./views/EssCabinetView";
// Sub-device Monitoring is commented out — see NAV_ITEMS.
// import { SubDeviceView }   from "./views/SubDeviceView";
import { MainMeterView }   from "./views/MainMeterView";
// Replaced by MainMeterView — it showed time-of-use billing buckets rather than
// the meter itself. views/MeterDataView.tsx is untouched.
// import { MeterDataView }   from "./views/MeterDataView";
// import { DeviceListView }  from "./views/DeviceListView";
import { SolarInverterView } from "./views/SolarInverterView";
import { LoadingState }    from "@/components/shared/LoadingState";
import type { Cabinet } from "@/lib/api/types";
import { PageHeader, PageStat } from "@/components/PageHeader";

// ── Submenu items ─────────────────────────────────────────────────────────────
// Flat and numbered, matching the shared module pattern (see PowerStationMonitoring).
// The old collapsible groups nested four destinations two levels deep for no
// navigational gain.
type NavKey = "ess-cabinet" | "meter" | "solar" | "device-list";

interface NavItem {
  key: NavKey;
  label: string;
  /** Shown only while the site has a device of this kind (lib/devices/registry). */
  device?: string;
}

/*
  Sub-device Monitoring is commented out. It was a nav item naming none of the
  four things behind it — PCS, BMS, Water Chiller, Fire Protection — and the
  first two now have proper tabs inside the cabinet, so it had become a second,
  older copy of screens the cabinet already carries. views/SubDeviceView.tsx is
  untouched; restoring it is this list, the import, and the render line.

  "Main" rather than bare "Electricity Meter": the cabinet has a Sub Meter tab,
  and once both exist the word "meter" alone stops saying which one.
*/
const NAV_ITEMS: NavItem[] = [
  { key: "ess-cabinet", label: "Energy Storage Cabinet"        },
  { key: "meter",       label: "Main Electricity Meter Data", device: "grid_meter" },
  { key: "solar",       label: "Solar Inverter"                },
  // Device List is switched off for now; restore this line to bring it back.
  // { key: "device-list", label: "Device List"                   },
  // { key: "sub-device",  label: "Sub-device Monitoring" },
];

// ── Drill-down selector ───────────────────────────────────────────────────────
function DrillDownSelector({
  stationId,
  onCabinetChange,
}: {
  stationId: string;
  onCabinetChange: (cabinet: Cabinet) => void;
}) {
  const hierarchy = useHierarchy(stationId);
  /* The global unit picker. When it names a BESS, the drill-down follows it —
     otherwise the header could say BESS 2 over a page opened on BESS 1. On
     Total it leaves the drill-down alone. */
  const { unit } = useUnit();

  const [gridId,    setGridId]    = useState<string>("");
  const [matrixId,  setMatrixId]  = useState<string>("");
  const [cabinetId, setCabinetId] = useState<string>("");

  const grids   = hierarchy.data?.grids ?? [];
  const matrices = useMemo(() => grids.find(g => g.id === gridId)?.matrices ?? [], [grids, gridId]);
  const cabinets = useMemo(() => matrices.find(m => m.id === matrixId)?.cabinets ?? [], [matrices, matrixId]);

  // Auto-select first items when hierarchy loads
  useEffect(() => {
    if (grids.length && !gridId) {
      const g = grids[0];
      setGridId(g.id);
      const m = g.matrices[0];
      if (m) {
        setMatrixId(m.id);
        const c = m.cabinets[0];
        if (c) { setCabinetId(c.id); onCabinetChange(c); }
      }
    }
  }, [grids.length]);

  useEffect(() => {
    if (!unit.sourceId) return;
    for (const g of grids) for (const m of g.matrices) {
      const c = m.cabinets.find((x) => x.id === unit.sourceId);
      if (c && c.id !== cabinetId) {
        setGridId(g.id); setMatrixId(m.id); setCabinetId(c.id); onCabinetChange(c);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.sourceId, grids.length]);

  function handleGrid(id: string) {
    setGridId(id); setMatrixId(""); setCabinetId("");
    const m = grids.find(g => g.id === id)?.matrices[0];
    if (m) { setMatrixId(m.id); const c = m.cabinets[0]; if (c) { setCabinetId(c.id); onCabinetChange(c); } }
  }
  function handleMatrix(id: string) {
    setMatrixId(id); setCabinetId("");
    const c = matrices.find(m => m.id === id)?.cabinets[0];
    if (c) { setCabinetId(c.id); onCabinetChange(c); }
  }
  function handleCabinet(id: string) {
    setCabinetId(id);
    const c = cabinets.find(c => c.id === id);
    if (c) onCabinetChange(c);
  }

  const selStr = [
    grids.find(g => g.id === gridId)?.name,
    matrices.find(m => m.id === matrixId)?.name,
    cabinets.find(c => c.id === cabinetId)?.name,
  ].filter(Boolean).join(" – ");

  // Renders bare so it can sit inside the panel head — the card chrome belongs
  // to the panel, not to the breadcrumb.
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {/* Site › Gateway › BESS. A level with one option is text, not a
          dropdown that can only be set to what it already says. */}
      {grids.length > 0 && (
        <>
          <ChevronRight size={13} className="text-muted flex-shrink-0" />
          {grids.length === 1 ? (
            <span className="text-[12px] text-ink3" title="Site">{grids[0].name}</span>
          ) : (
            <select value={gridId} onChange={e => handleGrid(e.target.value)} className="filter-input w-auto" aria-label="Site">
              {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </>
      )}

      {matrices.length > 0 && (
        <>
          <ChevronRight size={13} className="text-muted flex-shrink-0" />
          {matrices.length === 1 ? (
            <span className="text-[12px] text-ink3" title={`Gateway ${matrices[0].id}`}>{matrices[0].name}</span>
          ) : (
            <select value={matrixId} onChange={e => handleMatrix(e.target.value)} className="filter-input w-auto" aria-label="Gateway">
              {matrices.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
        </>
      )}

      {cabinets.length > 0 && (
        <>
          <ChevronRight size={13} className="text-muted flex-shrink-0" />
          <select value={cabinetId} onChange={e => handleCabinet(e.target.value)} className="filter-input w-auto" aria-label="BESS">
            {cabinets.map(c => <option key={c.id} value={c.id} title={deviceTitle(c.name)}>{deviceLabel(c.name)}</option>)}
          </select>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function EquipmentMonitoring({ stationId }: { stationId: string }) {
  const [navPick, setActiveNav] = useState<NavKey>("ess-cabinet");

  /* A device's tab only where the site has that device — the roster says
     which (fetchCommStatus, the presence rule in lib/devices/registry). A site
     without a grid meter has no meter tab, and the tab appears on its own the
     day one is fitted. A fitted meter that stops talking keeps its tab:
     MainMeterView says it is offline. */
  const { gatewayId } = useAppConfig();
  const { data: roster } = useCommDevices(gatewayId);
  const navItems = NAV_ITEMS.filter((i) => !i.device || !!roster?.some((d) => d.kind === i.device));
  const activeNav: NavKey = navItems.some((i) => i.key === navPick) ? navPick : "ess-cabinet";
  const [cabinet,   setCabinet]   = useState<Cabinet | null>(null);

  // Already fetched by DrillDownSelector — React Query dedupes, so reading it
  // here for the hero costs nothing.
  const hierarchy = useHierarchy(stationId);
  const grids     = hierarchy.data?.grids ?? [];
  const matrices  = grids.flatMap(g => g.matrices);
  const cabinets  = matrices.flatMap(m => m.cabinets);

  /* Only the cabinet view drills into a specific cabinet. Sub-device Monitoring
     was the other caller and is gone. */
  const showSelector = activeNav === "ess-cabinet";
  const activeLabel  = navItems.find(i => i.key === activeNav)?.label ?? "";

  return (
    <div className="page-fill" style={{ overflowY: "auto", paddingRight: 4, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Hero strip ──────────────────────────────────────────────── */}
      <PageHeader title="Equipment Monitoring">
        <PageStat label="Sites"    value={grids.length    ? String(grids.length)    : "—"} />
        <PageStat label="Gateways" value={matrices.length ? String(matrices.length) : "—"} />
        <PageStat label="BESS" value={cabinets.length ? String(cabinets.length) : "—"} />
      </PageHeader>

      {/* ── Numbered submenu + content ──────────────────────────────── */}
      <div className="ps-layout">
        <nav className="ps-submenu">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveNav(item.key)}
              className={`ps-sm-item${activeNav === item.key ? " on" : ""}`}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="surface-card ps-panel">
          <div className="ps-panel-head">
            <h2>{activeLabel}</h2>
            {showSelector && (
              <DrillDownSelector stationId={stationId} onCabinetChange={setCabinet} />
            )}
          </div>

          <div className="ps-panel-body">
            {activeNav === "ess-cabinet" && cabinet && (
              <EssCabinetView cabinet={cabinet} stationId={stationId} />
            )}
            {activeNav === "ess-cabinet" && !cabinet && <LoadingState rows={4} />}
            {/* {activeNav === "sub-device"  && <SubDeviceView  stationId={stationId} />} */}
            {activeNav === "meter"       && <MainMeterView stationId={stationId} />}
            {activeNav === "solar"       && <SolarInverterView gatewayId={stationId} />}
            {/* {activeNav === "device-list" && <DeviceListView stationId={stationId} />} */}
          </div>
        </div>
      </div>
    </div>
  );
}
