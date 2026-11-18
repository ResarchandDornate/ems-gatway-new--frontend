"use client";

import { useState, useMemo } from "react";
import { Wifi, WifiOff, Search, RefreshCw, ChevronRight } from "lucide-react";
import { useDevices } from "@/hooks/useDevices";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState }   from "@/components/shared/ErrorState";
import { DeviceDetailPanel } from "./DeviceDetailPanel";
import { deviceLabel, deviceTitle, isRenamed } from "@/lib/deviceNames";
import type { Device } from "@/lib/api/types";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono tracking-[1.2px] bg-good/10 text-good">
      <Wifi size={11} />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono tracking-[1.2px] bg-bad/10 text-bad">
      <WifiOff size={11} />
      Inactive
    </span>
  );
}

// ── Summary pills ─────────────────────────────────────────────────────────────

function SummaryPills({ devices }: { devices: Device[] }) {
  const total    = devices.length;
  const active   = devices.filter((d) => d.active).length;
  const inactive = total - active;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[11px] font-mono tracking-[1.4px] text-muted">
        {total} Device{total !== 1 ? "s" : ""}
      </span>
      <span className="w-px h-3 bg-line" />
      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-good">
        <Wifi size={11} /> {active} Active
      </span>
      {inactive > 0 && (
        <>
          <span className="w-px h-3 bg-line" />
          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-bad">
            <WifiOff size={11} /> {inactive} Inactive
          </span>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface DeviceListViewProps {
  stationId: string;
}

export function DeviceListView({ stationId }: DeviceListViewProps) {
  const { data: devices, isLoading, isError, error, refetch, isFetching } =
    useDevices(stationId);

  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [search, setSearch]         = useState("");
  const [statusFilter, setStatus]   = useState<"all" | "active" | "inactive">("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // When station changes, clear device selection
  useMemo(() => { setSelectedDevice(null); }, [stationId]);

  const deviceTypes = useMemo(() => {
    if (!devices) return [];
    return Array.from(new Set(devices.map((d) => d.type))).sort();
  }, [devices]);

  const filtered = useMemo(() => {
    if (!devices) return [];
    return devices.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (typeFilter !== "all" && d.type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          d.name.toLowerCase().includes(q) ||
          // Searchable by the shown name too, or a renamed device is
          // unfindable by the only name the operator can see.
          deviceLabel(d.name).toLowerCase().includes(q) ||
          d.type.toLowerCase().includes(q) ||
          d.ownerName.toLowerCase().includes(q) ||
          d.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [devices, search, statusFilter, typeFilter]);

  /* If a device is selected, show its detail panel. After every hook above,
     not before them: returning early here used to skip the two useMemos, and
     React throws on a render with fewer hooks than the last one. */
  if (selectedDevice) {
    return (
      <DeviceDetailPanel
        device={selectedDevice}
        onBack={() => setSelectedDevice(null)}
      />
    );
  }

  if (isLoading) return <div className="surface-card p-5"><LoadingState rows={5} /></div>;
  if (isError)   return <div className="surface-card p-5"><ErrorState message={String(error)} /></div>;
  if (!devices || devices.length === 0) {
    return (
      <div className="surface-card p-5 text-center text-[13px] text-muted">
        No Devices Found For This Station
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Toolbar */}
      <div className="surface-card p-4 flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search By Name, Type, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="filter-input w-full pl-7"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatus(e.target.value as typeof statusFilter)}
          className="filter-input w-auto"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        {/* Type filter */}
        {deviceTypes.length > 1 && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="filter-input w-auto max-w-[260px] truncate"
          >
            <option value="all">All Types</option>
            {deviceTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}

        {/* Spacer + summary + refresh */}
        <div className="ml-auto flex items-center gap-3">
          <SummaryPills devices={devices} />
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface2 transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-muted font-mono tracking-[1.4px] bg-surface2/30 border-b border-line">
                <th className="px-5 py-3 font-semibold w-[160px]">Device Name</th>
                <th className="px-4 py-3 font-semibold">Type / Profile</th>
                <th className="px-4 py-3 font-semibold w-[110px]">Status</th>
                <th className="px-4 py-3 font-semibold">Owner</th>
                <th className="px-4 py-3 font-semibold w-[60px] text-center">Ver.</th>
                <th className="px-5 py-3 font-semibold text-muted2">Device UUID</th>
                <th className="px-4 py-3 w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted text-[12px]">
                    No Devices Match The Current Filters
                  </td>
                </tr>
              ) : (
                filtered.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedDevice(d)}
                    className={[
                      "border-t border-line hover:bg-accent/5 cursor-pointer transition-colors group",
                      !d.active ? "opacity-70" : "",
                    ].join(" ")}
                  >
                    {/* Name */}
                    <td className="px-5 py-3 font-mono font-semibold text-ink text-[12px]">
                      <span title={deviceTitle(d.name)}>{deviceLabel(d.name)}</span>
                      {isRenamed(d.name) && (
                        <span className="block text-[10px] font-normal text-muted2">{d.name}</span>
                      )}
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3 text-ink2 max-w-[280px]">
                      <span className="truncate block">{d.type}</span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge active={d.active} />
                    </td>

                    {/* Owner — the cabinet (EMS source) the asset sits behind, read
                        off its id. The service fills ownerName with the gateway
                        UUID, identical on all eighteen rows, which told the
                        operator nothing. */}
                    <td className="px-4 py-3 text-ink3">
                      {/^(external_ems_\d+)_/.exec(d.id)?.[1] ?? (d.ownerName || <span className="text-muted2 italic">—</span>)}
                    </td>

                    {/* Version — nothing on this backend publishes one; the
                        service's 0 is a filler, not a firmware version. */}
                    <td className="px-4 py-3 text-center font-mono text-muted text-[11px]">
                      {d.version ? d.version : "—"}
                    </td>

                    {/* UUID */}
                    <td className="px-5 py-3">
                      <code className="text-[10.5px] font-mono text-muted2 bg-surface2/40 px-1.5 py-0.5 rounded select-all">
                        {d.id}
                      </code>
                    </td>

                    {/* Chevron */}
                    <td className="px-4 py-3 text-right">
                      <ChevronRight size={13} className="text-muted group-hover:text-accent transition-colors" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer count */}
        {filtered.length > 0 && filtered.length !== devices.length && (
          <div className="px-5 py-2.5 border-t border-line text-[10.5px] text-muted font-mono">
            Showing {filtered.length} Of {devices.length} Devices
          </div>
        )}
      </div>
    </div>
  );
}
