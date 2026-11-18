/**
 * Telemetry freshness.
 *
 * The distinction this module exists to keep straight:
 *
 *   API sync age  — when the browser last got a response from UGX.
 *   Telemetry age — when the DEVICE last published the reading being displayed.
 *
 * These are unrelated. UGX answers `limit=1` queries with the most recent
 * stored point regardless of how old it is, so a machine that stopped
 * publishing days ago still returns a full set of plausible values on every
 * poll. Judging "is this live?" by the API response is how a dead device ends
 * up rendered as a healthy one behind a green LIVE badge.
 *
 * Anything showing a device reading should age it with the helpers here.
 */

/**
 * How old a reading may be before the UI stops presenting it as current.
 *
 * Equipment telemetry publishes on a ~30 s cadence, so five minutes is roughly
 * ten missed publishes — comfortably past jitter, well short of "nobody would
 * notice".
 */
export const TELEMETRY_STALE_AFTER_MS = 5 * 60_000;

export type TelemetryState = "live" | "stale" | "none";

export interface TelemetryFreshness {
  state: TelemetryState;
  /** Age of the reading in ms, or null when the device has never published. */
  ageMs: number | null;
  /** Short human age, e.g. "42s", "6m", "3h", "2d". Empty when unknown. */
  age: string;
  /** Ready-to-render summary, e.g. "Last reading 3d ago". */
  label: string;
}

/** "42s" · "6m" · "3h" · "2d" — one unit, no decimals; precision is not the point. */
export function formatAge(ms: number): string {
  if (ms < 0) return "0s";
  if (ms < 60_000)     return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

/**
 * Describe how current a device reading is.
 *
 * `now` is passed in rather than read from the clock so callers control when
 * time is sampled — reading Date.now() during render would desync server and
 * client markup. Pass null before the client has a clock; the result is the
 * same "unknown" shape as a device that never published, which renders
 * identically and therefore never flashes a wrong state on hydration.
 */
export function describeTelemetry(
  ts: number | null | undefined,
  now: number | null,
): TelemetryFreshness {
  if (ts == null || now == null) {
    return { state: "none", ageMs: null, age: "", label: "No reading" };
  }

  const ageMs = Math.max(0, now - ts);
  const age = formatAge(ageMs);

  return ageMs <= TELEMETRY_STALE_AFTER_MS
    ? { state: "live",  ageMs, age, label: `Updated ${age} ago` }
    : { state: "stale", ageMs, age, label: `Last reading ${age} ago` };
}

/**
 * True when a reading is too old to be presented as the current state of the
 * plant. Distinct from "missing": stale data is real, just historical.
 */
export function isTelemetryStale(
  ts: number | null | undefined,
  now: number | null,
): boolean {
  return describeTelemetry(ts, now).state === "stale";
}
