/**
 * Many one-sample S1 reads in one request.
 *
 *   POST /api/fast-slices  { gatewayId, bessId, windows: [[fromMs, toMs], …] }
 *   → [[sample] | [] | null, …]   one entry per window, in order: the window's
 *     newest sample, [] when it has none, null when the read failed.
 *
 * A week of the thinned history (pointsCentral fastSeries) is ~170 such reads
 * per cabinet. From the browser they queue behind its handful of connections
 * per host — ~30 s for two cabinets at ~0.4 s a read (21 Oct 2026). Here they
 * run FAN_OUT at a time against the backend, and the browser waits on one
 * response. The bearer is checked once (verifyBearer, cached) and forwarded
 * on each read, as the /api/central proxy does.
 */
import { NextRequest, NextResponse } from "next/server";
import { CENTRAL_BASE, verifyBearer } from "@/lib/server/central/auth";
import { GATEWAY_MODE, translate } from "@/lib/server/central/gatewayCompat";
import { demoFastSlices, isDemoBearer } from "@/lib/server/central/demo";

export const dynamic = "force-dynamic";

const MAX_WINDOWS = 400;
/** Reads in flight at once: the bound the browser path used (FAST_CONCURRENCY). */
const FAN_OUT = 12;

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const demo = isDemoBearer(auth);
  const user = demo || await verifyBearer(auth);
  if (user === "unreachable") return NextResponse.json({ error: "central_unreachable" }, { status: 502 });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { gatewayId?: unknown; bessId?: unknown; windows?: unknown } | null;
  const gatewayId = typeof body?.gatewayId === "string" ? body.gatewayId : "";
  const bessId = typeof body?.bessId === "string" ? body.bessId : "";
  const windows = Array.isArray(body?.windows) ? body.windows : null;
  const valid = windows?.every((w) => Array.isArray(w) && w.length === 2 && w.every(Number.isFinite) && w[0] < w[1]);
  if (!gatewayId || !bessId || !windows || !valid || windows.length > MAX_WINDOWS) {
    return NextResponse.json({ error: "bad_request" }, { status: 422 });
  }
  if (demo) return NextResponse.json(demoFastSlices(bessId, windows as [number, number][]), { headers: { "cache-control": "no-store" } });

  const read = async ([from, to]: [number, number]): Promise<unknown[] | null> => {
    const qs = new URLSearchParams({
      limit: "1", bess_id: bessId,
      from_time: new Date(from).toISOString(), to_time: new Date(to).toISOString(),
    });
    try {
      let url = `${CENTRAL_BASE}/api/v1/gateways/${encodeURIComponent(gatewayId)}/fast-bess?${qs}`;
      let map: ((b: unknown) => unknown) | undefined;
      if (GATEWAY_MODE) {
        const t = translate(["gateways", gatewayId, "fast-bess"], qs, "GET");
        if (t && !t.local) { url = `${CENTRAL_BASE}/api/v1/${t.path}?${t.query}`; map = t.mapBody; }
      }
      const r = await fetch(url, {
        headers: { authorization: auth!, accept: "application/json" }, cache: "no-store", signal: req.signal,
      });
      if (!r.ok) return null;
      const body: unknown = await r.json();
      const rows: unknown = map ? map(body) : body;
      return Array.isArray(rows) ? rows : null;
    } catch {
      return null;
    }
  };

  const out: (unknown[] | null)[] = new Array(windows.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(FAN_OUT, windows.length) }, async () => {
    while (next < windows.length && !req.signal.aborted) {
      const i = next++;
      out[i] = await read(windows[i] as [number, number]);
    }
  }));
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
