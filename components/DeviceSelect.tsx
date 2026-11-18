"use client";

/**
 * DeviceSelect — which device in the selected station every screen reads from.
 *
 * Sits beside StationSelect and writes to StationContext; usePlantConfig picks
 * the choice up from there, so the rest of the app scopes itself without
 * knowing this control exists.
 *
 * Renders nothing when the station has one device or none: a picker with a
 * single option is furniture, not a choice.
 */

import { Cpu, ChevronDown } from "lucide-react";
import { useStation } from "@/lib/context/StationContext";
import { deviceLabel, deviceTitle } from "@/lib/deviceNames";

export function DeviceSelect() {
  const { devices, devicesLoading, deviceId, setDeviceId } = useStation();

  if (devicesLoading) {
    return (
      <span className="text-[11px] tracking-[1.6px] text-muted2 font-mono">
        Loading Devices…
      </span>
    );
  }

  if (devices.length <= 1) return null;

  return (
    <div className="relative flex items-center">
      <Cpu size={13} className="absolute left-2.5 text-muted pointer-events-none" />
      <select
        value={deviceId}
        onChange={(e) => setDeviceId(e.target.value)}
        aria-label="Device"
        title="Which device this station's screens read from"
        className="
          h-7 pl-7 pr-7 rounded-md appearance-none cursor-pointer
          bg-surface border border-line text-ink text-[12px]
          hover:border-line2 focus:border-accent focus:outline-none
          transition-colors max-w-[220px] truncate
        "
      >
        {devices.map((d) => (
          <option key={d.id} value={d.id} title={deviceTitle(d.name)}>
            {deviceLabel(d.name)}{d.type && d.type !== "Unknown" ? ` · ${d.type}` : ""}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="absolute right-2 text-muted pointer-events-none" />
    </div>
  );
}
