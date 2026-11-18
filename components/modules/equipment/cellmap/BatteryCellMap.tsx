"use client";

/**
 * BatteryCellMap — a live thermal map of one rack's cells.
 *
 *   <BatteryCellMap cells={cellData} mode="temperature" />
 *
 * `cells` is CellData[] straight from useCellData. Nothing here fetches,
 * simulates or fills in a value: a cell the API returned null for is drawn in
 * the no-reading grey and left out of every statistic, because a dead probe is
 * not a cold cell.
 *
 * ── Why one InstancedMesh ───────────────────────────────────────────────────
 *
 * A rack can carry several hundred cells. One React component per cell would
 * mean hundreds of objects, hundreds of draw calls and a reconciliation pass
 * every time a poll lands. Instead there is a single instanced mesh sharing
 * one geometry and one material, with per-cell colour living in the
 * instanceColor buffer.
 *
 * That buffer is written in an effect keyed on the data — not in useFrame.
 * Colour only changes when the API changes, and re-uploading it 60 times a
 * second to say the same thing is the easiest way to make a 500-cell pack
 * stutter.
 *
 * ── Getting per-cell emissive ───────────────────────────────────────────────
 *
 * instanceColor multiplies diffuse for free, but three has no per-instance
 * emissive, so a thermally-lit pack would glow one flat colour. The material
 * is patched in onBeforeCompile to multiply emissive by the same vColor the
 * instancing path already provides. Two lines, no extra attribute, and the
 * glow tracks the temperature the way the body does.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { CellData } from "@/lib/api/types";
import { roundedDisc } from "@/components/energy3d/geometry";
import {
  MODES,
  NO_READING,
  normalise,
  packStats,
  rampColor,
  rampCss,
  scaleEnds,
  legendBands,
  LEGEND_STEPS,
  type CellMode,
  type PackStats,
} from "./thermal";

// ── Pack layout, world units ─────────────────────────────────────────────────

// Proportioned like a real cylindrical cell (roughly 18650 aspect) rather
// than the squat pucks the first pass drew. Height is what makes a pack read
// as a pack at a 3/4 angle.
const CELL_R = 0.40;
const CELL_H = 3.2;
const PITCH = 1.02;

const ACCENT = "#5B8AB4";

/* The pack as it is built: 52 cells in series, 13 × 4, five packs to a
   cluster — the same layout and series snake as PackLayout. Packs sit one
   behind the other with a gap, each on its own tray. */
const PACK_COLS = 13;
const PACK_ROWS = 4;
const PER_PACK = PACK_COLS * PACK_ROWS;
const PACK_GAP = 1.4;   // world units between packs
const PACK_D = PACK_ROWS * PITCH;

/** Cell number from its id ("…_cell_37" → 37). */
const cellNoOf = (c: CellData) => Number(/(\d+)$/.exec(c.cellId)?.[1] ?? 0);

interface Placed {
  cell: CellData;
  value: number | null;
  x: number;
  z: number;
}

/** The instanced pack plus its hover/select behaviour. */
function Pack({
  placed,
  stats,
  mode,
  cols,
  trays,
  selected,
  onSelect,
  onHover,
}: {
  placed: Placed[];
  stats: PackStats | null;
  mode: CellMode;
  cols: number;
  /** Centre z of each pack's tray. */
  trays: number[];
  selected: number | null;
  onSelect: (i: number | null) => void;
  onHover: (i: number | null) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const float = useRef<THREE.Group>(null);

  const geometry = useMemo(() => roundedDisc(CELL_R, CELL_H, 0.13, 22), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      roughness: 0.36,
      metalness: 0.32,
      transparent: true,
      opacity: 0.94,
    });
    // Per-instance emissive. `vColor` is already varying because instancing
    // colour is in play; three simply never applies it to the emissive term.
    //
    // `.rgb` matters: three declares vColor as a vec4 here, and assigning it
    // straight into the vec3 totalEmissiveRadiance fails to compile — which
    // silently drops every cell from the scene while the tray still draws.
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;",
      );
    };
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveIntensity = 0.34;
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const scratch = useMemo(() => new THREE.Color(), []);

  // Transforms: only when the layout changes.
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    placed.forEach((p, i) => {
      dummy.position.set(p.x, CELL_H / 2, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.count = placed.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [placed, dummy]);

  /**
   * Target colours, recomputed only when the data or the mode changes.
   *
   * Held as a plain buffer rather than written straight to the mesh so the
   * frame loop has something to ease toward: switching mode has to glide, and
   * you cannot interpolate against a value you have already overwritten.
   */
  const targets = useMemo(() => {
    const buf = new Float32Array(placed.length * 3);
    const c = new THREE.Color();
    placed.forEach((p, i) => {
      if (p.value == null || stats == null) c.copy(NO_READING);
      else rampColor(normalise(p.value, stats, mode), mode, c);
      buf[i * 3] = c.r;
      buf[i * 3 + 1] = c.g;
      buf[i * 3 + 2] = c.b;
    });
    return buf;
  }, [placed, stats, mode]);

  /** True while the eased colours have not caught up with the targets. */
  const settling = useRef(true);
  useEffect(() => {
    settling.current = true;
  }, [targets]);

  // Seed instanceColor once, so the first frame is not black.
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    placed.forEach((_, i) => {
      scratch.setRGB(targets[i * 3], targets[i * 3 + 1], targets[i * 3 + 2]);
      m.setColorAt(i, scratch);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    settling.current = false;
    // Deliberately only on mount / count change: a mode switch must ease, and
    // seeding here would make it jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed.length]);

  // Whole-pack drift. Deliberately tiny: this is an instrument, and cells that
  // move relative to each other would imply something physical is happening.
  useFrame(({ clock }, delta) => {
    if (float.current) {
      float.current.position.y = Math.sin(clock.getElapsedTime() * 0.55) * 0.045;
    }

    // Ease instance colours toward the target buffer, then stop touching the
    // GPU entirely. Uploading a converged buffer every frame is the difference
    // between a 500-cell pack that idles free and one that does not.
    const m = mesh.current;
    if (!m || !m.instanceColor || !settling.current) return;

    const arr = m.instanceColor.array as Float32Array;
    const k = 1 - Math.exp(-6 * Math.min(delta, 0.1));
    let moved = 0;
    for (let i = 0; i < targets.length; i++) {
      const d = targets[i] - arr[i];
      arr[i] += d * k;
      const a = d < 0 ? -d : d;
      if (a > moved) moved = a;
    }
    m.instanceColor.needsUpdate = true;
    if (moved < 0.002) {
      arr.set(targets);
      m.instanceColor.needsUpdate = true;
      settling.current = false;
    }
  });

  const packW = cols * PITCH;

  const selectedPos = selected != null && placed[selected]
    ? new THREE.Vector3(placed[selected].x, CELL_H / 2, placed[selected].z)
    : null;

  return (
    <group ref={float}>
      {/* One tray per pack. Gives each pack a floor and the cells something
          to sit in, and shows where one pack ends and the next begins. */}
      {trays.map((z, i) => (
        <group key={i} position={[0, 0, z]}>
          <mesh position={[0, -0.09, 0]} receiveShadow>
            <boxGeometry args={[packW + 0.5, 0.18, PACK_D + 0.5]} />
            <meshStandardMaterial color={0x161d27} roughness={0.85} metalness={0.2} />
          </mesh>
          <mesh position={[0, 0.005, 0]}>
            <boxGeometry args={[packW + 0.58, 0.03, PACK_D + 0.58]} />
            <meshStandardMaterial
              color={ACCENT}
              emissive={ACCENT}
              emissiveIntensity={0.7}
              roughness={0.4}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}

      <instancedMesh
        ref={mesh}
        args={[geometry, material, Math.max(placed.length, 1)]}
        castShadow
        receiveShadow
        frustumCulled={false}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (e.instanceId != null) onHover(e.instanceId);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.instanceId == null) return;
          onSelect(e.instanceId === selected ? null : e.instanceId);
        }}
      />

      {/* Selection ring. A separate object rather than a changed instance:
          the others stay exactly as they were, which is the requirement. */}
      {selectedPos && (
        <group position={[selectedPos.x, 0.03, selectedPos.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[CELL_R * 1.25, CELL_R * 1.45, 32]} />
            <meshBasicMaterial color="#e8f2ff" transparent opacity={0.9} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, CELL_H / 2, 0]}>
            <cylinderGeometry args={[CELL_R * 1.1, CELL_R * 1.1, CELL_H * 1.04, 20, 1, true]} />
            <meshBasicMaterial
              color="#e8f2ff"
              transparent
              opacity={0.16}
              side={THREE.BackSide}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** Frames the pack and keeps the elevated 3/4 view the reference uses. */
function Rig({ cols, rows }: { cols: number; rows: number }) {
  /* Framed on the footprint's diagonal: five packs one behind the other are
     twice as deep as they are wide, and the longer side alone cropped the
     back trays and the near corner at the 3/4 angle. */
  const span = Math.hypot(cols * PITCH, rows * PITCH);
  const dist = span * 1.6 + 4;
  return (
    <>
      <OrbitControls
        makeDefault
        target={[0, CELL_H * 0.4, 0]}
        enablePan
        enableZoom
        minDistance={dist * 0.45}
        maxDistance={dist * 2}
        // Never let the camera drop to eye level or go fully top-down: both
        // lose the depth between rows that makes the pack readable.
        minPolarAngle={Math.PI / 7}
        maxPolarAngle={Math.PI / 2.6}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.6}
      />
    </>
  );
}

export interface BatteryCellMapProps {
  /** Straight from useCellData. The single source of truth. */
  cells: CellData[];
  /** Starting mode. The selector takes over from here. */
  mode?: CellMode;
  /**
   * Rack SOC, from ClusterData.
   *
   * Only used to say what the SOC mode cannot show. UGX mirrors rack SOC into
   * every per-cell register, so CellData.socPct is null and there is no
   * per-cell measurement to map. Rather than paint 240 cells one invented
   * colour, SOC mode reports the rack figure as a single number and says where
   * it came from. Pass null and it simply says the data is unavailable.
   */
  rackSoc?: number | null;
  height?: number;
}

const MODE_ORDER: CellMode[] = ["temperature", "voltage", "soc"];

export function BatteryCellMap({
  cells,
  mode: initialMode = "temperature",
  rackSoc = null,
  height = 420,
}: BatteryCellMapProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<CellMode>(initialMode);

  const spec = MODES[mode];
  const stats = useMemo(() => packStats(cells, mode), [cells, mode]);
  /* Packs by cell number, so a partial read keeps every cell in its own slot
     instead of reflowing into a smaller block. */
  const packCount = useMemo(
    () => Math.max(1, Math.ceil(Math.max(0, ...cells.map(cellNoOf)) / PER_PACK)),
    [cells],
  );
  const cols = PACK_COLS;
  const depth = packCount * PACK_D + (packCount - 1) * PACK_GAP;
  /* Depth in pitches, for the camera framing below. */
  const rows = Math.ceil(depth / PITCH);
  const trays = useMemo(
    () => Array.from({ length: packCount }, (_, p) => -depth / 2 + p * (PACK_D + PACK_GAP) + PACK_D / 2),
    [packCount, depth],
  );

  const placed = useMemo<Placed[]>(() => {
    const read = spec.read;
    return cells.map((cell) => {
      const k = Math.max(0, cellNoOf(cell) - 1);
      const pack = Math.floor(k / PER_PACK);
      const w = k % PER_PACK;
      const row = Math.floor(w / PACK_COLS);
      /* Series snake: A runs left to right, B back, and so on. */
      const col = row % 2 === 0 ? w % PACK_COLS : PACK_COLS - 1 - (w % PACK_COLS);
      return {
        cell,
        value: read(cell),
        x: (col - (PACK_COLS - 1) / 2) * PITCH,
        z: trays[pack] - PACK_D / 2 + (row + 0.5) * PITCH,
      };
    });
  }, [cells, spec, trays]);

  // A selection must not survive the pack changing shape underneath it.
  useEffect(() => {
    setSelected((s) => (s != null && s >= placed.length ? null : s));
  }, [placed.length]);

  const fmt = (v: number | null) =>
    v == null ? "—" : `${v.toFixed(spec.precision)} ${spec.unit}`;

  const active = hovered ?? selected;
  const activeCell = active != null ? placed[active] : undefined;

  /* Framed on the footprint's diagonal: five packs one behind the other are
     twice as deep as they are wide, and the longer side alone cropped the
     back trays and the near corner at the 3/4 angle. */
  const span = Math.hypot(cols * PITCH, rows * PITCH);
  const dist = span * 1.6 + 4;

  if (cells.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[11.5px] text-muted"
        style={{ height }}
      >
        No cell data for this rack.
      </div>
    );
  }

  return (
    <div className="flex gap-3 p-4" style={{ minHeight: height }}>
      {/* ── Scene ─────────────────────────────────────────────────────────── */}
      <div
        className="relative flex-1 rounded-lg overflow-hidden ring-1 ring-line"
        style={{ height, background: "#080c13" }}
      >
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={{ position: [dist * 0.62, dist * 0.6, dist * 0.72], fov: 32, near: 0.5, far: 400 }}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.5} color={0x9fb4d0} />
          <directionalLight
            position={[-14, 22, 12]}
            intensity={1.5}
            color={0xeaf2ff}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
            shadow-camera-left={-30}
            shadow-camera-right={30}
            shadow-camera-top={30}
            shadow-camera-bottom={-30}
            shadow-bias={-0.001}
          />
          <directionalLight position={[16, 8, -14]} intensity={0.7} color={ACCENT} />

          <Pack
            placed={placed}
            stats={stats}
            mode={mode}
            cols={cols}
            trays={trays}
            selected={selected}
            onSelect={setSelected}
            onHover={setHovered}
          />

          {activeCell && (
            <Html
              position={[activeCell.x, CELL_H + 0.5, activeCell.z]}
              center
              zIndexRange={[30, 0]}
              style={{ pointerEvents: "none" }}
            >
              <div
                className="font-mono"
                style={{
                  minWidth: 128,
                  padding: "7px 10px",
                  borderRadius: 7,
                  background: "rgba(8, 12, 19, 0.94)",
                  border: `1px solid ${ACCENT}66`,
                  boxShadow: "0 8px 24px rgba(0,0,0,.6)",
                  color: "#eaf1f8",
                  whiteSpace: "nowrap",
                }}
              >
                <div style={{ fontSize: 10, letterSpacing: "1.2px", color: "#8b97a6" }}>
                  {activeCell.cell.name || activeCell.cell.cellId}
                </div>
                <div style={{ fontSize: 9, letterSpacing: "1px", color: "#8b97a6", marginTop: 6 }}>
                  {spec.label.toUpperCase()}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {fmt(activeCell.value)}
                </div>
                {activeCell.value == null && (
                  <div style={{ fontSize: 9, color: "#c08a5a", marginTop: 3 }}>NO READING</div>
                )}
              </div>
            </Html>
          )}

          <ContactShadows
            position={[0, -0.19, 0]}
            scale={span * 2.4}
            resolution={1024}
            blur={2.6}
            opacity={0.5}
            far={6}
            color="#000000"
          />

          <Rig cols={cols} rows={rows} />
        </Canvas>

        <div
          className="absolute left-3 bottom-2 font-mono text-[9px] tracking-[1.3px] uppercase"
          style={{ color: "#68737f", pointerEvents: "none" }}
        >
          Drag To Orbit · Scroll To Zoom · Click A Cell
        </div>
      </div>

      {/* ── Mode selector, legend, readout ────────────────────────────────── */}
      <div className="flex flex-col gap-3" style={{ width: 140 }}>
        {/* Switching mode never remounts the canvas — only the target colour
            buffer changes, and the frame loop eases the cells across. */}
        <div className="flex bg-surface ring-1 ring-line rounded p-0.5">
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={[
                "flex-1 px-1 py-1 rounded text-[9.5px] font-mono uppercase tracking-[0.6px] transition-colors",
                mode === m ? "bg-accent/15 text-accent" : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {m === "temperature" ? "Temp" : m === "voltage" ? "Volt" : "SOC"}
            </button>
          ))}
        </div>

        <div>
          <div className="text-[9px] font-mono uppercase tracking-[1.2px] text-muted mb-1.5">
            {spec.label}
            {mode === "voltage" && <span className="text-[8px] normal-case"> · Vs Mean</span>}
          </div>
          <div className="flex gap-2" style={{ height: 190 }}>
            {/* Banded, like a solver's key: a band names a range, a smooth bar
                only names a direction. */}
            <div
              className="flex flex-col"
              style={{ width: 14, border: "1px solid var(--line)", borderRadius: 2, overflow: "hidden" }}
            >
              {stats
                ? legendBands(stats, mode).map((b, i) => (
                    <div key={i} style={{ flex: 1, background: b.css }} />
                  ))
                : <div style={{ flex: 1, background: rampCss(mode), opacity: 0.35 }} />}
            </div>
            {/* Endpoints come from the data, never from a fixed scale. */}
            {/* One tick per band edge, so a colour can be read back as a number. */}
            <div className="flex flex-col justify-between text-[9.5px] font-mono tabular-nums text-ink2 -my-[5px]">
              {(() => {
                if (!stats) return <><span>—</span><span /><span>—</span></>;
                const e = scaleEnds(stats, mode);
                const p = spec.precision;
                return Array.from({ length: LEGEND_STEPS + 1 }, (_, i) => {
                  const v = e.high - ((e.high - e.low) * i) / LEGEND_STEPS;
                  return (
                    <span key={i} className="leading-none">
                      <span className="text-muted mr-1">–</span>
                      {v.toFixed(p)}
                    </span>
                  );
                });
              })()}
            </div>
          </div>
        </div>

        {stats && (
          <div className="font-mono text-[10.5px] tabular-nums text-ink leading-snug">
            <div>Max = {stats.max.toFixed(spec.precision)}</div>
            <div>Min = {stats.min.toFixed(spec.precision)}</div>
          </div>
        )}

        <div className="flex flex-col gap-1.5 pt-1 border-t border-line">
          {([
            ["Max", stats?.max],
            ["Avg", stats?.avg],
            ["Min", stats?.min],
            ["Spread", stats?.spread],
          ] as const).map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <span className="text-[9.5px] font-mono uppercase tracking-[1px] text-muted">{k}</span>
              <span className="text-[12px] font-mono tabular-nums text-ink">
                {v == null ? "—" : v.toFixed(spec.precision)}
              </span>
            </div>
          ))}
        </div>

        {mode === "soc" && !stats && (
          <div className="text-[9.5px] font-mono leading-relaxed border-t border-line pt-2">
            <div style={{ color: "#c08a5a" }}>No Per-Cell SOC</div>
            <div className="text-muted mt-1">
              The BMS mirrors rack SOC into every cell register, so there is
              nothing per-cell to map.
            </div>
            <div className="mt-1.5 text-ink">
              Rack SOC{" "}
              <span className="tabular-nums">
                {rackSoc == null ? "—" : `${rackSoc.toFixed(1)} %`}
              </span>
            </div>
          </div>
        )}

        <div className="text-[9.5px] font-mono text-muted leading-relaxed">
          {stats ? `${stats.count} Cells` : "No Readings"}
          {stats && stats.missing > 0 && (
            <>
              <br />
              <span style={{ color: "#c08a5a" }}>{stats.missing} No Reading</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default BatteryCellMap;
