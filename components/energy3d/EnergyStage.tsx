"use client";

/**
 * The canvas, the palette and the scene — given a source that already exists.
 *
 * Split out of EnergyTwin so that a build with its own data layer can mount the
 * visualisation without importing the named-transport switch, and with it the
 * UGX poller and the mock simulation it will never call. The packaged mobile
 * app reads the gateway proxy and does exactly that.
 *
 * This is the one place the canvas is configured. Camera, tone mapping, DPR and
 * shadow settings live here and nowhere else, so the scene cannot come out
 * looking like two different products depending on which shell mounted it —
 * which is the failure a second copy of this file would eventually produce.
 *
 * The overlay is a node rather than a flag. It is the only part of the twin
 * that pulls a tweening library in, and a shell that does not draw it should
 * not carry it; passing it as a child also keeps it inside both providers,
 * which is where it has to be to read the plant.
 */

import { Suspense, useEffect, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  EnergySourceProvider,
  type EnergySource,
  type EnergySourceKind,
} from "@/lib/energy/context";
import { EnergyScene } from "./EnergyScene";
import { DEFAULT_SITE_ASSETS, type SiteAsset } from "@/lib/energy/topology";
import { ScenePaletteProvider, useScenePalette, useThemeName } from "./useScenePalette";

export interface EnergyStageProps {
  /** An already-resolved source: whatever hook produced it has run above. */
  source: EnergySource;
  kind?: EnergySourceKind;
  className?: string;
  /** Drawn over the canvas, inside the providers. Omit for a bare stage. */
  overlay?: ReactNode;
  /**
   * Floor for the canvas box, in px.
   *
   * 320 is the size the scene was composed at and stays the default for every
   * caller. It is a prop rather than a constant only because the dashboard packs
   * the stage into a fixed-height row beside rails of text: there, the diagram is
   * the element that gives up space, and a hard floor here does not remove that
   * pressure — it just moves the clipping from the rails onto the canvas. Lower
   * it deliberately and nowhere else; the scene reads smaller, not broken.
   */
  minHeight?: number;
  /** Which assets the site has — decides which slabs and feeders are drawn. */
  assets?: SiteAsset[];
}

export function EnergyStage({ source, kind, className, overlay, minHeight = 320, assets = DEFAULT_SITE_ASSETS }: EnergyStageProps) {
  const theme = useThemeName();

  // Until the theme is known the canvas is not mounted at all. The server
  // cannot know which one is active, and committing to a guess means either a
  // visible flash of the wrong palette or building a WebGL context and tearing
  // it straight back down.
  if (theme === null) {
    return (
      <div
        className={className}
        style={{ position: "relative", width: "100%", height: "100%", minHeight }}
      />
    );
  }

  return (
    <EnergySourceProvider source={source} kind={kind}>
      {/* Always the light palette: the twin is a white render in either app
          theme, so it reads the same wherever it is embedded. */}
      <ScenePaletteProvider theme="light">
        <div
          className={className}
          style={{ position: "relative", width: "100%", height: "100%", minHeight }}
        >
          <Canvas
            orthographic
            // zoom is a placeholder; FitToBounds sets it from the container.
            camera={{ position: [22, 17, 22], zoom: 40, near: -200, far: 400 }}
            shadows="soft"
            dpr={[1, 1.75]}
            gl={{ antialias: true, alpha: true }}
            style={{ background: "#ffffff", borderRadius: 12 }}
          >
            <Suspense fallback={null}>
              <Exposure />
              <EnergyScene assets={assets} />
            </Suspense>
          </Canvas>

          {overlay}
        </div>
      </ScenePaletteProvider>
    </EnergySourceProvider>
  );
}

/**
 * Tone mapping, kept reactive.
 *
 * This was set once in the Canvas's `onCreated`, which fires exactly one time —
 * so the light palette's lower exposure never reached a renderer that had
 * already booted in dark. Applying it from inside the tree means a theme
 * toggle updates it like any other palette value, with no canvas remount.
 */
function Exposure() {
  const p = useScenePalette();
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    gl.toneMapping =
      p.lighting.toneMapping === "aces"
        ? THREE.ACESFilmicToneMapping
        : THREE.LinearToneMapping;
    gl.toneMappingExposure = p.lighting.exposure;
  }, [gl, p.lighting.toneMapping, p.lighting.exposure]);

  return null;
}

export default EnergyStage;
