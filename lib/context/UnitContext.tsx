"use client";

/**
 * Which ESS unit the screens describe — Total, or one BESS.
 *
 * ── The hierarchy this reflects ────────────────────────────────────────────
 *
 * Verified against the live backend on 25 Sep 2026:
 *
 *   gateway bd57016e-…
 *   ├── external_ems_1 → bess_1 + 9 assets
 *   └── external_ems_2 → bess_2 + 9 assets
 *
 * One gateway, two EMS controllers, one BESS behind each, nine assets apiece.
 * The backend has NO station or site entity — there is no /sites endpoint and
 * nothing that carries a name, an address or a capacity. What the website calls
 * a "station" is a `source_id`, which is why this selector and the station
 * picker have been listing the same two things.
 *
 * ── Why Total is first ─────────────────────────────────────────────────────
 *
 * Physically this is one site with two cabinets, so the aggregate is the view
 * an operator wants by default and a single cabinet is the drill-down. `total`
 * is a real option with a null bessId rather than an absent selection, so a
 * consumer switches on the id instead of testing for undefined.
 *
 * ── What this used to be ───────────────────────────────────────────────────
 *
 * Four invented units — ESS 01 to ESS 04 with literal SOC, SOH, voltage and
 * cycle counts, one deliberately "offline" so the card's states could be
 * exercised. That was replaced by gateway-derived units carrying live
 * readings, and those readings were then never read by anything: the only
 * consumer is the selector, which uses id and label. They cost a telemetry
 * query per selection against a backend that is now disabled, so they are
 * gone. A panel that wants a reading should ask S1 for it directly.
 */

import {
  createContext, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { useFastBess } from "@/hooks/useFastBess";
import { useAppConfig } from "@/hooks/useAppConfig";

const LS_KEY = "EMS_UNIT_SEL";

/** The aggregate. A real member of the array, not the absence of a choice. */
export const TOTAL_UNIT_ID = "total";

export interface EssUnit {
  /** "total", or the backend's bess_id verbatim. */
  id: string;
  /** For the selector. */
  label: string;
  /** null on Total — the id a request should filter by, when it filters. */
  bessId: string | null;
  /** null on Total — which EMS controller reports this unit. */
  sourceId: string | null;
}

export const TOTAL_UNIT: EssUnit = {
  id: TOTAL_UNIT_ID,
  label: "Total",
  bessId: null,
  sourceId: null,
};

interface UnitCtx {
  /** Always at least [Total]; the selector renders nothing for a lone Total. */
  units: EssUnit[];
  unitId: string;
  setUnitId: (id: string) => void;
  /** The selected unit. Falls back to Total rather than going null. */
  unit: EssUnit;
  /** True while the unit list is still being discovered. */
  loading: boolean;
}

const UnitContext = createContext<UnitCtx>({
  units: [TOTAL_UNIT],
  unitId: TOTAL_UNIT_ID,
  setUnitId: () => {},
  unit: TOTAL_UNIT,
  loading: false,
});

/** `bess_1` → `BESS 1`; anything else is shown as the backend spells it. */
function labelFor(bessId: string): string {
  const m = /^bess[_-]?(\d+)$/i.exec(bessId);
  return m ? `BESS ${m[1]}` : bessId;
}

export function UnitProvider({ children }: { children: ReactNode }) {
  const { gatewayId } = useAppConfig();

  /* Ten unfiltered rows, polled slowly — the same probe the Live BESS page
     makes, with the same key, so React Query serves both from one request.
     Units appear when a cabinet is commissioned, not second to second. */
  const probe = useFastBess(gatewayId, undefined, 10, 60_000);

  const units = useMemo<EssUnit[]>(() => {
    const seen = new Map<string, string | null>();
    for (const r of probe.data ?? []) {
      if (r.bess_id && !seen.has(r.bess_id)) seen.set(r.bess_id, r.source_id ?? null);
    }
    const found = [...seen.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map<EssUnit>(([bessId, sourceId]) => ({
        id: bessId, label: labelFor(bessId), bessId, sourceId,
      }));
    return [TOTAL_UNIT, ...found];
  }, [probe.data]);

  const [chosen, setChosen] = useState<string>(TOTAL_UNIT_ID);

  /* Restored after mount rather than in the initial state: reading
     localStorage during render makes the server and client disagree on the
     first paint. */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LS_KEY);
      if (saved) setChosen(saved);
    } catch { /* blocked storage — Total is a fine default */ }
  }, []);

  function setUnitId(id: string) {
    setChosen(id);
    try { window.localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
  }

  /* A saved id survives a cabinet being renamed or decommissioned by falling
     back to Total, rather than leaving the selector pointing at nothing. */
  const unit = units.find((u) => u.id === chosen) ?? TOTAL_UNIT;

  const value = useMemo<UnitCtx>(
    () => ({ units, unitId: unit.id, setUnitId, unit, loading: probe.isLoading }),
    [units, unit, probe.isLoading],
  );

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
}

export function useUnit() {
  return useContext(UnitContext);
}
