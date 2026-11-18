"use client";

/**
 * Don't ask the gateway for the next reading faster than it can answer.
 *
 * Every poll interval in this app was chosen for a board that answers in well
 * under a second, and that board no longer exists. Measured against the
 * commissioned gateway on 7 September 2026, every one of these is the time to
 * return a bare **401** — no token, so no database read and no password
 * hashing, which makes it pure per-request overhead:
 *
 *     /api/health              18.7 s
 *     /api/sources/summary     23.8 s
 *     /api/telemetry           27.9 s
 *     /api/fast-bess/latest    36.1 s
 *
 * Against LATEST_MS of 5 s. The app was asking for a new reading roughly seven
 * times before the previous request had come back, and an authenticated call —
 * one that actually reads the historian — costs more than the 401 does.
 *
 * A static increase is the wrong fix. Earlier the same day /api/health answered
 * in 3.9 s, so the floor is swinging by a factor of nine; a hardcoded 60 s
 * would fix today and leave the app needlessly sluggish for the rest of its
 * life, at which point somebody would have to remember why the number is
 * there. So the cadence is measured instead of assumed: each query records how
 * long its last call actually took, and the next one is scheduled from that.
 * When the gateway is repaired the app speeds back up on its own, with nothing
 * to revert.
 *
 * What this does NOT do is stop requests overlapping — React Query already
 * refuses to run two fetches for one key at once. What it buys is an idle gap
 * between them. A client that issues its next request the instant the last one
 * lands keeps a loaded board permanently loaded, and this board is shared with
 * every other reader of the plant.
 */

/**
 * Idle time between polls, as a fraction of the last round trip.
 *
 * Half. Enough that a struggling board gets meaningful air between requests
 * from this client, without pacing so slowly that a screen someone is watching
 * falls behind the plant. It is a fraction rather than a fixed pause because
 * the pause that matters scales with how loaded the board already is.
 */
const IDLE_FRACTION = 0.5;

/**
 * Never slower than this, however bad the last call was.
 *
 * A ceiling on the backoff, not a target. Without it a single request that
 * took two minutes — an outlier this gateway is entirely capable of — would
 * pace that query at three minutes and keep it there, and a screen that
 * refreshes every three minutes has stopped being live in any useful sense.
 * Better to keep asking and keep failing visibly.
 */
const MAX_POLL_MS = 90_000;

/** Round trip of the last completed call, per query key. */
const lastRoundTrip = new Map<string, number>();

/**
 * Wrap a query function so its duration is recorded.
 *
 * In a `finally`, so a failed call is measured too. A request that fails after
 * 45 s tells you as much about the board's state as one that succeeds, and
 * measuring only successes would pace fastest exactly when the gateway is
 * least able to take it.
 */
export function timed<T>(key: string, fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      lastRoundTrip.set(key, Date.now() - started);
    }
  };
}

/**
 * A React Query `refetchInterval` that respects what the last call cost.
 *
 * `base` is the cadence the data itself deserves — 5 s for a 1 s logger, 30 s
 * for metering that integrates over its own window. It stays the answer on a
 * healthy gateway, which is the point: this only ever slows things down, and
 * only while the board is giving it reason to.
 */
export function paced(key: string, base: number): () => number {
  return () => {
    const rt = lastRoundTrip.get(key);
    if (rt == null) return base;
    return Math.min(MAX_POLL_MS, Math.max(base, rt * (1 + IDLE_FRACTION)));
  };
}

/** The last measured round trip for a query, ms. Null before its first call. */
export function roundTripMs(key: string): number | null {
  return lastRoundTrip.get(key) ?? null;
}
