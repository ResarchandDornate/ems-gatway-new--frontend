"use client";

import type { StationSelection } from "./StationSelect";
import { HierarchyPath } from "./HierarchyPath";
import { useEffect, useState } from "react";
import { useSiteFreshness } from "@/hooks/useSiteFreshness";

export function SubHeader({
  value,
  onChange,
}: {
  value: StationSelection;
  onChange: (v: StationSelection) => void;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const date = now?.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata",
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  }) ?? "";
  const time = now?.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }) ?? "";

  /* The badge and "Data updated" describe the SITE — see useSiteFreshness. */
  const freshness = useSiteFreshness();
  const lastReadingAt = freshness.lastReadingAt;
  const updatedAt = lastReadingAt != null
    ? new Date(lastReadingAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
        day: "2-digit", month: "short",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      })
    : "—";

  return (
    // relative + z-index makes this a stacking context, which traps the station
    // dropdown's z-50 inside it — so the bar itself has to be lifted above the
    // page content. Sits just under the TopBar's z-40.
    <div className="relative z-30 bg-surface2 border-b border-line">
      <div className="app-shell min-h-10 py-1 flex items-center gap-x-3 gap-y-2 flex-wrap">
        {/* Live / Delayed badge removed from the station bar.
        <div
          className="flex items-center gap-2 h-7 px-2.5 rounded-full border border-line bg-surface2"
          title={freshness.title}
        >
          <span
            className="relative inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: freshness.color, boxShadow: `0 0 0 3px ${freshness.color}26` }}
          />
          <span className="text-[11px] text-ink3 font-semibold">{freshness.label}</span>
        </div>
        <div className="hidden sm:block w-px h-5 bg-line" />
        */}
        <HierarchyPath value={value} onChange={onChange} />
        {/* Clock on top, the site's last reading directly beneath it. */}
        <div className="ml-auto flex flex-col items-end leading-tight">
          <div className="flex items-center gap-3 text-[12px] tabular-nums">
            <span className="text-ink2">{time}</span>
            {/* Date only where the row has room: at laptop widths it pushed the
                clock onto a second line and the bar doubled in height. */}
            <span className="text-muted hidden xl:inline">{date}</span>
            <span className="text-muted2">IST</span>
          </div>
          {/* Label and value wrap as one unit, never split across rows. */}
          <span className="flex items-baseline gap-2 whitespace-nowrap">
          <span
            className="card-eyebrow hidden md:inline"
            title="When the site last sent a reading. The badge on the left says whether it is live."
          >
            Data Updated
          </span>
          <span
            className="text-[12px] tabular-nums"
            style={{ color: freshness.label === "Live" ? "rgb(var(--color-ink2))" : freshness.color }}
            title={
              lastReadingAt == null
                ? "No device reading received yet"
                : `Device last published at ${new Date(lastReadingAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
            }
          >
            {updatedAt}
          </span>
          </span>
        </div>
      </div>
    </div>
  );
}
