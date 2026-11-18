/**
 * Gateway health, off the central backend.
 *
 * `GET /gateways/{id}/health?limit=` is the only endpoint on that backend that
 * returns anything a plant produced — the whole read surface is /health,
 * /auth/me and this. Telemetry goes UP through POST /ingest/batch and cannot
 * yet be read back; see docs/central-backend-s1-contract.md.
 *
 * ── Read defensively, because the payload is not ours ──────────────────────
 *
 * `data` is the gateway's own health snapshot, passed through verbatim, and
 * the API reference says plainly that its shape varies by firmware. Every
 * field below is therefore optional and every reader coerces rather than
 * trusts. A gateway on an older build that omits `bad_signal_count` should
 * render a view with one figure missing, not an exception.
 *
 * ── Two timestamps, and they mean different things ─────────────────────────
 *
 * `sample_time_utc` is when the gateway measured; `received_at_utc` is when
 * the backend stored it. The gap between them is the upload lag, which is the
 * one thing this endpoint can say about the link that nothing else can — a
 * gateway that is up but not delivering shows a growing gap while its own
 * status still reads "ok".
 */

import { getSession } from "./session";

export interface GatewaySourceHealth {
  source_id?: string;
  online?: boolean;
  asset_count?: number;
  online_asset_count?: number;
  signal_count?: number;
  bad_signal_count?: number;
  /** When the gateway last heard from this EMS controller. */
  last_update_utc?: string;
}

/** `health.storage` — the gateway's local store (its own disk, not ours). */
export interface GatewayStorageHealth {
  enabled?: boolean;
  mount_ok?: boolean;
  can_write?: boolean;
  db_size_mb?: number;
  used_percent?: number;
  free_space_mb?: number;
  last_skip_reason?: string | null;
  skipped_write_count?: number;
}

/** `health.fast_bess_logger` — the 1 Hz S1 sampler on the gateway. */
export interface GatewayFastBessLoggerHealth {
  enabled?: boolean;
  running?: boolean;
  thread_alive?: boolean;
  last_error?: string | null;
  last_sample_utc?: string;
}

/** Every field optional on purpose — see the note above. */
export interface GatewayHealthSnapshot {
  status?: string;
  gateway_mode?: string;
  source_count?: number;
  online_source_count?: number;
  asset_count?: number;
  online_asset_count?: number;
  total_signal_count?: number;
  bad_signal_count?: number;
  storage_can_write?: boolean;
  sources?: GatewaySourceHealth[];
  /* Added 28 Sep 2026 from a live payload; all optional like the rest. */
  control_enabled?: boolean;
  commands_enabled?: boolean;
  poll_error_count?: number;
  poll_error_active?: boolean;
  api_error?: string | null;
  /** The gateway's own clock when it built this snapshot. */
  gateway_timestamp_utc?: string;
  storage?: GatewayStorageHealth;
  fast_bess_logger?: GatewayFastBessLoggerHealth;
}

/**
 * `HealthRecord`, as /openapi.json declares it: all three fields required.
 *
 * `data` is `additionalProperties: true` in the schema — the gateway's own
 * snapshot, passed through verbatim — so the shape below is from the written
 * note rather than the contract, and every key inside it stays optional.
 */
export interface GatewayHealthRecord {
  /** Promoted by the backend (Oct 2026 reference): ONLINE / DEGRADED / …. Null on older rows. */
  status?: string | null;
  sample_time_utc: string;
  received_at_utc: string;
  data: {
    record_type?: string;
    reason?: string;
    api_reachable?: boolean;
    observed_at_utc?: string;
    health?: GatewayHealthSnapshot;
    [k: string]: unknown;
  };
}

export class CentralReadError extends Error {
  constructor(msg: string, readonly status?: number) {
    super(msg);
    this.name = "CentralReadError";
  }
}

/**
 * Newest first, as the backend returns them.
 *
 * An empty array is a VALID answer and must not be treated as an error: it
 * means no records for that gateway yet. Note the endpoint answers `[]` for an
 * unregistered gateway id too — verified against a fabricated UUID — so an
 * empty result cannot distinguish "not reporting" from "unknown gateway", and
 * the view says so rather than guessing.
 */
export async function fetchGatewayHealth(
  gatewayId: string,
  limit = 50,
): Promise<GatewayHealthRecord[]> {
  const s = getSession();
  if (!s) throw new CentralReadError("Not signed in");

  const capped = Math.max(1, Math.min(limit, 1000)); // server caps at 1000
  const r = await fetch(
    `/api/central/gateways/${encodeURIComponent(gatewayId)}/health?limit=${capped}`,
    { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" },
  );

  if (r.status === 422) throw new CentralReadError("That gateway id is not a valid UUID", 422);
  if (!r.ok) throw new CentralReadError(`Central backend answered ${r.status}`, r.status);

  const body: unknown = await r.json();
  return Array.isArray(body) ? (body as GatewayHealthRecord[]) : [];
}

/** One gateway as the backend lists it (GET /admin/sites/{site}/gateways). */
export interface GatewayListing {
  id: string;
  gateway_key?: string | null;
  enabled?: boolean;
  last_seen_at?: string | null;
}

/**
 * Every enabled gateway on the site, or null when the backend cannot list
 * them (older backend, or an account without admin scope). Null means "fall
 * back to the configured gateway", never "the site has none".
 */
export async function fetchGatewayList(): Promise<GatewayListing[] | null> {
  const s = getSession();
  if (!s) return null;
  try {
    const r = await fetch("/api/central/gateways", {
      headers: { authorization: `Bearer ${s.token}` }, cache: "no-store",
    });
    if (!r.ok) return null;
    const body: unknown = await r.json();
    if (!Array.isArray(body)) return null;
    return (body as GatewayListing[]).filter((g) => typeof g?.id === "string" && g.enabled !== false);
  } catch {
    return null;
  }
}

/* ── Date-range reads ────────────────────────────────────────────────────── */

/** A from/to window in epoch ms, half-open [from, to) on the record's sample time. */
export interface ReadWindow { fromMs?: number; toMs?: number }

/** Adds from_time / to_time (ISO-8601 UTC) to a query, for the ends that are set. */
export function setWindow(qs: URLSearchParams, w: ReadWindow): void {
  if (w.fromMs != null && Number.isFinite(w.fromMs)) qs.set("from_time", new Date(w.fromMs).toISOString());
  if (w.toMs != null && Number.isFinite(w.toMs)) qs.set("to_time", new Date(w.toMs).toISOString());
}

/**
 * True when `iso` falls inside the window. The reference lists from/to on
 * /controller, /solis and /edge-ai, but on 12 Oct 2026 the live openapi.json
 * took them on /fast-bess only, and FastAPI ignores a parameter it does not
 * declare. So the readers send the window AND apply it here: rows outside it
 * never reach a screen, whichever way the backend reads the query.
 */
export function inWindow(iso: string | null | undefined, w: ReadWindow): boolean {
  if (w.fromMs == null && w.toMs == null) return true;
  const t = Date.parse(iso ?? "");
  if (Number.isNaN(t)) return false;
  return (w.fromMs == null || t >= w.fromMs) && (w.toMs == null || t < w.toMs);
}

/**
 * The gateway's status: the promoted `status` (ONLINE, DEGRADED, …) when the
 * backend sends it, else the snapshot's own `data.health.status` (ok, …).
 */
export const healthStatusOf = (r: GatewayHealthRecord | undefined): string | null =>
  r?.status ?? r?.data?.health?.status ?? null;

/** True for the two spellings of a healthy gateway: "ok" (snapshot) and "ONLINE" (promoted). */
export const isHealthyStatus = (status: string | null | undefined): boolean =>
  ["OK", "ONLINE"].includes((status ?? "").toUpperCase());

/** The gateway this deployment watches. No /gateways list endpoint exists yet. */
export const CONFIGURED_GATEWAY_ID =
  process.env.NEXT_PUBLIC_CENTRAL_GATEWAY_ID?.trim() ?? "";
