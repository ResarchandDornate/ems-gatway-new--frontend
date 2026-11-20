/** T7: additive S2 point_id-primary reads.
 *
 * Resolves (substream, signal_key) to the canonical registry point_id (T2 CleanEdge 793 +
 * T3 Kalpa 2471) and, when enabled, attaches it to a backend telemetry query so the reads
 * resolve by point_id (backend T6). Unresolved signals and the disabled default keep pure
 * signal_key behavior — no point_ids are fabricated for unresolved CleanEdge signals. */
import { S2_POINT_IDS } from "./s2PointIds.ts";

/** Canonical registry point_id for an S2 (substream, signal_key), or null if unresolved. */
export function resolveS2PointId(substream: string, signalKey: string): string | null {
  return S2_POINT_IDS[substream]?.[signalKey] ?? null;
}

/** OFF by default. Enable (EMS_S2_POINT_ID_READS=1) only once the backend T6 is deployed and
 *  the gateway emits point_id tags (T1 verified) — until then point_id-filtered reads return
 *  empty, so flipping this on before deployment would blank live S2 panels. */
export function s2PointIdReadsEnabled(): boolean {
  return process.env.EMS_S2_POINT_ID_READS === "1";
}

/** Additive: when enabled AND the pair resolves, set point_id on the query (kept alongside
 *  signal_key so the backend cross-checks agreement and 409s on any mismatch instead of
 *  returning the wrong signal). No-op when disabled or unresolved. Returns the resolved
 *  point_id, or null. */
export function addS2PointId(qs: URLSearchParams, substream: string, signalKey: string): string | null {
  const pid = resolveS2PointId(substream, signalKey);
  if (pid && s2PointIdReadsEnabled()) qs.set("point_id", pid);
  return pid;
}
