/* NORTHBOUND GATEWAY PROXY — DISABLED 24 September 2026.
 * Commented out in place alongside lib/gateway/ and lib/api/adapters/gateway.ts.
 * The route still answers so callers get a clear 503 rather than a 404 that
 * looks like a routing bug. See docs/central-backend-s1-contract.md.
 *
 * THIS ROUTE IS /k's DATA PATH, not the website's. The website no longer makes
 * an HTTP call here at all — lib/gateway/index.ts is stubbed at module level —
 * so disabling this changed nothing for it, and restoring it would change
 * nothing back. What it did break is /k, the customer build, whose client
 * fetches `${apiBase()}/api/gw/<path>` (mobile_app_kunal_backend/gateway/
 * client.ts). /m is unaffected: it is served from mobile-app/, which makes no
 * network calls at all.
 *
 * Parked deliberately on 24 Sep 2026 — /k and /m are not being worked on. TO
 * BRING /k BACK, three things, not one:
 *   1. restore all THREE routes. Next gives a specific segment precedence over
 *      this catch-all, so history-series (charts) and ai (advisor) are separate
 *      files and stay disabled if only this one is reverted.
 *   2. decide GW_BASE_URL. It currently points at ems-api.unityess.cloud, which
 *      has answered 503 "Public gateway API temporarily disabled" since 18 Sep,
 *      so restoring alone swaps our 503 for the gateway's. UNSET it and the
 *      proxy serves the bundled capture instead (x-gw-mode: capture).
 *   3. expect gaps even then: the capture covers only the fast-BESS historian,
 *      so /api/telemetry, the per-source assets routes and /api/logs stay 503
 *      and the snapshot-driven panels stay empty. */

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
export async function POST() { return off(); }
export async function OPTIONS() { return new NextResponse(null, { status: 204 }); }

/* ── ORIGINAL, COMMENTED OUT ──────────────────────────────────────────────── */

// /**
//  * Mount point only. A Next route handler has to live under app/, so this file
//  * exists — but the implementation belongs with the app it serves and lives in
//  * mobile_app_kunal_backend/gateway/proxy.ts.
//  *
//  * `dynamic` is declared here rather than re-exported because Next parses route
//  * segment config statically, at compile time, and cannot follow it through a
//  * re-export.
//  */
// export const dynamic = "force-dynamic";
// /* OPTIONS as well as GET and POST: the packaged mobile builds call this
//    cross-origin from https://localhost, so the browser sends a preflight
//    first and a route without an OPTIONS handler answers it with 405. */
// export { GET, POST, OPTIONS } from "@/mobile_app_kunal_backend/gateway/proxy";
