import * as THREE from "three";

/**
 * A disc with rolled top and bottom edges.
 *
 * Revolved from a profile traced in the XY plane: bottom face outward, a
 * quarter-round up, the straight side, another quarter-round, then in across
 * the top. `bevel` is the roll radius.
 *
 * Used instead of CylinderGeometry everywhere a round section appears. A
 * cylinder's hard 90° rim catches the key light as a bright hairline and is
 * the single clearest tell of an unstyled Three.js scene; every round edge in
 * the reference has a visible soft roll.
 */
export function roundedDisc(
  radius: number,
  height: number,
  bevel: number,
  segments = 48,
): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const h = height / 2;
  const b = Math.min(bevel, h * 0.9, radius * 0.4);
  const STEPS = 6;

  pts.push(new THREE.Vector2(0.0001, -h));
  pts.push(new THREE.Vector2(radius - b, -h));
  for (let i = 1; i <= STEPS; i++) {
    const a = (i / STEPS) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + Math.sin(a) * b, -h + (1 - Math.cos(a)) * b));
  }
  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + Math.cos(a) * b, h - b + Math.sin(a) * b));
  }
  pts.push(new THREE.Vector2(0.0001, h));

  return new THREE.LatheGeometry(pts, segments);
}
