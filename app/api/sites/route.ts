/**
 * Mount point for the site registry. The logic lives with the app it serves,
 * in mobile_app_kunal_backend/gateway/sitesRoute.ts.
 *
 * `dynamic` is declared here rather than re-exported with the handlers. Next
 * reads route-segment config statically, off the route file's own source, so a
 * re-exported binding is invisible to it — the value cannot be traced back to
 * a literal and the build fails outright. The handlers re-export fine; only
 * the config has to be spelled out in place.
 */
export { GET, OPTIONS } from "@/mobile_app_kunal_backend/gateway/sitesRoute";

export const dynamic = "force-dynamic";
