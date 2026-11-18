"use client";

/**
 * The battery yard: three containerised racks, a PCS cabinet, and an SOC bar.
 *
 * Each container is built to read as industrial equipment rather than a box:
 * corrugated sides, end doors with locking bars, a louvre vent bank, and two
 * rooftop cooling units whose fans turn while current is moving. A cyan strip
 * along each container pulses with charge or discharge; a still yard means a
 * still bank.
 *
 * The SOC bar on the PCS cabinet is the one piece of geometry that encodes a
 * value as a *length* — state of charge is read most often, and length is the
 * only channel here that can be read precisely without the HTML panel.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BessState } from "@/lib/energy/types";
import { useScenePalette } from "../useScenePalette";
import { socColor } from "../theme";

export interface BessYardProps {
  state: BessState;
  /** Throughput as a fraction of the bank's rating, 0–1. */
  intensity: number;
}

const CONTAINERS = [-1.45, 0, 1.45];
const LEN = 3.0;
const H = 1.24;
const DEP = 1.16;
const BAR_MAX = 1.05;

export function BessYard({ state, intensity }: BessYardProps) {
  const p = useScenePalette();
  const charging = state.status === "charging";
  const discharging = state.status === "discharging";
  const moving = charging || discharging;
  const flowTint = charging ? p.cyan : p.teal;

  /** One material for every status strip, so the whole yard pulses together. */
  const stripMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: p.cyan, emissive: p.cyan, emissiveIntensity: 1.2, roughness: 0.3, toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => stripMat.dispose(), [stripMat]);

  const bar = useRef<THREE.Mesh>(null);
  const barMat = useRef<THREE.MeshStandardMaterial>(null);
  const fans = useRef<(THREE.Group | null)[]>([]);

  const socTint = useMemo(() => socColor(state.soc, p), [state.soc, p]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const t = performance.now() / 1000;

    const rate = 1.6 + 3.4 * intensity;
    const pulse = 0.5 + 0.5 * Math.sin(t * rate);
    stripMat.emissiveIntensity = (moving ? 0.9 + 2.6 * pulse : 0.45) * p.glow;
    stripMat.color.setHex(flowTint);
    stripMat.emissive.setHex(flowTint);

    // The bar eases toward SOC so a poll boundary does not look like a step.
    if (bar.current && barMat.current) {
      const pct = state.soc == null ? 0 : THREE.MathUtils.clamp(state.soc, 0, 100) / 100;
      const width = Math.max(pct * BAR_MAX, 0.0001);
      const eased = THREE.MathUtils.damp(bar.current.scale.z, width, 6, dt);
      bar.current.scale.z = eased;
      bar.current.position.z = -BAR_MAX / 2 + eased / 2;
      bar.current.visible = state.soc != null;
      barMat.current.color.setHex(socTint);
      barMat.current.emissive.setHex(socTint);
    }

    // Cooling fans turn only when there is heat to move.
    const spin = (moving ? 5 : 0.4) * dt;
    for (const f of fans.current) if (f) f.rotation.y += spin;
  });

  return (
    <group position={[0.35, 0, 0]}>
      {CONTAINERS.map((z, ci) => (
        <group key={ci} position={[0, 0, z]}>
          {/* Skid. */}
          <mesh position={[0, 0.05, 0]} receiveShadow>
            <boxGeometry args={[LEN + 0.08, 0.1, DEP + 0.06]} />
            <meshStandardMaterial color={p.shellDark} roughness={0.85} metalness={0.2} />
          </mesh>

          {/* Shell. */}
          <mesh position={[0, 0.1 + H / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[LEN, H, DEP]} />
            <meshStandardMaterial color={p.shell} roughness={0.62} metalness={0.4} />
          </mesh>

          {/* Corner posts — the frame that makes it a container. */}
          {([[1, 1], [1, -1], [-1, 1], [-1, -1]] as const).map(([sx, sz], k) => (
            <mesh key={k} position={[sx * (LEN / 2 - 0.03), 0.1 + H / 2, sz * (DEP / 2 - 0.03)]}>
              <boxGeometry args={[0.08, H + 0.02, 0.08]} />
              <meshStandardMaterial color={p.shellMid} roughness={0.55} metalness={0.5} />
            </mesh>
          ))}

          {/* Corrugation on the long side facing the camera. */}
          {Array.from({ length: 14 }, (_, r) => (
            <mesh key={r} position={[-LEN / 2 + 0.2 + r * 0.2, 0.1 + H / 2, DEP / 2 + 0.008]}>
              <boxGeometry args={[0.05, H - 0.16, 0.016]} />
              <meshStandardMaterial color={p.shellMid} roughness={0.6} metalness={0.45} />
            </mesh>
          ))}

          {/* Louvre vent bank. */}
          <group position={[-0.95, 0.1 + H * 0.52, DEP / 2 + 0.02]}>
            <mesh>
              <boxGeometry args={[0.62, 0.5, 0.02]} />
              <meshStandardMaterial color={p.shellDark} roughness={0.8} metalness={0.3} />
            </mesh>
            {Array.from({ length: 6 }, (_, r) => (
              <mesh key={r} position={[0, -0.2 + r * 0.08, 0.015]} rotation={[-0.5, 0, 0]}>
                <boxGeometry args={[0.56, 0.035, 0.02]} />
                <meshStandardMaterial color={p.shellMid} roughness={0.55} metalness={0.5} />
              </mesh>
            ))}
          </group>

          {/* Status strip. */}
          <mesh position={[0.45, 0.1 + H - 0.14, DEP / 2 + 0.02]} material={stripMat}>
            <boxGeometry args={[1.5, 0.045, 0.012]} />
          </mesh>

          {/* End doors, with seam and locking bars. */}
          <group position={[LEN / 2 + 0.008, 0.1 + H / 2, 0]}>
            <mesh>
              <boxGeometry args={[0.012, 0.012 + H - 0.14, 0.012]} />
              <meshStandardMaterial color={p.shellDark} />
            </mesh>
            {[-0.36, -0.14, 0.14, 0.36].map((dz) => (
              <mesh key={dz} position={[0.01, 0, dz]}>
                <cylinderGeometry args={[0.016, 0.016, H - 0.2, 6]} />
                <meshStandardMaterial color={p.shellMid} roughness={0.4} metalness={0.7} />
              </mesh>
            ))}
          </group>

          {/* Rooftop cooling units. */}
          {[-0.75, 0.75].map((dx, k) => (
            <group key={k} position={[dx, 0.1 + H, 0]}>
              <mesh position={[0, 0.13, 0]} castShadow>
                <boxGeometry args={[0.72, 0.26, 0.72]} />
                <meshStandardMaterial color={p.shellMid} roughness={0.5} metalness={0.55} />
              </mesh>
              <mesh position={[0, 0.265, 0]}>
                <cylinderGeometry args={[0.24, 0.24, 0.012, 24]} />
                <meshStandardMaterial color={p.shellDark} roughness={0.8} />
              </mesh>
              <group ref={(g) => { fans.current[ci * 2 + k] = g; }} position={[0, 0.275, 0]}>
                {[0, 1, 2].map((b) => (
                  <mesh key={b} rotation={[0, (b * Math.PI * 2) / 3, 0]}>
                    <boxGeometry args={[0.42, 0.012, 0.07]} />
                    <meshStandardMaterial color={p.shell} roughness={0.45} metalness={0.5} />
                  </mesh>
                ))}
              </group>
              <mesh position={[0, 0.27, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.25, 0.015, 6, 28]} />
                <meshStandardMaterial color={p.cyan} emissive={p.cyan} emissiveIntensity={0.9 * p.glow} toneMapped={false} />
              </mesh>
            </group>
          ))}
        </group>
      ))}

      {/* PCS cabinet, its face toward the camera carrying the SOC bar. */}
      <group position={[-2.05, 0, 0]}>
        <mesh position={[0, 0.8, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.74, 1.6, 2.7]} />
          <meshStandardMaterial color={p.shell} roughness={0.55} metalness={0.45} />
        </mesh>
        {/* Cabinet door seams. */}
        {[-0.9, -0.3, 0.3, 0.9].map((dz) => (
          <mesh key={dz} position={[0.372, 0.8, dz]}>
            <boxGeometry args={[0.006, 1.4, 0.012]} />
            <meshStandardMaterial color={p.shellDark} />
          </mesh>
        ))}
        {/* Recessed track the bar fills. */}
        <mesh position={[0.38, 1.3, 0]}>
          <boxGeometry args={[0.012, 0.12, BAR_MAX + 0.08]} />
          <meshStandardMaterial color={p.platform} roughness={0.9} />
        </mesh>
        <mesh ref={bar} position={[0.39, 1.3, 0]}>
          <boxGeometry args={[0.012, 0.075, 1]} />
          <meshStandardMaterial
            ref={barMat}
            color={p.teal}
            emissive={p.teal}
            emissiveIntensity={2.6 * p.glow}
            roughness={0.3}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}

export default BessYard;
