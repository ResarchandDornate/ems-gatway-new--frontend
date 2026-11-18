"use client";

import { useStation } from "@/lib/context/StationContext";
import { GroupScreen } from "@/components/dashboard/GroupScreen";
import { PerStation } from "@/components/dashboard/PerStation";

export default function DashboardPage() {
  const { sel, station } = useStation();

  return sel.mode === "group" || !station
    ? <GroupScreen />
    : <PerStation station={station} />;
}
