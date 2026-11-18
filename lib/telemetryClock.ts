"use client";

/**
 * telemetryClock — the newest DEVICE reading timestamp currently on screen.
 *
 * The header needs to answer "when did data last arrive from the plant?", but
 * the value lives inside whichever telemetry fetch happens to be running, deep
 * under the page. Threading it up through props or context would couple the
 * chrome to every module that polls, so services publish into this store
 * instead and the header subscribes.
 *
 * Deliberately NOT the API-response time — see lib/freshness.ts for why the two
 * are unrelated. useLastApiSync answers "can we reach UGX?"; this answers "is
 * the plant still talking?".
 *
 * Last write wins rather than max: on switching station the newest reading can
 * legitimately move backwards, and keeping the high-water mark would leave the
 * header quoting the previous plant's clock.
 */

import { useSyncExternalStore } from "react";

let lastTs: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Publish the newest telemetry timestamp from a fetch. null clears it. */
export function reportTelemetryTs(ts: number | null): void {
  if (ts === lastTs) return;
  lastTs = ts;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): number | null {
  return lastTs;
}

/** Server render has no telemetry yet — null keeps markup identical on hydration. */
function getServerSnapshot(): number | null {
  return null;
}

/** Newest device reading timestamp (ms), or null before anything has arrived. */
export function useLastTelemetryTs(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
