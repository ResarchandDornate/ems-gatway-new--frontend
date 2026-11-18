"use client";

/**
 * SocCore — the soft 3D state-of-charge object on the dashboard hero.
 *
 * A NEW object for the mobile app. The web app's 3D scenes (components/energy3d,
 * PowerFlowScene3D) are design-approved and untouched by this work.
 *
 * Reads as a sealed glass cell holding a rising column of light. SOC drives the
 * fill height and nothing else; when SOC is unavailable the core renders dark
 * and the caller states the absence in text, because a full-looking cell over
 * missing telemetry is exactly the fabrication §6.3 forbids.
 *
 * Deliberately cheap: no environment map (an HDR fetch would fail behind the
 * app's CSP and cost a megabyte), no post-processing, no shadows beyond a
 * single blurred contact plane. Five lights, five meshes. It has to hold 60 fps
 * on a 2 GB Android device, which §13 names as the performance floor.
 *
 * Tone mapping is ACES and emissive intensity is kept below 1. Without both,
 * an emissive fill clips straight to white and the object reads as a flat pale
 * slab rather than as lit volume — which is exactly what happened first time.
 */

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox, ContactShadows } from "@react-three/drei";
import * as THREE from "three";

/** Charging, discharging and idle read as different hues at a glance. */
function coreColor(power: number | null): string {
  if (power == null) return "#3B6FF6";
  if (power > 0.5)   return "#2DD4A7";   // discharging — supplying the site
  if (power < -0.5)  return "#7DD3FC";   // charging — taking in
  return "#3B6FF6";                       // idle
}

const CELL_H = 2.5;      // inner cavity height
const SHELL_H = 2.86;

function Core({ soc, power, light }: { soc: number | null; power: number | null; light: boolean }) {
  const group = useRef<THREE.Group>(null);
  const fill  = useRef<THREE.Group>(null);
  const glow  = useRef<THREE.PointLight>(null);

  const color = useMemo(() => coreColor(power), [power]);
  const three = useMemo(() => new THREE.Color(color), [color]);
  /* The fill's DIFFUSE colour is a near-black of the same hue, so the scene's
     white key and cyan rim cannot wash it out; all of its brightness comes
     from `emissive`. Lighting a saturated diffuse colour with strong white
     light is what turned this into pale mint on the first two attempts. */
  const fillBase = useMemo(() => new THREE.Color(color).multiplyScalar(0.09), [color]);
  // Clamp defensively: a bad reading must not scale geometry off-screen.
  const pct = soc == null ? 0 : Math.max(0, Math.min(100, soc)) / 100;

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // A slow float. Amplitude is small on purpose — the object should feel
    // suspended, not animated.
    if (group.current) {
      group.current.position.y = Math.sin(t * 0.62) * 0.05;
      group.current.rotation.y = Math.sin(t * 0.26) * 0.15;
    }

    // The fill eases toward its target rather than snapping, so a 30 s poll
    // that moves SOC by two points reads as the level rising.
    if (fill.current) {
      const target = Math.max(0.004, pct);
      const cur = fill.current.scale.y;
      const next = cur + (target - cur) * 0.05;
      fill.current.scale.y = next;
      fill.current.position.y = -CELL_H / 2 + (CELL_H * next) / 2;
    }

    // The internal light breathes very slightly, which is what stops the object
    // looking like a static render.
    if (glow.current) {
      glow.current.intensity = soc == null ? 0 : 2.2 + Math.sin(t * 1.4) * 0.35;
    }
  });

  return (
    <group ref={group}>
      {/* The column of light. Scaled from the base, so it rises rather than
          growing from its centre. Emissive stays under 1 — the brightness comes
          from the point light inside it, not from clipping the material. */}
      <group ref={fill} scale={[1, 0.004, 1]}>
        <RoundedBox args={[1.26, CELL_H, 1.26]} radius={0.16} smoothness={4}>
          <meshStandardMaterial
            color={fillBase}
            emissive={three}
            emissiveIntensity={0.62}
            roughness={0.42}
            metalness={0}
          />
        </RoundedBox>
      </group>

      {/* The glass shell. Rendered back-face-first so the far wall is visible
          through the near one — that double edge is most of what makes it read
          as glass rather than as a tinted box. */}
      <RoundedBox args={[1.66, SHELL_H, 1.66]} radius={0.34} smoothness={6}>
        <meshPhysicalMaterial
          color={light ? "#7E93B8" : "#DCE9FF"}
          transparent
          opacity={light ? 0.3 : 0.16}
          roughness={0.05}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.04}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </RoundedBox>

      {/* Terminal cap and base plinth — the small amount of hardware that keeps
          it from reading as an abstract cube.

          The plinth takes its value from the theme. A near-black plinth is
          right on the deep-navy ground and reads as a heavy blot on paper, so
          light mode gets a pale steel instead. */}
      <RoundedBox args={[0.86, 0.17, 0.86]} radius={0.06} smoothness={4} position={[0, SHELL_H / 2 + 0.05, 0]}>
        <meshStandardMaterial color={light ? "#8A9BB4" : "#D7E2F4"} roughness={0.26} metalness={0.85} />
      </RoundedBox>
      <RoundedBox args={[1.84, 0.15, 1.84]} radius={0.07} smoothness={4} position={[0, -SHELL_H / 2 - 0.07, 0]}>
        <meshStandardMaterial color={light ? "#B4C2D6" : "#61748F"} roughness={0.42} metalness={0.7} />
      </RoundedBox>

      <pointLight ref={glow} position={[0, -0.4, 0]} color={three} distance={6.5} intensity={2.2} />
    </group>
  );
}

export function SocCore({ soc, power, theme }: {
  soc: number | null; power: number | null; theme: "dark" | "light";
}) {
  const light = theme === "light";
  return (
    <Canvas
      camera={{ position: [0, 0.35, 6.6], fov: 32 }}
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.15,
      }}
      style={{ background: "transparent" }}
    >
      {/* Cool ambient fill, a white key from above-left, and a cyan rim from
          behind-right. The rim is what separates the object from the background
          without a drawn outline. */}
      {/* Light mode raises the ambient and drops the cyan rim: on paper the rim
          reads as a coloured fringe rather than as separation, and the object
          needs to sit IN the light rather than glow against it. */}
      <ambientLight intensity={light ? 1.15 : 0.34} color={light ? "#DCE7FA" : "#8FB4FF"} />
      <directionalLight position={[-3.6, 5.2, 3.8]} intensity={light ? 2.4 : 1.7} color="#FFFFFF" />
      <directionalLight position={[4.4, 1.2, -3.6]} intensity={light ? 1.1 : 3.2} color="#7DD3FC" />
      <pointLight position={[0, -3.2, 2.4]} intensity={light ? 0.5 : 1.2} color="#3B6FF6" />
      <pointLight position={[-2.6, 2.2, 2.8]} intensity={light ? 0.3 : 0.6} color="#FFFFFF" />

      <Core soc={soc} power={power} light={light} />

      <ContactShadows
        position={[0, -1.62, 0]}
        opacity={light ? 0.22 : 0.46}
        scale={8.5}
        blur={2.8}
        far={4}
        color={light ? "#26365C" : "#000814"}
      />
    </Canvas>
  );
}
