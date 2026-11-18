"use client";

/**
 * PowerFlowView — picks the rendering for the single-line stage.
 *
 * Both themes now get the 3D scene; the SVG stays as the fallback while the
 * canvas loads and for anything that cannot run WebGL.
 *
 * The earlier split — 3D dark, SVG light — assumed white bodies could not read
 * on a pale floor. That is true of glow, not of form: a clay render is white on
 * white and works because shadow does the separating. So the scene carries two
 * palettes instead, and light simply drives the emissives down and lets contact
 * shadow carry the shape.
 *
 * The scene remounts on a theme change rather than mutating live materials.
 * Lighting, tone mapping and the backdrop texture are all baked at build time,
 * and rebuilding once on a toggle is cheaper to reason about than keeping every
 * one of them swappable.
 *
 * Loaded on demand: three.js is already in the tree via react-globe.gl, but a
 * canvas has no business booting for someone who never opens the dashboard —
 * the same dynamic() pattern GroupScreen already uses for the globe.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { PowerFlowDiagram } from "./PowerFlowDiagram";

const PowerFlowScene3D = dynamic(() => import("./PowerFlowScene3D"), {
  ssr: false,
  loading: () => <div className="w-full h-full" />,
});

export interface PowerFlowViewProps {
  gridKw: number | null;
  loadKw: number | null;
  battKw: number | null;
  solarKw: number | null;
  soc: number | null;
  soh: number | null;
  maxCellTempC: number | null;
  gridHz: number | null;
}

/** Theme is a class on <html>; watch it so the stage swaps with the toggle. */
function useIsLight(): boolean | null {
  // null until mounted — rendering either branch during hydration would flash
  // the wrong one, and mounting a WebGL canvas only to tear it down is worse.
  const [isLight, setIsLight] = useState<boolean | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const sync = () => setIsLight(html.classList.contains("light"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isLight;
}

export function PowerFlowView(props: PowerFlowViewProps) {
  const isLight = useIsLight();

  // Until the theme is known, render the SVG: it needs no canvas, so there is
  // nothing to tear down if the answer turns out to be the other one.
  if (isLight === null) return <PowerFlowDiagram {...props} />;

  return (
    <PowerFlowScene3D
      key={isLight ? "light" : "dark"}
      light={isLight}
      gridKw={props.gridKw}
      loadKw={props.loadKw}
      battKw={props.battKw}
      soc={props.soc}
    />
  );
}
