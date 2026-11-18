"use client";

/**
 * Which BESS the screens are looking at.
 *
 * The gateway serves one site with two EMS sources (external_ems_1 / _2), each
 * carrying one BESS. That is a smaller and flatter selection problem than the
 * UGX station picker, so it is its own tiny context rather than a reuse of
 * StationContext — which resolves plant configuration this app does not have.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useBessIds, type BessUnit } from "../data";

interface Selection {
  bessId: string;
  sourceId: string;
  /** False when bessId was derived from the source id rather than reported. */
  bessIdConfirmed: boolean;
  /** Whether the selected unit is being logged right now. */
  reporting: boolean;
  available: BessUnit[];
  /** Keyed by source id — the only identifier every unit always has. */
  select: (sourceId: string) => void;
}

const Ctx = createContext<Selection>({
  bessId: "bess_1",
  sourceId: "external_ems_1",
  bessIdConfirmed: false,
  reporting: false,
  available: [],
  select: () => {},
});

export function GatewayProvider({ children }: { children: ReactNode }) {
  const available = useBessIds();
  const [picked, setPicked] = useState<string | null>(null);

  /* Selection is keyed by source id rather than by bess id. Only a historian
     row carries a bess id, so a unit that is not being logged does not have
     one to be keyed by — and that is exactly the unit this now has to be able
     to select. The source id is on every unit, always. */
  const value = useMemo<Selection>(() => {
    const chosen =
      available.find((a) => a.sourceId === picked) ?? available[0] ?? null;
    return {
      bessId: chosen?.bessId ?? "bess_1",
      sourceId: chosen?.sourceId ?? "external_ems_1",
      bessIdConfirmed: chosen?.bessIdConfirmed ?? false,
      reporting: chosen?.reporting ?? false,
      available,
      select: setPicked,
    };
  }, [picked, available]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useGatewaySelection = () => useContext(Ctx);
