"use client";

/**
 * The demand side: an industrial site rather than a single building.
 *
 * A sawtooth-roofed factory, a low warehouse with roller doors, an office
 * block, a stack, process tanks, and the pipe rack that ties them together —
 * several connected blocks, so it reads as a facility that draws power, not
 * as an icon of one.
 *
 * Consumption is shown on the office block as lit floor bands, and the number
 * lit tracks demand: the building fills from the ground up as the site draws
 * more. It survives peripheral vision, which a readout does not.
 *
 * Each band owns its material: instancing varies diffuse colour only, and the
 * signal here is in `emissive`.
 */

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LoadState } from "@/lib/energy/types";
import { useScenePalette } from "../useScenePalette";

export interface LoadClusterProps {
  state: LoadState;
  /** Demand as a fraction of the site's peak, 0–1. */
  intensity: number;
}

const FLOORS = 7;
const FLOOR_H = 0.34;

export function LoadCluster({ state, intensity }: LoadClusterProps) {
  const p = useScenePalette();
  const consuming = state.status === "consuming";

  const bandMats = useMemo(
    () =>
      Array.from({ length: FLOORS }, () =>
        new THREE.MeshStandardMaterial({
          color: p.cyan, emissive: p.cyan, emissiveIntensity: 0.4, roughness: 0.3, toneMapped: false,
        }),
      ),
    [],
  );
  useEffect(() => () => bandMats.forEach((m) => m.dispose()), [bandMats]);

  /** Shared by every roof glazing strip, so they brighten together. */
  const glazeMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: p.cyan, emissive: p.cyan, emissiveIntensity: 0.4, roughness: 0.2, toneMapped: false }),
    [],
  );
  useEffect(() => () => glazeMat.dispose(), [glazeMat]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const filled = consuming ? intensity * FLOORS : 0;
    bandMats.forEach((m, i) => {
      const lit = THREE.MathUtils.clamp(filled - i, 0, 1);
      const flicker = 0.92 + 0.08 * Math.sin(t * 1.3 + i * 2.1);
      m.emissiveIntensity = (0.25 + 3.0 * lit * flicker) * p.glow;
      m.color.setHex(p.cyan);
      m.emissive.setHex(p.cyan);
    });
    // Factory roof glazing brightens with demand, more gently than the bands.
    glazeMat.emissiveIntensity = (consuming ? 0.4 + 1.4 * intensity : 0.15) * p.glow;
  });

  return (
    <group>
      {/* ── Factory with a sawtooth roof ─────────────────────────────────── */}
      <group position={[-1.2, 0, -0.55]}>
        <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.3, 1.1, 1.9]} />
          <meshStandardMaterial color={p.shell} roughness={0.75} metalness={0.08} />
        </mesh>
        {[-0.8, -0.27, 0.26, 0.79].map((x) => (
          <group key={x} position={[x, 1.1, 0]}>
            {/* Sloped roof panel. */}
            <mesh position={[0.06, 0.14, 0]} rotation={[0, 0, Math.PI / 7]} castShadow>
              <boxGeometry args={[0.58, 0.04, 1.88]} />
              <meshStandardMaterial color={p.shellMid} roughness={0.55} metalness={0.3} />
            </mesh>
            {/* Vertical north-light glazing. */}
            <mesh position={[-0.2, 0.14, 0]} material={glazeMat}>
              <boxGeometry args={[0.02, 0.26, 1.8]} />
            </mesh>
          </group>
        ))}
        {/* Loading bay doors on the front face. */}
        {[-0.6, 0.2].map((x) => (
          <mesh key={x} position={[x, 0.36, 0.955]}>
            <boxGeometry args={[0.5, 0.6, 0.02]} />
            <meshStandardMaterial color={p.shellMid} roughness={0.6} metalness={0.3} />
          </mesh>
        ))}
        {/* Rooftop air handler. */}
        <mesh position={[0.7, 1.45, -0.55]} castShadow>
          <boxGeometry args={[0.5, 0.22, 0.5]} />
          <meshStandardMaterial color={p.shellMid} roughness={0.5} metalness={0.5} />
        </mesh>
      </group>

      {/* ── Warehouse ────────────────────────────────────────────────────── */}
      <group position={[-1.4, 0, 1.45]}>
        <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.0, 0.76, 1.0]} />
          <meshStandardMaterial color={p.shell} roughness={0.78} metalness={0.06} />
        </mesh>
        {/* Roller doors. */}
        {[-0.55, 0, 0.55].map((x) => (
          <group key={x} position={[x, 0.3, 0.505]}>
            <mesh>
              <boxGeometry args={[0.38, 0.5, 0.012]} />
              <meshStandardMaterial color={p.shellMid} roughness={0.55} metalness={0.4} />
            </mesh>
            {[0, 1, 2, 3].map((k) => (
              <mesh key={k} position={[0, -0.18 + k * 0.12, 0.008]}>
                <boxGeometry args={[0.38, 0.012, 0.008]} />
                <meshStandardMaterial color={p.shellDark} />
              </mesh>
            ))}
          </group>
        ))}
      </group>

      {/* ── Office block — the band host ─────────────────────────────────── */}
      <group position={[0.85, 0, -0.35]}>
        <mesh position={[0, 1.3, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.05, 2.6, 1.0]} />
          <meshStandardMaterial color={p.shell} roughness={0.7} metalness={0.08} />
        </mesh>
        {bandMats.map((m, i) => (
          <group key={i} position={[0, 0.42 + i * FLOOR_H, 0]}>
            <mesh position={[0, 0, 0.505]} material={m}>
              <boxGeometry args={[0.92, 0.1, 0.02]} />
            </mesh>
            <mesh position={[0.53, 0, 0]} material={m}>
              <boxGeometry args={[0.02, 0.1, 0.88]} />
            </mesh>
          </group>
        ))}
        {/* Roof plant and mast. */}
        <mesh position={[-0.15, 2.72, -0.15]} castShadow>
          <boxGeometry args={[0.46, 0.24, 0.4]} />
          <meshStandardMaterial color={p.shellMid} roughness={0.5} metalness={0.45} />
        </mesh>
        <mesh position={[0.3, 2.9, 0.25]}>
          <cylinderGeometry args={[0.014, 0.014, 0.6, 6]} />
          <meshStandardMaterial color={p.shellDark} roughness={0.6} metalness={0.4} />
        </mesh>
      </group>

      {/* ── Stack ────────────────────────────────────────────────────────── */}
      <group position={[2.2, 0, -1.55]}>
        <mesh position={[0, 1.2, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.15, 2.4, 16]} />
          <meshStandardMaterial color={p.shellMid} roughness={0.5} metalness={0.45} />
        </mesh>
        {[0.8, 1.7].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <cylinderGeometry args={[0.15, 0.15, 0.05, 16]} />
            <meshStandardMaterial color={p.shellDark} roughness={0.6} metalness={0.4} />
          </mesh>
        ))}
      </group>

      {/* ── Process tanks ────────────────────────────────────────────────── */}
      {([[1.75, 1.2], [2.35, 1.55]] as const).map(([x, z]) => (
        <group key={x} position={[x, 0, z]}>
          <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.26, 0.26, 1.1, 20]} />
            <meshStandardMaterial color={p.shellMid} roughness={0.4} metalness={0.55} />
          </mesh>
          <mesh position={[0, 1.1, 0]} castShadow>
            <sphereGeometry args={[0.26, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={p.shellMid} roughness={0.4} metalness={0.55} />
          </mesh>
        </group>
      ))}

      {/* ── Pipe rack joining the blocks ─────────────────────────────────── */}
      <group position={[0.6, 0, 1.0]}>
        {[-1.3, -0.4, 0.5, 1.4].map((x) => (
          <mesh key={x} position={[x, 0.38, 0]} castShadow>
            <boxGeometry args={[0.05, 0.76, 0.05]} />
            <meshStandardMaterial color={p.shellDark} roughness={0.6} metalness={0.5} />
          </mesh>
        ))}
        {[-0.08, 0.08].map((dz) => (
          <mesh key={dz} position={[0.05, 0.76, dz]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.04, 0.04, 2.9, 10]} />
            <meshStandardMaterial color={p.shellMid} roughness={0.45} metalness={0.55} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export default LoadCluster;
