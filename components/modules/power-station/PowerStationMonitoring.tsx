"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Range } from "@/lib/charts/period";
import { SingleStationData }     from "./views/SingleStationData";
import { SingleStationDataView } from "./views/SingleStationDataView";
// Matrix Data is commented out (1 Oct 2026). views/MatrixData.tsx is intact;
// uncomment this import, the nav item and the case below to bring it back.
// import { MatrixData }          from "./views/MatrixData";
import { CommStatus }          from "./views/CommStatus";
import { WeatherStationView }  from "./views/WeatherStationView";
import { DrawingsView }        from "./views/DrawingsView";
import { TopologyStrip }       from "./views/TopologyStrip";
import { WiringTiles }         from "./views/WiringTiles";
import { EmptyState }          from "@/components/shared/EmptyState";
import { usePlantConfig }      from "@/hooks/usePlantConfig";
import { PageHeader } from "@/components/PageHeader";

// ── Nav ───────────────────────────────────────────────────────────────────────
type NavKey =
  | "wiring"
  | "single-line"
  | "single-station"
  | "matrix"
  | "comm-status"
  | "weather-station"
  | "network-topology";

interface NavItem { key: NavKey; label: string }

const BASE_NAV_ITEMS: NavItem[] = [
  { key: "wiring",           label: "Main Wiring Diagram"    },
  { key: "single-line",      label: "Power Station Home"     },
  { key: "single-station",   label: "Site Data"              },
  // { key: "matrix",           label: "Matrix Data"            },
  { key: "comm-status",      label: "Communication Status"   },
  { key: "network-topology", label: "Network Topology"       },
];

const WMS_NAV_ITEM: NavItem = { key: "weather-station", label: "Weather Station" };

// ── Main ──────────────────────────────────────────────────────────────────────
export function PowerStationMonitoring({ stationId }: { stationId: string }) {
  /* ?view=single-station&range=week opens a tab and range directly — the
     dashboard's chart cards link here for their history (Apple Health's
     summary → detail). */
  const params = useSearchParams();
  const [activeNav, setActiveNav] = useState<NavKey>(() => {
    const v = params.get("view");
    return v && BASE_NAV_ITEMS.some((i) => i.key === v) ? (v as NavKey) : "wiring";
  });
  const rangeParam = params.get("range");
  const initialRange: Range | undefined =
    rangeParam === "day" || rangeParam === "week" ? rangeParam : undefined;
  const { data: plantConfig }     = usePlantConfig(stationId);

  /* The hero's two polls went with its stats. This shell now reads only the
     plant config it needs to decide which tabs exist; every view below keeps
     its own UGX wiring, so nothing lost a reading — Communication Status still
     calls useCommDevices for itself. */

  // Dynamically add the Weather Station tab when the plant has a WMS sensor.
  // Anchored to the tab it belongs before rather than to an index: the index
  // form silently reordered this the moment a tab above it was removed.
  const navItems: NavItem[] = (() => {
    if (!plantConfig?.wms) return BASE_NAV_ITEMS;
    const at = BASE_NAV_ITEMS.findIndex((i) => i.key === "network-topology");
    const before = at === -1 ? BASE_NAV_ITEMS.length : at;
    return [...BASE_NAV_ITEMS.slice(0, before), WMS_NAV_ITEM, ...BASE_NAV_ITEMS.slice(before)];
  })();

  function renderView() {
    switch (activeNav) {
      /* The site's electrical drawings (lib/drawings), under the live tiles the
         parked flow diagram (views/WiringDiagram.tsx) used to carry. */
      case "wiring":
        return (
          <div className="flex flex-col gap-3">
            <WiringTiles gatewayId={stationId} />
            <DrawingsView kind="sld" />
          </div>
        );
      case "single-line":     return <SingleStationData stationId={stationId} />;
      case "single-station":  return <SingleStationDataView stationId={stationId} initialRange={initialRange} />;
      // case "matrix":          return <MatrixData stationId={stationId} />;
      case "comm-status":     return <CommStatus stationId={stationId} />;
      case "weather-station": return <WeatherStationView stationId={stationId} />;
      case "network-topology":
        return (
          <div className="flex flex-col gap-3">
            <TopologyStrip gatewayId={stationId} />
            <DrawingsView kind="topology" />
          </div>
        );
    }
  }

  const activeLabel = navItems.find((i) => i.key === activeNav)?.label ?? "";

  return (
    <div className="page-fill" style={{ overflowY: "auto", paddingRight: 4, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Hero strip ──────────────────────────────────────────────── */}
      <PageHeader title="Power Station Monitoring" info="Single-line wiring, station data and communication health." />
        {/* The hero's stat cluster stood here — the 3D module render, then
            Devices online, SOC and Battery power. Removed on request; the hero
            is now the page's title and what it covers, and nothing else.

            Devices online is the one figure that had no second home on this
            page: SOC and battery power are both read again inside Single Station
            Data, but the online count now only exists as the KPI band at the top
            of Communication Status. */}

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
          </div>
          <div className="ps-panel-body">{renderView()}</div>
        </div>
      </div>
    </div>
  );
}
