"use client";

/**
 * PowerFlowDiagram — isometric single-line "live power flow" stage.
 *
 * Ported from the northbound-ems control-room render. Presentation only: every
 * figure arrives as a prop from useBessLive, so this file has no API knowledge
 * and no fallbacks. A null reading dims its branch and renders "—"; it is never
 * substituted with a plausible number.
 *
 * Sign conventions (this codebase, see useBessLive):
 *   battKw  positive = discharging, negative = charging
 *   gridKw  positive = import,      negative = export
 */

// tan(26.565°) = 0.5 — the isometric skew used by all 3D assets.
const ISO = 26.565;

/**
 * Stage palette.
 *
 * The energy hues are theme-independent — a discharging branch is green on
 * paper as well as on black — so they stay literals. Everything structural
 * (stage, isometric faces, pylon, platform, chip) reads as var(--sld-*), which
 * globals.css redefines under html.light. SVG presentation attributes and CSS
 * filters both resolve var(), so the swap needs no re-render.
 */
const C = {
  gridLine: "#5B8AB4", loadLine: "#9C844A",
  // Energy in motion is cyan charging, teal discharging — tokens, because
  // the same hue that glows on near-black turns pastel on paper.
  charge: "var(--sld-flow-charge)", discharge: "var(--sld-flow-discharge)",
  pv: "#9C844A",
  pvGlass: "var(--sld-pv-glass)", pvLine: "var(--sld-pv-line)", pvFrame: "var(--sld-pv-frame)",
  steel: "var(--sld-steel)", steelDim: "var(--sld-steel-dim)",
  idle: "var(--sld-idle)", cap: "var(--sld-cap)",
  isoTop: "var(--sld-iso-top)", isoLeft: "var(--sld-iso-left)", isoRight: "var(--sld-iso-right)",
  isoEdge: "var(--sld-iso-edge)", win: "var(--sld-win)",
  isoShade: "var(--sld-iso-shade)", contactShadow: "var(--sld-contact-shadow)",
  stage1: "var(--sld-stage1)", stage2: "var(--sld-stage2)", stageStroke: "var(--sld-stage-stroke)",
  haloIn: "var(--sld-halo-in)", haloMid: "var(--sld-halo-mid)",
  dots: "var(--sld-dots)", floor: "var(--sld-floor)",
  bracket: "var(--sld-bracket)",
  plat1: "var(--sld-plat1)", plat2: "var(--sld-plat2)",
  platSlab: "var(--sld-plat-slab)", platStroke: "var(--sld-plat-stroke)",
  pylonBright: "var(--sld-pylon-bright)", pylonMid: "var(--sld-pylon-mid)", pylonDim: "var(--sld-pylon-dim)",
  insBead: "var(--sld-ins-bead)", spark: "var(--sld-spark)",
  chipBg: "var(--sld-chip-bg)", chipText: "var(--sld-chip-text)",
  junctionFill: "var(--sld-junction-fill)",
  junctionRing: "var(--sld-junction-ring)", junctionCore: "var(--sld-junction-core)",
  assetGlow: "var(--sld-asset-glow)", pylonGlow: "var(--sld-pylon-glow)",
} as const;

type Pt = [number, number];

/** Energy conduit: solid neon core + glow underlay + traveling pulse beads. */
function Conduit({ from, to, color, active, reverse }: {
  from: Pt; to: Pt; color: string; active: boolean; reverse?: boolean;
}) {
  const [a, b] = reverse ? [to, from] : [from, to];
  const d = `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`;
  if (!active) {
    return <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={C.idle} strokeWidth={2.5} strokeLinecap="round" />;
  }
  return (
    <g>
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={color} strokeWidth={9}
        strokeLinecap="round" opacity={0.22} style={{ filter: "blur(4px)" }} />
      <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={color} strokeWidth={3.5}
        strokeLinecap="round" opacity={0.95} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      {/* Travelling chevrons rather than round beads.
          A bead moving along a line tells you there is flow, but a circle is
          symmetric — at a glance you cannot tell import from export, and on a
          grid leg that reverses sign the distinction is the whole point.
          rotate="auto" turns each chevron along the path, so the arrowheads
          always point the way the energy is actually going. */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <path d="M -4.5 -5 L 3.5 0 L -4.5 5" fill="none" stroke={color}
            strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"
            opacity={0.95} style={{ filter: `drop-shadow(0 0 5px ${color})` }}>
            <animateMotion dur="2.6s" repeatCount="indefinite" rotate="auto"
              begin={`${i * 0.65}s`} path={d} />
          </path>
        </g>
      ))}
    </g>
  );
}

/**
 * Targeting reticle under a node — a slow dashed ring plus a tick ring.
 *
 * Drawn on the platform's own ellipse so it sits in the isometric plane rather
 * than floating flat over it; a circle here would read as a sticker on the
 * screen instead of a mark on the ground. Only shown for a live node, so the
 * reticle doubles as the "this asset is reporting" signal.
 */
function Reticle({ x, y, color, on, rx = 46 }: {
  x: number; y: number; color: string; on: boolean; rx?: number;
}) {
  if (!on) return null;
  const ry = rx * 0.5;   // tan(26.565°) — matches the isometric platforms

  return (
    <g transform={`translate(${x},${y})`} opacity={0.75}>
      <g>
        <ellipse rx={rx} ry={ry} fill="none" stroke={color} strokeOpacity={0.5}
          strokeWidth={1} strokeDasharray="5 9" />
        <animateTransform attributeName="transform" type="rotate"
          from="0" to="360" dur="24s" repeatCount="indefinite" />
      </g>
      <ellipse rx={rx * 0.72} ry={ry * 0.72} fill="none" stroke={color}
        strokeOpacity={0.22} strokeWidth={0.8} />
      {/* Cardinal ticks */}
      {[0, 90, 180, 270].map((a) => {
        const r = (a * Math.PI) / 180;
        const x1 = Math.cos(r) * rx,        y1 = Math.sin(r) * ry;
        const x2 = Math.cos(r) * (rx + 7),  y2 = Math.sin(r) * (ry + 3.5);
        return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={color} strokeOpacity={0.55} strokeWidth={1.1} strokeLinecap="round" />;
      })}
      {/* One expanding pulse, slow enough to read as a sweep not a blink */}
      <ellipse rx={rx} ry={ry} fill="none" stroke={color} strokeWidth={1}>
        <animate attributeName="rx" values={`${rx * 0.7};${rx * 1.15}`} dur="3.6s" repeatCount="indefinite" />
        <animate attributeName="ry" values={`${ry * 0.7};${ry * 1.15}`} dur="3.6s" repeatCount="indefinite" />
        <animate attributeName="stroke-opacity" values="0.4;0" dur="3.6s" repeatCount="indefinite" />
      </ellipse>
    </g>
  );
}

/** Hollow node-ring resting on a live conduit. */
function LineRing({ from, to, f, color, active }: {
  from: Pt; to: Pt; f: number; color: string; active: boolean;
}) {
  if (!active) return null;
  const x = from[0] + (to[0] - from[0]) * f;
  const y = from[1] + (to[1] - from[1]) * f;
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill={color} opacity={0.14} />
      <circle cx={x} cy={y} r={7} fill={C.junctionFill} stroke={color} strokeWidth={2.2}
        style={{ filter: `drop-shadow(0 0 5px ${color})` }}>
        <animate attributeName="r" values="7;8;7" dur="2.4s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}

/** Isometric tech platform each asset stands on. */
function Platform({ x, y, color, on }: { x: number; y: number; color: string; on: boolean }) {
  const rh = (rx: number, ry: number, dy = 0) => `M ${-rx} ${dy} L 0 ${dy - ry} L ${rx} ${dy} L 0 ${dy + ry} Z`;
  return (
    <g transform={`translate(${x},${y})`} opacity={on ? 1 : 0.4}>
      {/* Contact shadow, offset down-right from the light. Without it the
          plinth floats above the floor grid instead of resting on it — the
          cheapest single thing that makes a matte object look placed. */}
      <ellipse cx={5} cy={12} rx={52} ry={15} fill="url(#clayShadow)" opacity={0.55}
        style={{ filter: "blur(3px)" }} />
      <ellipse cx={0} cy={6} rx={54} ry={13} fill={color} opacity={0.13} style={{ filter: "blur(5px)" }} />
      <path d={rh(46, 18, 5)} fill={C.platSlab} />
      <path d={rh(46, 18)} fill="url(#pfPlat)" stroke={C.platStroke} strokeWidth={1} />
      <path d="M -46 0 L 0 18 L 46 0" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round"
        opacity={on ? 0.75 : 0.25} style={on ? { filter: `drop-shadow(0 0 4px ${color})` } : undefined}>
        {on && <animate attributeName="opacity" values="0.75;0.4;0.75" dur="3s" repeatCount="indefinite" />}
      </path>
      <path d={rh(28, 11)} fill="none" stroke={color} strokeWidth={0.9} opacity={0.3} strokeDasharray="5 5">
        {on && <animate attributeName="stroke-dashoffset" from="0" to="-40" dur="6s" repeatCount="indefinite" />}
      </path>
      {[[-46, 0], [46, 0], [0, -18], [0, 18]].map(([sx, sy]) => (
        <circle key={`${sx}-${sy}`} cx={sx} cy={sy} r={1.6} fill={color} opacity={on ? 0.9 : 0.3}
          style={on ? { filter: `drop-shadow(0 0 3px ${color})` } : undefined} />
      ))}
    </g>
  );
}

/** Occasional electric spark flicker (deterministic, staggered by `seed`). */
function Spark({ x, y, seed }: { x: number; y: number; seed: number }) {
  return (
    <path d={`M ${x} ${y} l 2.2 -3 l 2 1.8 l 2.6 -3.4`} fill="none" stroke={C.spark}
      strokeWidth={1} strokeLinecap="round" opacity={0}>
      <animate attributeName="opacity" values="0;0;0;0.9;0.15;0.8;0;0;0;0" dur="7s"
        begin={`${seed * 1.7}s`} repeatCount="indefinite" />
    </path>
  );
}

/**
 * Isometric lattice transmission tower: four splayed legs on an iso-square
 * base, tapered X-braced body, a diagonal top cross-beam with end posts, and
 * hanging insulator strings feeding the bus.
 */
function Pylon({ x, y, on }: { x: number; y: number; on: boolean }) {
  const P = (X: number, Y: number, Z: number): Pt => [0.866 * (X - Y), 0.35 * (X + Y) - Z + 56];
  const seg = (p: Pt, q: Pt) => `M ${p[0].toFixed(1)} ${p[1].toFixed(1)} L ${q[0].toFixed(1)} ${q[1].toFixed(1)} `;

  const bright = on ? C.pylonBright : C.steelDim;
  const mid = on ? C.pylonMid : C.idle;
  const dim = on ? C.pylonDim : C.idle;

  // Body rings: z levels and half-widths (taper 14 → 7 at the waist, then column).
  const zs = [0, 16, 32, 48, 64, 76];
  const aAt = (z: number) => (z <= 64 ? 14 - (7 * z) / 64 : 7);
  const ring = (z: number) => {
    const a = aAt(z);
    return { F: P(a, a, z), R: P(a, -a, z), B: P(-a, -a, z), L: P(-a, a, z) };
  };
  const rings = zs.map(ring);
  const top = ring(92);

  let frontEdges = "", backEdges = "";
  for (let i = 0; i < rings.length - 1; i++) {
    frontEdges += seg(rings[i].F, rings[i + 1].F) + seg(rings[i].R, rings[i + 1].R) + seg(rings[i].L, rings[i + 1].L);
    backEdges += seg(rings[i].B, rings[i + 1].B);
  }
  frontEdges += seg(rings[5].F, top.F) + seg(rings[5].R, top.R) + seg(rings[5].L, top.L);
  backEdges += seg(rings[5].B, top.B);

  let frontRings = "", backRings = "";
  for (const r of [...rings.slice(1), top]) {
    frontRings += seg(r.L, r.F) + seg(r.F, r.R);
    backRings += seg(r.R, r.B) + seg(r.B, r.L);
  }

  let braces = "";
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    braces += seg(a.F, b.R) + seg(a.R, b.F) + seg(a.F, b.L) + seg(a.L, b.F);
  }

  // Top cross-beam: a box frame along the X axis, which reads diagonal on screen.
  const AX = 33, AY = 4, AZ0 = 78, AZ1 = 84;
  const bt = [P(-AX, -AY, AZ1), P(AX, -AY, AZ1), P(AX, AY, AZ1), P(-AX, AY, AZ1)];
  const bb = [P(-AX, -AY, AZ0), P(AX, -AY, AZ0), P(AX, AY, AZ0), P(-AX, AY, AZ0)];
  const armFrame =
    seg(bt[0], bt[1]) + seg(bt[1], bt[2]) + seg(bt[2], bt[3]) + seg(bt[3], bt[0]) +
    seg(bb[0], bb[1]) + seg(bb[1], bb[2]) + seg(bb[2], bb[3]) + seg(bb[3], bb[0]) +
    seg(bt[0], bb[0]) + seg(bt[1], bb[1]) + seg(bt[2], bb[2]) + seg(bt[3], bb[3]);
  const zig = [-33, -22, -11, 0, 11, 22, 33]
    .map((X, i) => {
      const p = P(X, AY, i % 2 === 0 ? AZ0 : AZ1);
      return `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
    })
    .join(" ");
  const struts = seg(P(7, 0, 70), P(20, 0, 78)) + seg(P(-7, 0, 70), P(-20, 0, 78));

  const posts: { l: string; cap: Pt; front: boolean }[] = [];
  for (const sx of [-29, 29]) for (const sy of [-2.5, 2.5]) {
    posts.push({ l: seg(P(sx, sy, AZ1), P(sx, sy, 91)), cap: P(sx, sy, 92), front: sy > 0 });
  }

  const hang = (X: number) => ({
    line: seg(P(X, 0, AZ0), P(X, 0, 66)),
    blobs: [73, 69.5].map((z) => P(X, 0, z)),
    tip: P(X, 0, 64),
  });
  const insL = hang(-27), insR = hang(27);
  const dropWire = `M ${insR.tip[0].toFixed(1)} ${insR.tip[1].toFixed(1)} C 28 3 31 5.5 34 8`;

  const feet = [rings[0].F, rings[0].R, rings[0].L];
  const backFoot = rings[0].B;

  return (
    <g transform={`translate(${x},${y})`} style={on ? { filter: `drop-shadow(0 0 9px ${C.pylonGlow})` } : undefined}>
      <path d={backEdges} stroke={dim} strokeWidth={1.1} fill="none" strokeLinecap="round" />
      <path d={backRings} stroke={dim} strokeWidth={0.8} fill="none" strokeLinecap="round" />
      <path d={braces} stroke={mid} strokeWidth={0.8} fill="none" strokeLinecap="round" opacity={0.8} />
      <path d={frontRings} stroke={mid} strokeWidth={1} fill="none" strokeLinecap="round" />
      <path d={frontEdges} stroke={bright} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d={armFrame} stroke={bright} strokeWidth={1.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d={zig} stroke={mid} strokeWidth={0.8} fill="none" strokeLinecap="round" />
      <path d={struts} stroke={mid} strokeWidth={0.9} fill="none" strokeLinecap="round" />
      {posts.map((p, i) => (
        <g key={i}>
          <path d={p.l} stroke={p.front ? bright : mid} strokeWidth={2} fill="none" strokeLinecap="round" />
          <circle cx={p.cap[0]} cy={p.cap[1]} r={1.5} fill={C.insBead} opacity={p.front ? 1 : 0.6} />
        </g>
      ))}
      {[insL, insR].map((ins, i) => (
        <g key={i}>
          <path d={ins.line} stroke={mid} strokeWidth={1} fill="none" />
          {ins.blobs.map((b, j) => (
            <circle key={j} cx={b[0]} cy={b[1]} r={2.1} fill={C.insBead} opacity={on ? 0.95 : 0.4} />
          ))}
          <circle cx={ins.tip[0]} cy={ins.tip[1]} r={1.9} fill={on ? C.gridLine : C.steelDim}
            style={on ? { filter: `drop-shadow(0 0 3px ${C.gridLine})` } : undefined}>
            {on && <animate attributeName="opacity" values="1;0.55;1" dur="2.8s" begin={`${i * 0.7}s`} repeatCount="indefinite" />}
          </circle>
        </g>
      ))}
      {on && <>
        <Spark x={insR.tip[0]} y={insR.tip[1]} seed={1} />
        <Spark x={insL.tip[0]} y={insL.tip[1]} seed={2.6} />
      </>}
      {/* catenary wires off-stage + drop wire onto the bus */}
      <path d={`M ${insL.tip[0].toFixed(1)} ${insL.tip[1].toFixed(1)} Q -60 4 -94 -2`}
        stroke={on ? C.gridLine : dim} strokeWidth={1.1} fill="none" opacity={0.4} />
      <path d="M -28.6 -33.6 Q -64 -14 -94 -20" stroke={on ? C.gridLine : dim} strokeWidth={1} fill="none" opacity={0.25} />
      <path d={dropWire} stroke={on ? C.gridLine : dim} strokeWidth={1.1} fill="none" opacity={0.6} />
      {on && (
        <circle r={1.8} fill={C.gridLine} style={{ filter: `drop-shadow(0 0 4px ${C.gridLine})` }}>
          <animateMotion dur="1.4s" repeatCount="indefinite" path={dropWire} />
        </circle>
      )}
      {feet.map((f, i) => <circle key={i} cx={f[0]} cy={f[1]} r={2} fill={C.insBead} opacity={on ? 0.9 : 0.4} />)}
      <circle cx={backFoot[0]} cy={backFoot[1]} r={1.6} fill={C.insBead} opacity={on ? 0.45 : 0.2} />
    </g>
  );
}

/** Glossy isometric battery cabinet with a glowing bolt and SOC pips. */
/** Glossy isometric battery cabinet with a glowing bolt and SOC pips. */
function IsoBattery({ x, y, on, soc }: { x: number; y: number; on: boolean; soc: number | null }) {
  const pct = soc == null ? 0 : Math.max(0, Math.min(100, soc));
  const socColor = pct < 20 ? "#A8505E" : pct < 45 ? C.loadLine : C.discharge;
  const a = 17, dep = 8.5, h = 50;
  return (
    <g transform={`translate(${x},${y})`} opacity={on ? 1 : 0.55}
      style={on ? { filter: `drop-shadow(0 0 10px ${C.assetGlow})` } : undefined}>
      <path d={`M ${-a} ${-dep} L 0 0 L 0 ${-h} L ${-a} ${-h - dep} Z`} fill="url(#clayLeft)" stroke={C.isoEdge} strokeWidth={0.8} />
      <path d={`M 0 0 L ${a} ${-dep} L ${a} ${-h - dep} L 0 ${-h} Z`} fill="url(#clayRight)" stroke={C.isoEdge} strokeWidth={0.8} />
      <path d={`M ${-a} ${-h - dep} L 0 ${-h} L ${a} ${-h - dep} L 0 ${-h - 2 * dep} Z`} fill="url(#clayTop)" stroke={C.isoEdge} strokeWidth={0.8} />
      <g transform={`skewY(${ISO})`} stroke="rgba(120,140,165,0.5)" strokeWidth={1}>
        <line x1={-13.5} y1={-41.5} x2={-3.5} y2={-41.5} />
        <line x1={-13.5} y1={-37.5} x2={-3.5} y2={-37.5} />
      </g>
      <g transform={`skewY(-${ISO})`}>
        <path d="M 10.5 -36 L 4.5 -24.5 L 8 -24.5 L 6.5 -14 L 13 -26.5 L 9.2 -26.5 Z"
          fill={on ? "#5B8AB4" : C.steelDim} style={on ? { filter: "drop-shadow(0 0 4px #5B8AB4)" } : undefined}>
          {on && <animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite" />}
        </path>
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={4.5 + i * 3.2} y={-9.5} width={2.2} height={4} rx={0.6}
            fill={i < Math.round((pct / 100) * 4) && on ? socColor : "rgba(85,98,120,0.45)"} />
        ))}
      </g>
      <circle cx={0} cy={-h - dep - 1} r={1.7} fill={on ? C.discharge : "#A8505E"}>
        {on && <animate attributeName="opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite" />}
      </circle>
    </g>
  );
}

/** Isometric PV array — three tilted panels plus a combiner box. */
function IsoSolar({ x, y, on }: { x: number; y: number; on: boolean }) {
  const panel = (px: number, py: number, i: number) => (
    <g key={i} transform={`translate(${px},${py})`}>
      <path d="M -15 -1 L -13 6 M 5 -11 L 7 -4" stroke={C.pvFrame} strokeWidth={1.2} fill="none" strokeLinecap="round" />
      <path d="M -12 7 L 10 -3 L 5 -13 L -17 -3 Z" fill={C.pvGlass} stroke={C.pvFrame} strokeWidth={1} strokeLinejoin="round" />
      <path d="M -14.4 0 L 7.6 -10 M -13 3.5 L 9 -6.5" stroke={C.pvLine} strokeWidth={0.7} fill="none" />
      {on && (
        <path d="M -15 -1 L 7 -11" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" opacity={0}>
          <animate attributeName="opacity" values="0;0;0.7;0;0" dur="6s" begin={`${i * 1.9}s`} repeatCount="indefinite" />
        </path>
      )}
    </g>
  );
  return (
    <g transform={`translate(${x},${y})`} opacity={on ? 1 : 0.55}
      style={on ? { filter: `drop-shadow(0 0 10px ${C.assetGlow})` } : undefined}>
      {panel(-22, 9, 0)}
      {panel(2, -2, 1)}
      {panel(26, -13, 2)}
      <g transform="translate(-34,-9)">
        <path d="M 0 0 L 7 -3.5 L 7 -11 L 0 -7.5 Z" fill={C.isoRight} stroke={C.isoEdge} strokeWidth={0.7} />
        <circle cx={3.5} cy={-9.5} r={1.1} fill={on ? C.pv : C.steelDim}>
          {on && <animate attributeName="opacity" values="1;0.35;1" dur="2s" repeatCount="indefinite" />}
        </circle>
      </g>
    </g>
  );
}

/** Isometric office tower (site load) with lit windows and a rooftop beacon. */
function IsoBuilding({ x, y, on }: { x: number; y: number; on: boolean }) {
  const a = 21, dep = 10.5, h = 84;
  return (
    <g transform={`translate(${x},${y})`} opacity={on ? 1 : 0.55}
      style={on ? { filter: `drop-shadow(0 0 10px ${C.assetGlow})` } : undefined}>
      <path d={`M ${-a} ${-dep} L 0 0 L 0 ${-h} L ${-a} ${-h - dep} Z`} fill="url(#clayLeft)" stroke={C.isoEdge} strokeWidth={0.8} />
      <path d={`M 0 0 L ${a} ${-dep} L ${a} ${-h - dep} L 0 ${-h} Z`} fill="url(#clayRight)" stroke={C.isoEdge} strokeWidth={0.8} />
      <path d={`M ${-a} ${-h - dep} L 0 ${-h} L ${a} ${-h - dep} L 0 ${-h - 2 * dep} Z`} fill="url(#clayTop)" stroke={C.isoEdge} strokeWidth={0.8} />
      <g transform={`skewY(${ISO})`}>
        {Array.from({ length: 5 }).flatMap((_, r) => [0, 1].map((c) => (
          <rect key={`l${r}-${c}`} x={-16.5 + c * 8} y={-h + 8 + r * 14} width={5} height={8} rx={1} fill={C.win} opacity={0.9} />
        )))}
      </g>
      <g transform={`skewY(-${ISO})`}>
        {Array.from({ length: 5 }).flatMap((_, r) => [0, 1].map((c) => {
          const lit = on && (r * 2 + c) % 3 !== 0;
          const twinkle = lit && (r * 3 + c) % 4 === 0;
          return (
            <rect key={`r${r}-${c}`} x={4 + c * 8} y={-h + 8 + r * 14} width={5} height={8} rx={1}
              fill={lit ? "rgba(156, 132, 74,0.75)" : C.win} opacity={0.92}>
              {twinkle && <animate attributeName="opacity" values="0.92;0.25;0.92;0.92" dur="5s" begin={`${(r * 7 + c * 3) % 5}s`} repeatCount="indefinite" />}
            </rect>
          );
        }))}
      </g>
      <line x1={-8} y1={-h - dep - 4} x2={-8} y2={-h - dep - 18} stroke="rgba(160,175,200,0.8)" strokeWidth={1.3} />
      <circle cx={-8} cy={-h - dep - 20} r={2} fill={on ? "#A8505E" : C.steelDim}>
        {on && <animate attributeName="opacity" values="1;0.25;1" dur="2.6s" repeatCount="indefinite" />}
      </circle>
      {on && (
        <circle cx={-8} cy={-h - dep - 20} r={2} fill="none" stroke="#A8505E" strokeWidth={0.8}>
          <animate attributeName="r" values="2;7" dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0" dur="2.6s" repeatCount="indefinite" />
        </circle>
      )}
      <path d={`M 3 ${-h - dep - 1} L 9 ${-h - dep - 4} L 15 ${-h - dep - 1} L 9 ${-h - dep + 2} Z`}
        fill={C.isoLeft} stroke={C.isoEdge} strokeWidth={0.7} />
    </g>
  );
}

function FlowChip({ x, y, text, sub, color }: { x: number; y: number; text: string; sub: string; color: string }) {
  const w = Math.max(88, text.length * 8 + 26);
  return (
    <g>
      <rect x={x - w / 2} y={y - 26} width={w} height={36} rx={10} fill={C.chipBg}
        stroke={color} strokeOpacity={0.75} strokeWidth={1.4}
        style={{ filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.35))" }} />
      <text x={x} y={y - 9} textAnchor="middle" fontSize={13.5} fontWeight={700} fill={C.chipText}
        style={{ fontVariantNumeric: "tabular-nums" }}>{text}</text>
      <text x={x} y={y + 4} textAnchor="middle" fontSize={8.5} fill={color} letterSpacing="0.09em"
        style={{ textTransform: "uppercase" }}>{sub}</text>
    </g>
  );
}

function NodeCap({ x, y, title, on }: { x: number; y: number; title: string; on: boolean }) {
  return (
    <g>
      <circle cx={x - title.length * 3.6 - 9} cy={y - 4} r={3} fill={on ? "#4E8D6E" : "#A8505E"}
        style={{ filter: `drop-shadow(0 0 4px ${on ? "#4E8D6E" : "#A8505E"})` }} />
      <text x={x} y={y} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={C.cap} letterSpacing="0.16em">{title}</text>
    </g>
  );
}

function PanelRow({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="pf-e">
      <span className="pf-k">{label}</span>
      <span className="pf-v" style={color ? { color } : undefined}>
        {value}{unit && <small> {unit}</small>}
      </span>
    </div>
  );
}

export interface PowerFlowDiagramProps {
  gridKw: number | null;
  loadKw: number | null;
  battKw: number | null;
  solarKw: number | null;
  soc: number | null;
  soh: number | null;
  maxCellTempC: number | null;
  gridHz: number | null;
}

export function PowerFlowDiagram({
  gridKw, loadKw, battKw, solarKw, soc, soh, maxCellTempC, gridHz,
}: PowerFlowDiagramProps) {
  // "Present" (a real reading exists — the node renders lit) is deliberately
  // separate from "flowing" (magnitude past the threshold — the conduit
  // animates). A null reading is neither, and never becomes a zero.
  const gridOn = gridKw != null;
  const loadOn = loadKw != null;
  const solarOn = solarKw != null;
  const battOn = battKw != null || soc != null;
  const hasSolar = solarKw != null;

  const gridImport = (gridKw ?? 0) >= 0;
  const gridFlowing = gridOn && Math.abs(gridKw ?? 0) > 0.5;
  const loadFlowing = loadOn && Math.abs(loadKw ?? 0) > 0.5;
  const solarFlowing = solarOn && (solarKw ?? 0) > 0.5;
  const charging = battKw != null && battKw < -0.5;
  const discharging = battKw != null && battKw > 0.5;
  const battFlowing = charging || discharging;
  const battColor = charging ? C.charge : C.discharge;

  const statusText = battKw == null ? "—" : charging ? "Charging" : discharging ? "Discharging" : "Idle";
  const statusColor = battKw == null ? "#8fa2b8" : charging ? C.charge : discharging ? C.discharge : "#8fa2b8";
  const socPct = soc == null ? null : Math.round(Math.max(0, Math.min(100, soc)));

  const kw = (v: number | null) => (v == null ? "—" : `${Math.abs(v).toFixed(1)} kW`);

  // Geometry: grid left, battery below the bus, load right, solar tapping the
  // bus mid-run. The right of the stage stays clear for the floating
  // BATTERY · LIVE card.
  //
  // The drawing itself spans roughly x 40–830, y 30–330. STAGE_W is cropped
  // close to that rather than left at the old 1190, because the surplus width
  // was dead stage nobody looked at — and since the SVG scales to the
  // container's width, carrying it made every asset render smaller than it
  // needed to. STAGE_H is then taller than the drawing so the stage fills the
  // panel instead of sitting as a letterboxed band inside it; CONTENT_DY
  // re-centres the drawing in that taller box, which keeps every coordinate
  // below unchanged.
  // The floating card overlays the right of the stage, so the drawing has to
  // end before it. The card is width:min(172px, 20%) + a 1.6% offset, and the
  // percentage is what bites: on a narrow panel 20% of the container is a much
  // larger share of the viewBox than the pixel cap suggests. Load therefore
  // sits at 72% of STAGE_W, leaving ~28% clear against the card's ~22% worst
  // case. Cropping to 980 without moving load is what put the load tower
  // underneath the card.
  const STAGE_W = 1040;
  const STAGE_H = 420;
  const CONTENT_DY = 40;
  /** Where the perspective floor meets the field. Below the drawing so the
   *  grid reads as ground under the assets rather than a backdrop behind them. */
  const HORIZON_Y = 300;

  const busY = 150;
  const gridX = 96, junctionX = 440, loadX = 700, solarX = 590;
  const battY = 288, solarPlatY = 84;

  const gridSeg: [Pt, Pt] = [[gridX + 34, busY], [junctionX - 4, busY]];
  const loadSeg: [Pt, Pt] = [[junctionX + 4, busY], [loadX - 44, busY]];
  const battSeg: [Pt, Pt] = [[junctionX, busY + 8], [junctionX, battY - 66]];
  const solarSeg: [Pt, Pt] = [[solarX, solarPlatY + 20], [solarX, busY - 8]];

  return (
    <div className="pf-wrap">
      <div className="pf-stage">
        {/* Fills both axes rather than width alone. Sized by width only, the
            stage rendered as a short band letterboxed inside a much taller
            card; "meet" keeps the aspect, so whichever axis binds is filled
            and the drawing can never overflow the panel. */}
        <svg
          viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block", borderRadius: 14, maxHeight: "100%" }}
        >
          <defs>
            <linearGradient id="pfStage" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.stage1} /><stop offset="100%" stopColor={C.stage2} />
            </linearGradient>
            <radialGradient id="pfHalo" cx="50%" cy="18%" r="75%">
              <stop offset="0%" stopColor={C.haloIn} /><stop offset="55%" stopColor={C.haloMid} /><stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <pattern id="pfDots" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="1.2" cy="1.2" r="1.1" fill={C.dots} />
            </pattern>
            <linearGradient id="pfFloor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(120,160,210,0)" /><stop offset="100%" stopColor={C.floor} />
            </linearGradient>
            <linearGradient id="pfPlat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.plat1} /><stop offset="100%" stopColor={C.plat2} />
            </linearGradient>

            {/* A soft band that travels across the stage — the one moving part
                that is not data, kept slow and low-contrast so it reads as
                ambience rather than something demanding attention. */}
            <linearGradient id="pfScan" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor={C.gridLine} stopOpacity="0" />
              <stop offset="50%"  stopColor={C.gridLine} stopOpacity="0.10" />
              <stop offset="100%" stopColor={C.gridLine} stopOpacity="0" />
            </linearGradient>

            {/* Fades the perspective floor out before it reaches the frame, so
                the grid appears to recede rather than stopping at an edge. */}
            <linearGradient id="pfGridFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#fff" stopOpacity="0" />
              <stop offset="35%"  stopColor="#fff" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id="pfGridMask">
              <rect x={0} y={HORIZON_Y} width={STAGE_W} height={STAGE_H - HORIZON_Y} fill="url(#pfGridFade)" />
            </mask>

            {/* The backdrop fades up and out at the sides, so the wall
                dissolves rather than ending at the frame — a grid that meets
                the edge at full strength reads as wallpaper, not as space. */}
            <linearGradient id="pfBackFadeY" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#fff" stopOpacity="0" />
              <stop offset="55%"  stopColor="#fff" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="pfBackFadeX" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#000" stopOpacity="1" />
              <stop offset="18%"  stopColor="#fff" stopOpacity="1" />
              <stop offset="82%"  stopColor="#fff" stopOpacity="1" />
              <stop offset="100%" stopColor="#000" stopOpacity="1" />
            </linearGradient>
            <mask id="pfBackMask">
              <rect x={0} y={0} width={STAGE_W} height={HORIZON_Y} fill="url(#pfBackFadeY)" />
              <rect x={0} y={0} width={STAGE_W} height={HORIZON_Y} fill="url(#pfBackFadeX)" style={{ mixBlendMode: "multiply" }} />
            </mask>

            {/* Hologram scanlines — 1px every 3, barely there individually but
                enough together to make the stage read as a projected surface
                rather than flat fill. */}
            <pattern id="pfScanlines" width="3" height="3" patternUnits="userSpaceOnUse">
              <rect x="0" y="0" width="3" height="1" fill={C.gridLine} opacity={0.055} />
            </pattern>

            {/* Vertical glow column behind the battery — the hero asset gets a
                shaft of light so the eye lands on it first. */}
            <linearGradient id="pfColumn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={C.gridLine} stopOpacity="0" />
              <stop offset="55%"  stopColor={C.gridLine} stopOpacity="0.09" />
              <stop offset="100%" stopColor={C.gridLine} stopOpacity="0" />
            </linearGradient>

            {/* Clay shading. A matte object is never one flat value across a
                face — it falls off away from the light, and that gradient is
                most of what makes a render read as a solid rather than a
                coloured polygon. Light is treated as coming from upper-left,
                so every face darkens down and to the right. */}
            <linearGradient id="clayTop" x1="0" y1="0" x2="0.85" y2="1">
              <stop offset="0%"   stopColor={C.isoTop} />
              <stop offset="100%" stopColor={C.isoLeft} />
            </linearGradient>
            <linearGradient id="clayLeft" x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0%"   stopColor={C.isoLeft} />
              <stop offset="100%" stopColor={C.isoRight} />
            </linearGradient>
            <linearGradient id="clayRight" x1="0" y1="0" x2="0.4" y2="1">
              <stop offset="0%"   stopColor={C.isoRight} />
              <stop offset="100%" stopColor={C.isoShade} />
            </linearGradient>

            {/* Contact shadow — the thing that stops an object hovering. */}
            <radialGradient id="clayShadow" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor={C.contactShadow} stopOpacity="0.9" />
              <stop offset="65%"  stopColor={C.contactShadow} stopOpacity="0.35" />
              <stop offset="100%" stopColor={C.contactShadow} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Stage */}
          <rect x={0} y={0} width={STAGE_W} height={STAGE_H} rx={14} fill="url(#pfStage)" stroke={C.stageStroke} strokeWidth={1} />
          <rect x={0} y={0} width={STAGE_W} height={STAGE_H} rx={14} fill="url(#pfHalo)" />
          <rect x={0} y={0} width={STAGE_W} height={STAGE_H} rx={14} fill="url(#pfDots)" />
          <rect x={0} y={STAGE_H - 190} width={STAGE_W} height={190} rx={14} fill="url(#pfFloor)" />
          {/* Backdrop grid — the wall this room has behind it. Ruled square
              rather than in perspective: it sits behind the scene, so its lines
              stay parallel while the floor's converge, and that difference is
              what separates the two planes. */}
          <g mask="url(#pfBackMask)">
            {Array.from({ length: 21 }, (_, i) => {
              const x = (i * STAGE_W) / 20;
              return <line key={`bv${i}`} x1={x} y1={0} x2={x} y2={HORIZON_Y}
                stroke={C.gridLine} strokeOpacity={i % 4 === 0 ? 0.26 : 0.13} strokeWidth={0.9} />;
            })}
            {Array.from({ length: 9 }, (_, i) => {
              const y = (i * HORIZON_Y) / 8;
              return <line key={`bh${i}`} x1={0} y1={y} x2={STAGE_W} y2={y}
                stroke={C.gridLine} strokeOpacity={i % 4 === 0 ? 0.26 : 0.13} strokeWidth={0.9} />;
            })}
          </g>

          {/* Perspective floor. Lines converge on a vanishing point above the
              lower edge, which gives the stage a ground plane and a depth the
              flat dot field could not — the single biggest thing separating
              "diagram on a panel" from "scene you are looking into". */}
          <g mask="url(#pfGridMask)">
            {Array.from({ length: 23 }, (_, i) => {
              const spread = (i - 11) * (STAGE_W / 7);
              return (
                <line
                  key={`v${i}`}
                  x1={STAGE_W / 2} y1={HORIZON_Y}
                  x2={STAGE_W / 2 + spread} y2={STAGE_H}
                  stroke={C.gridLine} strokeOpacity={0.30} strokeWidth={0.9}
                />
              );
            })}
            {Array.from({ length: 9 }, (_, i) => {
              // Geometric spacing: rows bunch toward the horizon the way they
              // would under real perspective, rather than stepping evenly.
              const t = Math.pow(i / 8, 2.1);
              const y = HORIZON_Y + t * (STAGE_H - HORIZON_Y);
              return (
                <line key={`h${i}`} x1={0} y1={y} x2={STAGE_W} y2={y}
                  stroke={C.gridLine} strokeOpacity={0.26} strokeWidth={0.9} />
              );
            })}
          </g>

          {/* Horizon — a lit edge where the floor meets the field, with a wide
              soft pass under it so the join glows rather than ruling a line. */}
          <line x1={0} y1={HORIZON_Y} x2={STAGE_W} y2={HORIZON_Y}
            stroke={C.gridLine} strokeWidth={6} opacity={0.10}
            style={{ filter: "blur(5px)" }} />
          <line x1={0} y1={HORIZON_Y} x2={STAGE_W} y2={HORIZON_Y}
            stroke={C.gridLine} strokeWidth={0.9} opacity={0.42} />

          {/* Light shaft behind the battery */}
          <rect x={junctionX - 70} y={0} width={140} height={STAGE_H} fill="url(#pfColumn)" />

          {/* Scanline overlay */}
          <rect x={0} y={0} width={STAGE_W} height={STAGE_H} rx={14} fill="url(#pfScanlines)" />

          {/* Scan sweep */}
          <rect x={-STAGE_W * 0.35} y={0} width={STAGE_W * 0.35} height={STAGE_H} fill="url(#pfScan)">
            <animate attributeName="x" from={-STAGE_W * 0.35} to={STAGE_W}
              dur="7s" repeatCount="indefinite" />
          </rect>

          {/* Frame ticks — HUD graticule along the top and bottom edges. */}
          <g opacity={0.5}>
            {Array.from({ length: 25 }, (_, i) => {
              const x = 30 + i * ((STAGE_W - 60) / 24);
              const major = i % 6 === 0;
              return (
                <g key={`t${i}`} stroke={C.bracket} strokeWidth={major ? 1.1 : 0.7}>
                  <line x1={x} y1={14} x2={x} y2={major ? 24 : 19} />
                  <line x1={x} y1={STAGE_H - 14} x2={x} y2={STAGE_H - (major ? 24 : 19)} />
                </g>
              );
            })}
          </g>

          <path
            d={[
              `M 14 30 L 14 14 L 30 14`,
              `M ${STAGE_W - 30} 14 L ${STAGE_W - 14} 14 L ${STAGE_W - 14} 30`,
              `M ${STAGE_W - 14} ${STAGE_H - 30} L ${STAGE_W - 14} ${STAGE_H - 14} L ${STAGE_W - 30} ${STAGE_H - 14}`,
              `M 30 ${STAGE_H - 14} L 14 ${STAGE_H - 14} L 14 ${STAGE_H - 30}`,
            ].join(" ")}
            fill="none" stroke={C.bracket} strokeWidth={1.4} strokeLinecap="round" />

          {/* Drawing — offset as a unit so the coordinates below stay authored
              against their own origin rather than the stage's. */}
          <g transform={`translate(0 ${CONTENT_DY})`}>

          {/* Reticles sit under the platforms so the plinth reads as resting
              on the mark rather than the mark being painted over it. */}
          <Reticle x={gridX}     y={214}        color={C.gridLine} on={gridOn} />
          <Reticle x={junctionX} y={battY}      color={battFlowing ? battColor : C.gridLine} on={battOn} />
          <Reticle x={loadX}     y={216}        color={C.loadLine} on={loadOn} />
          {hasSolar && <Reticle x={solarX} y={solarPlatY} color={C.pv} on={solarOn} rx={38} />}

          {/* Platforms */}
          <Platform x={gridX} y={214} color={C.gridLine} on={gridOn} />
          <Platform x={junctionX} y={battY} color={battFlowing ? battColor : C.gridLine} on={battOn} />
          <Platform x={loadX} y={216} color={C.loadLine} on={loadOn} />
          {hasSolar && <Platform x={solarX} y={solarPlatY} color={C.pv} on={solarOn} />}

          {/* Conduits */}
          <Conduit from={gridSeg[0]} to={gridSeg[1]} color={C.gridLine} active={gridFlowing} reverse={!gridImport} />
          <Conduit from={loadSeg[0]} to={loadSeg[1]} color={C.loadLine} active={loadFlowing} />
          <Conduit from={battSeg[0]} to={battSeg[1]} color={battColor} active={battFlowing} reverse={discharging} />
          {hasSolar && <Conduit from={solarSeg[0]} to={solarSeg[1]} color={C.pv} active={solarFlowing} />}
          <LineRing from={gridSeg[0]} to={gridSeg[1]} f={0.3} color={C.gridLine} active={gridFlowing} />
          <LineRing from={loadSeg[0]} to={loadSeg[1]} f={0.74} color={C.loadLine} active={loadFlowing} />

          {hasSolar && (
            <circle cx={solarX} cy={busY} r={4.5} fill={C.junctionFill} stroke={C.pv} strokeWidth={1.8}
              style={solarFlowing ? { filter: `drop-shadow(0 0 5px ${C.pv})` } : undefined} />
          )}

          {/* Junction */}
          {(gridFlowing || battFlowing || loadFlowing || solarFlowing) && (
            <>
              <circle cx={junctionX} cy={busY} r={8} fill="none" stroke={C.gridLine} strokeWidth={1.2}>
                <animate attributeName="r" values="8;22" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.55;0" dur="2s" repeatCount="indefinite" />
              </circle>
              <circle cx={junctionX} cy={busY} r={8} fill="none" stroke={C.gridLine} strokeWidth={1.2}>
                <animate attributeName="r" values="8;22" dur="2s" begin="1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.55;0" dur="2s" begin="1s" repeatCount="indefinite" />
              </circle>
            </>
          )}
          <circle cx={junctionX} cy={busY} r={7.5} fill={C.junctionFill} stroke={C.junctionRing} strokeWidth={2}
            style={{ filter: `drop-shadow(0 0 7px ${C.gridLine})` }} />
          <circle cx={junctionX} cy={busY} r={2.6} fill={C.junctionCore} />

          {/* Assets */}
          <Pylon x={gridX} y={busY} on={gridOn} />
          <IsoBattery x={junctionX} y={battY + 6} on={battOn} soc={soc} />
          <IsoBuilding x={loadX} y={218} on={loadOn} />
          {hasSolar && <IsoSolar x={solarX} y={solarPlatY} on={solarOn} />}

          {/* Value chips */}
          <FlowChip x={(gridSeg[0][0] + gridSeg[1][0]) / 2} y={busY} text={kw(gridKw)}
            sub={gridKw == null ? "grid" : gridImport ? "import" : "export"} color={C.gridLine} />
          <FlowChip x={(loadSeg[0][0] + loadSeg[1][0]) / 2} y={busY} text={kw(loadKw)} sub="site load" color={C.loadLine} />
          <FlowChip x={junctionX + 60} y={(battSeg[0][1] + battSeg[1][1]) / 2 + 4} text={kw(battKw)}
            sub={battKw == null ? "battery" : charging ? "charging" : discharging ? "discharging" : "idle"}
            color={battFlowing ? battColor : C.steel} />
          {hasSolar && (
            <FlowChip x={solarX + 60} y={(solarSeg[0][1] + solarSeg[1][1]) / 2 + 2} text={kw(solarKw)}
              sub="solar" color={solarFlowing ? C.pv : C.steel} />
          )}

          {/* Captions */}
          <NodeCap x={gridX} y={246} title="GRID" on={gridOn} />
          <NodeCap x={junctionX} y={322} title="BATTERY · PCS" on={battOn} />
          <NodeCap x={loadX} y={248} title="LOAD" on={loadOn} />
          {hasSolar && <NodeCap x={solarX} y={36} title="SOLAR" on={solarOn} />}
          </g>
        </svg>
      </div>

      {/* Floating live battery card */}
      <div className="pf-soc">
        <div className="pf-hd"><span className="pf-dot" /> Battery · live</div>
        <div className="pf-row">
          <span className="pf-lbl">SOC</span>
          <span className="pf-big">{socPct == null ? "—" : socPct}{socPct != null && <small>%</small>}</span>
        </div>
        <div className="pf-bar"><span style={{ width: `${socPct ?? 0}%` }} /></div>
        <PanelRow label="Status" value={statusText} color={statusColor} />
        <PanelRow label="Battery Power" value={battKw == null ? "—" : battKw.toFixed(1)} unit={battKw == null ? undefined : "kW"} />
        <PanelRow label="Max Cell Temp" value={maxCellTempC == null ? "—" : maxCellTempC.toFixed(1)} unit={maxCellTempC == null ? undefined : "°C"} />
        <PanelRow label="Grid Frequency" value={gridHz == null ? "—" : gridHz.toFixed(2)} unit={gridHz == null ? undefined : "Hz"} />
        <PanelRow label="State Of Health" value={soh == null ? "—" : soh.toFixed(1)} unit={soh == null ? undefined : "%"} color={soh == null ? undefined : C.discharge} />
      </div>
    </div>
  );
}
