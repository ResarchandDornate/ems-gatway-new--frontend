/**
 * Serves a file from /drawings to a signed-in session.
 *
 * The drawings are client documents, so they are not under /public. The
 * bearer is checked against the central backend's /auth/me — the same token
 * the rest of the app reads with — and only file names in lib/drawings are
 * served, so no path can reach outside the folder.
 */
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { drawingFiles } from "@/lib/drawings";
import { isDemoBearer } from "@/lib/server/central/demo";

export const dynamic = "force-dynamic";

const BASE = (process.env.CENTRAL_BASE_URL ?? "https://bess-ems-api.unityess.cloud").replace(/\/+$/, "");
const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf",
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!drawingFiles.has(file)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const auth = req.headers.get("authorization");
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  /* A client's documents are not the demo's to show. */
  if (isDemoBearer(auth)) return NextResponse.json({ error: "not_in_demo" }, { status: 403 });
  const me = await fetch(`${BASE}/api/v1/auth/me`, {
    headers: { authorization: auth, accept: "application/json" }, cache: "no-store",
  }).catch(() => null);
  if (!me) return NextResponse.json({ error: "central_unreachable" }, { status: 502 });
  if (!me.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await readFile(path.join(process.cwd(), "drawings", file)).catch(() => null);
  if (!body) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "private, no-store",
    },
  });
}
