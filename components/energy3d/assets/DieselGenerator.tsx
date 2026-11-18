"use client";

/**
 * The diesel generator: a canopied genset on its fuel-tank base.
 *
 * The backend publishes no generator readings yet, so the set is usually drawn
 * idle. When it runs, the exhaust stack's cap glows and the radiator fan turns
 * — the same "moving means working" rule the battery yard follows.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useScenePalette } from "../useScenePalette";

export interface DieselGeneratorProps {
  running: boolean;
  /** Output as a fraction of the busiest asset, 0–1. */
  intensity: number;
}

const L = 2.3;
const H = 1.05;
const D = 1.1;

export function DieselGenerator({ running, intensity }: DieselGeneratorProps) {
  const p = useScenePalette();
  const fan = useRef<THREE.Group>(null);
  const cap = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1);
    if (fan.current) fan.current.rotation.x += (running ? 6 + 6 * intensity : 0) * dt;
    if (cap.current) {
      const flicker = 0.8 + 0.2 * Math.sin(clock.getElapsedTime() * 7);
      cap.current.emissiveIntensity = (running ? 1.2 + 1.6 * flicker : 0.1) * p.glow;
    }
  });

  return (
    <group position={[0, 0, 0.1]}>
      {/* Fuel-tank base. */}
      <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
        <boxGeometry args={[L + 0.2, 0.28, D + 0.2]} />
        <meshStandardMaterial color={p.shellMid} roughness={0.7} metalness={0.35} />
      </mesh>

      {/* Acoustic canopy. */}
      <mesh position={[0, 0.28 + H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[L, H, D]} />
        <meshStandardMaterial color={p.shell} roughness={0.6} metalness={0.25} />
      </mesh>
      {/* Roof lip. */}
      <mesh position={[0, 0.28 + H + 0.02, 0]} castShadow>
        <boxGeometry args={[L + 0.06, 0.04, D + 0.06]} />
        <meshStandardMaterial color={p.shellMid} roughness={0.55} metalness={0.35} />
      </mesh>

      {/* Service doors on the camera-facing side. */}
      {[-0.7, 0, 0.7].map((x) => (
        <group key={x} position={[x, 0.28 + H / 2, D / 2 + 0.006]}>
          <mesh>
            <boxGeometry args={[0.6, H - 0.2, 0.01]} />
            <meshStandardMaterial color={p.shellMid} roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[0.22, 0, 0.01]}>
            <boxGeometry args={[0.03, 0.14, 0.02]} />
            <meshStandardMaterial color={p.shellDark} />
          </mesh>
        </group>
      ))}

      {/* Radiator grille and fan at the +x end. */}
      <group position={[L / 2 + 0.006, 0.28 + H / 2, 0]}>
        <mesh>
          <boxGeometry args={[0.012, H - 0.22, D - 0.22]} />
          <meshStandardMaterial color={p.shellDark} roughness={0.8} metalness={0.3} />
        </mesh>
        {Array.from({ length: 7 }, (_, i) => (
          <mesh key={i} position={[0.01, -0.3 + i * 0.1, 0]}>
            <boxGeometry args={[0.012, 0.025, D - 0.26]} />
            <meshStandardMaterial color={p.shellMid} roughness={0.5} metalness={0.5} />
          </mesh>
        ))}
        <group ref={fan} position={[0.02, 0, 0]}>
          {[0, 1, 2, 3].map((b) => (
            <mesh key={b} rotation={[(b * Math.PI) / 2, 0, 0]}>
              <boxGeometry args={[0.01, 0.5, 0.07]} />
              <meshStandardMaterial color={p.shell} roughness={0.5} metalness={0.4} />
            </mesh>
          ))}
        </group>
      </group>

      {/* Exhaust stack and cap. */}
      <group position={[-0.65, 0.28 + H, -0.2]}>
        <mesh position={[0, 0.35, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 0.7, 12]} />
          <meshStandardMaterial color={p.shellMid} roughness={0.45} metalness={0.6} />
        </mesh>
        <mesh position={[0, 0.72, 0]}>
          <cylinderGeometry args={[0.09, 0.08, 0.06, 12]} />
          <meshStandardMaterial ref={cap} color={p.amber} emissive={p.amber} emissiveIntensity={0.1} toneMapped={false} />
        </mesh>
      </group>

      {/* Control panel status light. */}
      <mesh position={[-L / 2 - 0.006, 0.28 + H * 0.7, 0.2]}>
        <boxGeometry args={[0.012, 0.04, 0.18]} />
        <meshStandardMaterial color={p.cyan} emissive={p.cyan} emissiveIntensity={(running ? 2 : 0.4) * p.glow} toneMapped={false} />
      </mesh>
    </group>
  );
}

export default DieselGenerator;
