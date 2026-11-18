/**
 * Where everything stands, and how it is wired: a single-line diagram in 3D.
 *
 * One AC busbar runs across the middle of the frame. Every asset hangs off it
 * on its own straight feeder — sources (grid, PV, DG) above the bus, storage
 * and demand (BESS, load) below — which is how an electrical single-line is
 * drawn, and why no two wires can cross or share a run. Point-to-point cables
 * between every pair of assets looked busier and said less: power meets at the
 * bus, and the diagram should show that.
 *
 * The layout is built from the site's asset list, so each of the five site
 * configurations gets a bus sized to what is on it.
 *
 * ── Axes ───────────────────────────────────────────────────────────────────
 * The camera looks down (−1, −, −1), so world (1, 0, −1) runs straight across
 * the screen and (1, 0, 1) straight down it. The layout is authored in those
 * two directions — `u` across, `v` toward the viewer — which is what makes the
 * bus horizontal and every feeder vertical on screen.
 */

import * as THREE from "three";
import type { SiteAsset } from "@/lib/energy/topology";

/** Scene ids. PV is "solar" to match the energy snapshot. */
export type NodeId = "solar" | "bess" | "grid" | "load" | "dg";

export type AccentKey = "cyan" | "teal" | "steel" | "green";

export interface AssetNode {
  id: NodeId;
  /** Slab centre in world space. */
  position: [number, number, number];
  /** Slab footprint, world units. */
  size: [number, number];
  label: string;
  accent: AccentKey;
  /** Above the bus (-1) or below it (+1). */
  side: -1 | 1;
  /** Position along the bus, world units. Feeders land at this point. */
  u: number;
  /** Where the reading chip is pinned — a corner of the slab — and which way
   *  it extends from there, always away from the equipment. */
  callout: [number, number, number];
  calloutAlign: "left" | "right" | "above";
  /** Straight feeder from the slab's bus-facing corner to the bus. */
  feeder: THREE.LineCurve3;
}

export interface SceneLayout {
  nodes: Partial<Record<NodeId, AssetNode>>;
  /** Busbar end points, world space. */
  bus: { start: THREE.Vector3; end: THREE.Vector3 };
  /** World-space box around equipment and callouts. */
  bounds: THREE.Box3;
  /**
   * The actual outline the camera should fit: every slab corner at ground and
   * at its tallest point, the reading chips, the bus ends. Fitting `bounds`
   * instead wastes the frame — it is square to the world axes while the layout
   * runs along the screen's, so on screen it is a large diamond with empty
   * corners above and below the plant.
   */
  points: THREE.Vector3[];
}

/** The slab surface. Everything an asset builder makes sits on this plane. */
export const DECK_Y = 0.22;
/** Height the bus and every feeder run at. */
export const BUS_Y = DECK_Y + 0.14;

const S2 = Math.SQRT1_2;
const U = new THREE.Vector3(S2, 0, -S2);
const V = new THREE.Vector3(S2, 0, S2);

/** Distance between neighbouring slabs along the bus, and from bus to slab. */
const STEP = 8.4;
const ROW = 7.0;

/** Reading chips: anchor height, and roughly how far one reaches, world units. */
const CALLOUT_Y = DECK_Y + 0.2;
const CALLOUT_W = 3.4;

const SPEC: Record<NodeId, { size: [number, number]; label: string; calloutH: number }> = {
  grid:  { size: [4.6, 4.6], label: "Utility Grid",     calloutH: 5.6 },
  solar: { size: [5.6, 4.2], label: "Solar PV",         calloutH: 2.6 },
  dg:    { size: [3.6, 3.2], label: "Diesel Generator", calloutH: 2.8 },
  bess:  { size: [5.4, 4.4], label: "Battery Storage",  calloutH: 3.2 },
  load:  { size: [5.8, 4.6], label: "Site Load",        calloutH: 3.8 },
};

/** Left-to-right order within each row. */
const TOP: NodeId[] = ["grid", "solar", "dg"];
const BOTTOM: NodeId[] = ["bess", "load"];

const idFor = (a: SiteAsset): NodeId => (a === "pv" ? "solar" : a);

/** Ground point for (u, v). */
const at = (u: number, v: number) => U.clone().multiplyScalar(u).addScaledVector(V, v);

export function buildLayout(assets: SiteAsset[]): SceneLayout {
  const present = new Set(assets.map(idFor));
  const top = TOP.filter((id) => present.has(id));
  const bottom = BOTTOM.filter((id) => present.has(id));

  const nodes: SceneLayout["nodes"] = {};
  const bounds = new THREE.Box3();
  const points: THREE.Vector3[] = [];
  const add = (v: THREE.Vector3) => { points.push(v.clone()); bounds.expandByPoint(v); };
  let uMin = Infinity, uMax = -Infinity;

  const place = (row: NodeId[], side: -1 | 1) => {
    row.forEach((id, i) => {
      const u = (i - (row.length - 1) / 2) * STEP;
      const spec = SPEC[id];
      const [w, d] = spec.size;
      const centre = at(u, side * ROW);

      // The slab corner that points at the bus: its offset along v is half the
      // footprint diagonal projected onto v.
      const reach = (w / 2 + d / 2) * S2;
      const start = centre.clone().addScaledVector(V, -side * reach).setY(BUS_Y);
      const end = at(u, 0).setY(BUS_Y);

      // Reading chips are pinned to a slab corner and extend outward, so they
      // can never sit on the equipment: the leftmost in a row from its left
      // corner, the rightmost from its right, and a middle one — neighbours
      // both ways — from the corner away from the bus.
      const single = row.length === 1;
      const edge: "left" | "right" | "above" =
        single ? (side < 0 ? "left" : "right")
        : i === 0 ? "left"
        : i === row.length - 1 ? "right"
        : "above";
      const callout = (edge === "above"
        ? centre.clone().addScaledVector(V, side * reach)
        : centre.clone().addScaledVector(U, (edge === "left" ? -1 : 1) * reach)
      ).setY(CALLOUT_Y);

      nodes[id] = {
        id,
        position: [centre.x, 0, centre.z],
        size: spec.size,
        label: spec.label,
        accent: "cyan",
        side,
        u,
        callout: [callout.x, callout.y, callout.z],
        calloutAlign: edge,
        feeder: new THREE.LineCurve3(start, end),
      };

      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        const cx = centre.x + (sx * w) / 2;
        const cz = centre.z + (sz * d) / 2;
        add(new THREE.Vector3(cx, 0, cz));
        add(new THREE.Vector3(cx, spec.calloutH, cz));
      }
      // Room for the chip on the side it extends to.
      const reachOut = edge === "left" ? -CALLOUT_W : edge === "right" ? CALLOUT_W : 0;
      add(callout.clone().addScaledVector(U, reachOut));
      if (edge === "above") add(callout.clone().setY(CALLOUT_Y + 2.2));
    });
  };
  place(top, -1);
  place(bottom, 1);

  if (!Number.isFinite(uMin)) { uMin = 0; uMax = 0; }
  const bus = {
    start: at(uMin - 2.2, 0).setY(BUS_Y),
    end: at(uMax + 2.2, 0).setY(BUS_Y),
  };
  add(bus.start);
  add(bus.end);

  return { nodes, bus, bounds, points };
}
