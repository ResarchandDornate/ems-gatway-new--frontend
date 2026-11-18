"use client";

import { usePageStation } from "@/lib/context/StationContext";
import { EmptyState } from "@/components/shared/EmptyState";
import { Financials } from "@/components/modules/financials/Financials";

export default function FinancialsPage() {
  const { station, needsPick } = usePageStation();
  if (needsPick) return <EmptyState title="Pick A Station" description="Choose a station above." />;
  return station ? <Financials station={station} /> : null;
}
