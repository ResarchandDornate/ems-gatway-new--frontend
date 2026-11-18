/**
 * Which Y axis each plotted parameter is drawn against.
 *
 * A Genie graph has three axes: X (time, or a parameter on the X–Y plot) and
 * two Y axes, left and right. Parameters that share a unit share a Y axis;
 * a parameter with no unit is a quantity of its own and needs a Y axis to
 * itself. So at most two scales can be drawn at once, and a parameter in a
 * third is refused rather than drawn against a scale nobody can read.
 *
 * Sides are sticky: a scale keeps its side while any drawn parameter uses
 * it, so removing the left axis's parameters never moves the right axis's
 * across. A side frees up only when nothing drawn uses it.
 */

export type Side = "left" | "right";
export const SIDES: readonly Side[] = ["left", "right"];
/** The scale each side carries (a unit, or "#<id>" for a unitless parameter). */
export type Sides = Partial<Record<Side, string>>;

export interface PlanItem { id: string; scale: string }

export interface AxisPlan {
  sides: Sides;
  /** Side of every drawn parameter. */
  sideOf: Map<string, Side>;
  /** Drawn parameters, in pick order. */
  graphed: string[];
  /** Picked but not drawn: past the graph limit, or no Y axis left for its scale. */
  notGraphed: Map<string, "limit" | "axes">;
}

/** A unit is its own scale; a parameter with no unit gets one of its own. */
export const scaleKey = (unit: string, id: string) => unit || `#${id}`;
export const isUnitless = (scale: string) => scale.startsWith("#");

const sideCarrying = (sides: Sides, scale: string) => SIDES.find((s) => sides[s] === scale);
const freeSide = (sides: Sides) => SIDES.find((s) => sides[s] === undefined);

/**
 * Lay out `items` (in pick order) on the two Y axes, keeping `prev`'s sides
 * for scales still drawn. Up to `max` are drawn; the rest are reported in
 * `notGraphed` (only reachable when the selection is allowed past what can be
 * drawn — the download-only mode).
 */
export function planAxes(items: PlanItem[], prev: Sides, max: number): AxisPlan {
  const present = new Set(items.map((i) => i.scale));
  let keep: Sides = {};
  for (const s of SIDES) if (prev[s] !== undefined && present.has(prev[s]!)) keep[s] = prev[s];

  for (;;) {
    const sides: Sides = { ...keep };
    const sideOf = new Map<string, Side>();
    const graphed: string[] = [];
    const notGraphed = new Map<string, "limit" | "axes">();
    for (const it of items) {
      if (graphed.length >= max) { notGraphed.set(it.id, "limit"); continue; }
      const side = sideCarrying(sides, it.scale) ?? freeSide(sides);
      if (!side) { notGraphed.set(it.id, "axes"); continue; }
      sides[side] = it.scale;
      sideOf.set(it.id, side);
      graphed.push(it.id);
    }
    /* A kept side whose parameters are all past the limit draws nothing;
       free it and lay out again so it can serve one that is drawn. */
    const idle = SIDES.filter((s) => sides[s] !== undefined && ![...sideOf.values()].includes(s));
    if (!idle.length) return { sides, sideOf, graphed, notGraphed };
    keep = { ...keep };
    for (const s of idle) delete keep[s];
  }
}

/** Why a parameter in `scale` cannot be added to `plan`, or null when it can. */
export function blockReason(plan: AxisPlan, scale: string, max: number): "limit" | "axes" | null {
  if (plan.graphed.length >= max) return "limit";
  if (sideCarrying(plan.sides, scale) || freeSide(plan.sides)) return null;
  return "axes";
}
