/* NORTHBOUND GATEWAY PROXY — DISABLED 24 September 2026.
 * Commented out in place alongside lib/gateway/ and lib/api/adapters/gateway.ts.
 * The route still answers so callers get a clear 503 rather than a 404 that
 * looks like a routing bug. See docs/central-backend-s1-contract.md. */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* A factory, not a shared constant: a NextResponse carries a single-use body
   stream, so handing the same instance to two requests fails on the second. */
const off = () =>
  NextResponse.json(
    { error: "northbound_gateway_disabled", detail: "See docs/central-backend-s1-contract.md" },
    { status: 503, headers: { "x-gw-mode": "disabled" } },
  );
export async function GET() { return off(); }
export async function OPTIONS() { return new NextResponse(null, { status: 204 }); }

/* ── ORIGINAL, COMMENTED OUT ──────────────────────────────────────────────── */

// /**
//  * Mount point for the aggregated history series.
//  *
//  * Deliberately a sibling of `app/api/gw/[...path]` rather than a path under it.
//  * A static segment wins over a catch-all in Next, so this handler answers
//  * /api/gw/history-series while every other /api/gw/* path still falls through
//  * to the gateway proxy — which means this route inherits the app-token gate,
//  * the CORS allowlist and the packaged builds' existing origin configuration
//  * without any of them being restated. `_series` would have been the obvious
//  * name and does not work: Next treats a leading underscore as a private folder
//  * and never routes it.
//  *
//  * The gateway publishes no endpoint called `history-series`, so nothing is
//  * shadowed. If it ever does, this file is what has to be renamed.
//  *
//  * All of the logic lives with the app it serves, in gateway/series.ts.
//  */
//
// import { NextRequest, NextResponse } from "next/server";
// import {
//   tokenOk, corsHeaders, GatewayReadError, withEdgeDeadline,
// } from "@/mobile_app_kunal_backend/gateway/proxy";
// import { buildSeries } from "@/mobile_app_kunal_backend/gateway/series";
// import { resolveSite, SITE_HEADER } from "@/mobile_app_kunal_backend/gateway/sites";
//
// export const dynamic = "force-dynamic";
//
// export async function OPTIONS(req: NextRequest) {
//   const cors = corsHeaders(req);
//   if (!Object.keys(cors).length) return new NextResponse(null, { status: 403 });
//   return new NextResponse(null, {
//     status: 204,
//     headers: {
//       ...cors,
//       "Access-Control-Allow-Methods": "GET, OPTIONS",
//       "Access-Control-Max-Age": "600",
//     },
//   });
// }
//
// export async function GET(req: NextRequest) {
//   const cors = corsHeaders(req);
//
//   if (!tokenOk(req)) {
//     return NextResponse.json(
//       {
//         error: "app_token_required",
//         detail:
//           "This deployment only answers the packaged UnityESS app. The request " +
//           "carried no valid app token, so it was refused before the gateway was " +
//           "contacted. This is not a problem with your account.",
//       },
//       { status: 403, headers: cors },
//     );
//   }
//
//   /* Same rule as the proxy: an unrecognised site is refused, never silently
//      answered from the default. This route aggregates and caches, so serving
//      the wrong gateway here would also poison the chunk cache under the wrong
//      key — a mistake that outlives the request that made it. */
//   const site = resolveSite(req);
//   if (!site) {
//     return NextResponse.json(
//       {
//         error: "unknown_site",
//         detail:
//           `This deployment has no site "${(req.headers.get(SITE_HEADER) ?? "").slice(0, 64)}". ` +
//           `It may have been removed since you last signed in.`,
//       },
//       { status: 400, headers: cors },
//     );
//   }
//
//   const q = req.nextUrl.searchParams;
//   const num = (k: string, fallback: number) => {
//     const v = Number(q.get(k));
//     return Number.isFinite(v) ? v : fallback;
//   };
//
//   try {
//     /* One budget for the whole aggregate, not one per page.
//
//        This is the route the deadline was made request-scoped for. buildSeries
//        walks the gateway a page at a time through gatewayRead, so a cap applied
//        per gateway call would let a single chart spend the full budget on every
//        page and still be cut off at the edge with nothing to show for it. Under
//        one shared deadline the walk stops while there is time left to say why.
//        See EDGE_BUDGET_MS in proxy.ts. */
//     const series = await withEdgeDeadline(() => buildSeries({
//       sourceId: q.get("source_id") ?? "",
//       bessId: q.get("bess_id") ?? "",
//       fromEpochMs: num("from_epoch_ms", 0),
//       toEpochMs: num("to_epoch_ms", 0),
//       points: num("points", 720),
//       auth: req.headers.get("authorization"),
//       nowMs: num("now_epoch_ms", Date.now()),
//       site,
//     }));
//
//     return NextResponse.json(series, {
//       /* Never cached at the edge. The aggregate is cheap to rebuild from the
//          chunk cache behind it, and the trailing bucket moves every few seconds
//          — a shared cache here would serve one caller's window to another and
//          hold the live edge still. */
//       headers: { ...cors, "Cache-Control": "no-store", "x-gw-mode": series.mode },
//     });
//   } catch (e) {
//     if (e instanceof GatewayReadError) {
//       return NextResponse.json(
//         { error: "gateway_read_failed", detail: e.message },
//         { status: e.status, headers: cors },
//       );
//     }
//     return NextResponse.json(
//       { error: "series_failed", detail: e instanceof Error ? e.message : String(e) },
//       { status: 502, headers: cors },
//     );
//   }
// }
