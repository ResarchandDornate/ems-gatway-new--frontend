"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// ── Palette ───────────────────────────────────────────────────────────────────
const ACCENT = 0x5b8ab4; // steel blue (grid)
const GREEN  = 0x4e8d6e; // sage green (load / healthy battery)
const BRASS  = 0x9c844a; // brass gold
const RED    = 0xa8505e; // warning red

interface Palette {
  flowCharge: number;
  flowDischarge: number;
  shell: number;
  shellDark: number;
  floor: number;
  gridMain: number;
  gridSection: number;
  gridOpacity: number;
  backdropLine: string;
  backdropOpacity: number;
  ink: string;
  inkShadow: string;
  chipBg: string;
  chipInk: string;
  chipShadow: string;
  ambient: number;
  keyIntensity: number;
  rimIntensity: number;
  exposure: number;
  glow: number;
}

const DARK_PALETTE: Palette = {
  flowCharge: 0x2fd8ee, // Cyan
  flowDischarge: 0x34d6b4, // Teal
  shell: 0xeef3f9,
  shellDark: 0xb9c6d6,
  floor: 0x080d16,
  gridMain: 0x1d2b3d,
  gridSection: ACCENT,
  gridOpacity: 0.4,
  backdropLine: "#5b8ab4",
  backdropOpacity: 0.5,
  ink: "#EEF3F9",
  inkShadow: "0 2px 10px rgba(0,0,0,.75)",
  chipBg: "rgba(8,13,20,0.92)",
  chipInk: "#F2F7FC",
  chipShadow: "0 6px 22px rgba(0,0,0,.55)",
  ambient: 0.55,
  keyIntensity: 2.0,
  rimIntensity: 0.45,
  exposure: 1.05,
  glow: 1,
};

const LIGHT_PALETTE: Palette = {
  flowCharge: 0x0e9aae,
  flowDischarge: 0x0e9a80,
  shell: 0x99a4b2,
  shellDark: 0x6f7b8a,
  floor: 0xe4ebf4,
  gridMain: 0xaebfd4,
  gridSection: 0x7d96b4,
  gridOpacity: 0.9,
  backdropLine: "#5b8ab4",
  backdropOpacity: 0.42,
  ink: "#16202C",
  inkShadow: "0 1px 2px rgba(255,255,255,.9)",
  chipBg: "rgba(255,255,255,0.94)",
  chipInk: "#0D1117",
  chipShadow: "0 6px 20px rgba(15,23,42,.16)",
  ambient: 0.88,
  keyIntensity: 1.45,
  rimIntensity: 0.26,
  exposure: 1.0,
  glow: 0.7,
};

let P: Palette = DARK_PALETTE;

// Node Coordinates in Rotated Scene Space
const X_NODE = -2.5, Z_NODE = -0.5; // Central Hub
const X_BESS = -0.2, Z_BESS = 1.8;  // Battery Storage
const X_LOAD = 2.0,  Z_LOAD = 2.2;  // Site Load
const X_GRID = 3.6,  Z_GRID = -1.6; // Grid pylon

const FACE = -Math.PI / 4;

export interface PowerFlowSceneProps {
  gridKw: number | null;
  loadKw: number | null;
  battKw: number | null;
  soc:    number | null;
  light?: boolean;
}

interface Label {
  el: HTMLDivElement;
  pos: THREE.Vector3;
}

// ── Builders ──────────────────────────────────────────────────────────────────

const matte = (color: number) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02 });

const metallic = (color: number) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.22, metalness: 0.88 });

const glass = (color: number) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.65 });

const lit = (color: number, intensity: number) =>
  new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity * P.glow,
    roughness: 0.3,
  });

function plinth(x: number, z: number, w: number, d: number, glowColor: number): THREE.Group {
  const g = new THREE.Group();

  // Main base block
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), matte(P.shell));
  m.position.set(x, 0.09, z);
  m.rotation.y = FACE;
  m.castShadow = m.receiveShadow = true;
  g.add(m);

  // Glowing base trim
  const glowGeo = new THREE.BoxGeometry(w + 0.08, 0.02, d + 0.08);
  const glowMat = lit(glowColor, 2.0);
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.position.set(x, 0.01, z);
  glowMesh.rotation.y = FACE;
  g.add(glowMesh);

  return g;
}

function buildLightningBolt(): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.35);
  shape.lineTo(0.14, 0.05);
  shape.lineTo(0.04, 0.05);
  shape.lineTo(0.14, -0.35);
  shape.lineTo(-0.14, -0.05);
  shape.lineTo(-0.04, -0.05);
  shape.closePath();

  const extrudeSettings = { depth: 0.06, bevelEnabled: false };
  const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geo.center();

  const mesh = new THREE.Mesh(geo, lit(0x2fd8ee, 3.5));
  mesh.rotation.y = FACE;
  mesh.castShadow = true;
  return mesh;
}

function buildHub(): THREE.Group {
  const g = new THREE.Group();

  // Outer glowing torus ring
  const ringGeo = new THREE.TorusGeometry(0.7, 0.06, 12, 48);
  const ringMat = lit(0x34d6b4, 2.5);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.2;
  g.add(ring);

  // Inner cabinet base
  const baseGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 24);
  const baseMat = matte(P.shellDark);
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.06;
  base.castShadow = base.receiveShadow = true;
  g.add(base);

  // Standing lightning bolt
  const bolt = buildLightningBolt();
  bolt.position.set(0, 0.45, 0);
  g.add(bolt);

  return g;
}

function buildPylon(on: boolean): THREE.Group {
  const g = new THREE.Group();
  const H = 4.6;
  const skin = matte(P.shell);
  const metalMat = metallic(P.shellDark);

  // Substation transformer block next to the tower
  const transBox = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.65, 0.7), metalMat);
  transBox.position.set(-0.5, 0.325, 0.5);
  transBox.castShadow = transBox.receiveShadow = true;
  g.add(transBox);

  // Transformer cooling panels on the sides
  for (const xOffset of [-0.37, 0.37]) {
    const rad = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.5), metalMat);
    rad.position.set(-0.5 + xOffset, 0.325, 0.5);
    g.add(rad);
  }

  // Insulator bushings stacking on top of the transformer
  for (const zOffset of [-0.2, 0, 0.2]) {
    const baseCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8), matte(P.shellDark));
    baseCyl.position.set(-0.5, 0.69, 0.5 + zOffset);
    g.add(baseCyl);

    const stackCount = 4;
    for (let i = 0; i < stackCount; i++) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10), lit(ACCENT, 0.8));
      disc.position.set(-0.5, 0.75 + i * 0.04, 0.5 + zOffset);
      g.add(disc);
    }
  }

  // Tower legs
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const a = new THREE.Vector3(sx * 0.62 + 0.3, 0.18, sz * 0.62 - 0.3);
    const b = new THREE.Vector3(sx * 0.16 + 0.3, H, sz * 0.16 - 0.3);
    const len = a.distanceTo(b);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.054, len, 6), skin);
    leg.position.copy(a.clone().lerp(b, 0.5));
    leg.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize(),
    );
    leg.castShadow = true;
    g.add(leg);
  }

  // Tower horizontal belts
  for (const y of [0.9, 1.9, 2.9, 3.7]) {
    const r = (0.62 - (0.62 - 0.16) * (y / H)) * 1.3;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 5, 4), skin);
    belt.position.set(0.3, y, -0.3);
    belt.rotation.x = Math.PI / 2;
    belt.rotation.z = Math.PI / 4;
    belt.castShadow = true;
    g.add(belt);
  }

  // Tower arms & insulators
  for (const [y, half] of [[3.5, 1.4], [4.3, 1.0]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.08, 0.14), skin);
    arm.position.set(0.3, y, -0.3);
    arm.castShadow = true;
    g.add(arm);
    for (const x of [-half * 0.82, half * 0.82]) {
      const ins = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.38, 8),
        on ? lit(ACCENT, 1.1) : matte(P.shellDark),
      );
      ins.position.set(0.3 + x, y - 0.24, -0.3);
      g.add(ins);
    }
  }

  return g;
}

function buildBattery(): { group: THREE.Group; socBar: THREE.Mesh; columns: THREE.Mesh[] } {
  const g = new THREE.Group();
  const skin = matte(P.shell);
  const metalMat = metallic(P.shellDark);
  const columns: THREE.Mesh[] = [];

  // Main BESS shipping-container style enclosure
  const container = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.25, 1.1), skin);
  container.position.set(0.0, 0.625 + 0.18, -0.2);
  container.castShadow = container.receiveShadow = true;
  g.add(container);

  // Corrugated rib lines on the container sides to make it look highly realistic
  const ribCount = 14;
  for (let i = 0; i < ribCount; i++) {
    const x = -1.05 + (i * 2.1) / (ribCount - 1);
    for (const zOffset of [-0.56, 0.56]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.1, 0.02), skin);
      rib.position.set(x, 0.625 + 0.18, -0.2 + zOffset);
      g.add(rib);
    }
  }

  // External cooling unit (HVAC block) on one end
  const hvac = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.9, 0.85), metalMat);
  hvac.position.set(1.28, 0.55 + 0.18, -0.2);
  hvac.castShadow = true;
  g.add(hvac);

  // HVAC circular fan outline
  const fanGlow = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 24), lit(P.flowCharge, 1.2));
  fanGlow.rotation.y = Math.PI / 2;
  fanGlow.position.set(1.445, 0.55 + 0.18, -0.2);
  g.add(fanGlow);

  // Plinth perimeter safety fence (posts + rails)
  const fenceMat = metallic(P.shellDark);
  const fencePosts = [
    [-1.3, 1.1], [1.3, 1.1], [1.3, -1.1], [-1.3, -1.1]
  ];
  fencePosts.forEach(([x, z]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), fenceMat);
    post.position.set(x, 0.3 + 0.18, z);
    post.castShadow = true;
    g.add(post);
  });

  // Top fence bar rails
  const topRail1 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.02, 0.02), fenceMat);
  topRail1.position.set(0, 0.58 + 0.18, 1.1);
  const topRail2 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.02, 0.02), fenceMat);
  topRail2.position.set(0, 0.58 + 0.18, -1.1);
  const topRail3 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 2.2), fenceMat);
  topRail3.position.set(1.3, 0.58 + 0.18, 0);
  const topRail4 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 2.2), fenceMat);
  topRail4.position.set(-1.3, 0.58 + 0.18, 0);
  g.add(topRail1, topRail2, topRail3, topRail4);

  // Vertical pulsing cyan slots representing battery status
  for (const xVal of [-0.6, -0.1, 0.4]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.02), lit(P.flowCharge, 2.4));
    col.position.set(xVal, 0.65 + 0.18, 0.36);
    columns.push(col);
    g.add(col);
  }

  // PCS cabinet standing in front
  const pcs = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.3, 0.65), skin);
  pcs.position.set(-0.4, 0.65 + 0.18, 0.65);
  pcs.castShadow = pcs.receiveShadow = true;
  g.add(pcs);

  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.01, 1.0, 0.01), matte(P.shellDark));
  seam.position.set(-0.4, 0.65 + 0.18, 0.98);
  g.add(seam);

  const track = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.01), matte(P.shellDark));
  track.position.set(-0.4, 0.95 + 0.18, 0.98);
  g.add(track);

  const socBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.01), lit(GREEN, 2.2));
  socBar.position.set(-0.61, 0.95 + 0.18, 0.985);
  g.add(socBar);

  return { group: g, socBar, columns };
}

function buildLoad(): { group: THREE.Group; bands: THREE.Mesh[] } {
  const g = new THREE.Group();
  const bands: THREE.Mesh[] = [];
  const skin = matte(P.shell);
  const glowMat = lit(GREEN, 2.8);
  const glassMat = glass(0x34d6b4);

  // Factory workshop block with slanted roofs
  const factory = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.4), skin);
  factory.position.set(-0.3, 0.5 + 0.18, -0.2);
  factory.castShadow = factory.receiveShadow = true;
  g.add(factory);

  // Slanted triangular roofs (using thin rotated boxes)
  for (const zVal of [-0.4, 0, 0.4]) {
    const roof1 = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 1.38), skin);
    roof1.position.set(-0.48 + zVal, 1.1 + 0.18, -0.2);
    roof1.rotation.z = Math.PI / 10;
    roof1.castShadow = true;
    g.add(roof1);
  }

  // Modern corporate glass-faced tower building
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.6, 0.85), skin);
  tower.position.set(0.5, 1.3 + 0.18, 0.4);
  tower.castShadow = tower.receiveShadow = true;
  g.add(tower);

  // Glass facade screen
  const facade = new THREE.Mesh(new THREE.BoxGeometry(0.72, 2.2, 0.02), glassMat);
  facade.position.set(0.5, 1.3 + 0.18, 0.835);
  g.add(facade);

  const levels = 5;
  for (let i = 0; i < levels; i++) {
    const y = 0.4 + i * 0.45;
    const stripFront = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.02), glowMat);
    stripFront.position.set(0.5, y + 0.18, 0.83);
    g.add(stripFront);
    bands.push(stripFront);
  }

  // Industrial silos / storage tanks
  const siloHeight = 1.3;
  for (const [x, z] of [[-0.8, 0.8], [-1.2, 0.4]]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, siloHeight, 16), metallic(P.shellDark));
    silo.position.set(x, siloHeight / 2 + 0.18, z);
    silo.castShadow = silo.receiveShadow = true;
    g.add(silo);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8), metallic(P.shellDark));
    cap.position.set(x, siloHeight + 0.18, z);
    g.add(cap);
  }

  // Antenna on top of the office building
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6), matte(P.shellDark));
  mast.position.set(0.5, 2.6 + 0.4 + 0.18, 0.4);
  g.add(mast);

  return { group: g, bands };
}

function buildBackdrop(): THREE.Mesh {
  const S = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d")!;

  const cells = 26;
  const step = S / cells;
  ctx.strokeStyle = P.backdropLine;
  ctx.lineWidth = 1.4;
  for (let i = 0; i <= cells; i++) {
    const p = Math.round(i * step) + 0.5;
    ctx.globalAlpha = i % 4 === 0 ? 0.5 : 0.2;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  const up = ctx.createLinearGradient(0, 0, 0, S);
  up.addColorStop(0, "rgba(0,0,0,1)");
  up.addColorStop(0.55, "rgba(0,0,0,0.4)");
  up.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = up;
  ctx.fillRect(0, 0, S, S);
  const side = ctx.createLinearGradient(0, 0, S, 0);
  side.addColorStop(0, "rgba(0,0,0,1)");
  side.addColorStop(0.22, "rgba(0,0,0,0)");
  side.addColorStop(0.78, "rgba(0,0,0,0)");
  side.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, S, S);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 17),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: P.backdropOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.position.set(0, 6.4, -9);
  return mesh;
}

function buildBeacon(color: number) {
  const g = new THREE.Group();
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), lit(color, 3.0));
  lamp.position.y = 0.24;
  g.add(lamp);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.2, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  g.add(ring);
  return { group: g, lamp, ring };
}

function buildConduit(p1: [number, number], p2: [number, number], color: number, weight = 1.0) {
  const g = new THREE.Group();
  const a = new THREE.Vector3(p1[0], 0.34, p1[1]);
  const b = new THREE.Vector3(p2[0], 0.34, p2[1]);
  
  const mid = a.clone().lerp(b, 0.5).setY(0.44);
  const curve = new THREE.CatmullRomCurve3([a, mid, b]);

  const casing = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.11 * weight, 12, false), matte(P.shell));
  casing.castShadow = casing.receiveShadow = true;
  g.add(casing);

  const core = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.055 * weight, 10, false), lit(color, 2.6));
  g.add(core);

  const cones: THREE.Mesh[] = [];
  const coneGeo = new THREE.ConeGeometry(0.1 * weight * 1.35, 0.26 * weight * 1.35, 12);
  const coneMat = lit(color, 3.2);
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(coneGeo, coneMat);
    cones.push(c);
    g.add(c);
  }

  return { group: g, curve, cones, core };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PowerFlowScene3D(props: PowerFlowSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    P = props.light ? LIGHT_PALETTE : DARK_PALETTE;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = P.exposure;
    mount.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" });

    const scene = new THREE.Scene();

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 200);
    camera.position.set(16, 12, 16);
    camera.lookAt(0, 1.2, 0);

    scene.add(new THREE.AmbientLight(0xffffff, P.ambient));
    const key = new THREE.DirectionalLight(0xffffff, P.keyIntensity);
    key.position.set(-8, 13, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = props.light ? 7 : 3;
    key.shadow.blurSamples = 16;
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -14; cam.right = 14; cam.top = 14; cam.bottom = -14;
    cam.updateProjectionMatrix();
    scene.add(key);
    
    const rim = new THREE.DirectionalLight(ACCENT, P.rimIntensity);
    rim.position.set(9, 5, -7);
    scene.add(rim);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: P.floor, roughness: 0.9, metalness: 0.15 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid helper
    const grid = new THREE.GridHelper(60, 54, P.gridSection, P.gridMain);
    (grid.material as THREE.Material).opacity = P.gridOpacity;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.006;
    scene.add(grid);

    // Main group rotated 45°
    const root = new THREE.Group();
    root.rotation.y = Math.PI / 4;
    root.scale.setScalar(0.72);
    scene.add(root);

    // Plinths with custom glowing base outlines
    const plHub  = plinth(X_NODE, Z_NODE, 2.4, 2.4, 0x34d6b4);
    const plBess = plinth(X_BESS, Z_BESS, 2.8, 2.4, 0x2fd8ee);
    const plGrid = plinth(X_GRID, Z_GRID, 2.6, 2.6, ACCENT);
    const plLoad = plinth(X_LOAD, Z_LOAD, 2.8, 2.8, GREEN);
    root.add(plHub, plBess, plGrid, plLoad);

    // Visual assets
    const hubMesh = buildHub();
    hubMesh.position.set(X_NODE, 0, Z_NODE);
    root.add(hubMesh);

    const gridOn = propsRef.current.gridKw != null;
    const pylon = buildPylon(gridOn);
    pylon.rotation.y = FACE;
    pylon.position.set(X_GRID, 0, Z_GRID);
    root.add(pylon);

    const batt = buildBattery();
    batt.group.rotation.y = FACE;
    batt.group.position.set(X_BESS, 0, Z_BESS);
    root.add(batt.group);

    const load = buildLoad();
    load.group.rotation.y = FACE;
    load.group.position.set(X_LOAD, 0, Z_LOAD);
    root.add(load.group);

    // Conduits from assets to central hub
    const gridRun = buildConduit([X_GRID - 0.8, Z_GRID + 0.8], [X_NODE + 0.8, Z_NODE - 0.8], ACCENT);
    const loadRun = buildConduit([X_NODE + 0.8, Z_NODE + 0.8], [X_LOAD - 0.8, Z_LOAD - 0.8], GREEN);
    const battRun = buildConduit([X_NODE + 0.2, Z_NODE + 0.8], [X_BESS - 0.2, Z_BESS - 0.8], P.flowCharge, 1.3);
    root.add(gridRun.group, loadRun.group, battRun.group);

    root.add(buildBackdrop());

    // Beacons next to assets
    const beacons = [
      { b: buildBeacon(ACCENT), x: X_GRID, z: Z_GRID, on: () => propsRef.current.gridKw != null },
      { b: buildBeacon(P.flowDischarge), x: X_BESS, z: Z_BESS, on: () => propsRef.current.battKw != null || propsRef.current.soc != null },
      { b: buildBeacon(GREEN), x: X_LOAD, z: Z_LOAD, on: () => propsRef.current.loadKw != null },
    ];
    for (const bc of beacons) {
      bc.b.group.position.set(bc.x - 1.0, 0.18, bc.z + 1.0);
      root.add(bc.b.group);
    }

    // ── Labels: DOM overlaid on the canvas, positioned by projection ─────────
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden",
    });
    mount.appendChild(overlay);

    const mkCaption = (text: string, pos: THREE.Vector3): Label => {
      const el = document.createElement("div");
      el.textContent = text;
      Object.assign(el.style, {
        position: "absolute", transform: "translate(-50%,-50%)", whiteSpace: "nowrap",
        font: "700 11px var(--font-mono), ui-monospace, monospace",
        letterSpacing: "2.2px", color: P.ink, textShadow: P.inkShadow,
      });
      overlay.appendChild(el);
      return { el, pos };
    };

    const mkCallout = (pos: THREE.Vector3): Label => {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute", transform: "translate(-50%,-50%)", whiteSpace: "nowrap",
        textAlign: "center", borderRadius: "8px", padding: "5px 11px",
        background: P.chipBg, border: "1px solid rgba(120, 150, 190, 0.2)",
        boxShadow: P.chipShadow,
        font: "var(--font-sans), Inter, system-ui, sans-serif",
      });
      overlay.appendChild(el);
      return { el, pos };
    };

    const caps = [
      mkCaption("GRID · UTILITY",   new THREE.Vector3(X_GRID, 0.1, Z_GRID + 1.6)),
      mkCaption("BATTERY · PCS",   new THREE.Vector3(X_BESS, 0.1, Z_BESS + 1.5)),
      mkCaption("SITE LOAD",       new THREE.Vector3(X_LOAD, 0.1, Z_LOAD + 1.6)),
      mkCaption("ENERGY HUB",      new THREE.Vector3(X_NODE, 0.1, Z_NODE + 1.4)),
    ];

    const coGrid = mkCallout(new THREE.Vector3(X_GRID, 4.4, Z_GRID));
    const coLoad = mkCallout(new THREE.Vector3(X_LOAD, 3.8, Z_LOAD));
    const coBatt = mkCallout(new THREE.Vector3(X_BESS, 3.2, Z_BESS));
    const coNode = mkCallout(new THREE.Vector3(X_NODE, 2.2, Z_NODE));

    const kw = (v: number | null) => (v == null ? "—" : `${Math.abs(v).toFixed(1)} kW`);
    const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

    function paintCallout(l: Label, value: string, sub: string, color: number) {
      l.el.style.border = `1px solid ${hex(color)}`;
      l.el.innerHTML =
        `<div style="font-size:13px;font-weight:700;color:${P.chipInk};font-variant-numeric:tabular-nums">${value}</div>` +
        `<div style="font-size:8px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${hex(color)};margin-top:1px">${sub}</div>`;
    }

    function resize() {
      const w = mount!.clientWidth, h = mount!.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      const worldW = 19, aspect = w / h;
      camera.left = -worldW / 2; camera.right = worldW / 2;
      camera.top = worldW / (2 * aspect); camera.bottom = -worldW / (2 * aspect);
      camera.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // ── Frame loop ───────────────────────────────────────────────────────────
    let raf = 0;
    const clock = new THREE.Clock();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();

    function separate(labels: Label[]) {
      const boxes = labels.map((l) => ({
        l,
        x: parseFloat(l.el.style.left) || 0,
        y: parseFloat(l.el.style.top) || 0,
        w: l.el.offsetWidth,
        h: l.el.offsetHeight,
      })).sort((a, b) => a.y - b.y);

      for (let i = 1; i < boxes.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = boxes[j], b = boxes[i];
          const needX = (a.w + b.w) / 2 + 8;
          const needY = (a.h + b.h) / 2 + 8;
          if (Math.abs(a.x - b.x) < needX && Math.abs(a.y - b.y) < needY) {
            b.y = a.y + needY;
            b.l.el.style.top = `${b.y}px`;
          }
        }
      }
    }

    function project(l: Label) {
      root.localToWorld(v.copy(l.pos));
      v.project(camera);
      const w = mount!.clientWidth, h = mount!.clientHeight;
      l.el.style.left = `${((v.x + 1) / 2) * w}px`;
      l.el.style.top  = `${((-v.y + 1) / 2) * h}px`;
    }

    function animateRun(run: ReturnType<typeof buildConduit>, active: boolean, reverse: boolean, t: number) {
      (run.core.material as THREE.MeshStandardMaterial).emissiveIntensity = active ? 2.6 * P.glow : 0;
      run.cones.forEach((c, i) => {
        c.visible = active;
        if (!active) return;
        let u = ((t * 0.22) + i / run.cones.length) % 1;
        if (reverse) u = 1 - u;
        c.position.copy(run.curve.getPointAt(u));
        const tan = run.curve.getTangentAt(u).normalize();
        if (reverse) tan.negate();
        c.quaternion.setFromUnitVectors(up, tan);
      });
    }

    function tick() {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      const p = propsRef.current;

      const gImport  = (p.gridKw ?? 0) >= 0;
      const gFlowing = p.gridKw != null && Math.abs(p.gridKw) > 0.5;
      const lFlowing = p.loadKw != null && Math.abs(p.loadKw) > 0.5;
      const charging    = p.battKw != null && p.battKw < -0.5;
      const discharging = p.battKw != null && p.battKw > 0.5;

      animateRun(gridRun, gFlowing, !gImport, t);
      animateRun(loadRun, lFlowing, false, t);
      animateRun(battRun, charging || discharging, discharging, t);

      const flowHex = charging ? P.flowCharge : P.flowDischarge;
      (battRun.core.material as THREE.MeshStandardMaterial).color.setHex(flowHex);
      (battRun.core.material as THREE.MeshStandardMaterial).emissive.setHex(flowHex);
      battRun.cones.forEach((c) => {
        const m = c.material as THREE.MeshStandardMaterial;
        m.color.setHex(flowHex);
        m.emissive.setHex(flowHex);
      });

      // Beacons blinking/expanding
      const breath = 0.5 + 0.5 * Math.sin(t * 2.4);
      for (const bc of beacons) {
        const live = bc.on();
        bc.b.group.visible = live;
        if (!live) continue;
        (bc.b.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = (1.4 + breath * 2.6) * P.glow;
        const k = (t * 0.55) % 1;
        bc.b.ring.scale.setScalar(1 + k * 2.6);
        (bc.b.ring.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - k);
      }

      // SOC Bar scaling
      const pct = p.soc == null ? 0 : Math.max(0, Math.min(100, p.soc));
      const wBar = (0.42 * pct) / 100;
      batt.socBar.visible = pct > 0;
      batt.socBar.scale.x = Math.max(wBar, 0.0001);
      batt.socBar.position.x = -0.21 + wBar / 2;
      const socCol = pct < 20 ? RED : pct < 45 ? BRASS : GREEN;
      const bm = batt.socBar.material as THREE.MeshStandardMaterial;
      bm.color.setHex(socCol); bm.emissive.setHex(socCol);

      // Battery racks pulse when power is flowing
      const pulse = (charging || discharging ? 1.9 + Math.sin(t * 2.2) * 0.8 : 0.55) * P.glow;
      batt.columns.forEach((c) => {
        (c.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
      });

      // Load building windows glow
      load.bands.forEach((b) => {
        (b.material as THREE.MeshStandardMaterial).emissiveIntensity = (lFlowing ? 3.2 : 1.8) * P.glow;
      });

      // Render floating callouts
      paintCallout(coGrid, kw(p.gridKw), p.gridKw == null ? "grid" : gImport ? "import" : "export", ACCENT);
      paintCallout(coLoad, kw(p.loadKw), "site load", GREEN);
      paintCallout(coBatt, kw(p.battKw), p.battKw == null ? "battery" : charging ? "charging" : discharging ? "discharging" : "idle",
        charging ? P.flowCharge : discharging ? P.flowDischarge : P.shellDark);

      // Central node callout - dynamic battery SOC or new energy percentage
      const ratio = p.soc != null ? `${p.soc.toFixed(0)}%` : "52%";
      paintCallout(coNode, ratio, "BESS SOC", 0x34d6b4);

      caps.forEach(project);
      const callouts = [coNode, coBatt, coGrid, coLoad];
      callouts.forEach(project);
      separate(callouts);

      renderer.render(scene, camera);
    }
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      overlay.remove();
      renderer.domElement.remove();
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    };
  }, []);

  return <div ref={mountRef} style={{ position: "relative", width: "100%", height: "100%" }} />;
}
