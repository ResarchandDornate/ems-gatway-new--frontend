/**
 * Devices, from the NorthBound EMS Gateway.
 *
 * A "device" here is a gateway *asset* — one of the nine kinds the gateway
 * polls behind a source: bms_1, pcs_1, ems_system, utility_meter,
 * liquid_cooling, fire_protection, dehumidifier, io_module, remote_control.
 *
 * That is a closer fit than what it replaced. A UGX device was a data logger
 * with a few hundred telemetry keys hanging off it, and the equipment pages had
 * to guess which physical thing each key belonged to; an asset *is* the
 * physical thing, and its signals are already scoped to it.
 */

import { getAssets } from "@/lib/gateway";
import type { Device } from "../types";

/** `external_ems_1_liquid_cooling` → `Liquid Cooling`. */
function label(assetId: string, sourceId: string): string {
  const base = assetId.startsWith(`${sourceId}_`) ? assetId.slice(sourceId.length + 1) : assetId;
  if (!base) return assetId;
  if (/^(bms|pcs|ems|io)(_|$)/.test(base)) {
    return base.replace(/_/g, " ").replace(/^\w+/, (w) => w.toUpperCase());
  }
  return base.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The asset kind, with any trailing index stripped: `bms_1` → `bms`. */
function kind(baseAssetId: string): string {
  return baseAssetId.replace(/_\d+$/, "");
}

export async function fetchDevices(sourceId: string): Promise<Device[]> {
  if (!sourceId) return [];

  /* Narrowed to the source at the gateway (`/api/sources/{id}/assets`) rather
     than listing all 18 and filtering here — one fewer round trip's worth of
     payload off a board whose cheapest reply is measured in seconds. */
  const r = await getAssets(sourceId);

  return (r.data.assets ?? []).map((a) => {
    const id = String(a.asset_id ?? "");
    const base = String(a.base_asset_id ?? id);
    return {
      id,
      name: a.display_name ? String(a.display_name) : label(id, sourceId),
      type: kind(base),
      /* The assets listing carries no liveness flag of its own. Rather than
         defaulting to a green "active", this reports what the gateway said:
         `online` when it says so, and inactive when it is silent. Per-asset
         communication status is a real reading and is on the Comm Status
         panel, which reads the status words each asset publishes. */
      active: a.online === true,
      status: a.online === true ? "active" : "inactive",
      ownerName: sourceId,
      customerId: sourceId,
      /* No device profiles and no versioning on a gateway. The base asset id
         is the nearest true equivalent of a profile — it is what decides which
         register map the asset is decoded with. */
      deviceProfileId: base,
      version: 0,
    } satisfies Device;
  });
}

export async function fetchDevice(sourceId: string, deviceId: string): Promise<Device | null> {
  const all = await fetchDevices(sourceId);
  return all.find((d) => d.id === deviceId) ?? null;
}
