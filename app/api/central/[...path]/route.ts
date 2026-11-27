/**
 * Server-side proxy to the Ornate Central EMS Backend.
 *
 * Mirrors app/api/gw/ rather than inventing a second pattern: the browser talks
 * to same-origin `/api/central/*` and this handler forwards to the backend, so
 * there is no CORS negotiation to get wrong and no backend origin compiled into
 * client code. The reference asks which origins to allow for a dev host; going
 * through here means the answer only ever has to be "the server", never a list
 * of developer laptops.
 *
 * Path mapping is `/api/central/<rest>` → `<base>/api/v1/<rest>`, so callers
 * write `auth/login` and `gateways/<id>/health` without repeating the version.
 *
 * `dynamic` is spelled out here because Next reads route-segment config
 * statically off the route file's own source — the same reason app/api/gw and
 * app/api/sites both declare it in place.
 */
import { NextRequest, NextResponse } from "next/server";
import { GATEWAY_MODE, SITE_ID, translate, s2General, s2Point } from "@/lib/server/central/gatewayCompat";
import { demoCentral, isDemoBearer, isDemoCredentials, mintDemoToken } from "@/lib/server/central/demo";

export const dynamic = "force-dynamic";

const BASE = (process.env.CENTRAL_BASE_URL ?? "https://bess-ems-api.unityess.cloud")
  .replace(/\/+$/, "");

/* Guide §1 rule 3: every data read needs site_id. Added here so screens can
   call /api/central/commands, /alarms/summary, /telemetry/series etc. directly. */
const SITE_SCOPED = new Set([
  "bess", "telemetry", "health", "alarms", "controller",
  "solis", "edge-ai", "config-audit", "commands", "charge-discharge",
  "automation-status", "automation-events",
]);

/* Forwarded deliberately rather than by spreading the incoming headers. A blind
   copy would carry the browser's cookies to a third-party origin, and the
   backend authenticates on the bearer alone. */
function outbound(req: NextRequest): HeadersInit {
  const h: Record<string, string> = { accept: "application/json" };
  const auth = req.headers.get("authorization");
  if (auth) h.authorization = auth;
  const ct = req.headers.get("content-type");
  if (ct) h["content-type"] = ct;
  return h;
}

/**
 * `/health` is the one route that is NOT under /api/v1 — the spec mounts it at
 * the root, and the API notes call it the connectivity ping. Mapping it like
 * the rest would ask for /api/v1/health and get a 404 that looks like the
 * backend being down, which is the precise opposite of what the ping is for.
 */
function upstream(path: string[]): string {
  if (path.length === 1 && path[0] === "health") return `${BASE}/health`;
  return `${BASE}/api/v1/${path.map(encodeURIComponent).join("/")}`;
}

async function forward(req: NextRequest, path: string[], body?: BodyInit) {
  /* Guide §3D: the monitoring surface is a separate pipeline. Never forwarded. */
  if (path[0] === "monitor") {
    return NextResponse.json({ detail: "monitor/* is not served by the data frontend" }, { status: 404 });
  }
  let qs = req.nextUrl.search;
  const isPing = path.length === 1 && path[0] === "health";
  /* Read caching: only GETs, and only in the viewer's OWN browser (private) —
     never a shared CDN cache — so one tenant's data can never reach another. A
     5 s freshness window with 30 s stale-while-revalidate collapses re-mounts
     and quick navigations onto one fetch. Writes and errors stay no-store. */
  const getCache = req.method === "GET"
    ? "private, max-age=5, stale-while-revalidate=30"
    : "no-store";
  if (GATEWAY_MODE && req.method === "GET" && !isPing && SITE_SCOPED.has(path[0])
      && !req.nextUrl.searchParams.get("site_id") && SITE_ID()) {
    const sp = new URLSearchParams(req.nextUrl.searchParams);
    sp.set("site_id", SITE_ID());
    qs = `?${sp}`;
  }
  let url = `${upstream(path)}${qs}`;
  let mapBody: ((b: unknown) => unknown) | undefined;
  if (GATEWAY_MODE && path.length === 3 && path[2] === "general" && req.nextUrl.searchParams.get("substream") && !req.nextUrl.searchParams.get("point_id")) {
    const rows = await s2General(BASE, req.headers.get("authorization") ?? "", path[1], req.nextUrl.searchParams.get("substream")!);
    return NextResponse.json(rows, { headers: { "cache-control": getCache, "x-central-mode": "gateway-s2" } });
  }
  /* An old S2 point id, served from its mapped signal (gatewayCompat POINT_MAP). */
  const pid = req.nextUrl.searchParams.get("point_id");
  if (GATEWAY_MODE && path.length === 3 && path[2] === "general" && pid) {
    const rows = await s2Point(BASE, req.headers.get("authorization") ?? "", path[1], pid);
    return NextResponse.json(rows, { headers: { "cache-control": getCache, "x-central-mode": "gateway-s2-point" } });
  }
  if (GATEWAY_MODE) {
    const t = translate(path, req.nextUrl.searchParams, req.method);
    if (t?.local) return NextResponse.json(t.local[1], { status: t.local[0], headers: { "x-central-mode": "gateway-local" } });
    if (t) {
      url = `${upstream(t.path.split("/"))}${t.query ? `?${t.query}` : ""}`;
      mapBody = t.mapBody;
    }
  }

  let r: Response;
  try {
    r = await fetch(url, { method: req.method, headers: outbound(req), body, cache: "no-store" });
  } catch (e) {
    /* The backend was unreachable — a different condition from any status it
       could return, and the UI distinguishes them. */
    return NextResponse.json(
      { error: "central_unreachable", detail: e instanceof Error ? e.message : String(e) },
      { status: 502, headers: { "x-central-mode": "unreachable" } },
    );
  }

  /* Status and body are passed through untouched. The backend's own error
     shapes — {detail: string} and the 422 {detail: [...]} — are what callers
     are written against; re-wrapping them here would mean decoding two
     vocabularies on the client instead of one. */
  let text = await r.text();
  if (mapBody && r.ok) {
    try { text = JSON.stringify(mapBody(JSON.parse(text))); } catch { /* leave as is */ }
  }
  return new NextResponse(text, {
    status: r.status,
    headers: {
      "content-type": r.headers.get("content-type") ?? "application/json",
      "cache-control": r.ok ? getCache : "no-store",
      "x-central-mode": "live",
    },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

/* The demo account (lib/server/central/demo.ts) is answered here and never
   forwarded: its token means nothing to the backend, and a demo viewer must
   never be one hop from the real site. */
const demoReply = ([status, body]: [number, unknown]) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store", "x-central-mode": "demo" } });

export async function GET(req: NextRequest, ctx: Ctx) {
  const path = (await ctx.params).path;
  if (isDemoBearer(req.headers.get("authorization"))) return demoReply(demoCentral(path, req.nextUrl.searchParams));
  return forward(req, path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  const path = (await ctx.params).path;
  const body = await req.text();
  if (path.join("/") === "auth/login") {
    let creds: { email?: unknown; password?: unknown } = {};
    try { creds = JSON.parse(body); } catch { /* not JSON: the backend says why */ }
    if (isDemoCredentials(creds.email, creds.password)) {
      return demoReply([200, { access_token: mintDemoToken(), token_type: "bearer" }]);
    }
  }
  /* Writes from the demo go nowhere. */
  if (isDemoBearer(req.headers.get("authorization"))) return demoReply([403, { detail: "Not available in the demo" }]);
  if (GATEWAY_MODE && path.join("/") === "auth/login") {
    try {
      const c = JSON.parse(body) as { email?: string; password?: string };
      return forward(req, path, JSON.stringify({ identifier: c.email, password: c.password }));
    } catch { /* fall through */ }
  }
  return forward(req, path, body);
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
