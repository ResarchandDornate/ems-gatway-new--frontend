/**
 * The scene's palette and material vocabulary, in one place, for both themes.
 *
 * Two rules hold the look together, and both are easy to break by editing a
 * colour inline somewhere:
 *
 *   1. Infrastructure is never coloured. Every cabinet, panel, tower and
 *      building is one of three neutrals. All chroma in the frame belongs to
 *      energy — the flows, the status trim, the SOC bar. That is what makes a
 *      cyan line read as *power* rather than as decoration.
 *
 *   2. Glow is emissive-only. There is no bloom pass; brightness comes from
 *      emissiveIntensity plus an additive shell around the hot geometry. A
 *      postprocessing chain would wash the neutrals out and cost a full-screen
 *      pass per frame on a dashboard that may be left open all day.
 *
 * ── On the light theme ──────────────────────────────────────────────────────
 *
 * Light is not "dark with the background flipped", and treating it that way is
 * what makes most dark-first 3D look broken in daylight. Three things change:
 *
 *   · Chroma darkens. Cyan that sings against charcoal is invisible against
 *     white — the light palette's energy colours are the same hues pushed down
 *     in value until they hold contrast against a pale floor.
 *
 *   · Emissives come down hard (`glow` ≈ 0.5). Emissive is additive against
 *     whatever is behind it; on a light floor an intensity tuned for dark
 *     clips straight to white and the flows lose both their colour and their
 *     direction.
 *
 *   · Shadow does the separating instead of glow. White equipment on a pale
 *     slab reads fine — that is just a clay render — but only if contact
 *     shadow and a softer, higher-ambient key are carrying the form. So the
 *     light palette raises ambient, lowers the key, and leans on
 *     ContactShadows harder than the dark one does.
 */

export type ThemeName = "dark" | "light";

export interface ScenePalette {
  name: ThemeName;

  // Energy chroma.
  cyan: number;   // charging / PV-side flow
  teal: number;   // discharge / delivered energy
  steel: number;  // utility side — cooler and duller than the renewable path
  green: number;  // load side
  amber: number;  // SOC below the comfortable band
  red: number;    // fault

  // Neutrals. Infrastructure only.
  shell: number;
  shellMid: number;
  shellDark: number;
  casing: number;       // unlit cable sheath
  platform: number;     // the slabs assets stand on
  platformEdge: number;
  /**
   * Ground plane colour, or null to omit the plane entirely.
   *
   * Dark needs a floor: the charcoal ground *is* the backdrop, and without it
   * the equipment floats on the page. Light does not, and forcing one in was
   * the wrong instinct — an opaque plane, however pale, tone-maps down to a
   * mid-grey slab that reads as a hole punched in a white dashboard. Leaving
   * the canvas transparent lets the card's own surface be the ground, and
   * ContactShadows still seats everything on it.
   */
  floor: number | null;
  gridLine: number;

  /** Multiplier applied to every emissiveIntensity in the scene. */
  glow: number;
  gridOpacity: number;
  contactShadow: number;

  lighting: {
    ambient: number;
    key: number;
    rim: number;
    fill: number;
    exposure: number;
    /**
     * ACES is built for HDR scenes that resolve to dark, and it earns its
     * place there: it rolls the emissive flows off instead of letting them
     * clip. Pointed at a light palette it does the opposite favour, dragging a
     * near-white floor down to a flat mid-grey. Light renders linear, which
     * costs nothing because its emissives are already at half intensity and
     * have no highlights left to roll off.
     */
    toneMapping: "aces" | "linear";
  };

  /** Tokens for the HTML panels, which cannot read the numeric colours above. */
  css: {
    ink: string;
    inkDim: string;
    panelBg: string;
    panelBorder: string;
    panelShadow: string;
  };
}

const KEY_POSITION = [-9, 14, 8] as const;
const RIM_POSITION = [10, 6, -8] as const;
const FILL_POSITION = [4, 3, 10] as const;

export const LIGHT_POSITIONS = {
  key: KEY_POSITION,
  rim: RIM_POSITION,
  fill: FILL_POSITION,
} as const;

/** Shadow map resolution. Shared — this is a cost, not a look. */
export const SHADOW_MAP_SIZE = 2048;

export const DARK_PALETTE: ScenePalette = {
  name: "dark",

  cyan: 0x2fd8ee,
  teal: 0x34d6b4,
  steel: 0x5b8ab4,
  green: 0x4e8d6e,
  amber: 0xd8a13a,
  red: 0xd05463,

  shell: 0xe8eef6,
  shellMid: 0xaebac9,
  shellDark: 0x6d7987,
  casing: 0x39424f,
  platform: 0x161c26,
  platformEdge: 0x232c3a,
  floor: 0x0b0f16,
  gridLine: 0x1e2937,

  glow: 1,
  gridOpacity: 0.42,
  contactShadow: 0.5,

  lighting: { ambient: 0.62, key: 1.85, rim: 0.5, fill: 0.35, exposure: 1.06, toneMapping: "aces" },

  css: {
    ink: "#eaf1f8",
    inkDim: "#8b97a6",
    panelBg: "rgba(11, 16, 23, 0.82)",
    panelBorder: "rgba(120, 150, 190, 0.22)",
    panelShadow: "0 10px 34px rgba(0, 0, 0, 0.55)",
  },
};

export const LIGHT_PALETTE: ScenePalette = {
  name: "light",

  // Same hues, pushed down in value so they hold against a pale floor.
  cyan: 0x0d8ea3,
  teal: 0x108974,
  steel: 0x40699b,
  green: 0x2f7355,
  amber: 0xa9741a,
  red: 0xb03d4d,

  // Equipment stays near-white; the slabs go mid-grey so the two separate.
  shell: 0xfdfefe,
  shellMid: 0xccd5e0,
  shellDark: 0x93a0af,
  casing: 0x9aa6b4,
  platform: 0xdae2ec,
  platformEdge: 0xeaeff5,
  floor: null,
  gridLine: 0xccd6e2,

  // Emissive is additive: dark-theme intensities clip to white on a pale floor.
  glow: 0.5,
  gridOpacity: 0.62,
  // Form is carried by shadow here rather than by glow, so this works harder.
  contactShadow: 0.42,

  lighting: { ambient: 0.82, key: 1.5, rim: 0.26, fill: 0.3, exposure: 1.0, toneMapping: "linear" },

  css: {
    ink: "#16202c",
    inkDim: "#5b6979",
    panelBg: "rgba(255, 255, 255, 0.92)",
    panelBorder: "rgba(22, 42, 72, 0.16)",
    panelShadow: "0 8px 26px rgba(15, 23, 42, 0.14)",
  },
};

export const PALETTES: Record<ThemeName, ScenePalette> = {
  dark: DARK_PALETTE,
  light: LIGHT_PALETTE,
};

/** `0x2fd8ee` → `#2fd8ee`, for handing scene colours to the DOM panels. */
export const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

/** SOC band colouring, shared by the bank's bar and its readout. */
export function socColor(soc: number | null, p: ScenePalette): number {
  if (soc == null) return p.shellDark;
  if (soc < 20) return p.red;
  if (soc < 45) return p.amber;
  return p.teal;
}
