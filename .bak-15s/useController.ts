"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchController } from "@/lib/central";

/** S5 controller snapshots, newest first. The newest row is the live state. */
export const useController = (gatewayId: string, limit = 200) =>
  useQuery({
    queryKey: ["central", "controller", gatewayId, limit],
    queryFn: () => fetchController(gatewayId, { limit }),
    enabled: !!gatewayId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
