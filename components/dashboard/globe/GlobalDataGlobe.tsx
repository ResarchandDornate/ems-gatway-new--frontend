"use client";

/**
 * GlobalDataGlobe — sites as illuminated spikes on a slowly turning Earth.
 *
 *   <GlobalDataGlobe sites={sites} metric="Installed Capacity" unit="MW" />
 *
 * ── What is live and what is not ────────────────────────────────────────────
 *
 * `value` on every site is real: it comes from the station API through
 * GroupScreen. Coordinates are not — the station API returns no latitude or
 * longitude, so positions come from the curated GEO_LOOKUP table that already
 * existed in GroupScreen for the previous globe. A site with no entry there
 * cannot be placed, which is the same limitation the old globe had.
 *
 * ── Why the spikes are one InstancedMesh ────────────────────────────────────
 *
 * A mesh per site means a draw call per site and a React element per site, and
 * the whole point of this view is that it should still hold 60fps when the
 * portfolio grows. One instanced mesh carries every spike; heights and colours
 * live in buffers that are written only when they actually change.
 *
 * Height changes ease rather than jump — a site going 40 → 75 grows into it —
 * and the easing runs in useFrame against a target array, so new API data
 * never rebuilds the scene, never resets the camera, and never interrupts a
 * drag in progress.
 *
 * ── Occlusion ───────────────────────────────────────────────────────────────
 *
 * Spikes are ordinary depth-tested geometry standing on a solid sphere, so the
 * far side is hidden by the Earth for free. Nothing is projected or faked; if
 * you rotate a spike behind the globe it goes away, which is most of what
 * makes the thing read as a sphere rather than a disc.
 */

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useThemeName } from "@/components/energy3d/useScenePalette";
import { DARK_GLOBE, LIGHT_GLOBE, hex, type GlobeTokens } from "./tokens";

export interface GlobeSite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** The metric driving spike height. Real API value. */
  value: number;
  status?: string;
}

const RADIUS = 1;
/** Tallest spike, as a fraction of the globe radius. */
const MAX_SPIKE = 0.42;
const MIN_SPIKE = 0.05;

/** The app already loads this texture for the previous globe. */
const EARTH_TEXTURE = "https://unpkg.com/three-globe/example/img/earth-dark.jpg";

/** Geographic coordinates → a point on the sphere. */
function latLngToVec3(lat: number, lng: number, r: number, out = new THREE.Vector3()) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return out.set(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

/** Warm ramp, low → peak. Never leaves orange/amber. */
function spikeColor(t: number, k: GlobeTokens, out = new THREE.Color()) {
  const a = new THREE.Color(k.dataLow);
  const b = new THREE.Color(k.dataMid);
  const c = new THREE.Color(k.dataHigh);
  const d = new THREE.Color(k.dataPeak);
  if (t < 0.34) return out.copy(a).lerp(b, t / 0.34);
  if (t < 0.7) return out.copy(b).lerp(c, (t - 0.34) / 0.36);
  return out.copy(c).lerp(d, (t - 0.7) / 0.3);
}

/** The sphere, its landmass and the atmospheric rim. */
function Earth({ k }: { k: GlobeTokens }) {
  const texture = useLoader(THREE.TextureLoader, EARTH_TEXTURE);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const rim = useRef<THREE.ShaderMaterial>(null);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }, [texture]);

  useFrame(() => {
    if (mat.current) {
      mat.current.color.setHex(k.continent);
      mat.current.emissive.setHex(k.surface);
    }
    if (rim.current) {
      rim.current.uniforms.uColor.value.setHex(k.atmosphere);
      rim.current.uniforms.uStrength.value = k.atmosphereStrength;
    }
  });

  return (
    <group>
      <mesh>
        <sphereGeometry args={[RADIUS, 64, 48]} />
        <meshStandardMaterial
          ref={mat}
          map={texture}
          color={k.continent}
          emissive={k.surface}
          // Low: emissive adds a flat term everywhere, and at 0.9 it drowned
          // the map completely — the globe rendered as an unlit grey sphere.
          // The key light does the work; this only keeps the night side from
          // going pure black.
          emissiveIntensity={0.3}
          roughness={0.72}
          metalness={0.18}
        />
      </mesh>

      {/*
        Fresnel rim. A back-side shell lit only where the surface turns away
        from the camera, which is what produces an atmosphere rather than an
        outline. A plain translucent sphere would wash the whole globe.
      */}
      <mesh scale={1.055}>
        <sphereGeometry args={[RADIUS, 48, 32]} />
        <shaderMaterial
          ref={rim}
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          uniforms={{
            uColor: { value: new THREE.Color(k.atmosphere) },
            uStrength: { value: k.atmosphereStrength },
          }}
          vertexShader={`
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              vView = normalize(-mv.xyz);
              gl_Position = projectionMatrix * mv;
            }
          `}
          fragmentShader={`
            uniform vec3 uColor;
            uniform float uStrength;
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
              float f = pow(1.0 - abs(dot(vNormal, vView)), 3.2);
              gl_FragColor = vec4(uColor, f * uStrength);
            }
          `}
        />
      </mesh>
    </group>
  );
}

/** Every site's spike, in one instanced mesh. */
function Spikes({
  sites,
  k,
  selected,
  onHover,
  onSelect,
}: {
  sites: GlobeSite[];
  k: GlobeTokens;
  selected: string | null;
  onHover: (i: number | null) => void;
  onSelect: (id: string | null) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => new THREE.Color(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const quat = useMemo(() => new THREE.Quaternion(), []);

  /** Target height per site, 0..1 of MAX_SPIKE. Recomputed only on new data. */
  const targets = useMemo(() => {
    const values = sites.map((s) => s.value).filter((v) => Number.isFinite(v));
    const max = values.length ? Math.max(...values) : 0;
    return sites.map((s) =>
      max > 0 && Number.isFinite(s.value) ? Math.max(s.value / max, 0) : 0,
    );
  }, [sites]);

  /** Eased heights. Persist across data changes so growth is visible. */
  const heights = useRef<number[]>([]);
  useEffect(() => {
    // Preserve what we already had; new sites grow from zero rather than
    // popping in at full height.
    const next = targets.map((_, i) => heights.current[i] ?? 0);
    heights.current = next;
  }, [targets]);

  /**
   * Seed the colour buffer before the first frame.
   *
   * three only defines USE_INSTANCING_COLOR — and only declares the `vColor`
   * varying the emissive patch below depends on — once instanceColor exists.
   * Setting colours for the first time inside useFrame is too late: the shader
   * has already compiled without it, and the whole material fails to build.
   */
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < Math.max(sites.length, 1); i++) {
      spikeColor(targets[i] ?? 0, k, c);
      m.setColorAt(i, c);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [sites.length, targets, k]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(delta, 0.1);

    for (let i = 0; i < sites.length; i++) {
      const target = targets[i] ?? 0;
      const cur = THREE.MathUtils.damp(heights.current[i] ?? 0, target, 3.2, dt);
      heights.current[i] = cur;

      const s = sites[i];
      latLngToVec3(s.lat, s.lng, RADIUS, pos);
      const normal = pos.clone().normalize();
      const h = MIN_SPIKE + cur * MAX_SPIKE;

      // Stand the cylinder on the surface, pointing straight out.
      quat.setFromUnitVectors(up, normal);
      dummy.position.copy(normal).multiplyScalar(RADIUS + h / 2);
      dummy.quaternion.copy(quat);
      const isSel = selected === s.id;
      dummy.scale.set(isSel ? 1.9 : 1, h, isSel ? 1.9 : 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);

      spikeColor(target, k, scratch);
      if (isSel) scratch.lerp(new THREE.Color(0xffffff), 0.35);
      m.setColorAt(i, scratch);
    }

    m.count = sites.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, Math.max(sites.length, 1)]}
      frustumCulled={false}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId != null) onHover(e.instanceId);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.instanceId == null) return;
        const id = sites[e.instanceId]?.id ?? null;
        onSelect(id === selected ? null : id);
      }}
    >
      {/* Thin, and unit-height so scale.y is the value. */}
      {/* Thin, but not sub-pixel: at the size this panel actually renders,
          the first pass was about half a pixel wide and invisible. */}
      <cylinderGeometry args={[0.016, 0.022, 1, 6]} />
      <meshStandardMaterial
        emissive={0xffffff}
        emissiveIntensity={0.9 * k.dataGlow}
        roughness={0.35}
        toneMapped={false}
        onBeforeCompile={(shader) => {
          // Per-instance emissive: instanceColor drives diffuse for free, but
          // three never applies it to the emissive term, so every spike would
          // glow the same colour. `.rgb` because vColor is a vec4 here.
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <emissivemap_fragment>",
            "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;",
          );
        }}
      />
    </instancedMesh>
  );
}

/** Small luminous markers at each site, sitting just proud of the surface. */
function SitePoints({ sites, k }: { sites: GlobeSite[]; k: GlobeTokens }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.getElapsedTime();
    sites.forEach((s, i) => {
      latLngToVec3(s.lat, s.lng, RADIUS * 1.004, pos);
      dummy.position.copy(pos);
      // A slow, staggered breath. Staggered by index so the field shimmers
      // instead of blinking in unison.
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.4 + i * 1.7);
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.count = sites.length;
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(sites.length, 1)]} frustumCulled={false}>
      <sphereGeometry args={[0.008, 8, 6]} />
      <meshBasicMaterial color={k.point} transparent opacity={0.9 * k.pointGlow} toneMapped={false} />
    </instancedMesh>
  );
}

/**
 * Arcs from the largest site to the next few.
 *
 * Held to three and to very low opacity on purpose: the brief asked for a
 * sense of network, and more than a handful of arcs turns the globe into
 * string art that hides the data it is supposed to support.
 */
function Connections({ sites, k }: { sites: GlobeSite[]; k: GlobeTokens }) {
  const curves = useMemo(() => {
    if (sites.length < 2) return [];
    const ranked = [...sites].sort((a, b) => b.value - a.value);
    const hub = ranked[0];
    return ranked.slice(1, 4).map((s) => {
      const a = latLngToVec3(hub.lat, hub.lng, RADIUS);
      const b = latLngToVec3(s.lat, s.lng, RADIUS);
      // Lift the midpoint off the surface so the arc bows outward.
      const mid = a.clone().add(b).multiplyScalar(0.5).normalize()
        .multiplyScalar(RADIUS * (1.12 + a.distanceTo(b) * 0.10));
      return new THREE.QuadraticBezierCurve3(a, mid, b);
    });
  }, [sites]);

  return (
    <group>
      {curves.map((c, i) => (
        <mesh key={i}>
          <tubeGeometry args={[c, 40, 0.0022, 6, false]} />
          <meshBasicMaterial
            color={k.arc}
            transparent
            opacity={k.arcOpacity}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Idle spin that yields to the user and resumes when they let go. */
function Scene({
  sites,
  k,
  selected,
  hovered,
  setHovered,
  setSelected,
  metric,
  unit,
}: {
  sites: GlobeSite[];
  k: GlobeTokens;
  selected: string | null;
  hovered: number | null;
  setHovered: (i: number | null) => void;
  setSelected: (id: string | null) => void;
  metric: string;
  unit: string;
}) {
  const spin = useRef<THREE.Group>(null);
  const interacting = useRef(false);

  useFrame((_, delta) => {
    if (!spin.current || interacting.current) return;
    spin.current.rotation.y += delta * 0.035;
  });

  const hoveredSite = hovered != null ? sites[hovered] : undefined;

  return (
    <>
      <ambientLight intensity={k.ambient} />
      <directionalLight position={[3, 2, 4]} intensity={k.key} color={0xffffff} />
      <directionalLight position={[-4, -1, -3]} intensity={0.35} color={k.atmosphere} />

      <group ref={spin}>
        {/*
          Earth suspends while its texture loads. Without this boundary the
          suspension propagates and nothing in the scene mounts — the spikes
          and points would wait on an image they do not need.
        */}
        <Suspense fallback={null}>
          <Earth k={k} />
        </Suspense>
        <Connections sites={sites} k={k} />
        <SitePoints sites={sites} k={k} />
        <Spikes
          sites={sites}
          k={k}
          selected={selected}
          onHover={setHovered}
          onSelect={setSelected}
        />

        {hoveredSite && (
          <Html
            position={latLngToVec3(hoveredSite.lat, hoveredSite.lng, RADIUS + MAX_SPIKE + 0.08).toArray()}
            center
            zIndexRange={[40, 0]}
            style={{ pointerEvents: "none" }}
          >
            <div
              className="font-mono"
              style={{
                padding: "6px 9px",
                borderRadius: 6,
                background: k.css.panelBg,
                border: `1px solid ${k.css.panelBorder}`,
                color: k.css.textPrimary,
                whiteSpace: "nowrap",
                boxShadow: "0 8px 22px rgba(0,0,0,.45)",
              }}
            >
              <div style={{ fontSize: 9.5, letterSpacing: "1.2px", textTransform: "uppercase" }}>
                {hoveredSite.name}
              </div>
              <div style={{ fontSize: 8.5, color: k.css.textSecondary, marginTop: 3 }}>
                {metric.toUpperCase()}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {hoveredSite.value.toFixed(2)}{" "}
                <span style={{ fontSize: 9, color: k.css.textSecondary }}>{unit}</span>
              </div>
            </div>
          </Html>
        )}
      </group>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom
        minDistance={1.6}
        maxDistance={4.2}
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.45}
        onStart={() => { interacting.current = true; }}
        onEnd={() => { interacting.current = false; }}
      />
    </>
  );
}

export interface GlobalDataGlobeProps {
  sites: GlobeSite[];
  /** Name of the metric the spikes encode, e.g. "Installed Capacity". */
  metric: string;
  unit: string;
  height?: number;
}

export function GlobalDataGlobe({ sites, metric, unit, height = 520 }: GlobalDataGlobeProps) {
  const theme = useThemeName();
  const host = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setAspect(r.width / r.height);
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) setAspect(r.width / r.height);
    return () => ro.disconnect();
  }, []);

  /**
   * Opening camera: far enough that the globe fits this container, aimed at
   * the data.
   *
   * Computed here rather than adjusted after mount. OrbitControls captures the
   * camera as its own state and writes it back every frame, so anything that
   * repositions the camera later is silently undone — the globe ends up
   * wherever the controls think it should be, which was off-frame.
   *
   * Aimed at the mean site position because this portfolio is entirely in
   * India: a default view over the Atlantic put every spike on the far side of
   * the sphere, correctly occluded and indistinguishable from a broken render.
   */
  const FOV = 34;
  const cameraPosition = useMemo<[number, number, number]>(() => {
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    let n = 0;
    for (const s of sites) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      v.add(latLngToVec3(s.lat, s.lng, 1, p));
      n++;
    }
    const facing = n === 0
      ? new THREE.Vector3(0, 0.35, 1).normalize()
      : v.divideScalar(n).normalize().add(new THREE.Vector3(0, 0.45, 0)).normalize();

    const vHalf = (FOV * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, 0.05));
    const half = Math.min(vHalf, hHalf);
    const dist = ((RADIUS + MAX_SPIKE) / Math.tan(half)) * 1.1;

    return facing.multiplyScalar(dist).toArray() as [number, number, number];
  }, [sites, aspect]);

  const k = theme === "light" ? LIGHT_GLOBE : DARK_GLOBE;

  const ranked = useMemo(
    () => [...sites].sort((a, b) => b.value - a.value).slice(0, 10),
    [sites],
  );
  const top = ranked[0]?.value ?? 0;

  // Until the theme is known there is nothing safe to draw: the server cannot
  // know it, and booting WebGL in the wrong palette only to rebuild is worse.
  if (theme === null) return <div style={{ height }} />;

  return (
    <div ref={host} style={{ position: "relative", width: "100%", height }}>
      <Canvas
        // Keyed on the framing so a container resize rebuilds the camera
        // rather than being overridden by OrbitControls a frame later.
        key={cameraPosition.join(",")}
        camera={{ position: cameraPosition, fov: FOV, near: 0.1, far: 100 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene
          sites={sites}
          k={k}
          selected={selected}
          hovered={hovered}
          setHovered={setHovered}
          setSelected={setSelected}
          metric={metric}
          unit={unit}
        />
      </Canvas>

      {/* ── Live indicator ─────────────────────────────────────────────── */}
      <div
        className="font-mono"
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 9,
          letterSpacing: "1.4px",
          color: k.css.textSecondary,
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: k.css.live,
            animation: "globePulse 2.4s ease-in-out infinite",
          }}
        />
        LIVE
      </div>

      {/* ── Ranking ────────────────────────────────────────────────────── */}
      {ranked.length > 0 && (
        <div
          className="font-mono"
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            width: 232,
            padding: "10px 12px",
            borderRadius: 8,
            background: k.css.panelBg,
            border: `1px solid ${k.css.panelBorder}`,
            backdropFilter: "blur(8px)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontSize: 9,
              letterSpacing: "1.3px",
              textTransform: "uppercase",
              color: k.css.textPrimary,
              marginBottom: 8,
            }}
          >
            Top {ranked.length} · {metric}
          </div>

          {ranked.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
              <span
                style={{
                  width: 74,
                  fontSize: 9,
                  color: k.css.textSecondary,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={s.name}
              >
                {s.name}
              </span>
              <span style={{ flex: 1, height: 4, borderRadius: 2, background: k.css.barTrack }}>
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    borderRadius: 2,
                    width: `${top > 0 ? Math.max((s.value / top) * 100, 2) : 0}%`,
                    background: hex(
                      spikeColor(top > 0 ? s.value / top : 0, k).getHex(),
                    ),
                  }}
                />
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: k.css.textPrimary,
                  fontVariantNumeric: "tabular-nums",
                  width: 46,
                  textAlign: "right",
                }}
              >
                {s.value.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes globePulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

export default GlobalDataGlobe;
