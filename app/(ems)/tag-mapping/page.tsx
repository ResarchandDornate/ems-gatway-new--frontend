import { notFound } from "next/navigation";

// Switched off: removed from the navigation bar and the route answers 404.
// To bring it back, delete this stub and uncomment the original page below
// (and its entry in components/TopBar.tsx).
export default function TagMappingPage() {
  notFound();
}

// "use client";
//
// import { useStation } from "@/lib/context/StationContext";
// import { TagMappingInspector } from "@/components/modules/tag-mapping/TagMappingInspector";
//
// export default function TagMappingPage() {
//   const { station } = useStation();
//   return <TagMappingInspector stationId={station?.id} />;
// }
