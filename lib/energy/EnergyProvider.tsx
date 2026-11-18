"use client";

/**
 * The seam between the plant and the picture.
 *
 * Everything under components/energy3d/ reads the scene's data through
 * `useEnergy()` and nothing else. No component in the visualisation imports
 * useBessLive, react-query, a socket or a fetch. That is the whole point of
 * this file: the day the numbers start arriving over MQTT instead of over the
 * UGX poller, the change is a new `source` value here, and not one line inside
 * the renderer moves.
 *
 * Adding a transport later means writing a hook that returns an EnergySource
 * — see sources/mock.ts for the smallest possible example — and giving it a
 * name in the switch below. The rule the switch enforces is that hooks are
 * called unconditionally: every source runs on every render and the chosen one
 * is selected from the results. Branching around a hook call would break the
 * rules of hooks the first time someone flipped the source at runtime, so the
 * cost of a spare mock simulation is paid deliberately to keep that safe.
 *
 * That rule has a price, and it is why the context now lives in context.tsx:
 * importing this file imports every transport named below, whether or not the
 * caller can use one. A build with a different data layer entirely — the
 * packaged mobile app, which reads the gateway proxy — mounts
 * EnergySourceProvider from context.tsx with its own source instead, and pays
 * for none of this. Both answer the same `useEnergy()`.
 */

import type { SiteAsset } from "./topology";
import { type ReactNode } from "react";
import { EnergySourceProvider, type EnergySourceKind } from "./context";
import type { EnergySource } from "./types";
import { useMockEnergy } from "./sources/mock";
import { useGatewayEnergy } from "./sources/gateway";

/**
 * The transports this module can name.
 *
 * Narrower than context.tsx's EnergySourceKind, which also admits "external".
 * A caller reaching this file has asked for a feed by name, and "external" is
 * the absence of that — it belongs to the provider that takes a source rather
 * than a name.
 */
export type NamedSourceKind = Extract<EnergySourceKind, "mock" | "gateway">;

export interface NamedSourceOptions {
  /** Station to read when the source is "gateway". Ignored by the mock. */
  stationId?: string;
  /** Nameplate energy, kWh — lets SOC be reported as stored kWh. */
  ratedCapacityKwh?: number | null;
  /** Days since commissioning, for the KPI strip. */
  runDays?: number | null;
  /** The site's assets; lets an unmetered solar be inferred on a site with no grid. */
  assets?: SiteAsset[];
}

/**
 * Resolve a transport by name.
 *
 * The switch, without the provider around it, for a caller that already has
 * somewhere to put the result — EnergyTwin hands it straight to EnergyStage,
 * which publishes it. Two providers for one source would have been two context
 * values describing the same plant.
 *
 * Both hooks always run. See the note at the top of the file: that is the rule
 * that keeps flipping `source` at runtime from breaking the rules of hooks, and
 * it is the reason this module is one a transport-free build should not import.
 */
export function useNamedEnergySource(
  source: NamedSourceKind = "mock",
  { stationId = "", ratedCapacityKwh = null, runDays = null, assets }: NamedSourceOptions = {},
): EnergySource {
  const mock = useMockEnergy();
  const live = useGatewayEnergy(stationId, { ratedCapacityKwh, runDays, assets });
  return source === "gateway" ? live : mock;
}

export interface EnergyProviderProps {
  children: ReactNode;
  /** Which feed to draw from. Defaults to the synthetic plant. */
  source?: NamedSourceKind;
  /** Station to read when `source` is "gateway". Ignored by the mock. */
  stationId?: string;
  /** Nameplate energy, kWh — lets SOC be reported as stored kWh. */
  ratedCapacityKwh?: number | null;
  /** Days since commissioning, for the KPI strip. */
  runDays?: number | null;
}

export function EnergyProvider({
  children,
  source = "mock",
  stationId = "",
  ratedCapacityKwh = null,
  runDays = null,
}: EnergyProviderProps) {
  const selected = useNamedEnergySource(source, { stationId, ratedCapacityKwh, runDays });

  return (
    <EnergySourceProvider source={selected} kind={source}>
      {children}
    </EnergySourceProvider>
  );
}

/* Re-exported so that every existing import of `useEnergy`, `useFlow` and the
   kind union keeps working against the file it has always come from. The
   definitions moved; the address did not. */
export {
  EnergySourceProvider,
  useEnergy,
  useFlow,
  EnergyContext,
  type EnergyContextValue,
  type EnergySourceKind,
  type EnergySourceProviderProps,
} from "./context";

export type { EnergyFlow, EnergySnapshot } from "./types";
