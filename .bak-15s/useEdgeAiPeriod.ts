"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchEdgeAi, EDGE_AI_MAX_LIMIT, type EdgeAiRecord } from "@/lib/central/edgeAi";
import { fetchHistory } from "@/lib/central/history";
import type { Period, Range } from "@/lib/charts/period";

/** One stored row per cabinet per this much: enough for a line or a day's capsule, bounded in size. */
const STEP_MS: Record<Range, number> = {
  hour: 60_000,
  day: 60_000,
  week: 5 * 60_000,
  days28: 15 * 60_000,
  month: 15 * 60_000,
  year: 2 * 3_600_000,
};
/** app/api/history refuses a read over 93 days, so a year is read in slices. */
const SLICE_MS = 90 * 86_400_000;
/** At most this many cabinets are read one by one (two reads each). */
const MAX_CABINETS = 8;

/** End of a period's read: the period, ended at now in 5-minute steps (a ticking end refetched constantly). */
export const edgeAiPeriodEnd = (period: Period) => Math.min(period.to, Math.ceil(Date.now() / 300_000) * 300_000);

/**
 * The live rows that reach furthest back. /edge-ai takes only `limit` (max
 * 1,000), `bess_id`, `source_id` and `only_anomalies` — it ignores from/to and
 * has no offset — so the way past the newest 1,000 rows is one read per
 * cabinet (1,000 cycles each instead of ~500 shared) plus each cabinet's
 * flagged rows. Not tied to a period: every period filters the same rows.
 */
export function useEdgeAiDeep(gatewayId: string, bessIds: string[]) {
  const ids = bessIds.slice(0, MAX_CABINETS);
  return useQuery({
    queryKey: ["central", "edgeAiDeep", gatewayId, ids.join(",")],
    queryFn: async () => {
      const reads = await Promise.all(ids.flatMap((bessId) => [
        fetchEdgeAi(gatewayId, { limit: EDGE_AI_MAX_LIMIT, bessId }).then((rows) => ({ rows, flagged: false })),
        fetchEdgeAi(gatewayId, { limit: EDGE_AI_MAX_LIMIT, bessId, onlyAnomalies: true }).then((rows) => ({ rows, flagged: true })),
      ].map((p) => p.catch(() => ({ rows: [] as EdgeAiRecord[], flagged: false, failed: true })))));
      return {
        rows: reads.flatMap((r) => r.rows),
        flagged: reads.filter((r) => r.flagged).flatMap((r) => r.rows),
        /* Every cabinet's flagged read came back under the cap (none failed). */
        flaggedComplete: reads.length > 0 && reads.every((r) => !("failed" in r)) &&
          reads.filter((r) => r.flagged).every((r) => r.rows.length < EDGE_AI_MAX_LIMIT),
      };
    },
    enabled: !!gatewayId && ids.length > 0,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

/**
 * S7 rows across a period from the collector's stored edge-AI history, thinned
 * per cabinet. Newest first, unmerged — the caller merges them with the live
 * rows (useEdgeAi, useEdgeAiAnomalies, useEdgeAiDeep), filters to the period
 * and de-duplicates.
 */
export function useEdgeAiPeriod(gatewayId: string, period: Period) {
  const end = edgeAiPeriodEnd(period);
  return useQuery({
    queryKey: ["central", "edgeAiPeriod", gatewayId, period.range, period.from, end],
    queryFn: async (): Promise<EdgeAiRecord[]> => {
      const slices: [number, number][] = [];
      for (let a = period.from; a < end; a += SLICE_MS) slices.push([a, Math.min(end, a + SLICE_MS)]);
      const stored = await Promise.all(slices.map(([a, b]) =>
        fetchHistory<EdgeAiRecord>("edge-ai", { fromMs: a, toMs: b, stepMs: STEP_MS[period.range] }).catch(() => [] as EdgeAiRecord[])));
      return stored.flat();
    },
    enabled: !!gatewayId,
    staleTime: 60_000,
  });
}
