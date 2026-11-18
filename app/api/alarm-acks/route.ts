/**
 * Alarm acknowledgements, shared by everyone on this site.
 *
 * The central backend has no acknowledge endpoint, so this server keeps them
 * (lib/server/central/store.ts, one JSON document per gateway): who, and when.
 *
 *   GET  → { acks: { [key]: { at, by } } }
 *   POST { key, ack: boolean } → the same, after the change
 *
 * `key` is the alarm's cabinet, signal and raise time (lib/alarms/ack.ts ackKey), so a
 * flag raised again later is a new, unacknowledged alarm. Entries older than
 * 30 days are dropped on write.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/server/central/auth";
import { readJson, writeJson } from "@/lib/server/central/store";
import { isDemoBearer } from "@/lib/server/central/demo";

export const dynamic = "force-dynamic";

type Acks = Record<string, { at: number; by: string }>;
const gatewayId = () => process.env.CENTRAL_GATEWAY_ID?.trim() || process.env.NEXT_PUBLIC_CENTRAL_GATEWAY_ID?.trim() || "site";
const DOC = "alarm-acks";
const KEEP_MS = 30 * 86_400_000;

/* Writes one at a time, so two operators acknowledging together both land. */
let chain: Promise<unknown> = Promise.resolve();

async function who(req: NextRequest) {
  const user = await verifyBearer(req.headers.get("authorization"));
  if (user === "unreachable") return { res: NextResponse.json({ error: "central_unreachable" }, { status: 502 }) };
  if (!user) return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { user };
}

/* The demo's acknowledgements live in memory and never touch the site's store. */
const demoAcks: Acks = {};

export async function GET(req: NextRequest) {
  if (isDemoBearer(req.headers.get("authorization"))) return NextResponse.json({ acks: demoAcks }, { headers: { "cache-control": "no-store" } });
  const { res } = await who(req);
  if (res) return res;
  const acks = await readJson<Acks>(gatewayId(), DOC, {});
  return NextResponse.json({ acks }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const demo = isDemoBearer(req.headers.get("authorization"));
  const { res, user } = demo ? { res: null, user: null } : await who(req);
  if (res) return res;
  const body = (await req.json().catch(() => null)) as { key?: unknown; ack?: unknown } | null;
  if (!body || typeof body.key !== "string" || body.key.length > 400 || typeof body.ack !== "boolean") {
    return NextResponse.json({ error: "bad_request" }, { status: 422 });
  }
  if (demo) {
    if (Object.keys(demoAcks).length > 500) for (const k of Object.keys(demoAcks)) delete demoAcks[k];
    if (body.ack) demoAcks[body.key] = { at: Date.now(), by: "Demo Customer" };
    else delete demoAcks[body.key];
    return NextResponse.json({ acks: demoAcks }, { headers: { "cache-control": "no-store" } });
  }
  const key = body.key, ack = body.ack;
  const next = chain.then(async () => {
    const acks = await readJson<Acks>(gatewayId(), DOC, {});
    if (ack) acks[key] = { at: Date.now(), by: user!.username };
    else delete acks[key];
    for (const [k, v] of Object.entries(acks)) if (Date.now() - v.at > KEEP_MS) delete acks[k];
    await writeJson(gatewayId(), DOC, acks);
    return acks;
  });
  chain = next.catch(() => undefined);
  const acks = await next;
  return NextResponse.json({ acks }, { headers: { "cache-control": "no-store" } });
}
