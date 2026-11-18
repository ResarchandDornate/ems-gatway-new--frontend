"use client";

import { ChevronDown, Building2, Layers } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useStations } from "@/hooks/useStations";

export type StationSelection =
  | { mode: "group" }
  | { mode: "station"; id: string };

export function StationSelect({
  value,
  onChange,
}: {
  value: StationSelection;
  onChange: (v: StationSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: stations = [] } = useStations();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const label =
    value.mode === "group"
      ? "Group Screen · Portfolio Aggregate"
      : stations.find((s) => s.id === value.id)?.powerStationEnglishName ?? "";

  return (
    <div className="relative min-w-0 w-full sm:w-auto" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 px-3 h-8 bg-surface2 border border-line rounded-ctl text-[12.5px] font-medium text-ink hover:border-line2 hover:bg-surface3 transition-all w-full sm:w-auto sm:min-w-[200px] sm:max-w-[300px]"
      >
        {value.mode === "group" ? (
          <Layers size={14} className="text-accent" />
        ) : (
          <Building2 size={14} className="text-accent" />
        )}
        <span className="flex-1 min-w-0 truncate text-left">{label}</span>
        <ChevronDown size={14} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-[min(440px,calc(100vw-20px))] bg-surface2 border border-line2 rounded-panel shadow-pop overflow-hidden z-50 animate-fade-in">
          <button
            onClick={() => { onChange({ mode: "group" }); setOpen(false); }}
            className={[
              // Surface token, not white/[.03] — a white overlay leaves no
              // visible hover on the light theme's white menu.
              "w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface3 transition-colors",
              value.mode === "group" ? "bg-accent/[.08]" : "",
            ].join(" ")}
          >
            <div className="w-8 h-8 rounded-ctl bg-surface3 border border-line grid place-items-center">
              <Layers size={14} className="text-accent" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-ink">Group Screen</div>
              <div className="text-[11.5px] text-muted">Portfolio Aggregate · {stations.length} Station{stations.length !== 1 ? "s" : ""}</div>
            </div>
          </button>
          <div className="border-t border-line" />
          <div className="py-1 max-h-[360px] overflow-y-auto">
            {stations.map((s) => {
              const isActive = value.mode === "station" && value.id === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => { onChange({ mode: "station", id: s.id }); setOpen(false); }}
                  className={[
                    "w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-surface3 transition-colors",
                    isActive ? "bg-accent/[.08]" : "",
                  ].join(" ")}
                >
                  <div className="w-8 h-8 rounded-ctl bg-surface3 border border-line grid place-items-center">
                    <Building2 size={14} className="text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink truncate">{s.powerStationEnglishName}</div>
                    <div className="text-[11.5px] text-muted truncate">{s.stationLocation}</div>
                  </div>
                  {/* Rated capacity is a commissioning fact (overlay), not
                      telemetry; the overlay leaves it 0 until it is written
                      down, and "0 kWh" would read as a measurement. */}
                  <div className="text-[10.5px] font-mono text-muted2 tracking-wider">
                    {s.installedCapacity > 0 ? `${s.installedCapacity.toLocaleString("en-IN")} kWh` : "— kWh"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
