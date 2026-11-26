"use client";

/**
 * The contents of the canvas: ground, lights, the busbar, one slab per asset
 * the site has, and a straight feeder from each slab to the bus.
 *
 * This component reads the plant once, from `useEnergy()`, and hands slices of
 * it down. Nothing below here fetches, polls or subscribes — see the note at
 * the top of lib/energy/EnergyProvider.tsx for why that boundary is worth
 * keeping strict.
 *
 * Each feeder carries its own asset's net power, in the direction the sign
 * says: into the bus for generation, discharge and import; out of it for load,
 * charge and export. That is the single-line reading of the plant, and it is
 * why no wire crosses another — see layout.ts.
 */

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { useEnergy } from "@/lib/energy/context";
import { buildLayout, DECK_Y, type NodeId, type SceneLayout } from "./layout";
import type { SiteAsset } from "@/lib/energy/topology";
import { FLOW_EPSILON_KW } from "@/lib/energy/flows";
import { Platform } from "./Platform";
import { PowerFlow } from "./PowerFlow";
import { Busbar } from "./Busbar";
import { SolarArray } from "./assets/SolarArray";
import { BessYard } from "./assets/BessYard";
import { GridYard } from "./assets/GridYard";
import { LoadCluster } from "./assets/LoadCluster";
import { DieselGenerator } from "./assets/DieselGenerator";
import { AssetCallout } from "./panels/AssetCallout";
import { LIGHT_POSITIONS, SHADOW_MAP_SIZE } from "./theme";
import { useScenePalette } from "./useScenePalette";

/** Formatters. `null` is "—", never 0. */
const kw = (v: number | null) => (v == null ? "—" : `${Math.abs(v).toFixed(1)} kW`);
const kwh = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} kWh`);
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
const degC = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)} °C`);
const hz = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)} Hz`);

/**
 * Frames the plant to the container, whatever shape the container is.
 *
 * An orthographic camera's framing is `pixels / zoom`, so a fixed zoom crops a
 * narrow panel and strands the model in a wide one. The first version guessed
 * at the scene's on-screen proportions with a magic ratio; it under-filled
 * badly once the stage was embedded in the dashboard next to the rails.
 *
 * This measures instead. The plant's world-space bounds come from the node
 * table, the eight corners are pushed through the camera's view matrix — for
 * an orthographic camera, view-space X and Y map straight to screen — and the
 * zoom that fits both axes wins. Move a slab and the framing follows.
 *
 * Only recomputed on resize. Doing it per frame would fight the user's scroll
 * wheel, since OrbitControls writes to the same `zoom`.
 */
const FIT_PADDING = 0.86;

/** Where the camera sits relative to what it looks at: the straight-on view. */
const HOME_OFFSET = new THREE.Vector3(22, 16, 22);
const HOME_TARGET = new THREE.Vector3(0, DECK_Y + 0.8, 0);

function FitToBounds({ bounds, points }: { bounds: THREE.Box3; points: THREE.Vector3[] }) {
  const { size, camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | null;
  const lastBounds = useRef<THREE.Box3 | null>(null);

  const corners = points;

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    if (!cam.isOrthographicCamera || !size.width || !size.height) return;

    /* A new configuration starts from the straight-on view, whatever the last
       one was orbited to — otherwise a drag on one case left the next drawn at
       an angle, with the bus no longer horizontal. A resize keeps the user's
       angle. The zoom is refit either way. */
    const fresh = lastBounds.current !== bounds;
    if (fresh) {
      lastBounds.current = bounds;
      cam.position.copy(HOME_TARGET).add(HOME_OFFSET);
      cam.lookAt(HOME_TARGET);
      if (controls) {
        controls.target.copy(HOME_TARGET);
        controls.update();
      }
    }

    cam.updateMatrixWorld();
    const view = new THREE.Matrix4().copy(cam.matrixWorld).invert();

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const v = new THREE.Vector3();
    for (const c of corners) {
      v.copy(c).applyMatrix4(view);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }

    const spanX = Math.max(maxX - minX, 0.001);
    const spanY = Math.max(maxY - minY, 0.001);
    cam.zoom = Math.min(size.width / spanX, size.height / spanY) * FIT_PADDING;
    cam.updateProjectionMatrix();

    /* Centre the plant in the frame. The camera looks at the middle of the
       layout's ground footprint, but tall equipment (pylons) and chips shift
       the on-screen middle; slide camera and target together, in the view
       plane, by the difference. Only on a fresh configuration, so a user's
       pan/rotate is not undone by a resize. */
    if (fresh) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const shift = new THREE.Vector3(cx, cy, 0).applyQuaternion(cam.quaternion);
      cam.position.add(shift);
      if (controls) {
        controls.target.add(shift);
        controls.update();
      }
    }
  }, [camera, controls, bounds, corners, size.width, size.height]);

  return null;
}

export function EnergyScene({ assets }: { assets: SiteAsset[] }) {
  const p = useScenePalette();
  const { snapshot, peak } = useEnergy();
  const { solar, bess, grid, load } = snapshot;
  const { size } = useThree();

  const layout: SceneLayout = useMemo(() => buildLayout(assets), [assets]);
  const nodes = layout.nodes;
  /* The diagram is shifted so its centre sits at the origin, where the camera
     looks. Aiming the camera at a moving centre instead would turn the view as
     the configuration changes, and the bus would stop reading as horizontal. */
  const focus = useMemo(() => layout.bounds.getCenter(new THREE.Vector3()).setY(0), [layout]);
  const framed = useMemo(
    () => layout.bounds.clone().translate(focus.clone().negate()),
    [layout, focus],
  );
  const framedPoints = useMemo(
    () => layout.points.map((pt) => pt.clone().sub(focus)),
    [layout, focus],
  );

  /**
   * Callouts are DOM and do not shrink with the model. Tie them to the canvas
   * width so an embedded stage keeps roughly the proportions the full-screen
   * view was designed at. Recomputed on resize only.
   */
  /* Under ~560 px (a phone) the chips go compact and a little smaller, or
     the side ones run off the canvas. */
  const compact = size.width < 560;
  const uiScale = THREE.MathUtils.clamp(size.width / 1400, compact ? 0.56 : 0.62, 1);

  /**
   * A single yardstick for "how hard is this asset working".
   *
   * Every asset's animation intensity is scaled against the busiest thing on
   * site rather than against its own nameplate, which the snapshot does not
   * carry. It means intensities are relative, not absolute — correct for a
   * scene whose job is showing where energy is going, not how close a unit is
   * to its rating.
   */
  const scale = useMemo(() => {
    const magnitudes = [
      solar.power ?? 0,
      Math.abs(bess.power ?? 0),
      Math.abs(grid.power ?? 0),
      load.power ?? 0,
    ];
    return Math.max(...magnitudes, 1);
  }, [solar.power, bess.power, grid.power, load.power]);

  const share = (v: number | null) => THREE.MathUtils.clamp(Math.abs(v ?? 0) / scale, 0, 1);

  /**
   * One feeder per asset present. `outOfBus` is the sign read into direction:
   * load always draws; the battery draws while charging (negative); the grid
   * takes power while the site exports (negative).
   *
   * A feeder runs on its own asset's reading alone. The pairwise flows from
   * lib/energy need a source AND a sink both reporting, so one dead meter —
   * the utility meter, today — stilled every wire, even while the battery was
   * plainly discharging into the bus. On a bus that pairing is not needed.
   */
  const feeders = useMemo(() => {
    const statusOf: Record<string, string | undefined> = {
      grid: grid.status, solar: solar.status, bess: bess.status, load: load.status,
    };
    const raw: Array<{ id: NodeId; value: number | null; outOfBus: boolean }> = [
      { id: "grid", value: grid.power, outOfBus: (grid.power ?? 0) < 0 },
      { id: "solar", value: solar.power, outOfBus: false },
      { id: "dg", value: null, outOfBus: false },
      { id: "bess", value: bess.power, outOfBus: (bess.power ?? 0) < 0 },
      { id: "load", value: load.power, outOfBus: true },
    ];
    return raw
      .filter((f) => nodes[f.id])
      .map((f) => ({
        id: f.id,
        outOfBus: f.outOfBus,
        power: Math.abs(f.value ?? 0),
        active: f.value != null && Math.abs(f.value) >= FLOW_EPSILON_KW,
        /* Energized but idle: its asset is reporting, even at zero power. */
        online: !!statusOf[f.id] && statusOf[f.id] !== "offline",
      }));
  }, [grid.power, solar.power, bess.power, load.power, grid.status, solar.status, bess.status, load.status, nodes]);

  /**
   * Flow along the bus itself, so power can be followed from the feeder it
   * enters by to the one it leaves by. Each stretch between two taps carries
   * the running total of everything injected to its left: positive runs
   * left → right, negative right → left. Taps at the same point along the bus
   * (one above, one below) are merged into one.
   */
  const busRuns = useMemo(() => {
    const taps = new Map<number, { point: THREE.Vector3; net: number }>();
    for (const f of feeders) {
      const n = nodes[f.id]!;
      const key = Math.round(n.u * 100) / 100;
      const t = taps.get(key) ?? { point: n.feeder.v2.clone(), net: 0 };
      if (f.active) t.net += (f.outOfBus ? -1 : 1) * f.power;
      taps.set(key, t);
    }
    const ordered = [...taps.entries()].sort(([a], [b]) => a - b).map(([, t]) => t);
    const runs: Array<{ key: string; curve: THREE.LineCurve3; power: number; active: boolean; reverse: boolean }> = [];
    let carried = 0;
    for (let i = 0; i < ordered.length - 1; i++) {
      carried += ordered[i].net;
      runs.push({
        key: `bus-${i}`,
        curve: new THREE.LineCurve3(ordered[i].point, ordered[i + 1].point),
        power: Math.abs(carried),
        active: Math.abs(carried) >= FLOW_EPSILON_KW,
        reverse: carried < 0,
      });
    }
    return runs;
  }, [feeders, nodes]);

  return (
    <>
      {/* ── Lighting ──────────────────────────────────────────────────────── */}
      <ambientLight intensity={p.lighting.ambient} />
      <directionalLight
        position={LIGHT_POSITIONS.key as unknown as [number, number, number]}
        intensity={p.lighting.key}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
        shadow-camera-near={0.1}
        shadow-camera-far={60}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />
      <directionalLight
        position={LIGHT_POSITIONS.rim as unknown as [number, number, number]}
        intensity={p.lighting.rim}
        color={p.steel}
      />
      <directionalLight
        position={LIGHT_POSITIONS.fill as unknown as [number, number, number]}
        intensity={p.lighting.fill}
      />

      {/* ── Ground ────────────────────────────────────────────────────────── */}
      {p.floor !== null && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[140, 140]} />
          <meshStandardMaterial color="#B7D488" roughness={1} metalness={0} />
        </mesh>
      )}
      {/* A gridHelper's material is a LineBasicMaterial; reach into it rather
          than replacing it with a mesh material that lines cannot use. */}
      <gridHelper
        args={[140, 56, "#9CBE6C", "#9CBE6C"]}
        position={[0, 0.004, 0]}
        material-transparent
        material-opacity={0.22}
      />

      {/* Softens the seat of every pad — cheaper and prettier than shadow alone. */}
      <ContactShadows
        position={[0, 0.012, 0]}
        scale={44}
        resolution={1024}
        blur={2.6}
        opacity={p.contactShadow}
        far={9}
        color="#000000"
      />

      <group position={[-focus.x, 0, -focus.z]}>
      {/* ── Bus and feeders ───────────────────────────────────────────────── */}
      <Busbar
        start={layout.bus.start}
        end={layout.bus.end}
        taps={Object.values(nodes).map((n) => n!.feeder.v2)}
        live={feeders.some((f) => f.active)}
      />
      {busRuns.map((r) => (
        <PowerFlow
          key={r.key}
          curve={r.curve}
          power={r.power}
          active={r.active}
          reverse={r.reverse}
          peak={peak}
          muted={snapshot.stale}
          standby={feeders.some((f) => f.online)}
        />
      ))}
      {feeders.map((f) => (
        <PowerFlow
          key={f.id}
          curve={nodes[f.id]!.feeder}
          power={f.power}
          active={f.active}
          reverse={f.outOfBus}
          peak={peak}
          muted={snapshot.stale}
          standby={f.online}
        />
      ))}

      {/* ── Assets ────────────────────────────────────────────────────────── */}
      {nodes.grid && (
        <Platform position={nodes.grid.position} size={nodes.grid.size} accent="cyan" live={grid.status !== "offline"}>
          <GridYard state={grid} intensity={share(grid.power)} />
        </Platform>
      )}
      {nodes.solar && (
        <Platform position={nodes.solar.position} size={nodes.solar.size} accent="cyan" live={solar.status !== "offline"}>
          <SolarArray state={solar} intensity={share(solar.power)} />
        </Platform>
      )}
      {nodes.dg && (
        <Platform position={nodes.dg.position} size={nodes.dg.size} accent="cyan" live={false}>
          <DieselGenerator running={false} intensity={0} />
        </Platform>
      )}
      {nodes.bess && (
        <Platform position={nodes.bess.position} size={nodes.bess.size} accent="cyan" live={bess.status !== "offline"}>
          <BessYard state={bess} intensity={share(bess.power)} />
        </Platform>
      )}
      {nodes.load && (
        <Platform position={nodes.load.position} size={nodes.load.size} accent="cyan" live={load.status !== "offline"}>
          <LoadCluster state={load} intensity={share(load.power)} />
        </Platform>
      )}

      {/* ── Callouts ──────────────────────────────────────────────────────── */}
      {nodes.grid && (
        <AssetCallout
          uiScale={uiScale}
          compact={compact}
          position={nodes.grid.callout}
          align={nodes.grid.calloutAlign}
          title="Utility Grid"
          primary={kw(grid.power)}
          status={grid.status}
          accent={p.cyan}
          offline={grid.status === "offline"}
          rows={[{ label: "Frequency", value: hz(grid.frequency), muted: grid.frequency == null }]}
        />
      )}
      {nodes.solar && (
        <AssetCallout
          uiScale={uiScale}
          compact={compact}
          position={nodes.solar.callout}
          align={nodes.solar.calloutAlign}
          title="Solar PV"
          primary={kw(solar.power)}
          status={solar.status}
          accent={p.cyan}
          offline={solar.status === "offline"}
          rows={[{
            label: "Today",
            value: kwh(solar.energy),
            muted: solar.energy == null,
          }]}
        />
      )}
      {nodes.dg && (
        <AssetCallout
          uiScale={uiScale}
          compact={compact}
          position={nodes.dg.callout}
          align={nodes.dg.calloutAlign}
          title="Diesel Generator"
          primary="—"
          status="no data"
          accent={p.cyan}
          offline
        />
      )}
      {nodes.bess && (
        <AssetCallout
          uiScale={uiScale}
          compact={compact}
          position={nodes.bess.callout}
          align={nodes.bess.calloutAlign}
          title="Battery · PCS"
          primary={kw(bess.power)}
          status={bess.status}
          accent={p.cyan}
          offline={bess.status === "offline"}
          rows={[
            { label: "SOC", value: pct(bess.soc), muted: bess.soc == null },
            { label: "Stored", value: kwh(bess.energy), muted: bess.energy == null },
            { label: "Cell Temp", value: degC(bess.temperature), muted: bess.temperature == null },
          ]}
        />
      )}
      {nodes.load && (
        <AssetCallout
          uiScale={uiScale}
          compact={compact}
          position={nodes.load.callout}
          align={nodes.load.calloutAlign}
          title="Site Load"
          primary={kw(load.power)}
          status={load.status}
          accent={p.cyan}
          offline={load.status === "offline"}
          rows={[{
            label: "Today",
            value: kwh(load.energy),
            muted: load.energy == null,
          }]}
        />
      )}

      </group>

      {/* ── Camera control ────────────────────────────────────────────────── */}
      <FitToBounds bounds={framed} points={framedPoints} />
      <OrbitControls
        makeDefault
        target={HOME_TARGET.toArray() as [number, number, number]}
        enablePan={false}
        enableZoom={false}
        enableRotate={false}
        // Held near the reference's eye level: free orbit would lose the
        // isometric read that makes the composition legible in the first place.
        minPolarAngle={Math.PI / 5}
        maxPolarAngle={Math.PI / 2.55}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.55}
      />
    </>
  );
}

export default EnergyScene;
