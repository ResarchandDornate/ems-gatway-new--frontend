/**
 * Globe tokens.
 *
 * Two complete environments rather than one inverted. The dark globe is a lit
 * object in a black room — graphite surface, warm rim, emissive spikes doing
 * the illuminating. The light globe is an object on paper — the rim glow is
 * nearly gone, the sphere is pale, and the spikes go deeper in value so they
 * hold against white instead of bleaching out.
 *
 * Consumed through useGlobeTokens(), which reads the app's existing theme
 * state. No second theme system, and no reload: the palette object swaps and
 * the materials pick it up on the next frame.
 */

export interface GlobeTokens {
  /** Sphere body. */
  surface: number;
  /** Landmass tint applied over the texture. */
  continent: number;
  /** Fresnel rim around the silhouette. */
  atmosphere: number;
  atmosphereStrength: number;

  /** Spike ramp, low → high. Warm throughout; never a rainbow. */
  dataLow: number;
  dataMid: number;
  dataHigh: number;
  /** Extreme values tip toward this. */
  dataPeak: number;
  /** Emissive multiplier — pulled right down on paper. */
  dataGlow: number;

  /** Site markers. */
  point: number;
  pointGlow: number;

  /** Connection arcs. */
  arc: number;
  arcOpacity: number;

  ambient: number;
  key: number;

  css: {
    panelBg: string;
    panelBorder: string;
    textPrimary: string;
    textSecondary: string;
    barTrack: string;
    live: string;
  };
}

export const DARK_GLOBE: GlobeTokens = {
  surface: 0x232830,
  continent: 0xbcc3cc,
  atmosphere: 0xd4562a,
  atmosphereStrength: 0.85,

  dataLow: 0xf2b33d,
  dataMid: 0xf08b28,
  dataHigh: 0xe25b1c,
  dataPeak: 0xd8341a,
  dataGlow: 1,

  point: 0xfff1dc,
  pointGlow: 1,

  arc: 0xe8873a,
  arcOpacity: 0.22,

  ambient: 0.55,
  key: 2.3,

  css: {
    panelBg: "rgba(14, 15, 18, 0.86)",
    panelBorder: "rgba(200, 150, 110, 0.16)",
    textPrimary: "#EFEFF1",
    textSecondary: "#8A9099",
    barTrack: "rgba(255, 255, 255, 0.06)",
    live: "#E8873A",
  },
};

export const LIGHT_GLOBE: GlobeTokens = {
  // A pale sphere with darker land — the reference's relationship, inverted in
  // value but not in structure, so the silhouette still reads the same way.
  surface: 0xf2f5f8,
  continent: 0xffffff,
  atmosphere: 0xc2703c,
  // Nearly off. A rim glow on white looks like a lens artefact, not an
  // atmosphere, so depth here comes from the surface shading instead.
  atmosphereStrength: 0.22,

  dataLow: 0xc98a1e,
  dataMid: 0xc06a14,
  dataHigh: 0xa9481a,
  dataPeak: 0x8f2f16,
  dataGlow: 0.35,

  point: 0x1d5f7a,
  pointGlow: 0.4,

  arc: 0xa9481a,
  arcOpacity: 0.16,

  ambient: 0.75,
  key: 1.1,

  css: {
    panelBg: "rgba(255, 255, 255, 0.92)",
    panelBorder: "rgba(20, 40, 70, 0.12)",
    textPrimary: "#151A21",
    textSecondary: "#697280",
    barTrack: "rgba(15, 23, 42, 0.07)",
    live: "#B4531F",
  },
};

/** `0xe8873a` → `#e8873a`, for the DOM panels. */
export const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
