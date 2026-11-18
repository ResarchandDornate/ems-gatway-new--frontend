/**
 * The site's revenue master (lib/revenue/master.ts), shared by everyone on it.
 *
 * The central backend has nowhere to keep tariffs, so this server does
 * (lib/server/central/store.ts, one JSON document per gateway).
 *
 *   GET  → { master: RevenueMaster | null }
 *   POST RevenueMaster → { master }, stamped with who saved it and when
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/server/central/auth";
import { readJson, writeJson } from "@/lib/server/central/store";
import { isDemoBearer } from "@/lib/server/central/demo";
import { parseMaster, type RevenueMaster } from "@/lib/revenue/master";

export const dynamic = "force-dynamic";

const gatewayId = () => process.env.CENTRAL_GATEWAY_ID?.trim() || process.env.NEXT_PUBLIC_CENTRAL_GATEWAY_ID?.trim() || "site";
const DOC = "revenue-master";

async function who(req: NextRequest) {
  const user = await verifyBearer(req.headers.get("authorization"));
  if (user === "unreachable") return { res: NextResponse.json({ error: "central_unreachable" }, { status: 502 }) };
  if (!user) return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { user };
}

export async function GET(req: NextRequest) {
  /* The site's tariff is not the demo's to read; the screens fall back to their defaults. */
  if (isDemoBearer(req.headers.get("authorization"))) return NextResponse.json({ master: null }, { headers: { "cache-control": "no-store" } });
  const { res } = await who(req);
  if (res) return res;
  const master = await readJson<RevenueMaster | null>(gatewayId(), DOC, null);
  return NextResponse.json({ master }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const { res, user } = await who(req);
  if (res) return res;
  const parsed = parseMaster(await req.json().catch(() => null));
  if (!parsed) return NextResponse.json({ error: "bad_request" }, { status: 422 });
  const master: RevenueMaster = { ...parsed, updatedBy: user!.username, updatedAt: Date.now() };
  await writeJson(gatewayId(), DOC, master);
  return NextResponse.json({ master }, { headers: { "cache-control": "no-store" } });
}
