"use client";

/**
 * Whether what is on screen is current, said once and said first.
 *
 * The rule this exists to enforce: a reading is presented in the present tense
 * only while the device is actually communicating. Everything else is labelled
 * as the last known value. An EMS that renders an hour-old state of charge the
 * same way it renders a one-second-old one is not reporting the plant, it is
 * reporting its own cache.
 *
 * Two facts, kept apart because their remedies differ and §9 of the brief asks
 * for exactly this separation:
 *
 *   Device state — what the gateway says about the source, from
 *                  /api/sources/summary `online`.
 *   Data state   — how old the newest reading actually is.
 *
 * A device can be online while the data is stale (the logger fell behind), and
 * the app can be unable to reach the gateway while the device itself is fine.
 * The line below states the first and the second, in that order.
 */

import { CloudOff, Wifi, WifiOff, Clock, HelpCircle } from "lucide-react";

import { useConnectivity } from "../data";

export function StationStatus() {
  const c = useConnectivity();

  const Icon =
    c.status === "live" ? Wifi
    : c.status === "stale" ? Clock
    : c.status === "offline" ? WifiOff
    : HelpCircle;

  return (
    <div className={`m-station-status is-${c.tone}`} role="status">
      <span className="m-ss-mark"><Icon size={15} /></span>
      <span className="m-ss-text">
        <span className="m-ss-label">{c.label}</span>
        <span className="m-ss-detail">{c.detail}</span>
      </span>

      {/* Only when the app itself cannot reach the gateway. That is a
          different problem from the device being offline — this one is
          between the phone and the proxy, and the readings on screen are
          simply the last ones that got through. */}
      {c.unreachable && (
        <span className="m-ss-aside" title="This app cannot currently reach the gateway">
          <CloudOff size={13} />
        </span>
      )}
    </div>
  );
}
