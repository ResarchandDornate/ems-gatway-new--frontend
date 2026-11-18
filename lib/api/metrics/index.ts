/**
 * Metric binding layer — public surface.
 *
 * Usage:
 *   import { activeProfile, readMetric } from "@/lib/api/metrics";
 *   const soc = readMetric(activeProfile(), payload, "bank.soc", { bank: assetId });
 *   // soc.value is % regardless of backend; soc.status explains any null.
 *
 * Switching backends = NEXT_PUBLIC_TELEMETRY_PROFILE=kinetics. No UI changes.
 * Adding a backend = one new profile file registered below. No UI changes.
 */

export * from "./types";
export { METRICS, isMetricId, type MetricId } from "./registry";
export { readMetric, readMetricArray, readMetrics, auditProfile } from "./resolver";
export {
  matchTag, tagToMetric, scaleForTag, metricToTags, classifyTags, describeMetric,
  type TagMatch,
} from "./tagMap";
export { NORTHBOUND_PROFILE } from "./profiles/northbound.profile";
export { KINETICS_PROFILE } from "./profiles/kinetics.profile";

import type { Profile } from "./types";
import { NORTHBOUND_PROFILE } from "./profiles/northbound.profile";
import { KINETICS_PROFILE } from "./profiles/kinetics.profile";

export const PROFILES: Record<string, Profile> = {
  northbound: NORTHBOUND_PROFILE,
  kinetics: KINETICS_PROFILE,
};

/**
 * Profile selected by env, defaulting to the backend the app runs on.
 *
 * `ugx` is gone along with the backend it described. `kinetics` stays: it is
 * written against the Phase 1.6 register catalogue rather than against this
 * deployed build, and is what a gateway that publishes raw Modbus values —
 * with per-rack and per-cell detail — would be read through. It is not
 * reachable today and is kept because the catalogue it encodes is real work.
 */
export function activeProfile(): Profile {
  const id = process.env.NEXT_PUBLIC_TELEMETRY_PROFILE ?? "northbound";
  return PROFILES[id] ?? NORTHBOUND_PROFILE;
}
