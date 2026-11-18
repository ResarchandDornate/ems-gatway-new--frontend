/**
 * Send this device a lock-screen alert now.
 *
 *   POST { endpoint, gatewayId } → { sent, ringing }
 *
 * Reads the alarms with the caller's own token — the same pass the watcher
 * makes every minute, so it also works where the watcher's account is not
 * configured — and sends the result to the calling device only: the alert the
 * watcher would send, or a plain test message when nothing is ringing.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/server/central/auth";
import { alarmMessage, pushPublicKey, ringingAlarms, sendPush } from "@/lib/server/push/push";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const user = await verifyBearer(auth);
  if (user === "unreachable") return NextResponse.json({ error: "central_unreachable" }, { status: 502 });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!pushPublicKey()) return NextResponse.json({ error: "push_not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { endpoint?: unknown; gatewayId?: unknown } | null;
  if (typeof body?.endpoint !== "string" || typeof body.gatewayId !== "string") {
    return NextResponse.json({ error: "bad_request" }, { status: 422 });
  }
  const token = auth!.replace(/^Bearer\s+/i, "");
  const ringing = await ringingAlarms(body.gatewayId, token).catch(() => []);
  const msg = ringing.length
    ? alarmMessage(ringing, 0)
    : { title: "UnityESS · test alert", body: "Lock-screen alerts are on for this device. No alarm is active right now.", tag: "ems-test", url: "/alarms", urgent: false };
  const { sent } = await sendPush(msg, body.endpoint);
  return NextResponse.json({ sent, ringing: ringing.length });
}
