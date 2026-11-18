import { notFound } from "next/navigation";

// Switched off: removed from the navigation bar and the route answers 404.
// To bring it back, delete this stub and uncomment the original page below
// (and its entry in components/TopBar.tsx).
export default function ScadaPage() {
  notFound();
}

// "use client";
//
// import { useStation } from "@/lib/context/StationContext";
// import { ScadaMonitoring } from "@/components/modules/scada/ScadaMonitoring";
//
// export default function ScadaPage() {
//   const { station } = useStation();
//   return <ScadaMonitoring stationName={station?.powerStationEnglishName ?? ""} />;
// }
