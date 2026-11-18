/**
 * Reads the app server's own stored history (app/api/history), which the
 * collector fills from the central backend. Best effort by design: with the
 * collector off, or nothing stored yet for a range, this answers [] and the
 * caller carries on with the live read alone.
 */

import { getSession } from "./session";
import { centralUrl } from "./serverScope";
import { getActiveGateway } from "./activeGateway";

export type HistoryStream = "general" | "controller" | "solis" | "alarms" | "edge-ai" | "health" | "fast";

export async function fetchHistory<T = Record<string, unknown>>(
  stream: HistoryStream,
  opts: { fromMs: number; toMs?: number; pointId?: string; bessId?: string; assetId?: string; stepMs?: number; shape?: "solar" | "soc" },
): Promise<T[]> {
  const s = getSession();
  if (!s) return [];
  const qs = new URLSearchParams({ from: String(Math.floor(opts.fromMs)), to: String(Math.ceil(opts.toMs ?? Date.now() + 60_000)) });
  if (opts.pointId) qs.set("point_id", opts.pointId);
  if (opts.bessId) qs.set("bess_id", opts.bessId);
  if (opts.assetId) qs.set("asset_id", opts.assetId);
  if (opts.stepMs) qs.set("step", String(opts.stepMs));
  if (opts.shape) qs.set("shape", opts.shape);
  const gw = getActiveGateway();
  if (gw) qs.set("gateway_id", gw);
  try {
    const r = await fetch(centralUrl(`/api/history/${stream}?${qs}`), { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" });
    if (!r.ok) return [];
    const body: unknown = await r.json();
    return Array.isArray(body) ? (body as T[]) : [];
  } catch { return []; }
}

/** Live rows plus stored ones, de-duplicated on `key`, newest first by `time`. */
export function mergeRows<T>(live: T[], stored: T[], key: (r: T) => string, time: (r: T) => number): T[] {
  const seen = new Set(live.map(key));
  const out = live.slice();
  for (const r of stored) { const k = key(r); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out.sort((a, b) => time(b) - time(a));
}
