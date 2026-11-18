"use client";

/**
 * Demo mode.
 *
 * On only under /m/demo. The live routes at /m never see this provider, so
 * they cannot accidentally render fixtures — there is no runtime flag, no env
 * var and no toggle that could flip production into demo.
 *
 * Holds the station selection locally rather than reaching into
 * StationContext, because StationContext resolves its list from UGX and there
 * is no UGX here.
 */

import { createContext, useContext, useMemo, useState } from "react";
import { demoStations } from "./fixtures";

interface DemoCtx {
  on: boolean;
  stationId: string;
  select: (id: string) => void;
  /** Fixed at mount so every screen agrees on "now" for the session. */
  now: number;
}

const Ctx = createContext<DemoCtx>({ on: false, stationId: "", select: () => {}, now: 0 });

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [stationId, setStationId] = useState(demoStations[0].id);
  // Read once. Recomputing per render would make alarm timestamps creep.
  const [now] = useState(() => Date.now());

  const value = useMemo(
    () => ({ on: true, stationId, select: setStationId, now }),
    [stationId, now],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDemo = () => useContext(Ctx);
