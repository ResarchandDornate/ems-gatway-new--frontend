"use client";

import { usePageStation } from "@/lib/context/StationContext";
import { EmptyState } from "@/components/shared/EmptyState";
import { CurveReport } from "@/components/modules/curve-report/CurveReport";

export default function CurveReportPage() {
  const { station, needsPick } = usePageStation();
  if (needsPick) return <EmptyState title="Pick A Station" description="Choose a station above." />;
  return <CurveReport stationId={station?.id ?? ""} />;
}
