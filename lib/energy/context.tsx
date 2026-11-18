"use client";

/**
 * The context the scene reads, and nothing about where the numbers come from.
 *
 * Split out of EnergyProvider.tsx so that mounting the visualisation does not
 * oblige you to import every transport that exists. EnergyProvider calls its
 * source hooks unconditionally — deliberately, so that flipping `source` at
 * runtime cannot break the rules of hooks — which means importing it also
 * imports the UGX poller and the mock simulation, and in a build that has
 * neither (the packaged mobile app, whose numbers arrive from the gateway
 * proxy) that is a whole data layer bundled to be never called.
 *
 * So the seam is in two pieces:
 *
 *   · this file — the context, the reader, and a provider that takes an
 *     already-resolved EnergySource. No transport is named here, so anything
 *     that can produce an EnergySnapshot can mount the scene.
 *   · EnergyProvider.tsx — the named-transport switch, built on this one.
 *
 * Both still answer `useEnergy()`, which is the only thing components/energy3d
 * knows about. The renderer is unchanged by this split and cannot tell which
 * provider is above it, which is the property the original seam was for.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { EnergyFlow, EnergySnapshot, EnergySource } from "./types";
import { EMPTY_SNAPSHOT } from "./types";
import { peakFlow } from "./flows";

/**
 * Which transport produced a snapshot.
 *
 * "external" is any source supplied by the caller rather than named here —
 * the mobile app's gateway reader is one. It is a single value rather than one
 * name per future feed because this string exists to be shown in a badge, and
 * a reader who needs to know *which* external feed is looking at the wrong
 * thing: the app around the scene already says which plant it is talking to.
 */
export type EnergySourceKind = "mock" | "gateway" | "external";

export interface EnergyContextValue extends EnergySource {
  /** Largest flow in the current set, kW. null when the plant is idle. */
  peak: number | null;
  /** Which transport produced this snapshot — surfaced in the UI as a badge. */
  kind: EnergySourceKind;
}

export const EnergyContext = createContext<EnergyContextValue | null>(null);

export interface EnergySourceProviderProps {
  children: ReactNode;
  /** An already-resolved source: whatever hook produced it has run above. */
  source: EnergySource;
  kind?: EnergySourceKind;
}

/**
 * Publish a source the caller has already resolved.
 *
 * The peak is computed here rather than by the caller so that every provider
 * derives it the same way — it drives flow-line thickness, and two providers
 * disagreeing about it would be two scenes that scale differently from the
 * same plant.
 */
export function EnergySourceProvider({
  children,
  source,
  kind = "external",
}: EnergySourceProviderProps) {
  const value = useMemo<EnergyContextValue>(
    () => ({
      snapshot: source.snapshot,
      flows: source.flows,
      peak: peakFlow(source.flows),
      kind,
    }),
    [source, kind],
  );

  return <EnergyContext.Provider value={value}>{children}</EnergyContext.Provider>;
}

/**
 * Read the current plant state.
 *
 * Outside a provider this returns the empty snapshot rather than throwing. A
 * missing provider should degrade to a scene with everything greyed out — the
 * same thing it shows when the plant is unreachable — not to a blank dashboard
 * behind an error boundary.
 */
export function useEnergy(): EnergyContextValue {
  const ctx = useContext(EnergyContext);
  if (ctx) return ctx;
  return { snapshot: EMPTY_SNAPSHOT, flows: [], peak: null, kind: "mock" };
}

/** Convenience reader for a single directed pair, e.g. solar → bess. */
export function useFlow(from: EnergyFlow["from"], to: EnergyFlow["to"]): EnergyFlow | null {
  const { flows } = useEnergy();
  return flows.find((f) => f.from === from && f.to === to) ?? null;
}

export type { EnergyFlow, EnergySnapshot, EnergySource };
