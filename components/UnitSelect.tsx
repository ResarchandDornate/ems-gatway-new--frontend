"use client";

/**
 * UnitSelect — which ESS unit inside the selected station the screens describe.
 *
 * Replaced DeviceSelect in the sub-header. That control listed the UGX devices
 * behind a station ("Gujarat Site · BESS"), which is a different question from
 * the one an operator standing in front of four cabinets actually asks, and it
 * was redundant beside the station picker once a single site was the norm.
 * Removing the control does not remove the device choice — StationContext still
 * resolves a device, falling back to the first, so every screen reading through
 * usePlantConfig is unaffected.
 *
 * Styled to match what it replaced rather than inventing a second look for a
 * control in the same slot.
 */

import { Boxes, ChevronDown } from "lucide-react";
import { useUnit } from "@/lib/context/UnitContext";

export function UnitSelect() {
  const { units, unitId, setUnitId } = useUnit();

  /* Total alone is not a choice. A lone-unit site gets no control rather than
     a dropdown that can only be set to what it already says. */
  if (units.length < 2) return null;

  return (
    <div className="relative flex items-center">
      <Boxes size={13} className="absolute left-2.5 text-muted pointer-events-none" />
      <select
        value={unitId}
        onChange={(e) => setUnitId(e.target.value)}
        aria-label="ESS unit"
        title="Which ESS unit the screens describe — Total, or one cabinet"
        className="
          h-8 pl-7 pr-7 rounded-md appearance-none cursor-pointer
          bg-surface border border-line text-ink text-[12px]
          hover:border-line2 focus:border-accent focus:outline-none
          transition-colors max-w-[220px] truncate
        "
      >
        {units.map((u) => (
          <option key={u.id} value={u.id} title={u.bessId ?? "All units"}>
            {u.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="absolute right-2 text-muted pointer-events-none" />
    </div>
  );
}
