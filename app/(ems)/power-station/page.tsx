"use client";

import { usePageStation } from "@/lib/context/StationContext";
import { PowerStationMonitoring } from "@/components/modules/power-station/PowerStationMonitoring";
import { EmptyState } from "@/components/shared/EmptyState";
import { Suspense } from "react";

export default function PowerStationPage() {
  const { station, needsPick } = usePageStation();
  if (needsPick) {
    return <EmptyState title="Pick A Station" description="Choose a station above." />;
  }
  /* Suspense: PowerStationMonitoring reads ?view= / ?range= (useSearchParams). */
  return (
    <Suspense fallback={null}>
      <PowerStationMonitoring stationId={station?.id ?? ""} />
    </Suspense>
  );
}
