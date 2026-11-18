"use client";

/**
 * Where the screens are looking, as the path the plant is organised by:
 *
 *   Organisation › Site › Gateway › BESS unit
 *
 * A level with a choice is a dropdown; a level with one value is plain text.
 * The site picker stays a dropdown even with one site because it also offers
 * the Group Screen. The unit picker hides itself when there is nothing to pick.
 *
 * Organisation and gateway are text for now: the backend cannot list either,
 * so there is exactly one of each. When it can, they become dropdowns here.
 * Phones keep only the two levels that change — site and unit — on a row of
 * their own, so the site name has room.
 */

import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { StationSelect, type StationSelection } from "./StationSelect";
import { UnitSelect } from "./UnitSelect";
import { useStation } from "@/lib/context/StationContext";
import { gatewayLabel } from "@/lib/api/overlay/stations";

export function HierarchyPath({
  value,
  onChange,
}: {
  value: StationSelection;
  onChange: (v: StationSelection) => void;
}) {
  const { station } = useStation();
  const group = value.mode === "group";
  const gatewayId = station?.gatewayId ?? "";

  const levels: { key: string; node: ReactNode; phone: boolean }[] = [];
  if (station?.organisation) {
    levels.push({
      key: "org", phone: false,
      node: <Level label="Organisation">{station.organisation}</Level>,
    });
  }
  levels.push({ key: "site", phone: true, node: <StationSelect value={value} onChange={onChange} /> });
  if (!group && gatewayId) {
    levels.push({
      key: "gateway", phone: false,
      node: (
        <Level label="Gateway" title={`Gateway ${gatewayId}`}>
          <span className="text-[11.5px]">{station?.gatewayName ?? gatewayLabel(gatewayId).replace(/^Gateway (?=[0-9a-f]{8}$)/, "")}</span>
        </Level>
      ),
    });
  }
  if (!group) levels.push({ key: "unit", phone: true, node: <UnitSelect /> });

  return (
    <nav aria-label="Location" className="flex items-center gap-1.5 min-w-0 w-full sm:w-auto">
      {levels.map((l, i) => (
        <Fragment key={l.key}>
          {i > 0 && (
            <ChevronRight
              size={13}
              aria-hidden
              /* On phones a separator shows only between two phone-visible levels. */
              className={`text-muted2 flex-none ${l.phone && levels.slice(0, i).some((p) => p.phone) ? "" : "hidden sm:block"}`}
            />
          )}
          <span className={`${l.phone ? "flex" : "hidden sm:flex"} items-center min-w-0 ${l.key === "site" ? "flex-1 sm:flex-none" : ""}`}>
            {l.node}
          </span>
        </Fragment>
      ))}
    </nav>
  );
}

function Level({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <span className="text-[12.5px] text-ink2 whitespace-nowrap" title={title ?? label} aria-label={label}>
      {children}
    </span>
  );
}
