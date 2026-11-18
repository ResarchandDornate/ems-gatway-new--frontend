/**
 * Read-only server-side proxy to the EMS-gateway-backend2 backend, used ONLY by the
 * Admin → User Monitor panel. It is deliberately separate from the existing
 * /api/central proxy (which points at the current backend) — nothing here changes
 * that path or any existing page.
 *
 * Path mapping: /api/admin-gw/<rest> → <ADMIN_CENTRAL_BASE_URL>/api/v1/<rest>
 * e.g. /api/admin-gw/org/operators → https://ems-gateway-api.unityess.cloud/api/v1/org/operators
 *
 * The browser talks same-origin; the bearer token is forwarded, cookies are not.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = (process.env.ADMIN_CENTRAL_BASE_URL ?? "https://ems-gateway-api.unityess.cloud")
  .replace(/\/+$/, "");

function outbound(req: NextRequest): HeadersInit {
  const h: Record<string, string> = { accept: "application/json" };
  const auth = req.headers.get("authorization");
  if (auth) h.authorization = auth;
  const ct = req.headers.get("content-type");
  if (ct) h["content-type"] = ct;
  return h;
}

function upstream(path: string[]): string {
  if (path.length === 1 && path[0] === "health") return `${BASE}/health`;
  return `${BASE}/api/v1/${path.map(encodeURIComponent).join("/")}`;
}

async function forward(req: NextRequest, path: string[], body?: BodyInit) {
  const url = `${upstream(path)}${req.nextUrl.search}`;
  let r: Response;
  try {
    r = await fetch(url, { method: req.method, headers: outbound(req), body, cache: "no-store" });
  } catch (e) {
    return NextResponse.json(
      { error: "admin_backend_unreachable", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
  const text = await r.text();
  return new NextResponse(text, {
    status: r.status,
    headers: {
      "content-type": r.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path, await req.text());
}
