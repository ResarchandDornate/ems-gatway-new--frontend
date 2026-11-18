"use client";

/**
 * A battery pack drawn the way it is built: 52 cells in series, laid out as
 * four strips (A–D) of thirteen, the way the module sits in its tray.
 *
 * The heat map above answers "which cells are out of line"; this answers
 * "where are they" — a technician opening a pack needs strip and position, not
 * a cell number to count to.
 *
 * Two mappings are assumed and live in `placeOf` only, so correcting them is
 * one function:
 *   · packs are consecutive — cells 1–52 are PACK1, 53–104 PACK2, …;
 *   · the series chain snakes: strip A runs 1→13 left to right, strip B runs
 *     14→26 right to left, and so on, which is how a 13 × 4 series string is
 *     normally wired.
 *
 * Colour is voltage relative to the cluster mean. The pack's 32 temperature
 * probes are published without saying which cell each sits on, so they are
 * not painted onto cells (see fetchCellData). In temperature mode they are
 * drawn as their own readings along the busbars instead, 8 per module (M1–M4),
 * numbered in order — an assumed placement until the vendor's layout is in.
 */

import { useMemo, useState } from "react";
import type { CellData } from "@/lib/api/types";

export const CELLS_PER_PACK = 52;
export const PROBES_PER_PACK = 32;
const PROBES_PER_STRIP = PROBES_PER_PACK / 4;
const COLS = 13;
const ROWS = 4;
const STRIPS = ["A", "B", "C", "D"];

/** Where cell `k` (0-based, within its pack) sits: strip row and column. */
function placeOf(k: number): { row: number; col: number } {
  const row = Math.floor(k / COLS);
  const i = k % COLS;
  return { row, col: row % 2 === 0 ? i : COLS - 1 - i };
}

/* Geometry, SVG units. A strip is drawn as in the module's top view: a black
   carrier, a row of busbar plates along each long edge, and the cells' vents
   down the middle. Each cell is one column across the strip. */
const CW = 46;                  // one cell's width along the strip
const BUS_H = 24;               // busbar plate row height
const VENT_H = 30;              // centre band: vent + cell number
const STRIP_PAD = 7;
const STRIP_H = STRIP_PAD * 2 + BUS_H * 2 + VENT_H;
const CAP = 14;                 // orange end cap width
const STRIP_W = CAP * 2 + COLS * CW;
const STRIP_GAP = 8;
const LEFT = 28, TOP = 16, BOTTOM = 16;
const HARNESS = 58;             // wiring harness + BMS box at the right
const W = LEFT + STRIP_W + 12 + HARNESS + 10;
const H = TOP + ROWS * STRIP_H + (ROWS - 1) * STRIP_GAP + BOTTOM;

const stripY = (row: number) => TOP + row * (STRIP_H + STRIP_GAP);
const cellX = (col: number) => LEFT + CAP + col * CW;
/** Y of the centre (vent) band of a strip. */
const ventY = (row: number) => stripY(row) + STRIP_PAD + BUS_H;

/* Colour: deviation from the cluster mean, mV. A healthy pack is mostly the
   neutral cell blue; drift pulls a cell toward amber/red (low) or teal (high). */
const NEUTRAL = [79, 134, 198];
const LOW1 = [216, 161, 58];
const LOW2 = [194, 86, 107];
const HIGH = [44, 181, 160];
const mix = (a: number[], b: number[], t: number) =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t)))).join(",")})`;
function colourFor(dev: number | null): string {
  if (dev == null) return "rgb(var(--color-surface3))";
  if (dev < -25) return mix(LOW1, LOW2, (-dev - 25) / 25);
  if (dev < -8) return mix(NEUTRAL, LOW1, (-dev - 8) / 17);
  if (dev > 8) return mix(NEUTRAL, HIGH, (dev - 8) / 22);
  return mix(NEUTRAL, NEUTRAL, 0);
}

const volts = (mv: number | null) => (mv == null ? "—" : `${(mv / 1000).toFixed(3)} V`);
const degC = (t: number | null) => (t == null ? "—" : `${t.toFixed(1)} °C`);

/* Temperature: deviation from the cluster mean, °C. ±1 °C reads as even. */
const WARM1 = [216, 161, 58];
function tempColour(dev: number | null): string {
  if (dev == null) return "rgb(var(--color-surface3))";
  if (dev > 3) return mix(WARM1, LOW2, (dev - 3) / 3);
  if (dev > 1) return mix(NEUTRAL, WARM1, (dev - 1) / 2);
  if (dev < -1) return mix(NEUTRAL, HIGH, (-dev - 1) / 2);
  return mix(NEUTRAL, NEUTRAL, 0);
}
/* Cells recede in temperature mode, so the probes carry the colour. */
const CELL_MUTED = "rgb(88,98,112)";

export interface PackLayoutProps {
  /** All cells of the cluster, in cell-number order. */
  cells: CellData[];
  /** 1-based pack number. */
  pack: number;
  /** Mean cell voltage across the whole cluster, mV — the colour reference. */
  clusterMeanMv: number | null;
  /** Called with the global (1-based) cell number when a cell is clicked. */
  onSelectCell?: (cellNo: number) => void;
  /** Highlight this global cell number. */
  selected?: number;
  /** What the colour shows. Temperature draws the probes along the busbars. */
  mode?: "voltage" | "temperature";
  /** All probe temperatures of the cluster by probe number (index 0 = probe 1). */
  probes?: (number | null)[];
  /** Mean probe temperature across the cluster, °C — the colour reference. */
  clusterMeanC?: number | null;
}

export function PackLayout({
  cells, pack, clusterMeanMv, onSelectCell, selected,
  mode = "voltage", probes = [], clusterMeanC = null,
}: PackLayoutProps) {
  const [hover, setHover] = useState<number | null>(null);
  const [hoverProbe, setHoverProbe] = useState<number | null>(null);
  const temp = mode === "temperature";
  const firstProbe = (pack - 1) * PROBES_PER_PACK;
  const packProbes = useMemo(
    () => Array.from({ length: PROBES_PER_PACK }, (_, i) => probes[firstProbe + i] ?? null),
    [probes, firstProbe],
  );
  const tStats = useMemo(() => {
    const vals = packProbes.map((t, i) => ({ i, t })).filter((x): x is { i: number; t: number } => x.t != null);
    if (!vals.length) return null;
    const min = vals.reduce((a, b) => (b.t < a.t ? b : a));
    const max = vals.reduce((a, b) => (b.t > a.t ? b : a));
    return { min, max, spread: max.t - min.t };
  }, [packProbes]);
  const first = (pack - 1) * CELLS_PER_PACK;
  const packCells = useMemo(() => cells.slice(first, first + CELLS_PER_PACK), [cells, first]);

  const stats = useMemo(() => {
    const vals = packCells.map((c, k) => ({ k, v: c.voltMv })).filter((x): x is { k: number; v: number } => x.v != null);
    if (!vals.length) return null;
    const min = vals.reduce((a, b) => (b.v < a.v ? b : a));
    const max = vals.reduce((a, b) => (b.v > a.v ? b : a));
    const avg = vals.reduce((a, b) => a + b.v, 0) / vals.length;
    return { min, max, avg, spread: max.v - min.v };
  }, [packCells]);

  /* Series path through cell centres, in chain order. */
  const path = useMemo(() => {
    const pts = packCells.map((_, k) => {
      const { row, col } = placeOf(k);
      return `${cellX(col) + CW / 2},${ventY(row) + VENT_H / 2}`;
    });
    return pts.length ? `M${pts.join(" L")}` : "";
  }, [packCells]);

  if (!packCells.length) return null;
  const firstPlace = placeOf(0);
  const lastPlace = placeOf(packCells.length - 1);
  const hovered = hover != null ? packCells[hover] : null;

  return (
    <div style={{ minWidth: 0 }}>
      {/* Header: which pack, which cells, and its extremes. */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 14px", marginBottom: 2, fontSize: 11.5 }}>
        <span style={{ fontWeight: 600, color: "var(--ink)" }}>Pack {pack}</span>
        <span style={{ color: "var(--muted)" }}>Cells {first + 1}–{first + packCells.length}</span>
        {temp && tStats && (
          <>
            <span style={{ color: "var(--muted)" }}>Min <b style={{ color: "var(--ink)", fontWeight: 600 }}>{degC(tStats.min.t)}</b> Sensor {firstProbe + tStats.min.i + 1}</span>
            <span style={{ color: "var(--muted)" }}>Max <b style={{ color: "var(--ink)", fontWeight: 600 }}>{degC(tStats.max.t)}</b> Sensor {firstProbe + tStats.max.i + 1}</span>
            <span style={{ color: "var(--muted)" }}>Spread <b style={{ color: "var(--ink)", fontWeight: 600 }}>{tStats.spread.toFixed(1)} °C</b></span>
          </>
        )}
        {!temp && stats && (
          <>
            <span style={{ color: "var(--muted)" }}>Min <b style={{ color: "var(--ink)", fontWeight: 600 }}>{volts(stats.min.v)}</b> #{first + stats.min.k + 1}</span>
            <span style={{ color: "var(--muted)" }}>Max <b style={{ color: "var(--ink)", fontWeight: 600 }}>{volts(stats.max.v)}</b> #{first + stats.max.k + 1}</span>
            <span style={{ color: "var(--muted)" }}>Spread <b style={{ color: "var(--ink)", fontWeight: 600 }}>{stats.spread.toFixed(0)} mV</b></span>
          </>
        )}
      </div>
      {/* Hover readout on a line of its own, always the same height. Inside the
          header it could wrap the header onto a second line when it appeared,
          shifting the drawing so the cell slid out from under the pointer —
          which cleared the readout, which moved it back: a flicker loop. */}
      <div style={{ height: 16, marginBottom: 4, fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontVariantNumeric: "tabular-nums" }}>
        {temp && hoverProbe != null
          ? `Probe ${firstProbe + hoverProbe + 1} · Module M${Math.floor(hoverProbe / PROBES_PER_STRIP) + 1} · ${degC(packProbes[hoverProbe])}`
          : hovered ? `Cell ${first + (hover as number) + 1} · Strip ${STRIPS[placeOf(hover as number).row]} · ${volts(hovered.voltMv)}`
          : "\u00a0"}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`Pack ${pack} cell layout`}>
        {/* Tray. */}
        <rect x={2} y={2} width={W - 4} height={H - 4} rx={8} fill="#2a2f37" stroke="#11151b" strokeWidth={2} />

        {STRIPS.map((s, row) => {
          const y = stripY(row);
          // Plates alternate between the two edges from strip to strip, as the
          // chain turns at each end.
          const flip = row % 2 === 1;
          const topPairs = Array.from({ length: 7 }, (_, i) => (flip ? i * 2 - 1 : i * 2));
          const botPairs = Array.from({ length: 7 }, (_, i) => (flip ? i * 2 : i * 2 - 1));
          const plate = (start: number, yy: number, key: string) => {
            // A plate spans cells start and start+1; at the ends it is a single
            // terminal pad on one cell.
            const a = Math.max(0, start);
            const b = Math.min(COLS - 1, start + 1);
            const x0 = cellX(a) + 4;
            const x1 = cellX(b) + CW - 4;
            const single = a === b;
            return (
              <g key={key}>
                <rect x={x0} y={yy} width={x1 - x0} height={BUS_H} rx={3}
                  fill={single ? "#d9dde2" : "#c9ced6"} stroke="#8d949e" strokeWidth={0.8} />
                {/* Laser-weld seam and bolt pads. */}
                {!single && <line x1={(x0 + x1) / 2} y1={yy + 4} x2={(x0 + x1) / 2} y2={yy + BUS_H - 4} stroke="#9aa1ab" strokeWidth={1.4} />}
                <circle cx={x0 + 9} cy={yy + BUS_H / 2} r={3} fill="#a9b0b9" />
                <circle cx={x1 - 9} cy={yy + BUS_H / 2} r={3} fill="#a9b0b9" />
                {/* Voltage sense tab. */}
                <rect x={(x0 + x1) / 2 - 3} y={yy + (yy < ventY(row) ? BUS_H - 3 : -2)} width={6} height={5} rx={1} fill="#e2b93b" />
              </g>
            );
          };
          return (
            <g key={s}>
              {/* Carrier. */}
              <rect x={LEFT} y={y} width={STRIP_W} height={STRIP_H} rx={5} fill="#111418" />
              {/* Orange end caps. */}
              <rect x={LEFT} y={y + 3} width={CAP} height={STRIP_H - 6} rx={3} fill="#e8762c" />
              <rect x={LEFT + STRIP_W - CAP} y={y + 3} width={CAP} height={STRIP_H - 6} rx={3} fill="#e8762c" />
              <text x={LEFT - 13} y={y + STRIP_H / 2 + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#c4cad3">{s}</text>
              {topPairs.map((st, i) => plate(st, y + STRIP_PAD, `t${i}`))}
              {botPairs.map((st, i) => plate(st, y + STRIP_PAD + BUS_H + VENT_H, `b${i}`))}
            </g>
          );
        })}

        {/* Cells: the centre band carries the reading. */}
        {packCells.map((c, k) => {
          const { row, col } = placeOf(k);
          const x = cellX(col), y = ventY(row);
          const dev = c.voltMv != null && clusterMeanMv != null ? c.voltMv - clusterMeanMv : null;
          const no = first + k + 1;
          const isMin = !temp && stats?.min.k === k, isMax = !temp && stats?.max.k === k;
          const isSel = selected === no;
          const ring = isSel ? "#ffffff" : isMin ? "#ff6b7d" : isMax ? "#3fe0c3" : null;
          return (
            <g
              key={c.cellId}
              onMouseEnter={() => setHover(k)}
              onMouseLeave={() => setHover((h) => (h === k ? null : h))}
              onClick={() => onSelectCell?.(no)}
              style={{ cursor: onSelectCell ? "pointer" : "default" }}
            >
              <title>{`Cell ${no} · strip ${STRIPS[row]} · ${volts(c.voltMv)}`}</title>
              <rect x={x + 1.5} y={y + 1} width={CW - 3} height={VENT_H - 2} rx={3} fill={temp ? CELL_MUTED : colourFor(dev)} />
              {/* Vent. */}
              <ellipse cx={x + CW / 2} cy={y + VENT_H / 2} rx={15} ry={9.5} fill="rgba(255,255,255,0.88)" stroke="rgba(0,0,0,0.25)" strokeWidth={0.8} />
              <text x={x + CW / 2} y={y + VENT_H / 2 + 3.6} textAnchor="middle" fontSize={10} fontWeight={700} fill="#1b2330">{no}</text>
              {ring && (
                <rect x={x + 0.5} y={stripY(row) + STRIP_PAD - 1} width={CW - 1} height={BUS_H * 2 + VENT_H + 2}
                  rx={4} fill="none" stroke={ring} strokeWidth={2.4} pointerEvents="none" />
              )}
            </g>
          );
        })}

        {/* Red sense wires along each strip, either side of the vents. */}
        {STRIPS.map((s, row) => (
          <g key={`w${s}`} stroke="#d23b3b" strokeWidth={1.1} fill="none" opacity={0.85} pointerEvents="none">
            <path d={`M${cellX(0) + 6},${ventY(row) + 2} L${cellX(COLS - 1) + CW - 6},${ventY(row) + 2}`} />
            <path d={`M${cellX(0) + 6},${ventY(row) + VENT_H - 2} L${cellX(COLS - 1) + CW - 6},${ventY(row) + VENT_H - 2}`} />
          </g>
        ))}

        {/* Temperature probes: 8 per module, evenly along its top busbar row,
            in probe order — see the header for why the placement is assumed. */}
        {temp && STRIPS.map((s, row) => {
          const span = COLS * CW;
          const step = span / PROBES_PER_STRIP;
          const y = stripY(row) + STRIP_PAD + 1;
          return Array.from({ length: PROBES_PER_STRIP }, (_, j) => {
            const i = row * PROBES_PER_STRIP + j;
            const t = packProbes[i];
            const cx = cellX(0) + step * (j + 0.5);
            const isMin = tStats?.min.i === i, isMax = tStats?.max.i === i;
            return (
              <g key={`p${s}${j}`} onMouseEnter={() => setHoverProbe(i)} onMouseLeave={() => setHoverProbe((h) => (h === i ? null : h))}>
                <title>{`Probe ${firstProbe + i + 1} · module M${row + 1} · ${degC(t)}`}</title>
                <rect x={cx - 25} y={y} width={50} height={BUS_H - 2} rx={5}
                  fill={tempColour(t != null && clusterMeanC != null ? t - clusterMeanC : null)}
                  stroke={isMax ? "#ff6b7d" : isMin ? "#3fe0c3" : "rgba(0,0,0,0.35)"} strokeWidth={isMax || isMin ? 2.4 : 1} />
                <text x={cx} y={y + BUS_H / 2 + 3} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
                  {t != null ? t.toFixed(1) : "—"}
                </text>
              </g>
            );
          });
        })}

        {/* Series path, faint, over the cells. */}
        <path d={path} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.2} strokeDasharray="3 4" pointerEvents="none" />

        {/* Harness and BMS box along the right edge, with module tags. */}
        {(() => {
          const hx = LEFT + STRIP_W + 12;
          return (
            <g>
              <path d={`M${hx + 10},${TOP} C${hx + 22},${H * 0.3} ${hx - 2},${H * 0.6} ${hx + 12},${H - BOTTOM}`} stroke="#0b0d10" strokeWidth={6} fill="none" />
              <rect x={hx + 20} y={H / 2 - 40} width={HARNESS - 24} height={80} rx={4} fill="#1a1e24" stroke="#3a414b" />
              <text x={hx + 20 + (HARNESS - 24) / 2} y={H / 2 + 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#8b95a3"
                transform={`rotate(-90 ${hx + 20 + (HARNESS - 24) / 2} ${H / 2})`}>BMU</text>
              {STRIPS.map((_, row) => (
                <g key={`tag${row}`}>
                  <line x1={LEFT + STRIP_W} y1={stripY(row) + STRIP_H / 2} x2={hx + 12} y2={stripY(row) + STRIP_H / 2} stroke="#0b0d10" strokeWidth={3} />
                  <rect x={hx - 4} y={stripY(row) + STRIP_H / 2 - 7} width={20} height={14} rx={2} fill={row % 2 ? "#e5c93a" : "#3a9ad9"} />
                  <text x={hx + 6} y={stripY(row) + STRIP_H / 2 + 3.5} textAnchor="middle" fontSize={8} fontWeight={700} fill="#111">M{row + 1}</text>
                </g>
              ))}
            </g>
          );
        })()}

        {/* Pack terminals at the two ends of the chain. */}
        <text x={LEFT + CAP / 2} y={ventY(firstPlace.row) + VENT_H / 2 + 5} textAnchor="middle" fontSize={15} fontWeight={800} fill="#fff">+</text>
        <text
          x={lastPlace.col === 0 ? LEFT + CAP / 2 : LEFT + STRIP_W - CAP / 2}
          y={ventY(lastPlace.row) + VENT_H / 2 + 5}
          textAnchor="middle" fontSize={16} fontWeight={800} fill="#fff"
        >−</text>
      </svg>
    </div>
  );
}

/** Colour key for the pack layout in temperature mode. */
export function PackTempLegend() {
  const items: Array<[string, string]> = [
    [tempColour(5), "≥ 5 °C Above Average"],
    [tempColour(2), "2 °C Above Average"],
    [tempColour(0), "Within ±1 °C Of Average"],
    [tempColour(-3), "≥ 3 °C Below Average"],
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 11, color: "var(--muted)" }}>
      {items.map(([c, l]) => (
        <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: c }} />{l}
        </span>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, border: "2px solid #ff6b7d" }} />Pack Hottest
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, border: "2px solid #3fe0c3" }} />Pack Coolest
      </span>
    </div>
  );
}

/** Colour key for the pack layout. */
export function PackLegend() {
  const items: Array<[string, string]> = [
    [colourFor(-50), "≥ 50 mV Low"],
    [colourFor(-25), "25 mV Low"],
    [colourFor(0), "Within ±8 mV Of Average"],
    [colourFor(30), "≥ 30 mV High"],
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 11, color: "var(--muted)" }}>
      {items.map(([c, l]) => (
        <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: c }} />{l}
        </span>
      ))}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, border: "2px solid #C2566B" }} />Pack Min
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, border: "2px solid #2CB5A0" }} />Pack Max
      </span>
      <span>Dashed Line: Series Path, + To − · Silver Plates: Busbars</span>
    </div>
  );
}
