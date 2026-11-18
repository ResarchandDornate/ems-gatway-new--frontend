"use client";

import { usePageStation } from "@/lib/context/StationContext";
import { EmptyState } from "@/components/shared/EmptyState";
import { StrategyManagement } from "@/components/modules/strategy/StrategyManagement";

export default function StrategyPage() {
  const { station, needsPick } = usePageStation();
  if (needsPick) return <EmptyState title="Pick A Station" description="Choose a station above." />;
  return <StrategyManagement stationId={station?.id ?? ""} />;
}
