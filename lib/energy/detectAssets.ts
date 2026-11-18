/**
 * Which assets a site has, read from what its gateway publishes.
 *
 * An asset counts as present when a device FITTED behind its stream has
 * published — the presence rule in lib/devices/registry — not when it is
 * reporting right now. A fitted meter that goes quiet keeps the grid on the
 * diagram (its link was up once; stored history remembers it for 30 days),
 * because a diagram that dropped the grid every time a meter went quiet would
 * be wrong exactly when an operator most needs it. A slot published with no
 * device behind it does not count: Site 1's gateway publishes a grid_meter
 * that reads all zeros with its link never up, and the site has no meter.
 *
 * What the central backend is known to carry (verified 29 Sep 2026 on Site 1):
 *   utility_meter              → grid (published on Site 1, but no meter fitted)
 *   pcs_extended, bms_extended → BESS (also fast-bess bess_1 / bess_2)
 *   ems_system, liquid_cooling, fire_protection, dehumidifier, io_module,
 *   remote_control             → auxiliaries, not drawn
 *
 * PV and DG: no site publishing them has been seen yet, and the backend returns
 * an empty list for ANY substream name rather than rejecting unknown ones, so
 * their names cannot be discovered by probing. The names below are the likely
 * ones and are provisional — correct PROBES when a PV or DG site is connected.
 *
 * Load: a site's load is usually derived from the grid meter, not metered on
 * its own. It is assumed present unless a site says otherwise (the
 * BESS · PV · Grid configuration has none) — set `assets` in the site overlay
 * for those. A dedicated load meter, where there is one, confirms it.
 */

import { fetchGeneral, type GeneralRecord } from "@/lib/central";
import { installedAssets } from "@/lib/api/services/devicePresence";
import { DEVICE_TYPES } from "@/lib/devices/registry";
import type { SiteAsset } from "./topology";

/** Substreams whose presence proves an asset. First match wins. */
const PROBES: Record<Exclude<SiteAsset, "load">, string[]> & { load: string[] } = {
  grid: ["utility_meter"],
  bess: ["pcs_extended", "bms_extended"],
  pv:   ["pv_inverter", "solar", "pv"],               // provisional names
  dg:   ["genset", "diesel_generator", "dg"],         // provisional names
  load: ["load_meter"],                               // provisional name
};

export interface DetectedAssets {
  assets: SiteAsset[];
  /** For each asset, the substream that proved it — or why it is included. */
  evidence: Partial<Record<SiteAsset, string>>;
}

/** Rows per signal and device are what the presence rule weighs, so one row is
 *  not enough: a meter's link register has to be among them. */
const PROBE_ROWS = 200;

/** Whether a fitted device publishes on the substream. The link registers are
 *  read by point as well, as the roster does: a substream window can miss them,
 *  and without one a slot would pass for a device that has no link to report. */
async function hasFittedDevice(gatewayId: string, substream: string): Promise<boolean> {
  const links = DEVICE_TYPES.filter((t) => t.substream === substream && t.linkPoint).map((t) => t.linkPoint!);
  const [rows, linkRows] = await Promise.all([
    fetchGeneral(gatewayId, { substream, limit: PROBE_ROWS }),
    Promise.all(links.map((pointId) => fetchGeneral(gatewayId, { pointId, limit: 20 }).catch(() => [] as GeneralRecord[]))),
  ]);
  if (rows.length === 0) return false;
  const byAsset = new Map<string, GeneralRecord[]>();
  for (const r of [...rows, ...linkRows.flat()]) if (r.asset_id) (byAsset.get(r.asset_id) ?? byAsset.set(r.asset_id, []).get(r.asset_id)!).push(r);
  return (await installedAssets(byAsset)).size > 0;
}

export async function detectSiteAssets(gatewayId: string): Promise<DetectedAssets> {
  const evidence: DetectedAssets["evidence"] = {};

  await Promise.all(
    (Object.keys(PROBES) as SiteAsset[]).map(async (asset) => {
      for (const s of PROBES[asset]) {
        if (await hasFittedDevice(gatewayId, s)) {
          evidence[asset] = s;
          return;
        }
      }
    }),
  );

  // Load is assumed unless something says otherwise — see the note above.
  if (!evidence.load) evidence.load = "assumed (no load meter)";

  const order: SiteAsset[] = ["load", "bess", "pv", "grid", "dg"];
  return { assets: order.filter((a) => evidence[a]), evidence };
}
