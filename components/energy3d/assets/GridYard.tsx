"use client";

/**
 * The utility connection: two lattice transmission towers strung with
 * conductors, over a fenced substation bay.
 *
 * Two towers rather than one because a line is what says "grid" — a single
 * pylon reads as a landmark, a pair with wire sagging between them reads as a
 * transmission corridor arriving at the site.
 *
 * Import and export are distinguished on the equipment itself: insulator
 * strings light on import, the substation busbar lights on export. The flows
 * carry the same information; the asset agreeing with its cable is what keeps
 * the scene from feeling like labels floating over scenery.
 */

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GridState } from "@/lib/energy/types";
import { useScenePalette } from "../useScenePalette";
import type { ScenePalette } from "../theme";

export interface GridYardProps {
  state: GridState;
  intensity: number;
}

const TOWER_H = 3.9;
const BASE_HALF = 0.5;
const TOP_HALF = 0.14;
/** Crossarms: [height, half-span]. */
const ARMS: ReadonlyArray<readonly [number, number]> = [[2.95, 1.05], [3.6, 0.75]];

/** Two towers along the corridor, in pad coordinates. */
const TOWERS: ReadonlyArray<readonly [number, number]> = [[1.35, -1.25], [-1.05, -1.65]];

const halfAt = (y: number) => BASE_HALF + (TOP_HALF - BASE_HALF) * (y / TOWER_H);

function Pylon({ position, p, insulatorMat }: {
  position: readonly [number, number];
  p: ScenePalette;
  insulatorMat: THREE.Material;
}) {
  const legs = useMemo(
    () =>
      ([[1, 1], [1, -1], [-1, 1], [-1, -1]] as const).map(([sx, sz]) => {
        const a = new THREE.Vector3(sx * BASE_HALF, 0, sz * BASE_HALF);
        const b = new THREE.Vector3(sx * TOP_HALF, TOWER_H, sz * TOP_HALF);
        const q = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          b.clone().sub(a).normalize(),
        );
        return { mid: a.clone().lerp(b, 0.5).toArray() as [number, number, number], q, len: a.distanceTo(b) };
      }),
    [],
  );

  return (
    <group position={[position[0], 0, position[1]]}>
      {/* Footings. */}
      {([[1, 1], [1, -1], [-1, 1], [-1, -1]] as const).map(([sx, sz], i) => (
        <mesh key={i} position={[sx * BASE_HALF, 0.04, sz * BASE_HALF]} receiveShadow>
          <boxGeometry args={[0.16, 0.08, 0.16]} />
          <meshStandardMaterial color={p.shellMid} roughness={0.9} />
        </mesh>
      ))}
      {/* Legs. */}
      {legs.map((l, i) => (
        <mesh key={i} position={l.mid} quaternion={l.q} castShadow>
          <cylinderGeometry args={[0.03, 0.04, l.len, 6]} />
          <meshStandardMaterial color={p.shell} roughness={0.55} metalness={0.45} />
        </mesh>
      ))}
      {/* Belts, with X-bracing on the two faces toward the camera. */}
      {[0.7, 1.5, 2.3, 2.95].map((y, i, arr) => {
        const h = halfAt(y);
        const next = arr[i + 1];
        return (
          <group key={y}>
            <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, Math.PI / 4]}>
              <torusGeometry args={[h * 1.42, 0.016, 4, 4]} />
              <meshStandardMaterial color={p.shellMid} roughness={0.6} metalness={0.4} />
            </mesh>
            {next !== undefined && (
              <>
                {[1, -1].map((s) => {
                  const h2 = halfAt(next);
                  const a = new THREE.Vector3(-h, y, h);
                  const b = new THREE.Vector3(h2, next, h2);
                  if (s < 0) { a.x = h; b.x = -h2; }
                  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
                  return (
                    <mesh key={s} position={a.clone().lerp(b, 0.5).toArray()} quaternion={q}>
                      <cylinderGeometry args={[0.012, 0.012, a.distanceTo(b), 4]} />
                      <meshStandardMaterial color={p.shellMid} roughness={0.6} metalness={0.4} />
                    </mesh>
                  );
                })}
              </>
            )}
          </group>
        );
      })}
      {/* Crossarms and insulator strings. */}
      {ARMS.map(([y, half]) => (
        <group key={y}>
          <mesh position={[0, y, 0]} castShadow>
            <boxGeometry args={[half * 2, 0.06, 0.1]} />
            <meshStandardMaterial color={p.shell} roughness={0.55} metalness={0.45} />
          </mesh>
          {[-half * 0.88, half * 0.88].map((x) => (
            <mesh key={x} position={[x, y - 0.2, 0]} material={insulatorMat}>
              <cylinderGeometry args={[0.035, 0.035, 0.32, 8]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Earth-wire peak. */}
      <mesh position={[0, TOWER_H + 0.12, 0]}>
        <coneGeometry args={[0.06, 0.26, 4]} />
        <meshStandardMaterial color={p.shell} roughness={0.55} metalness={0.45} />
      </mesh>
    </group>
  );
}

export function GridYard({ state, intensity }: GridYardProps) {
  const p = useScenePalette();
  const importing = state.status === "importing";
  const exporting = state.status === "exporting";
  const offline = state.status === "offline";

  /** Shared by every insulator on both towers, so they light together. */
  const insulatorMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: p.steel, emissive: p.steel, emissiveIntensity: 0.8, roughness: 0.4, toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => insulatorMat.dispose(), [insulatorMat]);

  const busbar = useRef<THREE.MeshStandardMaterial>(null);

  /** Conductors: one sagging span per insulator tip, tower to tower. */
  const conductors = useMemo(() => {
    const [a, b] = TOWERS;
    const out: THREE.CatmullRomCurve3[] = [];
    for (const [y, half] of ARMS) {
      for (const sx of [-1, 1]) {
        const x = sx * half * 0.88;
        const p0 = new THREE.Vector3(a[0] + x, y - 0.36, a[1]);
        const p2 = new THREE.Vector3(b[0] + x, y - 0.36, b[1]);
        const p1 = p0.clone().lerp(p2, 0.5).setY(y - 0.36 - 0.32);
        out.push(new THREE.CatmullRomCurve3([p0, p1, p2]));
      }
    }
    return out;
  }, []);

  useFrame(({ clock }) => {
    const breath = 0.5 + 0.5 * Math.sin(clock.getElapsedTime() * 1.7);
    insulatorMat.color.setHex(p.steel);
    insulatorMat.emissive.setHex(p.steel);
    insulatorMat.emissiveIntensity = (importing ? 0.7 + 2.2 * breath * intensity : 0.1) * p.glow;
    if (busbar.current) {
      busbar.current.emissiveIntensity = (exporting ? 0.7 + 2.2 * breath * intensity : 0.12) * p.glow;
    }
  });

  return (
    <group>
      {TOWERS.map((t) => (
        <Pylon key={t.join()} position={t} p={p} insulatorMat={insulatorMat} />
      ))}

      {conductors.map((c, i) => (
        <mesh key={i}>
          <tubeGeometry args={[c, 24, 0.012, 5, false]} />
          <meshStandardMaterial color={p.shellDark} roughness={0.5} metalness={0.6} />
        </mesh>
      ))}

      {/* ── Substation bay, fenced ────────────────────────────────────────── */}
      <group position={[-0.55, 0, 1.2]}>
        {/* Gravel pad. */}
        <mesh position={[0, 0.01, 0]} receiveShadow>
          <boxGeometry args={[2.3, 0.02, 1.7]} />
          <meshStandardMaterial color={p.platformEdge} roughness={0.95} />
        </mesh>

        {/* Transformer tank, radiators and bushings. */}
        <mesh position={[-0.35, 0.42, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.8, 0.8, 0.8]} />
          <meshStandardMaterial color={p.shellMid} roughness={0.4} metalness={0.6} />
        </mesh>
        {[-0.8, 0.1].map((x) => (
          <mesh key={x} position={[x, 0.42, 0]} castShadow>
            <boxGeometry args={[0.08, 0.6, 0.62]} />
            <meshStandardMaterial color={p.shellDark} roughness={0.5} metalness={0.55} />
          </mesh>
        ))}
        {[-0.24, 0, 0.24].map((z) => (
          <group key={z} position={[-0.35, 0.82, z]}>
            {[0, 1, 2, 3].map((k) => (
              <mesh key={k} position={[0, 0.06 + k * 0.05, 0]}>
                <cylinderGeometry args={[0.065, 0.065, 0.025, 10]} />
                <meshStandardMaterial color={p.shell} roughness={0.45} metalness={0.3} />
              </mesh>
            ))}
          </group>
        ))}

        {/* Busbar gantry — the bar lights when the site is exporting. */}
        {[0.35, 0.95].map((x) => (
          <mesh key={x} position={[x, 0.6, 0]} castShadow>
            <boxGeometry args={[0.05, 1.2, 0.05]} />
            <meshStandardMaterial color={p.shellMid} roughness={0.6} metalness={0.5} />
          </mesh>
        ))}
        <mesh position={[0.65, 1.18, 0]}>
          <boxGeometry args={[0.75, 0.045, 0.045]} />
          <meshStandardMaterial
            ref={busbar}
            color={p.steel}
            emissive={p.steel}
            emissiveIntensity={0.5}
            roughness={0.35}
            toneMapped={false}
          />
        </mesh>

        {/* Fence: posts and two rails round the bay. */}
        {(() => {
          const W = 2.3, D = 1.7, out: ReactElement[] = [];
          const sides: Array<[number, number, number, number]> = [
            [-W / 2, -D / 2, W / 2, -D / 2], [W / 2, -D / 2, W / 2, D / 2],
            [W / 2, D / 2, -W / 2, D / 2], [-W / 2, D / 2, -W / 2, -D / 2],
          ];
          sides.forEach(([x0, z0, x1, z1], si) => {
            const len = Math.hypot(x1 - x0, z1 - z0);
            const n = Math.max(2, Math.round(len / 0.38));
            for (let k = 0; k < n; k++) {
              const t = k / n;
              out.push(
                <mesh key={`p${si}-${k}`} position={[x0 + (x1 - x0) * t, 0.2, z0 + (z1 - z0) * t]}>
                  <boxGeometry args={[0.025, 0.4, 0.025]} />
                  <meshStandardMaterial color={p.shellDark} roughness={0.6} metalness={0.5} />
                </mesh>,
              );
            }
            for (const y of [0.18, 0.38]) {
              out.push(
                <mesh key={`r${si}-${y}`} position={[(x0 + x1) / 2, y, (z0 + z1) / 2]} rotation={[0, -Math.atan2(z1 - z0, x1 - x0), 0]}>
                  <boxGeometry args={[len, 0.012, 0.012]} />
                  <meshStandardMaterial color={p.shellDark} roughness={0.6} metalness={0.5} />
                </mesh>,
              );
            }
          });
          return out;
        })()}
      </group>

      {/* Meter kiosk. Unlit when the connection is down. */}
      <mesh position={[1.55, 0.3, 1.55]} castShadow receiveShadow>
        <boxGeometry args={[0.36, 0.6, 0.3]} />
        <meshStandardMaterial color={offline ? p.shellDark : p.shell} roughness={0.75} metalness={0.05} />
      </mesh>
    </group>
  );
}

export default GridYard;
