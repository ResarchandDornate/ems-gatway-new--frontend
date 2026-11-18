"use client";

/**
 * Header — station pill, theme, profile.
 *
 * The pill is the only glass element at the top of the screen; everything
 * around it is transparent so the ambient gradient reads straight through.
 * That is what gives the top of the page its air, and it is why the header
 * scrolls with the content rather than pinning: a pinned bar would need an
 * opaque backing and would cost the composition its lightest area.
 */

import { useState } from "react";
import { ChevronDown, Moon, Sun, Zap } from "lucide-react";
import { useMobileStation } from "../data";
import { BottomSheet } from "./Overlays";
import { IconButton } from "./Controls";
import { ListItem } from "./ListItem";
import { StatusIndicator } from "./Status";
import { useTheme } from "../useTheme";
import { useDemo } from "../demo/DemoContext";

export function Header() {
  const { station, stations, select, stationId } = useMobileStation();
  const [open, setOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const demo = useDemo();

  return (
    <>
      {/* Unmissable and unremovable while under /m/demo. Every figure below it
          is invented, and the screen has to say so without being asked. */}
      {demo.on && (
        <div className="m-demo-tag" role="status">
          <span className="m-demo-dot" />
          Demo data · not live telemetry
        </div>
      )}

      <header className="m-header">
        <button
          className="m-station-pill"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`Station: ${station?.powerStationEnglishName ?? "none selected"}. Change station.`}
        >
          <span className="m-sp-mark"><Zap size={16} strokeWidth={2.2} /></span>
          <span className="m-sp-text">
            <span className="m-sp-name">
              {station?.powerStationEnglishName || station?.powerStationName || "Select station"}
            </span>
            <span className="m-sp-loc">{station?.stationLocation || "—"}</span>
          </span>
          <ChevronDown size={15} style={{ marginLeft: "auto", flex: "none", opacity: .55 }} />
        </button>

        <IconButton label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} onClick={toggle}>
          {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
        </IconButton>
      </header>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Stations">
        {stations.length === 0 && (
          <div className="m-empty">
            <span className="m-body m-ink3">No stations available on this account.</span>
          </div>
        )}
        {stations.map((s) => (
          <ListItem
            key={s.id}
            title={s.powerStationEnglishName || s.powerStationName}
            subtitle={s.stationLocation}
            trailing={
              <StatusIndicator
                tone={s.status === "online" ? "good" : s.status === "abnormal" ? "warn" : "idle"}
                label={s.status === "online" ? "Online" : s.status === "abnormal" ? "Check" : "Offline"}
                live={s.status === "online"}
              />
            }
            onClick={() => { select(s.id); setOpen(false); }}
            className={s.id === stationId ? "is-current" : undefined}
          />
        ))}
      </BottomSheet>
    </>
  );
}
