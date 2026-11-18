"use client";

/**
 * The AC busbar every feeder lands on.
 *
 * A straight conductor on insulator posts, with a small breaker cubicle where
 * each feeder joins. It is the one place all power in the diagram meets, so it
 * lights whenever any feeder is carrying — a dark bus means a quiet site.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useScenePalette } from "./useScenePalette";

export interface BusbarProps {
  start: THREE.Vector3;
  end: THREE.Vector3;
  /** Where feeders land, world space. */
  taps: THREE.Vector3[];
  /** Any feeder active. */
  live: boolean;
}

const POST_EVERY = 2.2;

export function Busbar({ start, end, taps, live }: BusbarProps) {
  const p = useScenePalette();
  const core = useRef<THREE.MeshStandardMaterial>(null);
  const level = useRef(live ? 1 : 0);

  const length = start.distanceTo(end);
  const mid = start.clone().lerp(end, 0.5);
  const yaw = Math.atan2(-(end.z - start.z), end.x - start.x);
  const along = end.clone().sub(start).normalize();
  const posts = Math.max(2, Math.round(length / POST_EVERY));

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    level.current += THREE.MathUtils.clamp((live ? 1 : 0) - level.current, -dt * 3, dt * 3);
    if (core.current) core.current.emissiveIntensity = (0.3 + 1.8 * level.current) * p.glow;
  });

  return (
    <group>
      {/* Conductor. */}
      <mesh position={mid.toArray()} rotation={[0, yaw, 0]} castShadow>
        <boxGeometry args={[length, 0.09, 0.09]} />
        <meshStandardMaterial
          ref={core}
          color={p.cyan}
          emissive={p.cyan}
          emissiveIntensity={0.3}
          roughness={0.35}
          metalness={0.4}
          toneMapped={false}
        />
      </mesh>

      {/* Insulator posts. */}
      {Array.from({ length: posts + 1 }, (_, i) => {
        const pt = start.clone().addScaledVector(along, (i / posts) * length);
        return (
          <mesh key={i} position={[pt.x, pt.y / 2, pt.z]} castShadow>
            <cylinderGeometry args={[0.035, 0.05, pt.y, 8]} />
            <meshStandardMaterial color={p.shellMid} roughness={0.5} metalness={0.3} />
          </mesh>
        );
      })}

      {/* Breaker cubicle at each tap. */}
      {taps.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} rotation={[0, yaw, 0]}>
          <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.46, 0.6, 0.34]} />
            <meshStandardMaterial color={p.shell} roughness={0.6} metalness={0.25} />
          </mesh>
          <mesh position={[0, 0.45, 0.175]}>
            <boxGeometry args={[0.2, 0.035, 0.01]} />
            <meshStandardMaterial color={p.cyan} emissive={p.cyan} emissiveIntensity={1.6 * p.glow} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default Busbar;
