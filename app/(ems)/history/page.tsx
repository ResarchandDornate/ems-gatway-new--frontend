/**
 * History — COMMENTED OUT.
 *
 * The page's contents are preserved verbatim below. Restoring it is a matter of
 * deleting this comment wrapper and the stub underneath; nothing else about the
 * route, the module it rendered, or the data behind it was touched, so it comes
 * back exactly as it was.
 *
 * The one thing that could not be commented out is the default export. Next
 * resolves a route by it, and a page file without one fails the build with "The
 * default export is not a React Component in page" rather than behaving as an
 * absent route — so the stub below stands in for it and renders nothing.
 *
 * The nav entry in components/TopBar.tsx is commented out alongside this, so
 * nothing links here any more. Restore the two together — putting the page back
 * without the tab leaves it reachable only by typing the URL.
 *
 * ── Original ────────────────────────────────────────────────────────────────
 *
 * "use client";
 *
 * import { useStation } from "@/lib/context/StationContext";
 * import { HistoricalData } from "@/components/modules/history/HistoricalData";
 *
 * export default function HistoryPage() {
 *   const { station } = useStation();
 *   return <HistoricalData stationId={station?.id ?? ""} />;
 * }
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

export default function HistoryPage() {
  return null;
}
