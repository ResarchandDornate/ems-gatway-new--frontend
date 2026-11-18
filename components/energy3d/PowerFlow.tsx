"use client";

/**
 * An animated power transfer along one feeder.
 *
 *   <PowerFlow curve={node.feeder} power={4.2} active />
 *
 * The component owns four separate readings of the same fact, because a viewer
 * should be able to answer different questions at different glance-lengths:
 *
 *   · that a path exists            — the dim casing, always drawn
 *   · that it is carrying           — the emissive core lights
 *   · which way                     — chevrons travel, and point, downstream
 *   · roughly how hard              — chevron spacing and speed both scale
 *
 * Chevron *density* is what actually encodes magnitude. Speed alone is a poor
 * channel: a fast trickle and a fast torrent look identical in a still frame
 * and nearly identical in motion. Spacing survives a screenshot.
 *
 * Direction is carried by the geometry, never by the sign of `power`: the
 * curve runs asset → bus, and `reverse` animates it bus → asset (a load
 * drawing, a battery charging, the site exporting). `power` stays positive.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useScenePalette } from "./useScenePalette";

export interface PowerFlowProps {
  /** The run, drawn from its start toward its end. */
  curve: THREE.Curve<THREE.Vector3>;
  /** kW. Always positive; direction comes from `from`/`to`. */
  power: number;
  active?: boolean;
  /** Animate against the flow direction. Visual override, not a data channel. */
  reverse?: boolean;
  /**
   * Largest concurrent flow on site, kW — the yardstick chevron density and
   * speed are scaled against. Omit and the flow is scaled against itself,
   * which makes every route look equally busy.
   */
  peak?: number | null;
  /** Flow colour. Defaults to the palette's cyan. */
  color?: number;
  /**
   * The reading is old. The run still shows which way power was last going,
   * but slower and dimmer, so a stale flow cannot be mistaken for a live one.
   */
  muted?: boolean;
}

/** Chevrons per world unit at full scale. Tuned so a busy run reads as a stream. */
const MAX_DENSITY = 0.72;
const MIN_CHEVRONS = 2;
/** Instance buffer size. Chevron count varies per frame; the buffer must not. */
const MAX_CHEVRONS = 26;

/** World units per second at full scale. */
const MAX_SPEED = 2.6;
const MIN_SPEED = 0.55;

/** Seconds for a flow to fade fully in or out. Keeps toggles from popping. */
const FADE_SECONDS = 0.35;

const UP = new THREE.Vector3(0, 1, 0);

export function PowerFlow({
  curve,
  power,
  active = true,
  reverse = false,
  peak = null,
  color,
  muted = false,
}: PowerFlowProps) {
  const p = useScenePalette();
  const tint = color ?? p.cyan;
  const length = useMemo(() => curve.getLength(), [curve]);

  const chevrons = useRef<THREE.InstancedMesh>(null);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);

  /** Animation phase, kept across frames so speed changes do not jump the pattern. */
  const phase = useRef(0);
  /** Eased 0–1 presence, driving every brightness in the component. */
  const presence = useRef(active ? 1 : 0);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tintColor = useMemo(() => new THREE.Color(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);
  const tangent = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    // Clamp: a backgrounded tab resumes with a large delta and would otherwise
    // teleport the pattern forward by however long the user was away.
    const dt = Math.min(delta, 0.1);

    const target = active && power > 0 ? (muted ? 0.45 : 1) : 0;
    const step = dt / FADE_SECONDS;
    presence.current += THREE.MathUtils.clamp(target - presence.current, -step, step);
    const presenceNow = presence.current;

    if (coreMat.current) {
      // The conductor sits proud of the sheath, and its colour moves from the
      // sheath's grey toward the flow tint as power arrives: an idle run reads
      // as cable, a live one as a lit cyan line — in either palette.
      coreMat.current.color.setHex(p.casing).lerp(tintColor.setHex(tint), 0.6 + 0.4 * presenceNow);
      coreMat.current.emissive.setHex(tint);
      coreMat.current.emissiveIntensity = (0.15 + 2.5 * presenceNow) * p.glow;
    }
    // Additive glow vanishes on white, so the light palette uses a normal
    // translucent halo instead.
    if (haloMat.current) haloMat.current.opacity = (p.name === "light" ? 0.06 + 0.18 * presenceNow : 0.16 * p.glow * presenceNow);

    const mesh = chevrons.current;
    if (!mesh) return;

    if (presenceNow < 0.01) {
      mesh.count = 0;
      return;
    }

    // Normalise against the busiest flow on site so magnitude is comparative.
    const scale = peak && peak > 0 ? THREE.MathUtils.clamp(power / peak, 0.08, 1) : 1;

    const count = THREE.MathUtils.clamp(
      Math.round(length * MAX_DENSITY * scale),
      MIN_CHEVRONS,
      MAX_CHEVRONS,
    );
    mesh.count = count;

    const speed = (MIN_SPEED + (MAX_SPEED - MIN_SPEED) * scale) * (muted ? 0.4 : 1);
    phase.current = (phase.current + (dt * speed) / length) % 1;

    for (let i = 0; i < count; i++) {
      // Even spacing, offset by the shared phase.
      let u = (phase.current + i / count) % 1;
      if (reverse) u = 1 - u;

      curve.getPointAt(u, dummy.position);
      curve.getTangentAt(u, tangent).normalize();
      if (reverse) tangent.negate();
      quat.setFromUnitVectors(UP, tangent);
      dummy.quaternion.copy(quat);

      // Taper the ends so chevrons arrive and depart rather than blinking on
      // top of the equipment they connect.
      const edge = Math.min(u, 1 - u);
      const taper = THREE.MathUtils.smoothstep(edge, 0, 0.06);
      dummy.scale.setScalar(presenceNow * taper * (0.7 + 0.5 * scale));

      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/*
        Casing — the physical cable. Deliberately thin and dark: an idle run
        must read as "a route exists" and nothing more. A heavier casing turned
        the yard into grey spaghetti that competed with the lit flows, which is
        exactly backwards for a diagram whose subject is the energy.
      */}
      <mesh castShadow receiveShadow>
        <tubeGeometry args={[curve, 24, 0.04, 8, false]} />
        <meshStandardMaterial color={p.casing} roughness={0.85} metalness={0.2} />
      </mesh>

      {/* Core — the energised conductor. */}
      <mesh>
        <tubeGeometry args={[curve, 24, 0.05, 10, false]} />
        <meshStandardMaterial
          ref={coreMat}
          color={tint}
          emissive={tint}
          emissiveIntensity={0.35}
          roughness={0.35}
          toneMapped={false}
        />
      </mesh>

      {/* Halo — stands in for a bloom pass. Additive, unlit, never shadowed. */}
      <mesh>
        <tubeGeometry args={[curve, 24, 0.13, 8, false]} />
        <meshBasicMaterial
          ref={haloMat}
          color={tint}
          transparent
          opacity={0}
          depthWrite={false}
          blending={p.name === "light" ? THREE.NormalBlending : THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* Chevrons — direction and magnitude. */}
      <instancedMesh
        ref={chevrons}
        args={[undefined, undefined, MAX_CHEVRONS]}
        frustumCulled={false}
      >
        <coneGeometry args={[0.15, 0.4, 12]} />
        <meshStandardMaterial
          color={tint}
          emissive={tint}
          emissiveIntensity={3.2 * p.glow}
          roughness={0.3}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}

export default PowerFlow;
