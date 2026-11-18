"use client";

/**
 * BessHero — the containerised BESS that anchors the dashboard.
 *
 * A rendered still with a telemetry overlay, not realtime 3D. The 3D version
 * was built and dropped: at this size a phone shows a container roughly 300 px
 * wide, which is not enough for shading and shadow to read as industrial
 * equipment, and modelling it well enough to survive that crop costs more
 * frame budget than the screen has. The still is sharper, art-directed once
 * rather than approximated every frame, and takes three.js off this screen.
 *
 * The split is strict and deliberate: the picture is the site and never
 * changes, the overlay is the telemetry and is the only thing allowed to move
 * or to make a claim. Nothing is painted into the render — the reference
 * images had their readings baked into the pixels, which would have shown the
 * same numbers forever regardless of the plant.
 *
 * With no render present the frame says so rather than collapsing, so the
 * screen is usable before the asset exists.
 */

import { useEffect, useState } from "react";

import { useTheme } from "../useTheme";

/** Which way energy is moving at one anchor, from the container's point of view. */
type Dir = "in" | "out" | "none";

/**
 * Where the three arrows land on the render.
 *
 * x is shared with the label row above the hero — also a three-column grid —
 * so each arrow falls under its own label and the two read as one element
 * rather than as a caption near a picture.
 *
 * y is the container's roof at that x, measured off the render. The container
 * is drawn in perspective, so the roof is not level: the far right corner sits
 * higher in frame than the near left one, and arrows ending at a single y
 * would visibly float off the roof at one end.
 *
 * These are the standing cost of overlaying a still. A new render means
 * re-measuring them — cheaper than the realtime scene they replaced.
 */
const ANCHORS = [
  { x: 16.7, y: 11.4 }, // left end, grid side
  { x: 50.0, y: 8.2 },  // centre, over the racks and PCS
  { x: 83.3, y: 6.2 },  // right end, load side
] as const;

/** Where the arrows start, just under the labels. */
const TOP = 1.4;

/** Below this, a reading is noise rather than flow, and nothing should animate. */
const DEADBAND_KW = 0.5;

export function BessHero({
  src,
  gridKw,
  batteryKw,
  loadKw,
  chargeState,
  live = true,
}: {
  src?: string;
  /**
   * Whether these figures are current.
   *
   * The travelling pulse on each leg is the strongest "this is happening now"
   * signal on the screen — stronger than any number, because motion reads as
   * liveness before the eye reaches a label. Running it over readings that are
   * an hour old is the clearest way this app could lie, so it stops.
   */
  live?: boolean;
  /** Grid meter active power. Positive imports from the utility. */
  gridKw: number | null;
  /** Battery power. Positive discharges, per the convention in data.ts. */
  batteryKw: number | null;
  /** Site load as the EMS computes it. */
  loadKw: number | null;
  /** BMS charge_discharge_status: 0 idle, 1 discharge, 2 charge. */
  chargeState: number | null;
}) {
  const { theme } = useTheme();

  /* Two renders of the same container, one lit for each theme. The dark plate
     sits on near-black and the light one on near-white, so using either across
     both themes leaves the container floating on a ground it was not lit for —
     a bright studio shot on the dark dashboard reads as a pasted rectangle.
     An explicit `src` still wins, so a caller can pin one.

     Resolved per render rather than in a default parameter: a default is
     evaluated once at the call site and would not follow the theme toggle. */
  const resolved = src ?? (theme === "light" ? "/bess-hero-light.jpg" : "/bess-hero-dark.jpg");

  const [missing, setMissing] = useState(false);

  /* A theme switch swaps the file. Without this, one missing render would
     latch the placeholder on for the other theme too, whose file may be fine. */
  useEffect(() => setMissing(false), [resolved]);

  /* Grid: importing pushes energy into the site, exporting takes it out. */
  const gridDir: Dir =
    gridKw == null || Math.abs(gridKw) < DEADBAND_KW ? "none" : gridKw > 0 ? "in" : "out";

  /* Battery: the BMS status bit is authoritative where present, because it
     distinguishes a genuine idle from a reading that merely rounds to zero.
     Power is the fallback. */
  const batteryDir: Dir =
    chargeState === 2 ? "in"
    : chargeState === 1 ? "out"
    : chargeState === 0 ? "none"
    : batteryKw == null || Math.abs(batteryKw) < DEADBAND_KW ? "none"
    : batteryKw > 0 ? "out" : "in";

  /* Load only ever consumes; it has no direction to choose, only presence. */
  const loadDir: Dir = loadKw == null || loadKw < DEADBAND_KW ? "none" : "out";

  const dirs: Dir[] = [gridDir, batteryDir, loadDir];

  return (
    <div className="m-hero">
      {missing ? (
        <div className="m-hero-empty" role="note">
          <span className="m-hero-empty-title">No site render</span>
          <span className="m-hero-empty-body">
            Expected at <code>public/bess-hero-{theme === "light" ? "light" : "dark"}.jpg</code>.
          </span>
        </div>
      ) : (
        <img
          className="m-hero-img"
          src={resolved}
          alt="Battery container with racks, power conversion cabinets and switchgear"
          onError={() => setMissing(true)}
          draggable={false}
        />
      )}

      <svg className="m-hero-flow" viewBox="0 0 100 56" aria-hidden focusable="false">
        {ANCHORS.map((a, i) => {
          const dir = dirs[i];
          const into = dir === "in";
          return (
            <g key={a.x}>
              {/* The connection itself, always drawn: an idle site is still a
                  connected one, and a missing line would read as a fault. */}
              <line className="m-hero-track" x1={a.x} y1={TOP} x2={a.x} y2={a.y} />

              {dir !== "none" && (
                <>
                  {/* One geometry for both directions; the travel reverses in
                      CSS. Two mirrored paths would drift apart the moment
                      either is edited. */}
                  <line
                    className={`m-hero-pulse${into ? "" : " is-out"}${live ? "" : " is-held"}`}
                    x1={a.x}
                    y1={TOP}
                    x2={a.x}
                    y2={a.y}
                  />
                  {/* Head at the destination, so direction survives without
                      motion — which is what a reduced-motion reader gets. */}
                  <polygon
                    className="m-hero-head"
                    points={
                      into
                        ? `${a.x},${a.y} ${a.x - 1.15},${a.y - 2.1} ${a.x + 1.15},${a.y - 2.1}`
                        : `${a.x},${TOP} ${a.x - 1.15},${TOP + 2.1} ${a.x + 1.15},${TOP + 2.1}`
                    }
                  />
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
