"use client";

/**
 * IndiaPortfolioMap — the portfolio's sites on a map of India.
 *
 *   <IndiaPortfolioMap sites={sites} metric="Installed Power" unit="MW" />
 *
 * ── Why a map and not the globe ─────────────────────────────────────────────
 *
 * Every site in GEO_LOOKUP is Indian — Assam to Amritsar, Nasik to Malur — so
 * a whole Earth spent most of its pixels on ocean and most of its interaction
 * budget on rotating back to the one country that matters. At India's extent
 * the portfolio reads as a distribution rather than a cluster of dots on a
 * limb, and nothing is ever hidden around the back.
 *
 * It also drops a network dependency: the globe textured itself from
 * unpkg.com at runtime, and rendered as a featureless grey sphere whenever
 * that did not resolve.
 *
 * ── The boundary is the point ───────────────────────────────────────────────
 *
 * india-states.json is derived from udit-001/india-maps-data's TopoJSON
 * `states` layer, chosen over the alternatives BECAUSE of where its lines run:
 * it carries the full claimed territory — Ladakh reaching 37.08°N and 80.33°E,
 * so Gilgit-Baltistan and Aksai Chin are inside the outline — and Arunachal
 * Pradesh whole to 97.39°E. A GADM-derived file tested alongside it stopped at
 * 35.50°N, which is a materially different and, for an Indian company
 * shipping this to customers, an unacceptable map.
 *
 * Simplification was therefore checked against that extent rather than only
 * by eye: 4,723 points at ~86 KB, still spanning 68.10..97.39 by 6.77..37.08.
 * If this asset is ever regenerated, re-verify the extent before shipping it.
 *
 * Administrative divisions are current: 36 states and UTs, with Telangana,
 * Ladakh separate from Jammu & Kashmir, and Dadra & Nagar Haveli merged with
 * Daman & Diu.
 *
 * ── Projection ──────────────────────────────────────────────────────────────
 *
 * ── Colour ─────────────────────────────────────────────────────────────────
 *
 * Straight from the shell's CSS custom properties, not from globe/tokens.ts.
 * Those describe a LIT 3D SPHERE — `continent` is pure white because it is a
 * tint multiplied over a texture and then shaded by a key light. Painted flat
 * into an SVG with no lighting, white land lands on a white card and the map
 * disappears, which is exactly what the first cut of this did. Reading
 * --surface3 / --line2 / --accent instead also means the map re-themes with
 * the rest of the shell without a JS theme lookup at all.
 *
 * Web Mercator, written out here rather than pulled from d3-geo: d3-geo is
 * present only as a transitive dependency of a charting package, and importing
 * it directly would make this component break the day that package drops it.
 * The whole projection is four lines, and India is far enough from the poles
 * that Mercator's distortion is not visible at this size.
 */

import { useMemo, useState } from "react";
import indiaStates from "./india-states.json";

export interface MapSite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** The metric driving marker size. Real API value. */
  value: number;
  status?: string;
}

type Ring = number[][];
type FeatureCollection = {
  features: { properties: { st_nm: string }; geometry: { coordinates: Ring[][] } }[];
};

const GEO = indiaStates as unknown as FeatureCollection;

/* ── Projection ───────────────────────────────────────────────────────────── */

const VB_W = 1000;
const PAD = 24;

/**
 * Mercator northing, returned in DEGREES rather than the natural log units.
 *
 * x below is a raw longitude in degrees, so y has to share that scale. The log
 * form on its own spans ~0.58 across India against x's ~29.3, which squashes
 * the whole country into a horizontal smear roughly 57x too flat — 180/pi is
 * exactly that factor.
 */
const mercY = (lat: number) =>
  (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Bounds computed from the asset, so a regenerated file re-fits on its own. */
function bounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of GEO.features)
    for (const poly of f.geometry.coordinates)
      for (const ring of poly)
        for (const [lng, lat] of ring) {
          const y = mercY(lat);
          if (lng < x0) x0 = lng;
          if (lng > x1) x1 = lng;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
  return { x0, y0, x1, y1 };
}

/* ── Geometry, built once ─────────────────────────────────────────────────── */

const SHAPE = (() => {
  const b = bounds();
  const sx = (VB_W - PAD * 2) / (b.x1 - b.x0);
  const h = (b.y1 - b.y0) * sx + PAD * 2;

  const project = (lng: number, lat: number): [number, number] => [
    PAD + (lng - b.x0) * sx,
    /* y inverted: latitude grows upward, SVG grows downward. */
    PAD + (b.y1 - mercY(lat)) * sx,
  ];

  const paths = GEO.features.map((f) => {
    let d = "";
    for (const poly of f.geometry.coordinates)
      for (const ring of poly) {
        ring.forEach(([lng, lat], i) => {
          const [x, y] = project(lng, lat);
          d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
        });
        d += "Z";
      }
    return { name: f.properties.st_nm, d };
  });

  return { paths, project, height: h };
})();

/* ── Component ────────────────────────────────────────────────────────────── */

export function IndiaPortfolioMap({
  sites,
  metric,
  unit,
  height = 520,
}: {
  sites: MapSite[];
  metric: string;
  unit: string;
  height?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);

  /* Marker radius scales with the square root of value, not value itself: a
     circle's area is what the eye compares, so scaling the radius linearly
     would overstate a large site by its square. */
  const maxValue = useMemo(
    () => sites.reduce((m, s) => Math.max(m, s.value), 0),
    [sites],
  );

  const placed = useMemo(
    () =>
      sites.map((s) => {
        const [x, y] = SHAPE.project(s.lng, s.lat);
        const k = maxValue > 0 ? Math.sqrt(s.value / maxValue) : 0;
        return { ...s, x, y, r: 4 + k * 11 };
      }),
    [sites, maxValue],
  );

  const active = placed.find((p) => p.id === hover);

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${VB_W} ${SHAPE.height}`}
        className="w-full h-full"
        role="img"
        aria-label={`Portfolio sites across India, sized by ${metric}`}
      >
        <g>
          {SHAPE.paths.map((p) => (
            <path
              key={p.name}
              d={p.d}
              fill="var(--surface3)"
              stroke="var(--line2)"
              strokeWidth={0.9}
              strokeLinejoin="round"
              /* Fills overlap at shared borders; evenodd would punch holes
                 through them where two states meet. */
              fillRule="nonzero"
            />
          ))}
        </g>

        {placed.map((s) => (
          <g
            key={s.id}
            onMouseEnter={() => setHover(s.id)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "pointer" }}
          >
            <circle cx={s.x} cy={s.y} r={s.r * 2.2} fill="var(--accent)" opacity={0.14} />
            <circle
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="var(--accent)"
              stroke="var(--surface2)"
              strokeWidth={hover === s.id ? 2 : 1}
              opacity={hover && hover !== s.id ? 0.45 : 1}
            />
          </g>
        ))}
      </svg>

      {active && (
        <div
          className="absolute pointer-events-none rounded-lg px-2.5 py-1.5 text-[11px] leading-tight"
          style={{
            /* Positioned in percentages so the label tracks the marker as the
               SVG scales, rather than drifting off it at other widths. */
            left: `${(active.x / VB_W) * 100}%`,
            top: `${(active.y / SHAPE.height) * 100}%`,
            transform: "translate(-50%, calc(-100% - 10px))",
            background: "var(--surface2)",
            border: "1px solid var(--line2)",
            color: "var(--ink)",
            whiteSpace: "nowrap",
          }}
        >
          <div className="font-semibold">{active.name}</div>
          <div style={{ color: "var(--muted)" }}>
            {active.value.toFixed(2)} {unit} · {metric}
          </div>
        </div>
      )}

      {sites.length === 0 && (
        <div
          className="absolute inset-x-0 bottom-3 text-center text-[10px] font-mono tracking-[0.1em] uppercase"
          style={{ color: "var(--muted)" }}
        >
          No stations reporting
        </div>
      )}
    </div>
  );
}
