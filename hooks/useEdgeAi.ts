"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchEdgeAi, EDGE_AI_MAX_LIMIT } from "@/lib/central";

/** S7 anomaly-model cycles and anomalies, newest first. A cycle is ~30 s. */
export const useEdgeAi = (gatewayId: string) =>
  useQuery({
    queryKey: ["central", "edgeAi", gatewayId],
    queryFn: () => fetchEdgeAi(gatewayId, { limit: EDGE_AI_MAX_LIMIT }),
    enabled: !!gatewayId,
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

/**
 * Only the rows the model flagged (v2 `only_anomalies=true`). With one row per
 * BESS per cycle, the newest 1,000 rows cover only ~500 cycles; asking for the
 * anomalies alone reaches much further back for the log.
 */
export const useEdgeAiAnomalies = (gatewayId: string) =>
  useQuery({
    queryKey: ["central", "edgeAiAnomalies", gatewayId],
    queryFn: () => fetchEdgeAi(gatewayId, { limit: EDGE_AI_MAX_LIMIT, onlyAnomalies: true }),
    enabled: !!gatewayId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
