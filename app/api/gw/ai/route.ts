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
export async function POST() { return off(); }
export async function OPTIONS() { return new NextResponse(null, { status: 204 }); }

/* ── ORIGINAL, COMMENTED OUT ──────────────────────────────────────────────── */

// /**
//  * Mount point for the inference service.
//  *
//  * A sibling of app/api/gw/[...path] rather than a path under it, for the same
//  * reason history-series is: a static segment wins over a catch-all in Next, so
//  * this handler answers /api/gw/ai while every other /api/gw/* path still falls
//  * through to the gateway proxy — which means it inherits the app-token gate,
//  * the CORS allowlist and the packaged builds' origin configuration without any
//  * of them being restated.
//  *
//  * The gateway publishes no endpoint called `ai`, so nothing is shadowed.
//  *
//  * Unlike the proxy and unlike history-series, this route contacts no gateway
//  * at all. Both tasks are answered from the signal dictionary compiled into
//  * this build plus values supplied by the caller and validated here, so there
//  * is no site to resolve and no plant read to scope. The logic lives with the
//  * app it serves, in gateway/ai.ts, explain.ts and advise.ts.
//  */
//
// import { createHash } from "node:crypto";
// import { NextRequest, NextResponse } from "next/server";
// import { tokenOk, corsHeaders } from "@/mobile_app_kunal_backend/gateway/proxy";
// import { aiEnabled, rateLimit } from "@/mobile_app_kunal_backend/gateway/ai";
// import { explainAlarm, ExplainInputError } from "@/mobile_app_kunal_backend/gateway/explain";
// import { advise, AdviseInputError } from "@/mobile_app_kunal_backend/gateway/advise";
// import { interpret, interpretConfigured, interpretReady } from "@/mobile_app_kunal_backend/gateway/interpret";
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
//       "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
//       "Access-Control-Max-Age": "600",
//     },
//   });
// }
//
// /**
//  * Who is being rate-limited.
//  *
//  * The bearer identifies a session, and a digest of it is enough to count
//  * against without holding the credential itself in a process-lifetime map.
//  * Falling back to the app token means an unauthenticated caller that somehow
//  * passed the gate shares one bucket with every other such caller, which is the
//  * safe direction.
//  */
// function callerKey(req: NextRequest): string {
//   const bearer = req.headers.get("authorization") ?? "anonymous";
//   return createHash("sha256").update(bearer).digest("hex").slice(0, 32);
// }
//
// /**
//  * Whether this deployment offers AI at all.
//  *
//  * The client feature-detects on this rather than carrying a build-time flag,
//  * so a deployment without a key advertises nothing and the app draws no AI
//  * affordance — the Play bundle and the web build run the same code and differ
//  * only in what the server they talk to will admit to.
//  */
// export async function GET(req: NextRequest) {
//   const cors = corsHeaders(req);
//   if (!tokenOk(req)) {
//     return NextResponse.json({ error: "app_token_required" }, { status: 403, headers: cors });
//   }
//   /* Two independent capabilities. `available` is the hosted inference service
//      and costs money per call; `interpret` is a local model and does not, so a
//      deployment can have either, both, or neither. The History screen asks only
//      about the second. */
//   /* `interpret` reports REACHABLE, not merely configured — a client that shows
//      the fallback because a variable is set, over a host that is not listening,
//      spends a timeout per question to arrive at the refusal it would have shown
//      immediately. `interpretConfigured` is reported alongside it so the
//      difference is diagnosable from outside: true/false there means "set but
//      not answering", which is the state worth knowing about during a rollout. */
//   return NextResponse.json(
//     {
//       available: aiEnabled(),
//       interpret: await interpretReady(),
//       interpretConfigured: interpretConfigured(),
//     },
//     { headers: cors },
//   );
// }
//
// export async function POST(req: NextRequest) {
//   const cors = corsHeaders(req);
//
//   if (!tokenOk(req)) {
//     return NextResponse.json(
//       {
//         error: "app_token_required",
//         detail:
//           "This deployment only answers the packaged UnityESS app. The request " +
//           "carried no valid app token, so it was refused before anything was " +
//           "computed. This is not a problem with your account.",
//       },
//       { status: 403, headers: cors },
//     );
//   }
//
//   /* Signed in, or nothing. This endpoint spends money per call, so it is not
//      left open to anyone who obtained the app token by unpacking the bundle.
//      The bearer is not verified against the gateway here — /api/auth/me on this
//      board takes tens of seconds and would double the latency of every
//      explanation — so this is a presence check backed by the rate limiter
//      rather than proof of identity. Nothing plant-specific is returned, which
//      is what makes that trade acceptable. */
//   if (!req.headers.get("authorization")) {
//     return NextResponse.json(
//       { error: "sign_in_required", detail: "Sign in to use this feature." },
//       { status: 401, headers: cors },
//     );
//   }
//
//   let body: Record<string, unknown>;
//   try {
//     body = (await req.json()) as Record<string, unknown>;
//   } catch {
//     return NextResponse.json(
//       { error: "bad_request", detail: "A JSON body is required." },
//       { status: 400, headers: cors },
//     );
//   }
//
//   /* Answered ahead of the hosted-service gate below, which is about a
//      different provider entirely: interpretation runs on a local model and is
//      available whenever OLLAMA_URL is set, with or without an API key. */
//   if (body?.task === "interpret") {
//     if (!(await interpretReady())) {
//       return NextResponse.json(
//         {
//           error: "interpret_unavailable",
//           detail: interpretConfigured()
//             ? "The local model is configured but not answering on this deployment."
//             : "No local model is configured on this deployment.",
//         },
//         { status: 503, headers: cors },
//       );
//     }
//     const limit = rateLimit(`i:${callerKey(req)}`);
//     if (!limit.ok) {
//       return NextResponse.json(
//         { error: "rate_limited", detail: "Too many requests. Try again shortly." },
//         { status: 429, headers: { ...cors, "Retry-After": String(limit.retryAfterSec) } },
//       );
//     }
//     const rewritten = await interpret(body.question);
//     return NextResponse.json({ question: rewritten }, { headers: cors });
//   }
//
//   if (!aiEnabled()) {
//     return NextResponse.json(
//       {
//         error: "ai_unavailable",
//         detail:
//           "This deployment has no inference service configured, so explanations " +
//           "and advice are not available. Every reading on screen is unaffected.",
//       },
//       { status: 503, headers: cors },
//     );
//   }
//
//   const limit = rateLimit(callerKey(req));
//   if (!limit.ok) {
//     return NextResponse.json(
//       { error: "rate_limited", detail: "Too many requests. Try again shortly." },
//       {
//         status: 429,
//         headers: { ...cors, "Retry-After": String(limit.retryAfterSec) },
//       },
//     );
//   }
//
//   try {
//     if (body.task === "explain") {
//       const explanation = await explainAlarm({
//         signalName: body.signalName,
//         value: body.value,
//         assetLabel: body.assetLabel,
//         unitLabel: body.unitLabel,
//       });
//       return NextResponse.json(explanation, { headers: cors });
//     }
//
//     if (body.task === "advise") {
//       const advice = await advise(body.evidence, body.unitLabel);
//       return NextResponse.json(advice, { headers: cors });
//     }
//
//     return NextResponse.json(
//       { error: "bad_request", detail: "Unknown task." },
//       { status: 400, headers: cors },
//     );
//   } catch (e) {
//     /* An input we refused is the caller's to fix and says so. Anything else is
//        ours: the upstream message may name the model, the account or the key,
//        and none of that belongs in a customer's app. It is logged here and
//        replaced with something a person can act on. */
//     if (e instanceof ExplainInputError || e instanceof AdviseInputError) {
//       return NextResponse.json(
//         { error: "bad_request", detail: e.message },
//         { status: 400, headers: cors },
//       );
//     }
//     console.error("[ai] request failed:", e);
//     return NextResponse.json(
//       {
//         error: "ai_failed",
//         detail:
//           "The explanation could not be generated just now. The readings on " +
//           "screen are unaffected.",
//       },
//       { status: 502, headers: cors },
//     );
//   }
// }
