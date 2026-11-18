/**
 * The site list, as the browser is allowed to see it.
 *
 * Outside /api/gw deliberately. Everything under that prefix is a gateway
 * passthrough, and this is not: the registry is a property of *this*
 * deployment, not of any gateway, and no gateway can answer it. Mounting it as
 * a static sibling of the catch-all would work — that is how history-series is
 * done — but it would also stake a claim on a path the gateway might publish
 * later, and unlike history-series there is no reason to be in that namespace
 * at all.
 *
 * Gated by the same app token as the proxy. The list carries no addresses and
 * no telemetry, but it does carry the names of a customer's sites, and there
 * is no reason to publish those to anyone who has not been given the app.
 */

import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, tokenOk } from "./proxy";
import { defaultSite, publicSites } from "./sites";

/* No `dynamic` here: Next reads route-segment config statically from the
   route file itself, so it is declared in app/api/sites/route.ts instead. */

export async function OPTIONS(req: NextRequest) {
  const cors = corsHeaders(req);
  if (!Object.keys(cors).length) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, {
    status: 204,
    headers: { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "600" },
  });
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req);

  if (!tokenOk(req)) {
    return NextResponse.json(
      {
        error: "app_token_required",
        detail:
          "This deployment only answers the packaged UnityESS app. The request " +
          "carried no valid app token, so it was refused. This is not a problem " +
          "with your account.",
      },
      { status: 403, headers: cors },
    );
  }

  return NextResponse.json(
    /* defaultSiteId is null when nothing is configured. The client treats a
       registry with no default as "this deployment has no gateway", which is
       what it is — there is no longer a bundled capture to name here. */
    { sites: publicSites(), defaultSiteId: defaultSite()?.id ?? null },
    /* No-store rather than cached. The registry only changes on a restart, but
       a shared cache in front of this would hold one deployment's site names
       against another's origin, and the response is a few hundred bytes. */
    { headers: { ...cors, "Cache-Control": "no-store" } },
  );
}
