/**
 * The device types a site can have, and how to tell whether one is there.
 *
 * There is no device endpoint. A site's devices are the distinct `asset_id`s
 * its gateway publishes on S2 — `external_ems_<n>_<kind>`, one set per
 * cabinet — and every screen that lists devices builds from that roster
 * (fetchCommStatus). This file is the one place that says what each `kind` is:
 * its name, the substream it publishes on, and the register that says whether
 * it is talking. Nothing here says which devices a site HAS; that is read.
 *
 * ── Published is not installed ──────────────────────────────────────────────
 *
 * The gateway publishes a row for every device slot its EMS is configured
 * with, fitted or not. Site 1 runs without a grid meter and still publishes
 * `external_ems_{1,2}_grid_meter` — 43 signals, every one 0.0, and its own
 * `communication_status` 0 (verified 26 Oct 2026). Listing that as a device
 * showed a permanent "Grid Meter · Offline" for hardware that does not exist.
 *
 * So a device counts as installed when:
 *
 *   · it has a reachability register of its own (LINK_SIGNALS) and that
 *     register has read 1 — it has talked at least once; or
 *   · it has such a register that has never read 1, but some other signal of
 *     its carries a non-zero value — it is there and its link bit is wrong; or
 *   · it has no reachability register at all, and publishes. Such a device
 *     cannot say it is absent: `remote_control` reads all zeros because no
 *     dispatch schedule is set, and it is still the plant's remote control.
 *
 * A fitted device that later goes quiet is still installed — it is Offline,
 * not gone. The newest rows cannot show that once the silence outlasts them,
 * so callers also look back through stored history (devicePresence.ts).
 *
 * ── Adding a device type ────────────────────────────────────────────────────
 *
 * A kind the gateway starts publishing appears on Communication Status by
 * itself, named from its id (deviceType's fallback). An entry here gives it a
 * proper name, lets Communication Status read its link by point, and — with
 * `summary` — a row on the dashboard's System Status card. No screen needs to
 * change.
 */

/** Signals by which a device reports its own link. 1 = talking. */
export const LINK_SIGNALS = ["communication_status", "online_points"] as const;

export interface DeviceType {
  /** The asset id's suffix: `external_ems_1_grid_meter` → `grid_meter`. */
  kind: string;
  /** The S2 substream the device publishes on. */
  substream: string;
  label: string;
  /** The device's own reachability point (LINK_SIGNALS), if it has one. */
  linkPoint?: string;
  /** An S1 flag that reports the link faster than the S2 point does. */
  fastLink?: string;
  /** Listed on the dashboard's System Status card, under this name. */
  summary?: string;
}

/**
 * In the order screens list them. Points from the gateway telemetry dictionary
 * (docs/power-station-api-mapping.md).
 */
export const DEVICE_TYPES: readonly DeviceType[] = [
  { kind: "pcs",             substream: "pcs_extended",    label: "PCS",             linkPoint: "p0154", fastLink: "pcs_online_status", summary: "PCS Online Status" },
  { kind: "bms",             substream: "bms_extended",    label: "BMS",             linkPoint: "p0364", fastLink: "bms_online_status", summary: "BMS Online Status" },
  { kind: "liquid_cooling",  substream: "liquid_cooling",  label: "Liquid Cooling",  linkPoint: "p1146", summary: "Liquid Cooling Status" },
  { kind: "grid_meter",      substream: "utility_meter",   label: "Grid Meter",      linkPoint: "p1354", summary: "Grid Meter Status" },
  { kind: "dehumidifier",    substream: "dehumidifier",    label: "Dehumidifier",    linkPoint: "p1282", summary: "Dehumidifier Status" },
  { kind: "fire_protection", substream: "fire_protection", label: "Fire Protection", linkPoint: "p1259" },
  { kind: "io_module",       substream: "io_module",       label: "IO Module",       linkPoint: "p1125" },
  { kind: "ems_system",      substream: "ems_system",      label: "EMS System" },
  { kind: "remote_control",  substream: "remote_control",  label: "Remote Control" },
  { kind: "solar_meter",     substream: "solar_meter",     label: "Solar Meter" },
  { kind: "load_meter",      substream: "load_meter",      label: "Load Meter" },
];

const BY_KIND = new Map(DEVICE_TYPES.map((t) => [t.kind, t]));
const ACRONYMS = new Set(["ems", "bms", "pcs", "io", "pv", "dg", "soc", "ac", "dc", "hw"]);

/** `liquid_cooling` → `Liquid Cooling`, `io_module` → `IO Module`. */
export function labelFromKind(kind: string): string {
  return kind.split("_").filter(Boolean).map((w) =>
    ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The registry entry for a kind — or a plain one for a kind it does not know. */
export function deviceType(kind: string): DeviceType {
  return BY_KIND.get(kind) ?? { kind, substream: kind, label: labelFromKind(kind) };
}

/** `external_ems_1_grid_meter` → `grid_meter`; an id of another shape is its own kind. */
export function kindOf(assetId: string): string {
  const ext = /^external_ems_\d+_(.+)$/.exec(assetId)?.[1];
  if (ext) return ext;
  // Kalpa SECURE meter assets carry an instance suffix: solar_meter_1 -> solar_meter.
  const meter = /^((?:solar|load)_meter)_\d+$/.exec(assetId)?.[1];
  return meter ?? assetId;
}

/** The link points of every type that has one — what reachability reads ask for. */
export const LINK_POINTS: readonly string[] = DEVICE_TYPES.flatMap((t) => (t.linkPoint ? [t.linkPoint] : []));

/** The dashboard's System Status rows, in order. */
export const SUMMARY_TYPES: readonly DeviceType[] = DEVICE_TYPES.filter((t) => t.summary);

/** One reading, as much of a row as the presence rule needs. */
export interface PresenceRow {
  signal?: string | null;
  value?: unknown;
}

const isLink = (r: PresenceRow) => (LINK_SIGNALS as readonly string[]).includes(r.signal ?? "");
const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));

export type Presence = "installed" | "absent" | "unproven";

/**
 * What one device's rows say about whether it is fitted (see the note above).
 * "unproven" — a link register that has never read 1 and nothing else alive:
 * absent, unless stored history shows it talking (devicePresence.ts).
 */
export function presenceOf(rows: readonly PresenceRow[]): Presence {
  if (rows.length === 0) return "absent";
  const link = rows.filter(isLink);
  if (link.length === 0) return "installed";
  if (link.some((r) => num(r.value) === 1)) return "installed";
  if (rows.some((r) => !isLink(r) && Number.isFinite(num(r.value)) && num(r.value) !== 0)) return "installed";
  return "unproven";
}
