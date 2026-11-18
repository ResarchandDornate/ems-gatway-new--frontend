"use client";

/**
 * One Day / Week / Month / Year period shared by a page's charts.
 *
 * Inside a <SharedPeriodProvider>, every card that asks with useCardPeriod
 * follows the one period and hides its own control — the page shows a single
 * <SharedPeriodBar> at the top of its graphs. Outside a provider a card keeps
 * its own period, as before.
 */

import { createContext, useContext, type ReactNode } from "react";
import { PeriodNav, usePeriod, type PeriodState } from "./PeriodNav";
import { RANGES, type Range, type RangeOption } from "@/lib/charts/period";

const Ctx = createContext<PeriodState | null>(null);

export function SharedPeriodProvider({ initial = "day", ranges = RANGES, children }: { initial?: Range; ranges?: RangeOption[]; children: ReactNode }) {
  const state = usePeriod(initial, ranges);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

/** The page's shared period when there is one, else the card's own. */
export function useCardPeriod(initial: Range = "day"): { nav: PeriodState; shared: boolean } {
  const shared = useContext(Ctx);
  const own = usePeriod(initial);
  return { nav: shared ?? own, shared: shared != null };
}

/** The shared control: the period with its steps, and the range pill. */
export function SharedPeriodBar() {
  const state = useContext(Ctx);
  if (!state) return null;
  return (
    <div className="surface-card" style={{ padding: "8px var(--pad)" }}>
      <PeriodNav state={state} />
    </div>
  );
}
