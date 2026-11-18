"use client";

/**
 * The raised slab an asset stands on.
 *
 * In the reference, every equipment group sits on its own dark pad with a thin
 * lit edge. The pads do the compositional work: they group related geometry,
 * they give the cyan runs somewhere to terminate, and their edges are the only
 * thing separating near-black equipment bases from the near-black floor.
 *
 * The trim dims when its asset has no data, which is the scene's one consistent
 * "this is offline" signal — an unlit pad reads as absent without needing a
 * badge or a strikethrough anywhere in the HTML layer.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useScenePalette } from "./useScenePalette";
import { DECK_Y, type AccentKey } from "./layout";

export interface PlatformProps {
  position: [number, number, number];
  size: [number, number];
  accent: AccentKey;
  /** Dims the edge trim when false. */
  live?: boolean;
  children?: React.ReactNode;
}

const HEIGHT = DECK_Y;

export function Platform({ position, size, accent, live = true, children }: PlatformProps) {
  const p = useScenePalette();
  const tint = p[accent];
  const [w, d] = size;
  const trim = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const level = useRef(live ? 1 : 0);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const target = live ? 1 : 0;
    level.current += THREE.MathUtils.clamp(target - level.current, -dt * 3, dt * 3);
    if (trim.current) trim.current.emissiveIntensity = (0.15 + 2.1 * level.current) * p.glow;
    if (halo.current) halo.current.opacity = (0.05 + 0.16 * level.current) * p.glow;
  });

  return (
    <group position={position}>
      {/* Slab body. */}
      <mesh position={[0, HEIGHT / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, HEIGHT, d]} />
        <meshStandardMaterial color={p.platform} roughness={0.88} metalness={0.06} />
      </mesh>

      {/* Chamfered upper lip, a shade lighter so the top face reads separately. */}
      <mesh position={[0, HEIGHT - 0.012, 0]} receiveShadow>
        <boxGeometry args={[w - 0.14, 0.03, d - 0.14]} />
        <meshStandardMaterial color={p.platformEdge} roughness={0.8} metalness={0.1} />
      </mesh>

      {/* Lit edge trim. */}
      <mesh position={[0, 0.028, 0]}>
        <boxGeometry args={[w + 0.07, 0.045, d + 0.07]} />
        <meshStandardMaterial
          ref={trim}
          color={tint}
          emissive={tint}
          emissiveIntensity={2.1}
          roughness={0.35}
          toneMapped={false}
        />
      </mesh>

      {/* Ground bleed beneath the trim, so the pad sits in light rather than on it. */}
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w + 1.5, d + 1.5]} />
        <meshBasicMaterial
          ref={halo}
          color={tint}
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* Assets are authored with their feet at y=0 and lifted onto the deck here. */}
      <group position={[0, HEIGHT, 0]}>{children}</group>
    </group>
  );
}

export default Platform;
