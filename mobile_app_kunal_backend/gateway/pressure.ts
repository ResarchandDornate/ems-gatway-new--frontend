/**
 * How much work somebody is currently waiting on the gateway for.
 *
 * The board behind the tunnel answers one thing at a time in practice, and two
 * very different callers share it: requests a person is waiting on, and the
 * backfill walker, which is waiting on nothing. This counter is what lets the
 * second stand aside for the first.
 *
 * Its own module rather than a constant in series.ts, because both sides of
 * the wire need it and series.ts already imports from proxy.ts — putting it in
 * either one makes a cycle out of the other.
 *
 * ── Why this exists at all ────────────────────────────────────────────────
 *
 * series.ts had a counter of exactly this shape, but it only ever counted
 * chart fills. Every other request a person makes — the five-second live
 * snapshot poll above all, and health, alarms, telemetry and the rest — was
 * invisible to the walker, so the walker never yielded to any of it.
 *
 * Measured against the commissioned gateway while the walker ran:
 *
 *     GET /api/fast-bess/latest    32-80 s   (sub-second when idle)
 *     GET /api/health              25.5 s
 *     GET /api/telemetry           21.2 s
 *
 * The app polls that first endpoint every five seconds. At eighty seconds a
 * response, polls were being issued sixteen times faster than they could be
 * answered, so the queue grew without bound and every screen in the app read
 * "Data delayed" against a plant that was fine. The walker was yielding
 * diligently to the one kind of request that was not the problem.
 */

/** Requests a person is waiting on right now. */
let waiting = 0;

/**
 * Mark the start of a request somebody is waiting on, and return the function
 * that marks its end.
 *
 * Returns a closure rather than exposing a bare decrement so a caller cannot
 * release a count it never took. Call the returned function in a `finally`:
 * a counter that only goes up parks the backfill permanently, which is a
 * worse failure than the one this module exists to fix.
 */
export function beginUserWait(): () => void {
  waiting += 1;
  let released = false;
  return () => {
    /* Idempotent. A double release would drive the count negative and make the
       walker believe the board is quieter than it is. */
    if (released) return;
    released = true;
    waiting -= 1;
  };
}

/**
 * How many requests a person is waiting on.
 *
 * Read by the backfill walker before every gateway read. Anything above zero
 * means someone is on a screen waiting for an answer, and the walker's work
 * can wait — it is pre-filling a store for later, and nobody is watching it.
 */
export const userWaitsInFlight = (): number => waiting;
