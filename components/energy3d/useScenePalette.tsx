"use client";

/**
 * Which palette the scene is drawing with.
 *
 * The app's theme is a `light` class on <html>, toggled by TopBar and restored
 * from localStorage by an inline script in the root layout. There is no React
 * state behind it, so this observes the attribute rather than subscribing to a
 * store — the same approach the old PowerFlowView used, kept because it is the
 * only thing that stays correct when the class is set outside React.
 *
 * The palette rides a context that is provided *outside* the R3F Canvas and
 * read inside it. That works: R3F forwards parent context through its own
 * reconciler, which is verified by the data layer doing exactly the same thing
 * — the callouts inside the Canvas render values from EnergyProvider.
 *
 * Unlike the old scene, a theme switch does NOT remount the canvas. Everything
 * that differs between themes is either a material property or a light
 * intensity, and both are cheap to reassign; tearing down a WebGL context and
 * rebuilding every geometry to change some colours is a lot of work to avoid
 * writing the update path once.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DARK_PALETTE, PALETTES, type ScenePalette, type ThemeName } from "./theme";

const PaletteContext = createContext<ScenePalette>(DARK_PALETTE);

/**
 * Track the `light` class on <html>.
 *
 * Returns null until mounted. Callers must not render a canvas against a
 * guess: the server has no idea which theme is active, and committing to one
 * during hydration means either a flash of the wrong palette or a WebGL
 * context built and immediately thrown away.
 */
export function useThemeName(): ThemeName | null {
  const [name, setName] = useState<ThemeName | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const sync = () => setName(html.classList.contains("light") ? "light" : "dark");
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return name;
}

export function ScenePaletteProvider({
  theme,
  children,
}: {
  theme: ThemeName;
  children: ReactNode;
}) {
  return (
    <PaletteContext.Provider value={PALETTES[theme]}>{children}</PaletteContext.Provider>
  );
}

/** The active palette. Safe outside a provider — falls back to dark. */
export function useScenePalette(): ScenePalette {
  return useContext(PaletteContext);
}
