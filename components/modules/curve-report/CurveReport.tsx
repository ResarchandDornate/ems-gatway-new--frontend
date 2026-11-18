"use client";

import { useState } from "react";
import { AssetCurve }         from "./views/AssetCurve";
import { PowerQuantityReport } from "./views/PowerQuantityReport";
import { ProfitReportView }   from "./views/ProfitReport";
import { PageHeader, PageStat } from "@/components/PageHeader";

type NavKey = "curve" | "power-quantity" | "profit";

/**
 * One flat numbered list, matching the shared module pattern. The two
 * collapsible groups ("Curve Display" / "Report Data") hid six destinations
 * behind two toggles; the split now shows as a label above each run instead,
 * which keeps the grouping without making it something to operate.
 */
const NAV_ITEMS: { key: NavKey; label: string; group: string }[] = [
  /* One curve page, not four. The old views — WholeStationPower,
     SingleCabinetPcs, BatteryClusterCurve, SingleCellBattery — each fixed one
     asset and one set of lines; AssetCurve asks for the asset instead and lets
     up to five of its parameters share a chart. The four files are untouched
     if any of them has to come back. */
  { key: "curve",           label: "Curve Display",         group: "Curve Display" },
  { key: "power-quantity",  label: "Energy Report",         group: "Report Data"   },
  { key: "profit",          label: "Profit Report",         group: "Report Data"   },
];

export function CurveReport({ stationId }: { stationId: string }) {
  const [activeNav, setActiveNav] = useState<NavKey>("curve");

  function renderView() {
    switch (activeNav) {
      case "curve":           return <AssetCurve stationId={stationId} />;
      case "power-quantity":  return <PowerQuantityReport stationId={stationId} />;
      case "profit":          return <ProfitReportView   stationId={stationId} />;
    }
  }

  const active = NAV_ITEMS.find(i => i.key === activeNav);

  return (
    <div className="page-fill" style={{ overflowY: "auto", paddingRight: 4, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Hero strip ──────────────────────────────────────────────── */}
      <PageHeader title="Genie">
        <PageStat label="Curves" value={NAV_ITEMS.filter(i => i.group === "Curve Display").length} />
        <PageStat label="Reports" value={NAV_ITEMS.filter(i => i.group === "Report Data").length} />
      </PageHeader>

      {/* ── Numbered submenu + content ──────────────────────────────── */}
      <div className="ps-layout">
        <nav className="ps-submenu">
          {NAV_ITEMS.map((item, i) => (
            <div key={item.key} className="contents">
              {/* Group label above the first item of each run */}
              {/* w-full so the label claims its own line once .ps-submenu flips
                  to a wrapping row under 900px, instead of sitting between two
                  buttons as if it were one. */}
              {NAV_ITEMS[i - 1]?.group !== item.group && item.group !== item.label && (
                <div className="w-full px-1 pt-2 pb-1 text-[11px] font-medium text-muted">
                  {item.group}
                </div>
              )}
              <button
                onClick={() => setActiveNav(item.key)}
                className={`ps-sm-item${activeNav === item.key ? " on" : ""}`}
              >
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </nav>

        <div className="surface-card ps-panel">
          <div className="ps-panel-head">
            <h2>{active?.label ?? ""}</h2>
            {active && active.group !== active.label && <span className="text-[11px] text-muted">{active.group}</span>}
          </div>
          <div className="ps-panel-body">{renderView()}</div>
        </div>
      </div>
    </div>
  );
}
