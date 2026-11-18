/**
 * Which of a site's published assets are fitted devices — the registry's
 * presence rule (lib/devices/registry) over the newest rows, with stored
 * history as the look-back for the ones those rows cannot settle.
 *
 * The look-back is what keeps a fitted device that has gone quiet on screen
 * as Offline instead of dropping it: S2 holds minutes, and a meter silent for
 * an hour would otherwise read the same as one that was never fitted. Stored
 * history is best effort (lib/central/history) — with the collector off it
 * answers nothing, and only the newest rows decide.
 */

import { fetchHistory, type GeneralRecord } from "@/lib/central";
import { deviceType, kindOf, presenceOf, type PresenceRow } from "@/lib/devices/registry";

/** How far back a device that once talked still counts as fitted. */
const LOOKBACK_MS = 30 * 86_400_000;
/** One stored row per quarter hour is plenty to see a link that was up. */
const LOOKBACK_STEP_MS = 15 * 60_000;

async function talkedRecently(assetId: string): Promise<boolean> {
  const point = deviceType(kindOf(assetId)).linkPoint;
  if (!point) return false;
  const rows = await fetchHistory<GeneralRecord>("general", {
    fromMs: Date.now() - LOOKBACK_MS, pointId: point, assetId, stepMs: LOOKBACK_STEP_MS,
  });
  return rows.some((r) => r.asset_id === assetId && Number(r.value) === 1);
}

/** @param rowsByAsset every row read for each asset, link points included */
export async function installedAssets(rowsByAsset: Map<string, readonly PresenceRow[]>): Promise<Set<string>> {
  const out = new Set<string>();
  const unproven: string[] = [];
  for (const [assetId, rows] of rowsByAsset) {
    const p = presenceOf(rows);
    if (p === "installed") out.add(assetId);
    else if (p === "unproven") unproven.push(assetId);
  }
  const recent = await Promise.all(unproven.map((id) => talkedRecently(id).catch(() => false)));
  unproven.forEach((id, i) => { if (recent[i]) out.add(id); });
  return out;
}
