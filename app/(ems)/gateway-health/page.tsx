"use client";

/**
 * Gateway Health.
 *
 * The one screen reading real data from the central backend. Everything else
 * in this app is still waiting on S1 — see docs/central-backend-s1-contract.md
 * — because GET /gateways/{id}/health is the only endpoint there that returns
 * anything a plant produced.
 *
 * The gateway is configured rather than chosen: that backend publishes no
 * endpoint listing gateways or sites yet, so there is nothing to build a
 * picker from. When GET /gateways lands, a picker belongs here and the rest of
 * the screen is unchanged.
 */

import { useGatewayHealth } from "@/hooks/useGatewayHealth";
import { useAppConfig } from "@/hooks/useAppConfig";
import { GatewayHealth } from "@/components/modules/gateway/GatewayHealth";

export default function GatewayHealthPage() {
  const { gatewayId, isLoading: configLoading } = useAppConfig();
  const { data, isLoading, error } = useGatewayHealth(gatewayId);

  return (
    <GatewayHealth
      gatewayId={gatewayId}
      records={data}
      loading={configLoading || isLoading}
      configPending={configLoading}
      error={error ?? null}
    />
  );
}
