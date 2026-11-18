"use client";

/**
 * Asset Telemetry — S2 general asset signals.
 *
 * Two queries, because the endpoint answers two different questions. A
 * substream query says what an asset reads right now: unfiltered it spans
 * about seven seconds, so it is a snapshot however many rows are asked for. A
 * point_id query is the only one with a usable time axis, and it is made only
 * when a signal is opened — charting all 465 points would be 465 requests.
 */

import { useState } from "react";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useGeneralSubstream, useGeneralPoint } from "@/hooks/useGeneral";
import { AssetTelemetry } from "@/components/modules/gateway/AssetTelemetry";
import type { GeneralRecord } from "@/lib/central";

export default function AssetTelemetryPage() {
  const { gatewayId, isLoading: configLoading } = useAppConfig();
  /* ems_system first: it is the only substream that describes the site as a
     whole rather than one box inside it. */
  const [substream, setSubstream] = useState("ems_system");
  const [point, setPoint] = useState<GeneralRecord | null>(null);

  const list = useGeneralSubstream(gatewayId, substream);
  const history = useGeneralPoint(gatewayId, point?.point_id ?? null);

  return (
    <AssetTelemetry
      gatewayId={gatewayId}
      rows={list.data}
      loading={configLoading || list.isLoading}
      configPending={configLoading}
      error={list.error ?? null}
      substream={substream}
      onSubstream={setSubstream}
      point={point}
      onPoint={setPoint}
      pointRows={history.data}
      pointLoading={history.isLoading}
    />
  );
}
