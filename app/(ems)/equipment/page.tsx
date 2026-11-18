"use client";

import { usePageStation } from "@/lib/context/StationContext";
import { EmptyState } from "@/components/shared/EmptyState";
import { EquipmentMonitoring } from "@/components/modules/equipment/EquipmentMonitoring";

export default function EquipmentPage() {
  const { station, needsPick } = usePageStation();
  if (needsPick) return <EmptyState title="Pick A Station" description="Choose a station above." />;
  return <EquipmentMonitoring stationId={station?.id ?? ""} />;
}
