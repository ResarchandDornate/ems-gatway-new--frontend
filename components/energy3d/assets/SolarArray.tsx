"use client";

/**
 * The PV field: long tilted tables of modules, in rows.
 *
 * Each table is two modules high and seven wide, framed and on posts — the
 * shape of a real ground-mount string, and what makes the asset read as a solar
 * farm rather than a grid of tiles. Modules are one instanced mesh; the frames
 * behind them are another, so 56 modules cost two draw calls.
 *
 * Cells are dark in either palette. That breaks the "infrastructure is
 * neutral" rule on purpose: a pale panel is not recognisable as PV, and the
 * dark face is what identifies the asset at a glance. Generation lights the
 * faces with a faint cyan sheen — the cells glow, or they do not.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SolarState } from "@/lib/energy/types";
import { useScenePalette } from "../useScenePalette";

export interface SolarArrayProps {
  state: SolarState;
  /** Generation as a fraction of the array's nameplate, 0–1. */
  intensity: number;
}

const ROWS = 4;
const COLS = 7;
const MOD_W = 0.66;
const MOD_D = 0.4;
const GAP = 0.03;
const ROW_PITCH = 0.98;
/** Positive: the front (+z) edge drops, so the faces turn toward the camera. */
const TILT = Math.PI / 8;
const TABLE_H = 0.5;
const CELL = 0x1f2d40;

export function SolarArray({ state, intensity }: SolarArrayProps) {
  const p = useScenePalette();
  const modules = useRef<THREE.InstancedMesh>(null);
  const cellMat = useRef<THREE.MeshStandardMaterial>(null);
  const generating = state.status === "generating";

  const tableW = COLS * (MOD_W + GAP);
  const tableD = 2 * (MOD_D + GAP);

  /** Module transforms, relative to the field, computed once. */
  const matrices = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(TILT, 0, 0));
    for (let r = 0; r < ROWS; r++) {
      const rowZ = (r - (ROWS - 1) / 2) * ROW_PITCH;
      for (let c = 0; c < COLS; c++) {
        for (let k = 0; k < 2; k++) {
          const local = new THREE.Vector3(
            (c - (COLS - 1) / 2) * (MOD_W + GAP),
            0,
            (k - 0.5) * (MOD_D + GAP),
          ).applyQuaternion(tilt);
          out.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(local.x, TABLE_H + local.y + 0.02, rowZ + local.z),
              tilt,
              new THREE.Vector3(1, 1, 1),
            ),
          );
        }
      }
    }
    return out;
  }, []);

  // Static transforms, written once.
  useFrame(() => {
    const mesh = modules.current;
    if (!mesh || mesh.userData.placed) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.placed = true;
  });

  useFrame(({ clock }) => {
    if (!cellMat.current) return;
    const wave = 0.82 + 0.18 * Math.sin(clock.getElapsedTime() * 0.9);
    cellMat.current.emissiveIntensity = (generating ? 0.9 * wave * (0.3 + intensity) : 0) * p.glow;
  });

  const rows = Array.from({ length: ROWS }, (_, r) => (r - (ROWS - 1) / 2) * ROW_PITCH);

  return (
    <group position={[-0.2, 0, 0]}>
      {/* Modules. */}
      <instancedMesh
        ref={modules}
        args={[undefined, undefined, ROWS * COLS * 2]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <boxGeometry args={[MOD_W, 0.025, MOD_D]} />
        <meshStandardMaterial
          ref={cellMat}
          color={CELL}
          emissive={p.cyan}
          emissiveIntensity={0}
          roughness={0.28}
          metalness={0.6}
        />
      </instancedMesh>

      {rows.map((z) => (
        <group key={z} position={[0, 0, z]}>
          {/* Table frame behind the modules. */}
          <mesh position={[0, TABLE_H, 0]} rotation={[TILT, 0, 0]} castShadow>
            <boxGeometry args={[tableW + 0.06, 0.02, tableD + 0.06]} />
            <meshStandardMaterial color={p.shellMid} roughness={0.5} metalness={0.5} />
          </mesh>
          {/* Posts: a short front and a taller back leg at each bay. */}
          {[-tableW / 2 + 0.1, 0, tableW / 2 - 0.1].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh position={[0, (TABLE_H - 0.12) / 2, tableD * 0.34]} castShadow>
                <boxGeometry args={[0.04, TABLE_H - 0.12, 0.04]} />
                <meshStandardMaterial color={p.shellDark} roughness={0.6} metalness={0.5} />
              </mesh>
              <mesh position={[0, (TABLE_H + 0.12) / 2, -tableD * 0.34]} castShadow>
                <boxGeometry args={[0.04, TABLE_H + 0.12, 0.04]} />
                <meshStandardMaterial color={p.shellDark} roughness={0.6} metalness={0.5} />
              </mesh>
            </group>
          ))}
        </group>
      ))}

      {/* String inverters at the field edge. */}
      {[-0.7, 0.4].map((z) => (
        <group key={z} position={[tableW / 2 + 0.3, 0, z]}>
          <mesh position={[0, 0.34, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.36, 0.68, 0.46]} />
            <meshStandardMaterial color={p.shell} roughness={0.6} metalness={0.2} />
          </mesh>
          <mesh position={[0.185, 0.5, 0]}>
            <boxGeometry args={[0.01, 0.035, 0.24]} />
            <meshStandardMaterial color={p.cyan} emissive={p.cyan} emissiveIntensity={2 * p.glow} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default SolarArray;
