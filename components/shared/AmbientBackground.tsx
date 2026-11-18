"use client";

import { useEffect, useState } from "react";
import AnimatedGradient from "@/components/ui/animated-gradient";

/**
 * Slow ambient wash behind the whole shell.
 *
 * It is deliberately near-invisible: the dashboard is dense with numbers and
 * charts, so this reads as a faint drift in the backdrop rather than something
 * you look at. Everything about the intensity lives in the two config blocks
 * below — turn OPACITY up if you want more of it.
 */

// How much of the gradient makes it through. This is the main dial.
// Light needs far more than dark: the accent is a pale blue sitting on near-
// white, so the same opacity that reads clearly over #06080C vanishes on paper.
// Pulled back from .28/.70 now that cards are opaque and the body carries its
// own corner washes: the wash reads only in the gutters between cards, so the
// old values stacked two gradients in the same place and greyed the page.
const OPACITY = { dark: 0.22, light: 0.45 };

// Shared motion. The low `scale`/`shapeSize` pair keeps the shapes few, large
// and slow — at this size the pattern reads as drifting light, not as a texture.
const MOTION = {
  preset: "custom",
  rotation: -35,
  // Pushed hard toward the base colour: the Checks field clusters around its
  // midpoint, so anything near 50 paints the whole viewport in the accent.
  proportion: 10,
  scale: 0.28,
  speed: 4,
  distortion: 3,
  swirl: 45,
  swirlIterations: 4,
  softness: 100,
  offset: -120,
  shape: "Checks",
  shapeSize: 18,
} as const;

// The colour ramp runs base → accent → base, so the accent is a ribbon of light
// between two stretches of the page's own background rather than a field of
// colour. That is what keeps the wash from competing with the data.

// Dark theme: control-room cyan over the deep navy base.
const DARK = {
  ...MOTION,
  color1: "#08111B", // --bg
  color2: "#2CC9DE", // --accent
  color3: "#0A1826", // --bg, faintly lifted
} as const;

// Light theme: the same motion in pale cyan, so it stays a haze and never
// darkens the paper.
const LIGHT = {
  ...MOTION,
  color1: "#EEF1F7", // --bg
  color2: "#9FD8E4",
  color3: "#E6EDF6",
} as const;

export function AmbientBackground() {
  const [isLight, setIsLight] = useState(false);

  // The theme is a class on <html>, toggled from TopBar. Watch it so the wash
  // swaps palettes with the rest of the UI.
  useEffect(() => {
    const html = document.documentElement;
    const sync = () => setIsLight(html.classList.contains("light"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <AnimatedGradient
      config={isLight ? LIGHT : DARK}
      fps={20}
      maxPixelRatio={1}
      style={{
        zIndex: 0,
        opacity: isLight ? OPACITY.light : OPACITY.dark,
        transition: "opacity 0.2s",
      }}
    />
  );
}
