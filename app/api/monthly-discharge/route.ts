/**
 * Discharge per month as the collector recorded it (lib/revenue/monthly.ts):
 * each IST month's highest BMS month-to-date counter, and the first and last
 * PCS lifetime discharge reading, per cabinet.
 *
 *   GET → { months: MonthlyDoc, lifetime: LifetimeDoc }
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/server/central/auth";
import { readJson } from "@/lib/server/central/store";
import { LIFETIME_DOC, MONTHLY_DOC } from "@/lib/server/central/collector";
import { demoMonthlyDischarge, isDemoBearer } from "@/lib/server/central/demo";
import type { LifetimeDoc, MonthlyDoc } from "@/lib/revenue/monthly";

export const dynamic = "force-dynamic";

const gatewayId = () => process.env.CENTRAL_GATEWAY_ID?.trim() || process.env.NEXT_PUBLIC_CENTRAL_GATEWAY_ID?.trim() || "site";

export async function GET(req: NextRequest) {
  if (isDemoBearer(req.headers.get("authorization"))) return NextResponse.json(demoMonthlyDischarge(), { headers: { "cache-control": "no-store" } });
  const user = await verifyBearer(req.headers.get("authorization"));
  if (user === "unreachable") return NextResponse.json({ error: "central_unreachable" }, { status: 502 });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [months, lifetime] = await Promise.all([
    readJson<MonthlyDoc>(gatewayId(), MONTHLY_DOC, {}),
    readJson<LifetimeDoc>(gatewayId(), LIFETIME_DOC, {}),
  ]);
  return NextResponse.json({ months, lifetime }, { headers: { "cache-control": "no-store" } });
}
