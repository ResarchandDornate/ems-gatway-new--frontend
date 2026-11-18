"use client";

/**
 * A source's full telemetry snapshot, rebuilt from the central backend.
 *
 * This is the shape `lib/gateway`'s `fetchSourceTelemetry` used to return, and
 * it is reproduced exactly rather than improved on: the Equipment screens read
 * through `equipmentReadings.service.ts`, which is 400 lines of careful
 * signal-by-signal mapping with a fault-bit heuristic worth keeping. Matching
 * its input contract wires five views by changing one function.
 *
 * ── Base asset names ───────────────────────────────────────────────────────
 *
 * The readers address assets as `pcs_1`, `bms_1`, `utility_meter` — the
 * NorthBound dictionary's names. S2 reports `external_ems_1_pcs`,
 * `external_ems_1_bms`, `external_ems_1_grid_meter`. The mapping is
 * mechanical, and three of them are not identity:
 *
 *   pcs         → pcs_1
 *   bms         → bms_1
 *   grid_meter  → utility_meter
 *
 * Getting this wrong is silent: every lookup misses, every figure renders as a
 * dash, and the screen looks like a plant with nothing connected rather than a
 * mapping bug. That is exactly what the Communication Status subsystem table
 * did before it was removed.
 *
 * ── Why S1 is merged in on top ─────────────────────────────────────────────
 *
 * S2 carries the full dictionary at the snapshot cadence; S1 carries 63 of
 * those signals at 1 Hz. Where both have a signal, S1's is newer, so it wins.
 * The PCS and BMS readings on screen are the ones an operator watches move.
 *
 * ── Units come from the backend ────────────────────────────────────────────
 *
 * S2 states a unit per point. They are carried, never inferred from the signal
 * name — a guess that agrees with the dictionary most of the time still
 * mislabels an axis now and then, and the old UGX client did exactly that.
 */

import { fetchGeneral, fetchFastBess, SUBSTREAMS, type GeneralRecord } from "@/lib/central";

export type SignalMap = Record<string, Record<string, number | null>>;
export type UnitMap = Record<string, Record<string, string>>;

export interface SourceTelemetry {
  /** Base asset ids this snapshot actually contained, so absence can be stated. */
  assets: string[];
  signals: SignalMap;
  units: UnitMap;
  /** S2 alone, before S1 is laid on top, and each value's sample time (ms).
   *  For screens that must show one instant rather than the freshest of each. */
  snapshot?: SignalMap;
  snapshotTimes?: Record<string, Record<string, number>>;
  /** The fast stream's sample time (epoch ms) — its PCS and BMS values are this fresh. */
  fastTs?: number;
  /** The cabinet's bess_id on S1, when S1 had a sample for this source. */
  bessId?: string;
}

/** `external_ems_1_grid_meter` → `utility_meter`, for the given source. */
function baseAsset(assetId: string, sourceId: string): string | null {
  const prefix = `${sourceId}_`;
  if (!assetId.startsWith(prefix)) return null;
  const tail = assetId.slice(prefix.length);
  if (tail === "pcs") return "pcs_1";
  if (tail === "bms") return "bms_1";
  if (tail === "grid_meter") return "utility_meter";
  return tail;
}

export async function fetchSourceTelemetry(
  gatewayId: string,
  sourceId: string,
): Promise<SourceTelemetry> {
  if (!gatewayId || !sourceId) return { assets: [], signals: {}, units: {} };

  const [perSubstream, fast] = await Promise.all([
    Promise.all(
      SUBSTREAMS.map((ss) =>
        fetchGeneral(gatewayId, { substream: ss, limit: 1000 }).catch(() => [] as GeneralRecord[]),
      ),
    ),
    fetchFastBess(gatewayId, { limit: 20 }).catch(() => []),
  ]);

  const signals: SignalMap = {};
  const units: UnitMap = {};
  const times: Record<string, Record<string, number>> = {};

  /* Rows arrive newest first, so the first sighting of an (asset, signal) pair
     is its current value and later ones are history. */
  const seen = new Set<string>();
  for (const r of perSubstream.flat()) {
    if (!r.asset_id || !r.signal) continue;
    const asset = baseAsset(r.asset_id, sourceId);
    if (!asset) continue;                       // a different cabinet
    const key = `${asset}.${r.signal}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const n = r.value == null ? null : Number(r.value);
    (signals[asset] ??= {})[r.signal] = n !== null && Number.isFinite(n) ? n : null;
    if (r.unit) (units[asset] ??= {})[r.signal] = r.unit;
    const ts = Date.parse(r.sample_time_utc ?? "");
    if (!Number.isNaN(ts)) (times[asset] ??= {})[r.signal] = ts;
  }
  const snapshot: SignalMap = Object.fromEntries(Object.entries(signals).map(([a, m]) => [a, { ...m }]));

  /* S1 on top: same signals, one-second old instead of a snapshot old. */
  const s1 = fast.find((s) => s.source_id === sourceId);
  if (s1) {
    for (const [asset, group] of [["pcs_1", s1.data?.pcs_values], ["bms_1", s1.data?.bms_values]] as const) {
      for (const [name, v] of Object.entries(group ?? {})) {
        /* A true/false flag is the 1/0 register the readers expect; null stays
           null (unknown is not "off"). */
        (signals[asset] ??= {})[name] =
          typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" && Number.isFinite(v) ? v : null;
      }
    }
  }

  const fastTs = Date.parse(s1?.sample_time_utc ?? "");
  return {
    assets: Object.keys(signals).sort(), signals, units, snapshot, snapshotTimes: times,
    bessId: s1?.bess_id || undefined, fastTs: Number.isNaN(fastTs) ? undefined : fastTs,
  };
}

/** The unit the backend states for a signal, or "" when it states none. */
export const unitOf = (t: SourceTelemetry | undefined, asset: string, name: string): string =>
  t?.units[asset]?.[name] ?? "";
