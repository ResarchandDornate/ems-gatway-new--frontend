/**
 * The collector's stored history (lib/server/central/collector.ts), to a
 * signed-in session.
 *
 *   GET /api/history/<stream>?from=<ms>&to=<ms>[&point_id=][&bess_id=][&asset_id=]
 *
 * stream: general | controller | solis | alarms | edge-ai | health | fast.
 * Rows come back as the backend's own records, newest first like the backend
 * answers, so a caller merges them with a live read without translating.
 *
 *   step=<ms>    keep the first row per step, per asset/point/cabinet — a month
 *                of one-minute S1 samples is 17 MB; at 10 min it is 1.7.
 *   shape=solar  controller/solis only: [{ sample_time_utc, kw }] — the
 *                inverter's power, online/GOOD reads only.
 *   shape=soc    controller only: just the per-cabinet SOC block socByBess reads.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/server/central/auth";
import { readRange } from "@/lib/server/central/store";
import { GATEWAY_MODE, gatewayHistoryRows } from "@/lib/server/central/gatewayCompat";
import { demoHistory, isDemoBearer } from "@/lib/server/central/demo";

export const dynamic = "force-dynamic";

const STREAMS = new Set(["general", "controller", "solis", "alarms", "edge-ai", "health", "fast"]);
const gatewayId = () => process.env.CENTRAL_GATEWAY_ID?.trim() || process.env.NEXT_PUBLIC_CENTRAL_GATEWAY_ID?.trim() || "";

export async function GET(req: NextRequest, ctx: { params: Promise<{ stream: string }> }) {
  const { stream } = await ctx.params;
  if (!STREAMS.has(stream)) return NextResponse.json({ error: "unknown_stream" }, { status: 404 });
  if (isDemoBearer(req.headers.get("authorization"))) {
    return NextResponse.json(demoHistory(stream, req.nextUrl.searchParams), { headers: { "cache-control": "private, no-store" } });
  }
  const user = await verifyBearer(req.headers.get("authorization"));
  if (user === "unreachable") return NextResponse.json({ error: "central_unreachable" }, { status: 502 });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const now = Date.now();
  const to = Number(q.get("to") ?? now);
  const from = Number(q.get("from") ?? now - 86_400_000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 93 * 86_400_000) {
    return NextResponse.json({ error: "bad_range" }, { status: 422 });
  }
  const want = (field: string) => q.get(field);
  const step = Math.max(0, Number(q.get("step") ?? 0)) || 0;
  const shape = q.get("shape");
  const base = (process.env.CENTRAL_BASE_URL ?? "").replace(/\/+$/, "");
  const stored = GATEWAY_MODE
    ? await gatewayHistoryRows(base, req.headers.get("authorization") ?? "", want("gateway_id") || gatewayId(), stream, from, to, step, want("bess_id"), req.signal, { pointId: want("point_id"), assetId: want("asset_id") })
    : await readRange(gatewayId(), stream, from, to, 2_000_000);
  type R = Record<string, unknown>;
  let rows: R[] = [];
  const bucket = new Set<string>();
  for (const x of stored) {
    const r = x.r as R;
    if (want("point_id") && r.point_id !== want("point_id")) continue;
    if (want("bess_id") && r.bess_id !== want("bess_id")) continue;
    if (want("asset_id") && r.asset_id !== want("asset_id")) continue;
    if (step) {
      const k = `${r.asset_id ?? ""}|${r.point_id ?? ""}|${r.bess_id ?? ""}|${Math.floor(x.ts / step)}`;
      if (bucket.has(k)) continue;
      bucket.add(k);
    }
    if (shape === "solar") {
      const d = (r.data ?? {}) as { solis?: R };
      const so = d.solis ?? {};
      const kw = (r.active_power_kw ?? so.active_power_kw) as unknown;
      const good = stream === "solis"
        ? String(r.communication_quality ?? so.communication_quality ?? "").toUpperCase() === "GOOD" && (r.online ?? so.online) !== false
        : so.online === true;
      if (!good || typeof kw !== "number" || !Number.isFinite(kw)) continue;
      rows.push({ sample_time_utc: r.sample_time_utc, kw });
    } else if (shape === "soc") {
      const d = (r.data ?? {}) as { bess?: R };
      if (!d.bess) continue;
      rows.push({ sample_time_utc: r.sample_time_utc, controller_state: r.controller_state ?? "stored", data: { bess: d.bess } });
    } else rows.push(r);
  }
  rows = rows.reverse();
  return NextResponse.json(rows, { headers: { "cache-control": "private, no-store" } });
}
