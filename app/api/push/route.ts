/**
 * Lock-screen alarm alerts: this device's Web Push subscription.
 *
 *   GET                       → { publicKey }  (null when push is not configured)
 *   POST   { subscription }   → { ok }         subscribe this device
 *   DELETE { endpoint }       → { ok }         unsubscribe it
 *
 * Writes need a signed-in user. See lib/server/push/push.ts for what is sent.
 */
import { NextRequest, NextResponse } from "next/server";
import type { PushSubscription } from "web-push";
import { verifyBearer } from "@/lib/server/central/auth";
import { addSub, pushPublicKey, removeSub } from "@/lib/server/push/push";

export const dynamic = "force-dynamic";

async function who(req: NextRequest) {
  const user = await verifyBearer(req.headers.get("authorization"));
  if (user === "unreachable") return { res: NextResponse.json({ error: "central_unreachable" }, { status: 502 }) };
  if (!user) return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { user };
}

export async function GET() {
  return NextResponse.json({ publicKey: pushPublicKey() }, { headers: { "cache-control": "no-store" } });
}

const isSub = (s: unknown): s is PushSubscription => {
  const x = s as PushSubscription | null;
  return !!x && typeof x.endpoint === "string" && /^https:\/\//.test(x.endpoint) && x.endpoint.length < 1000
    && typeof x.keys?.p256dh === "string" && typeof x.keys?.auth === "string";
};

export async function POST(req: NextRequest) {
  const { res, user } = await who(req);
  if (res) return res;
  if (!pushPublicKey()) return NextResponse.json({ error: "push_not_configured" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { subscription?: unknown } | null;
  if (!isSub(body?.subscription)) return NextResponse.json({ error: "bad_request" }, { status: 422 });
  const { endpoint, keys } = body.subscription;
  await addSub({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, user!.username);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { res } = await who(req);
  if (res) return res;
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return NextResponse.json({ error: "bad_request" }, { status: 422 });
  await removeSub(body.endpoint);
  return NextResponse.json({ ok: true });
}
