"use client";

/**
 * CommStatus — device communication health.
 *
 * Restyled to the northbound-ems view language (KPI band + semantic table +
 * status pills). Data: useCommDevices → fetchCommStatus
 * (lib/api/services/powerStationCentral.service.ts).
 */

import { useCommDevices } from "@/hooks/usePowerStation";
import { LoadingState }   from "@/components/shared/LoadingState";
import { ErrorState }     from "@/components/shared/ErrorState";
import { EmptyState }     from "@/components/shared/EmptyState";


const PILL: Record<string, { cls: string; label: string }> = {
  online:   { cls: "green", label: "Online"   },
  /* Its data stopped arriving — the Communication Lost alarm's rule. */
  abnormal: { cls: "red",   label: "Communication Lost" },
  offline:  { cls: "red",   label: "Offline"  },
};

/* Related subsystems read as columns, not a row-major scatter: the pairs
   together, the banks together, the rest as auxiliary. First match wins, so a
   site without pairs or banks simply shows the Auxiliary column. */
const GROUP_DEFS: { title: string; match: (d: { name: string }) => boolean }[] = [
  { title: "Power Pairs", match: (d) => /^pair\b/i.test(d.name) },
  { title: "BMS Banks",   match: (d) => /^bms\s*bank/i.test(d.name) },
  { title: "Auxiliary",   match: () => true },
];

/* ── Subsystem reachability ────────────────────────────────────────────────
   The eight subsystems an operator checks per device, plus the device's own
   link at the top.

   `register` is the Modbus point that backs each row, read off the Northbound
   gateway telemetry dictionary (2026-08-10 handover). It is no longer carried as
   documentation: each row's `read` names the asset and signal, and the state is
   the value the gateway returned for it on this request. The rows used to hold
   literal states — three "online", one "offline" — which rendered identically to
   these and were true of nothing.

/* The subsystem table that stood here is gone.

   It addressed registers by the NorthBound base-asset names — pcs_1.
   bms_online_status, utility_meter.communication_status — against a backend
   that names those assets external_ems_1_pcs and external_ems_1_grid_meter,
   so every lookup missed and all eight rows read "No register" inside all
   eighteen cards. It also read useEquipmentReadings, which resolves through
   the disabled NorthBound seam and rejects.

   The registers themselves survived the move and are listed in
   docs/power-station-api-mapping.md; most are now on ems_system (p0038
   grid_meter_communication_status, p0066 fire_protection_...). What changed
   is that an asset on this backend IS a subsystem, so nesting a station-wide
   list beneath each one was saying the same eight things eighteen times. */

export function CommStatus({ stationId }: { stationId: string }) {
  const { data, isLoading, isError, refetch } = useCommDevices(stationId);

  if (isLoading) return <LoadingState rows={6} />;
  if (isError)   return <ErrorState onRetry={() => refetch()} />;

  const devices = data ?? [];
  const online   = devices.filter((d) => d.status === "online").length;
  const abnormal = devices.filter((d) => d.status === "abnormal").length;
  const offline  = devices.filter((d) => d.status === "offline").length;
  const groups = GROUP_DEFS
    .map((g) => ({ title: g.title, devices: devices.filter((d) => GROUP_DEFS.find((x) => x.match(d)) === g) }))
    .filter((g) => g.devices.length > 0);

  return (
    <div className="view-stack">
      <div className="kpi-band">
        <div className="kpi">
          <div className="k">Online</div>
          <div className={`v ${devices.length && online === devices.length ? "good" : ""}`}>{online}</div>
          <div className="s">Responding</div>
        </div>
        <div className="kpi">
          <div className="k">Communication Lost</div>
          <div className={`v ${abnormal ? "warn" : ""}`}>{abnormal}</div>
          <div className="s">No Data Arriving</div>
        </div>
        <div className="kpi">
          <div className="k">Offline</div>
          <div className="v">{offline}</div>
          <div className="s">Not Reporting</div>
        </div>
        <div className="kpi">
          <div className="k">Total Devices</div>
          <div className="v">{devices.length}</div>
          <div className="s">On This Station</div>
        </div>
      </div>

      {/* The device communication table stood here — device, IP, port, profile,
          last seen, status. Removed: every device now leads its own card below,
          so the status column was saying twice what the card headers say, and the
          rest was connection plumbing rather than plant health. `timeSince` went
          with it; git history has both if the detail is wanted back. */}

      {/*
        A card per device, each opening with the device's own link and listing its
        subsystems beneath a rule.

        This replaced a subsystems-down / devices-across matrix. The matrix was
        the better shape for comparing one subsystem across many devices; a card
        is the better shape for the question actually asked in front of a cabinet
        — "what is wrong with THIS unit" — because everything about one device
        stays inside one border instead of being read across a row. It also stops
        the layout widening with each device added: cards wrap, columns do not.

        The register behind each row is on the row's `title` rather than in a
        column of its own. It matters when someone is wiring this up and never
        while someone is reading it.
      */}
      <div className="sub-panel">
        <div className="sub-panel-head">
          <h3>Subsystem Status</h3>
        </div>

        {devices.length === 0 ? (
          <EmptyState title="No Devices" description="The gateway reported no assets for this source." />
        ) : (
          <div style={{
            display: "grid", gap: "var(--gap)", alignItems: "start",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          }}>
            {groups.map((g) => (
              <div key={g.title}>
                {/* The series heading, so a column reads as one group of kit. */}
                <div style={{
                  fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                  color: "var(--muted)", margin: "2px 0 8px 2px",
                }}>
                  {g.title} <span style={{ fontWeight: 400, color: "var(--line2)" }}>· {g.devices.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>
                  {g.devices.map((dev) => {
                    const link = PILL[dev.status] ?? PILL.offline;
                    return (
                      <div key={dev.id} className="surface-card" style={{ padding: "var(--pad-sm) var(--pad)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <span title={dev.name} style={{
                            minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {dev.name}
                          </span>
                          <span className={`pill ${link.cls}`} style={{ flex: "0 0 auto" }}>
                            <span className="dot" /> {link.label}
                          </span>
                        </div>
                        {Number.isFinite(Date.parse(dev.lastSeen)) && (
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                            Captured {new Date(dev.lastSeen).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

    </div>
  );
}
