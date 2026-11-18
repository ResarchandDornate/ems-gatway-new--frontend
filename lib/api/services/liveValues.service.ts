/**
 * liveValues.service.ts
 *
 * The latest value for a set of PlantKeys, from the gateway's telemetry
 * snapshot. Used by useLiveValues (30-second polling) to drive LivePlantView,
 * and by useBessLive to drive the dashboard SCADA view. READ-ONLY.
 *
 * One request per *source*, not one per device. On UGX a plant's keys were
 * spread across several data loggers and this fanned out a call per logger;
 * every signal on a gateway source arrives in one `/api/telemetry` response,
 * so a panel asking for forty keys costs exactly one round trip. That matters
 * here more than it did there — the board's cheapest measured reply is 2.5 s
 * and its worst fixed cost 20 s, and the whole request has 80 s before
 * Cloudflare gives up on it.
 *
 * No time window, and no staleness filter. The gateway returns what it last
 * decoded, and `leafValue` has already nulled anything whose quality was not
 * "good" — which is a better staleness signal than an age cutoff, because it
 * is the gateway's own judgement of the read rather than a guess from a
 * timestamp. A bounded window was previously used here and any device that had
 * not published inside it returned {} for every key, which callers turned into
 * fabricated placeholder readings.
 */

import { fetchSourceTelemetry } from "@/lib/gateway";
import { reportTelemetryTs } from "../../telemetryClock";
import { activeProfile, tagToMetric, type MetricId } from "../metrics";
import type { PlantKey } from "../types";

export type LiveValueMap = Record<string, number | null>;

/**
 * Pick the first non-null value whose key carries the given canonical metric,
 * however the firmware spells that key. Insertion order of `values` follows
 * request order, so earlier-requested spellings win.
 */
export function pickMetricValue(values: LiveValueMap, metric: MetricId): number | null {
  const profile = activeProfile();
  for (const [key, v] of Object.entries(values)) {
    if (v != null && tagToMetric(profile, key) === metric) return v;
  }
  return null;
}

export interface LiveValuesResult {
  /** Latest value per key. null = the gateway published no good read for it. */
  values: LiveValueMap;
  /** Newest telemetry timestamp (ms) across all keys, or null if unknown. */
  lastTs: number | null;
}

/** `external_ems_1_bms_1` → `external_ems_1`. */
function sourceOf(deviceId: string): string {
  const m = /^(external_ems_\d+)_/.exec(deviceId);
  return m ? m[1] : deviceId;
}

/** `external_ems_1_bms_1` → `bms_1`. */
function assetOf(deviceId: string): string {
  const src = sourceOf(deviceId);
  return deviceId.startsWith(`${src}_`) ? deviceId.slice(src.length + 1) : deviceId;
}

/**
 * Where in the snapshot one requested key lives.
 *
 * Two kinds of caller ask this function for readings and they name signals
 * differently:
 *
 *   getPlantKeyMap  walks the snapshot, so its PlantKeys carry a bare signal
 *                   name (`display_soc`) and the asset in `deviceId`
 *   useBessLive     asks the *profile* which tags carry a metric, so its keys
 *                   are full binding paths (`signals.bms_1.display_soc`) and
 *                   `deviceId` is whichever device the plant config named
 *
 * Only the first was handled. The second resolved `t.signals["bms_1"]
 * ["signals.bms_1.display_soc"]` — a signal name no gateway publishes — so
 * every metric the dashboard hero reads came back null and the cockpit showed
 * "NO DATA" over a plant that was answering. A binding path already states its
 * own asset, so it is read from the path rather than from the device id.
 */
function locate(deviceId: string, key: string): { asset: string; name: string } {
  const path = /^signals\.([^.]+)\.(.+)$/.exec(key);
  if (path) return { asset: path[1], name: path[2] };
  return { asset: assetOf(deviceId), name: key };
}

export async function fetchLiveValues(plantKeys: PlantKey[]): Promise<LiveValuesResult> {
  const realtimeKeys = plantKeys.filter((k) => k.isRealtime);
  if (!realtimeKeys.length) return { values: {}, lastTs: null };

  /* Grouped by source rather than by device: several assets share one snapshot,
     so grouping by device would fetch the same payload once per asset. */
  const bySource = new Map<string, PlantKey[]>();
  for (const pk of realtimeKeys) {
    const src = sourceOf(pk.deviceId);
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src)!.push(pk);
  }

  const values: LiveValueMap = {};

  await Promise.all(
    [...bySource.entries()].map(async ([sourceId, keys]) => {
      const t = await fetchSourceTelemetry(sourceId).catch(() => undefined);
      for (const pk of keys) {
        const at = locate(pk.deviceId, pk.key);
        const v = t?.signals[at.asset]?.[at.name];
        /* No scaling. The gateway decodes registers before publishing them —
           `phase_a_voltage` arrives as 228.6, not 2286 — so `pk.scale`, which
           the profile sets to 1 for every binding on this backend, is not
           applied. Multiplying by it would be harmless today and wrong the
           moment somebody adds a factor for a different gateway; the scale
           belongs where the raw value is, and here there is no raw value. */
        values[pk.key] = v ?? null;
      }
    }),
  );

  /* The flattened snapshot carries no per-point timestamp — `/api/telemetry`
     stamps the response, not the signal — so there is no reading time to
     report. Null rather than Date.now(): the header's "as of" label must date
     the data by when the plant spoke, and asserting that it spoke just now
     because this request just returned is exactly the false freshness this
     function was rewritten to stop claiming. The source's own last_seen_utc
     is the honest figure and is on the Comm Status panel. */
  const lastTs: number | null = null;
  reportTelemetryTs(lastTs);

  return { values, lastTs };
}
