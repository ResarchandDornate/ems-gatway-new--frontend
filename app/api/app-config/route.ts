/**
 * Runtime configuration the browser needs.
 *
 * WHY THIS EXISTS RATHER THAN A NEXT_PUBLIC_ VARIABLE. Next inlines
 * NEXT_PUBLIC_* at COMPILE time, so the value is baked into the JS bundle:
 * changing the gateway means rebuilding in production and restarting in dev,
 * and a dev server started before the variable existed serves a bundle that
 * silently has no gateway at all — which reads on screen as "no gateway
 * configured" while .env.local plainly contains one. That is a confusing
 * failure for something that is meant to be configuration.
 *
 * Read here, per request, on the server. Changing it is a restart, never a
 * rebuild, and never a redeploy.
 *
 * `CENTRAL_GATEWAY_ID` is the real name; NEXT_PUBLIC_CENTRAL_GATEWAY_ID is
 * still honoured so an existing .env keeps working.
 */
import { NextRequest, NextResponse } from "next/server";
import { DEMO_GATEWAY_ID, isDemoBearer } from "@/lib/server/central/demo";
import { GATEWAY_MODE } from "@/lib/server/central/gatewayCompat";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  /* The demo sign-in gets a gateway of its own; see DEMO_GATEWAY_ID. */
  if (isDemoBearer(req.headers.get("authorization"))) {
    return NextResponse.json({ gatewayId: DEMO_GATEWAY_ID }, { headers: { "cache-control": "no-store" } });
  }
  const gatewayId =
    process.env.CENTRAL_GATEWAY_ID?.trim() ||
    process.env.NEXT_PUBLIC_CENTRAL_GATEWAY_ID?.trim() ||
    "";

  return NextResponse.json(
    { gatewayId, gatewayMode: GATEWAY_MODE },
    { headers: { "cache-control": "no-store" } },
  );
}
