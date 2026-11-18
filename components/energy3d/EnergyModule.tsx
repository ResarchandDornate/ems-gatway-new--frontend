"use client";

/**
 * EnergyModule — a miniature energy-storage module, rendered live.
 *
 *   <EnergyModule value={soc} />
 *
 * A three-part stack, read bottom to top: a wide bevelled platform, a taller
 * translucent energy cell, and a rounded cuboid module with a lit core inset
 * into its top face.
 *
 * ── Geometry notes ──────────────────────────────────────────────────────────
 *
 * The two round sections are LatheGeometry, not cylinders. A cylinder has hard
 * 90° rims that catch light as a bright hairline and immediately read as
 * "default Three.js"; the reference has a soft roll on every edge. Lathing a
 * profile with rounded corners gives that roll in one draw, and the silhouette
 * is what carries the whole look at this size.
 *
 * The top module is a RoundedBox for the same reason — visibly radiused
 * corners, never a sharp cube.
 *
 * ── Material notes ──────────────────────────────────────────────────────────
 *
 * The blue is built in layers rather than painted on, because a single opaque
 * blue is exactly what makes this kind of icon look cheap:
 *
 *   · an outer shell using real refractive transmission,
 *   · an inner emissive volume that is the actual light source,
 *   · picked-out edges that catch the key light,
 *   · an additive halo standing in for bloom.
 *
 * That last one is a deliberate substitution. A real bloom pass would need
 * @react-three/postprocessing, a full-screen render chain and another
 * dependency; at 300px, additive shells give the same soft falloff for a
 * fraction of the cost. Worth revisiting if this ever renders large.
 *
 * ── Data ────────────────────────────────────────────────────────────────────
 *
 * `value` is 0..100 and comes from the caller. Nothing here fetches, invents,
 * randomises or animates a number on its own. null means "no reading" and
 * renders a visibly dormant module — distinct from a real zero, which renders
 * as a live module holding no charge.
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Edges, RoundedBox } from "@react-three/drei";
import * as THREE from "three";

// ── Palette ──────────────────────────────────────────────────────────────────

const NAVY = "#050a12";
/*
 * Built around #5B8AB4 — the accent this app already uses for active preset
 * buttons and charge bars. Two earlier passes missed it in opposite
 * directions: a saturated royal blue that read as moulded plastic, then a
 * bright ice-blue that read as neon. The house accent is a muted steel blue,
 * and matching it is what makes the object look like part of this product
 * rather than a widget dropped into it.
 *
 * Depth comes from translucency and the attenuation tint, not from the base
 * colour being dark or the highlights being hot.
 */
const SHELL_BLUE = 0x5b8ab4;   // the house accent, exactly
const ENERGY_BLUE = 0x7ba7cd;  // lit interior — the accent lifted, not hued
const CYAN = 0xa9cbe4;         // core + highlights, pale rather than electric
const EDGE = 0xb8d4e8;         // picked-out edges
const PALE = 0xe2eef7;         // near-white highlight
const DORMANT = 0x6b7684;

// ── Proportions ──────────────────────────────────────────────────────────────
// One unit ≈ the module's half-width. Tuned against the reference silhouette.

const BASE_R = 1.0;
const BASE_H = 0.13;   // a platform, not a torus — the first version read as a doughnut
const CELL_R = 0.70;
const CELL_H = 0.30;   // the glowing puck; the brightest element and the SOC readout
const TOP_W = 0.94;    // the dominant shape, as in the reference
const TOP_H = 0.44;
const TOP_RADIUS = 0.12;
const CORE_W = 0.34;

const BASE_Y = 0;
const CELL_Y = BASE_Y + BASE_H / 2 + 0.05 + CELL_H / 2;
const TOP_Y = CELL_Y + CELL_H / 2 + 0.045 + TOP_H / 2;

/**
 * A disc with rolled top and bottom edges.
 *
 * Profile is traced in the XY plane and revolved: bottom face outward, up
 * through a quarter-round, straight side, another quarter-round, then in
 * across the top. `bevel` is the roll radius.
 */
function roundedDisc(radius: number, height: number, bevel: number, segments = 48): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const h = height / 2;
  const b = Math.min(bevel, h * 0.9, radius * 0.4);
  const STEPS = 6;

  // Bottom face, centre outward to where the roll begins.
  pts.push(new THREE.Vector2(0.0001, -h));
  pts.push(new THREE.Vector2(radius - b, -h));
  // Bottom roll.
  for (let i = 1; i <= STEPS; i++) {
    const a = (i / STEPS) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + Math.sin(a) * b, -h + (1 - Math.cos(a)) * b));
  }
  // Top roll.
  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + Math.cos(a) * b, h - b + Math.sin(a) * b));
  }
  // Top face, inward to the axis.
  pts.push(new THREE.Vector2(0.0001, h));

  return new THREE.LatheGeometry(pts, segments);
}

/** Eased 0..1 tracking of the incoming value, plus a dormancy flag. */
function useLevel(input: number | null | undefined) {
  const target = input == null ? 0 : THREE.MathUtils.clamp(input, 0, 1);
  const dormant = input == null;

  const level = useRef(0);
  const dim = useRef(dormant ? 1 : 0);

  useFrame((_, delta) => {
    // Clamped: a backgrounded tab resumes with a very large delta.
    const dt = Math.min(delta, 0.1);
    level.current = THREE.MathUtils.damp(level.current, target, 2.4, dt);
    dim.current = THREE.MathUtils.damp(dim.current, dormant ? 1 : 0, 4, dt);
  });

  return { level, dim };
}

/**
 * The object itself, without a canvas.
 *
 * Exported so the metric field can render the same geometry in its own scene
 * rather than standing up eight more WebGL contexts. Authored in unit space
 * (base radius 1, standing on y≈0) and for a 3/4 view — callers using a
 * head-on camera must supply the isometric tilt themselves.
 *
 * `level` is 0..1, or null for no reading. It produces nothing on its own.
 */
export function EnergyModuleObject({ level: value }: { level: number | null }) {
  const { level, dim } = useLevel(value);

  const root = useRef<THREE.Group>(null);
  const energyFill = useRef<THREE.Mesh>(null);
  const energyMat = useRef<THREE.MeshStandardMaterial>(null);
  const baseGlowMat = useRef<THREE.MeshStandardMaterial>(null);
  const coreMat = useRef<THREE.MeshStandardMaterial>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const topShellMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const bandMat = useRef<THREE.MeshStandardMaterial>(null);

  const baseGeo = useMemo(() => roundedDisc(BASE_R, BASE_H, 0.055), []);
  const cellGeo = useMemo(() => roundedDisc(CELL_R, CELL_H, 0.085), []);
  // Inner volume sits just inside the cell shell so the shell reads as glass
  // with something behind it rather than as a tinted surface.
  const fillGeo = useMemo(() => roundedDisc(CELL_R * 0.965, CELL_H * 0.9, 0.075, 44), []);

  useEffect(
    () => () => {
      baseGeo.dispose();
      cellGeo.dispose();
      fillGeo.dispose();
    },
    [baseGeo, cellGeo, fillGeo],
  );

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const live = level.current * (1 - dim.current);
    // Slow enough to read as "alive", not as an animation. ~0.12 rpm.
    const breath = 0.82 + 0.18 * Math.sin(t * 1.15);

    if (root.current) {
      root.current.rotation.y = t * 0.0125;
      // ~3px of travel at this scale.
      root.current.position.y = Math.sin(t * 0.75) * 0.035;
    }

    // The cell fills from its base as the value rises.
    if (energyFill.current) {
      // Floor of 0.06 rather than 0: an empty-but-live cell should still read
      // as a cell, just an unlit one.
      const h = 0.06 + 0.94 * live;
      energyFill.current.scale.y = h;
      energyFill.current.position.y = -CELL_H * 0.41 + (CELL_H * 0.82 * h) / 2;
    }

    const tint = (m: THREE.MeshStandardMaterial | null, hot: number, base: number, span: number) => {
      if (!m) return;
      const c = dim.current > 0.5 ? DORMANT : hot;
      m.color.setHex(c);
      m.emissive.setHex(c);
      m.emissiveIntensity = base + span * live * breath;
    };

    // Wide spans: at 18% and 96% these must be obviously different objects,
    // which the first pass failed — every value looked the same.
    tint(energyMat.current, ENERGY_BLUE, 0.15, 5.0);
    tint(baseGlowMat.current, ENERGY_BLUE, 0.08, 1.6);
    tint(coreMat.current, CYAN, 0.35, 5.5);
    tint(bandMat.current, CYAN, 0.3, 3.2);

    if (haloMat.current) haloMat.current.opacity = 0.05 + 0.17 * live * breath;
    if (topShellMat.current) {
      topShellMat.current.emissiveIntensity = 0.04 + 0.75 * live * breath;
    }
  });

  return (
    <group ref={root}>
      {/* ── Lower platform ─────────────────────────────────────────────── */}
      <group position={[0, BASE_Y, 0]}>
        <mesh geometry={baseGeo} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={SHELL_BLUE}
            transmission={0.72}
            thickness={0.5}
            ior={1.35}
            roughness={0.34}
            metalness={0.1}
            clearcoat={0.45}
            clearcoatRoughness={0.4}
            transparent
            opacity={0.94}
            attenuationColor={new THREE.Color(0x40658a)}
            attenuationDistance={1.4}
          />
        </mesh>

        {/* Lit band inside the platform — the reference glows from within. */}
        {/* Same geometry instance as the shell, scaled down — sharing it is
            free, and <primitive attach> would hand R3F ownership of a
            geometry this component disposes itself. */}
        <mesh position={[0, -0.01, 0]} scale={[0.9, 0.5, 0.9]} geometry={baseGeo}>
          <meshStandardMaterial
            ref={baseGlowMat}
            color={ENERGY_BLUE}
            emissive={ENERGY_BLUE}
            emissiveIntensity={1}
            transparent
            opacity={0.7}
            roughness={0.3}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* ── Energy cell ────────────────────────────────────────────────── */}
      <group position={[0, CELL_Y, 0]}>
        <mesh geometry={cellGeo} castShadow>
          <meshPhysicalMaterial
            color={SHELL_BLUE}
            transmission={0.9}
            thickness={0.22}
            ior={1.42}
            roughness={0.1}
            metalness={0.05}
            clearcoat={1}
            clearcoatRoughness={0.1}
            transparent
            opacity={0.45}
            attenuationColor={new THREE.Color(0x4a7096)}
            attenuationDistance={1.1}
          />
        </mesh>

        {/* The lit interior. Scales from its base with the value. */}
        <mesh ref={energyFill} geometry={fillGeo} position={[0, 0, 0]}>
          <meshStandardMaterial
            ref={energyMat}
            color={ENERGY_BLUE}
            emissive={ENERGY_BLUE}
            emissiveIntensity={1.5}
            transparent
            opacity={0.82}
            roughness={0.25}
            toneMapped={false}
          />
        </mesh>

        {/* Equator band. The single brightest line in the reference, and what
            makes the puck read as a lit layer rather than a dark spacer. */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[CELL_R * 1.005, 0.022, 8, 64]} />
          <meshStandardMaterial
            ref={bandMat}
            color={CYAN}
            emissive={CYAN}
            emissiveIntensity={2}
            roughness={0.2}
            toneMapped={false}
          />
        </mesh>

        {/* A hairline catch on the puck's upper roll. Deliberately thin —
            the first pass used a fat torus here and it read as a white
            hula-hoop, which is nowhere in the reference. */}
        <mesh position={[0, CELL_H * 0.36, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[CELL_R * 0.99, 0.006, 6, 64]} />
          <meshBasicMaterial color={PALE} transparent opacity={0.5} toneMapped={false} />
        </mesh>
      </group>

      {/* ── Top module ─────────────────────────────────────────────────── */}
      <group position={[0, TOP_Y, 0]}>
        <RoundedBox
          args={[TOP_W, TOP_H, TOP_W]}
          radius={TOP_RADIUS}
          smoothness={6}
          castShadow
          receiveShadow
        >
          <meshPhysicalMaterial
            ref={topShellMat}
            color={SHELL_BLUE}
            emissive={ENERGY_BLUE}
            emissiveIntensity={0.1}
            /* Transmission at 0.8 made this near-invisible against a dark
               field — the shape vanished and only the edges survived. Held
               lower, with shorter attenuation, so the body keeps its blue. */
            transmission={0.45}
            thickness={1.1}
            ior={1.46}
            roughness={0.08}
            metalness={0.15}
            clearcoat={1}
            clearcoatRoughness={0.06}
            transparent
            opacity={0.95}
            attenuationColor={new THREE.Color(0x466d92)}
            attenuationDistance={0.55}
          />
          {/* Electric-blue edge pickout — the detail that sells the material. */}
          <Edges threshold={22} color={EDGE} />
        </RoundedBox>

        {/* Recessed well, so the core reads as embedded rather than stuck on. */}
        <mesh position={[0, TOP_H / 2 - 0.012, 0]}>
          <boxGeometry args={[CORE_W + 0.1, 0.03, CORE_W + 0.1]} />
          <meshStandardMaterial color={0x0d2246} roughness={0.5} metalness={0.4} />
        </mesh>

        {/* The core. */}
        <RoundedBox
          args={[CORE_W, 0.05, CORE_W]}
          radius={0.016}
          smoothness={4}
          position={[0, TOP_H / 2 - 0.004, 0]}
        >
          <meshStandardMaterial
            ref={coreMat}
            color={CYAN}
            emissive={CYAN}
            emissiveIntensity={2.5}
            roughness={0.1}
            metalness={0}
            toneMapped={false}
          />
        </RoundedBox>

        {/* Halo above the core — stands in for a bloom pass. */}
        <mesh position={[0, TOP_H / 2 + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[CORE_W * 1.5, 28]} />
          <meshBasicMaterial
            ref={haloMat}
            color={CYAN}
            transparent
            opacity={0.12}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}

/** Points the camera at the stack's optical centre rather than the origin. */
function CameraAim() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.lookAt(0, 0.42, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

export interface EnergyModuleProps {
  /**
   * 0..100. Supplied by the caller from existing data — this component never
   * produces a value of its own. null renders the module dormant, which is
   * deliberately distinct from a real zero.
   */
  value: number | null;
  /** Rendered size in CSS pixels. Square. */
  size?: number;
  /** Set false to sit on whatever is behind it instead of the deep-navy field. */
  background?: boolean;
  className?: string;
}

export function EnergyModule({
  value,
  size = 300,
  background = true,
  className,
}: EnergyModuleProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        background: background ? NAVY : "transparent",
        borderRadius: background ? 14 : 0,
        overflow: "hidden",
      }}
    >
      <Canvas
        // Mild perspective, not orthographic: the reference has just enough
        // convergence on the vertical edges to read as a photographed object.
        // A long lens keeps that honest without the splay a wide one gives.
        /* Pulled well back. The first framing cropped the top module and left
           no air; the reference is a small object in a large empty field. */
        camera={{ position: [4.35, 3.15, 4.35], fov: 26, near: 0.1, far: 60 }}
        dpr={[1, 2]}
        shadows
        gl={{ antialias: true, alpha: !background }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.18;
        }}
      >
        {/* Soft dark ambient — the object is lit by blue, not by white fill. */}
        <ambientLight intensity={0.5} color={0x9db6d2} />

        {/* Key, upper-left, slightly cool. Casts the contact shadow. */}
        <directionalLight
          position={[-3.2, 5, 3.4]}
          intensity={1.9}
          color={0xf2f8ff}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={0.5}
          shadow-camera-far={20}
          shadow-camera-left={-3}
          shadow-camera-right={3}
          shadow-camera-top={3}
          shadow-camera-bottom={-3}
          shadow-bias={-0.0012}
        />

        {/* Rim from behind-right, which is what separates the silhouette
            from the background at this value range. */}
        {/* Edge pickout is specular, not geometry: WebGL ignores line width,
            so <Edges> can only ever draw a 1px hairline. A hard cool rim from
            behind is what actually lights the bevels in the reference. */}
        <directionalLight position={[4, 1.6, -3.5]} intensity={2.6} color={CYAN} />
        <directionalLight position={[-2.6, 0.4, -3.0]} intensity={1.1} color={0x9fd4ff} />

        {/* Interior fill: sits inside the stack so the translucent layers have
            something to transmit. Without it the glass reads as grey — but at
            2.6 it blew the platform out into a white hotspot, so it is held
            low and tucked up inside the puck where the glow belongs. */}
        <pointLight position={[0, 0.34, 0]} intensity={0.9} distance={2.2} color={ENERGY_BLUE} />
        <pointLight position={[1.8, 0.2, 1.8]} intensity={0.5} distance={6} color={0x2b5fbf} />

        <CameraAim />

        <EnergyModuleObject level={value == null ? null : value / 100} />

        <ContactShadows
          position={[0, -BASE_H / 2 - 0.015, 0]}
          scale={3.4}
          resolution={512}
          blur={2.8}
          opacity={0.55}
          far={2.4}
          color="#000814"
        />
      </Canvas>
    </div>
  );
}

export default EnergyModule;
