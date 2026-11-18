"use client";

/**
 * Live BESS — S1 fast-BESS telemetry from the central backend.
 *
 * In the main nav rather than the account menu, unlike Gateway Health: this is
 * a plant measurement, not a statement about the link.
 *
 * ── Ranges ────────────────────────────────────────────────────────────────
 *
 * Up to 15 min is a sample COUNT (limit ≤ 1,000, filtered to one unit so the
 * whole budget goes to the cabinet on screen: 1,000 rows ≈ 16.9 min). The
 * gateway logs 1 Hz per unit, so a count is a duration.
 *
 * 1 h is a DATE RANGE. S1 has taken from_time/to_time since 1 Oct 2026, but a
 * response still stops at 1,000 rows, so the hour is paged (~4 pages). This
 * page used to say an hour could not be asked for at all; that was true of the
 * endpoint before the range landed.
 */

import { useState } from "react";
import { useFastBess, useFastBessWindow } from "@/hooks/useFastBess";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useUnit } from "@/lib/context/UnitContext";
import { FastBess, RANGES, type RangeKey } from "@/components/modules/gateway/FastBess";

export default function LiveBessPage() {
  const { gatewayId, isLoading: configLoading } = useAppConfig();
  const [range, setRange] = useState<RangeKey>("5m");
  /* The unit picker drives the cabinet shown: BESS 1 / BESS 2 open that one,
     and picking a tab here moves the picker to match. On Total — this view is
     one cabinet's 1 Hz stream — it opens on the first cabinet. */
  const { unit: picked, setUnitId } = useUnit();
  const [unit, setUnit] = useState<string | null>(null);

  /* A cheap unfiltered probe, only to learn which cabinets report. It cannot
     come from the data query below, which is filtered to one of them. Ten rows
     and a slow poll: the unit list changes when a cabinet is commissioned, not
     second to second. */
  const probe = useFastBess(gatewayId, undefined, 10, 60_000);
  const units = Array.from(
    new Set((probe.data ?? []).map((r) => r.bess_id).filter(Boolean)),
  ).sort();

  const pickedBess = picked.bessId && units.includes(picked.bessId) ? picked.bessId : null;
  const activeUnit = pickedBess ?? (unit && units.includes(unit) ? unit : units[0] ?? null);

  /* Filtered, so the whole budget goes to the cabinet on screen. A count
     for the short ranges, a paged date range for 1 h — only one runs. */
  const spec = RANGES[range];
  const byCount = useFastBess(
    spec.limit ? gatewayId : "",
    activeUnit ?? undefined,
    spec.limit ?? 1,
  );
  const byWindow = useFastBessWindow(gatewayId, activeUnit ?? undefined, spec.windowMs ?? 0, !!spec.windowMs);
  const { data, isLoading, error } = spec.windowMs
    ? { data: byWindow.data?.samples, isLoading: byWindow.isLoading, error: byWindow.error }
    : byCount;

  return (
    <FastBess
      gatewayId={gatewayId}
      samples={data}
      loading={configLoading || isLoading || probe.isLoading}
      configPending={configLoading}
      error={error ?? probe.error ?? null}
      units={units}
      activeUnit={activeUnit}
      onUnit={(b: string) => { setUnit(b); setUnitId(b); }}
      range={range}
      onRange={setRange}
    />
  );
}
