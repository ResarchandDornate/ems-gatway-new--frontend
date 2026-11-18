"use client";

/**
 * Communication health per asset, from the central backend.
 *
 * ── Where the device list comes from ───────────────────────────────────────
 *
 * There is no device endpoint. The list is the distinct `asset_id` values S2
 * reports — nine per source, eighteen on the commissioned site, the same set
 * `health.sources[].asset_count` counts — less the slots with no device
 * fitted behind them (lib/devices/registry: the presence rule).
 *
 * ── How status is decided, and why the polarity is not a guess ─────────────
 *
 * Three assets publish a `communication_status` register of their own, and its
 * meaning is settled by cross-checking it against whether the asset's other
 * signals carry data:
 *
 *   fire_protection  communication_status = 1  → its measurements are live
 *   io_module        communication_status = 1  → its measurements are live
 *   grid_meter       communication_status = 0  → all 43 measurements are 0.0
 *
 * and the EMS controller publishes its own view of two of them, which agrees:
 * `fire_protection_communication_status = 1`, `grid_meter_communication_status
 * = 0`. Two independent registers saying the meter is silent, and a meter
 * reading 0 V on all three phases, is not a coincidence. **1 means talking.**
 *
 * `pcs_communication_status_word` is NOT used: it reads 52038 and 63694 on the
 * two cabinets, so it is a bitfield rather than a flag, and treating it as a
 * boolean would report the PCS by whichever bit happened to land in the
 * low position.
 *
 * Four more publish an `online_points` register (1 = online) — bms p0364,
 * pcs p0154, liquid_cooling p1146, dehumidifier p1282. bms_extended overflows
 * a substream read, so these are point reads.
 *
 * An online asset is `abnormal` when its source reports bad signals or its
 * newest S2 row is more than five minutes old (remote_control excepted: it
 * publishes only when a schedule changes).
 *
 * Assets without a register of their own fall back to their source's `online`.
 * They are not marked offline for having all-zero readings — `remote_control`
 * is entirely zero because no dispatch schedule is set, which is a silent
 * device saying nothing rather than a broken one.
 */

import { fetchCommStatus } from "./powerStationCentral.service";
import type { Device } from "../types";

/* The roster itself — which assets are fitted devices, and each one's link —
   is fetchCommStatus's (powerStationCentral.service), the one Communication
   Status and the topology strip read. This file used to build a second copy
   of it, which drifted: it listed every published slot, unfitted ones too. */

/**
 * The same roster as the Device List screen wants.
 *
 * `Device` carries UGX-era fields — an owner, a customer UUID, a device
 * profile, a version — that this backend has no equivalent for. They are
 * filled with the honest nearest thing rather than invented: the site is the
 * owner, the substream is the profile, and the version is 0 because nothing
 * publishes one. What the screen actually reads — name, type, active — is real.
 */
export async function fetchDevices(gatewayId: string): Promise<Device[]> {
  const rows = await fetchCommStatus(gatewayId);
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.protocol ?? "—",
    active: d.status !== "offline",
    status: d.status !== "offline" ? "active" : "inactive",
    ownerName: gatewayId,
    customerId: gatewayId,
    deviceProfileId: d.protocol ?? "",
    version: 0,
  }));
}
