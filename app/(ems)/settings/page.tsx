"use client";

import { usePageStation } from "@/lib/context/StationContext";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { RevenueSettings } from "@/components/modules/settings/RevenueSettings";

export default function SettingsPage() {
  const { station, needsPick } = usePageStation();
  if (needsPick) return <EmptyState title="Pick A Station" description="Choose a station above." />;
  return (
    <div className="dash-page" style={{ display: "grid", gap: 12 }}>
      <PageHeader title="Settings" />
      {station && <RevenueSettings station={station} />}
    </div>
  );
}
