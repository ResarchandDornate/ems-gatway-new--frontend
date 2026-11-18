"use client";

/**
 * S6, the site's Solis PV inverter, off the central backend.
 *
 *   GET /gateways/{id}/solis?limit=&solis_state=&power_mode=&from_time=&to_time=
 *
 * from/to is in the Oct 2026 reference and is sent, and applied here too
 * until the backend honours it (see inWindow).
 *
 * ── What the stream really carries (checked live, 8 Oct 2026) ──────────────
 *
 * Not what the backend's first note described. Every promoted field —
 * inverter_id, source_id, quality, status — is null on all 1,000 rows, so the
 * `inverter_id` / `status` filters match nothing. There is no
 * `ac_active_power`, no today's yield, no inverter temperature and no PV
 * string reading: the stream is the SOC controller's view of the inverter,
 * read over its RS-485 link. Two shapes of row arrive:
 *
 *   snapshot  data.solis = { state, online, power_mode, active_power_kw,
 *             power_limit_percent, power_limit_equivalent_kw, target_*,
 *             communication_quality, last_read_age_sec, last_error, … },
 *             plus data.decision / controller_state / available. 938 of 1,000.
 *   event     data.event = { event_type, message, severity, result, device,
 *             soc_x, soc_y, solis_state, solis_power_w, … } — mostly
 *             communication_lost / _restored. 62 of 1,000.
 *
 * communication_quality is GOOD, STALE, OFFLINE or ERROR. Only a GOOD read is
 * a measurement of now; the others repeat or blank the last one.
 *
 * Like S5 it is back-filled after an outage (806 rows arrived late on 8 Oct).
 */

import { getSession } from "./session";
import { CentralReadError, inWindow, setWindow, type ReadWindow } from "./gateways";

export const SOLIS_MAX_LIMIT = 1000;

export interface SolisState {
  state?: string | null;
  online?: boolean | null;
  enabled?: boolean | null;
  unit_id?: number | null;
  power_mode?: string | null;
  target_state?: string | null;
  active_power_kw?: number | null;
  target_power_kw?: number | null;
  power_limit_percent?: number | null;
  power_limit_equivalent_kw?: number | null;
  communication_quality?: string | null;
  last_read_age_sec?: number | null;
  last_successful_read_utc?: string | null;
  last_error?: string | null;
  last_exception_code?: number | string | null;
  command_verified?: boolean | null;
}

export interface SolisEvent {
  id?: number;
  event_type?: string | null;
  message?: string | null;
  severity?: string | null;
  result?: string | null;
  device?: string | null;
  soc_x?: number | null;
  soc_y?: number | null;
  solis_state?: string | null;
  solis_power_w?: number | null;
}

/**
 * `SolisRecord`. The backend's v2 schema (S6_SOLIS_API_2, 8 Oct 2026)
 * promotes controller_state, decision, solis_state, power_mode, online,
 * communication_quality, unit_id and active_power_kw to the top level; the
 * first version's inverter_id / source_id / quality / status were never
 * filled. Every promoted field may be null — `data.solis` stays the fallback,
 * and is the only home of the derate chain (power_limit_*, target_*).
 */
export interface SolisRecord {
  controller_state?: string | null;
  decision?: string | null;
  solis_state?: string | null;
  power_mode?: string | null;
  online?: boolean | null;
  communication_quality?: string | null;
  /** Modbus unit id — the only way to tell inverters apart (no inverter_id). */
  unit_id?: number | null;
  active_power_kw?: number | null;
  /** Promoted in the Oct 2026 reference; the derate chain behind it stays in data.solis. */
  target_power_kw?: number | null;
  /** The same reading as active_power_kw, in watts (Oct 2026 reference). */
  active_power_w?: number | null;
  sample_time_utc: string;
  received_at_utc: string;
  data: {
    solis?: SolisState;
    decision?: string | null;
    controller_state?: string | null;
    available?: boolean | null;
    event?: SolisEvent;
  } | null;
}

const ms = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? 0 : t;
};

export async function fetchSolis(
  gatewayId: string,
  opts: { limit?: number; solisState?: string; powerMode?: string } & ReadWindow = {},
): Promise<SolisRecord[]> {
  const s = getSession();
  if (!s) throw new CentralReadError("Not signed in");

  const limit = Math.max(1, Math.min(opts.limit ?? 50, SOLIS_MAX_LIMIT));
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.solisState) qs.set("solis_state", opts.solisState);
  if (opts.powerMode) qs.set("power_mode", opts.powerMode);
  setWindow(qs, opts);

  const r = await fetch(
    `/api/central/gateways/${encodeURIComponent(gatewayId)}/solis?${qs}`,
    { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" },
  );
  if (r.status === 422) throw new CentralReadError("Gateway id rejected by the backend", 422);
  if (!r.ok) throw new CentralReadError(`Central backend answered ${r.status}`, r.status);

  const body: unknown = await r.json();
  if (!Array.isArray(body)) return [];
  /* Newest first by sample time — back-filled rows arrive late. */
  return (body as SolisRecord[]).filter((x) => inWindow(x.sample_time_utc, opts)).sort((a, b) => ms(b.sample_time_utc) - ms(a.sample_time_utc));
}

export interface SolisSnapshot { ts: number; solis: SolisState; decision: string | null; controllerState: string | null }
export interface SolisEventRow { ts: number; event: SolisEvent }

/** The snapshot rows, newest first. */
export function snapshotsOf(rows: SolisRecord[]): SolisSnapshot[] {
  const out: SolisSnapshot[] = [];
  for (const r of rows) {
    const ts = ms(r.sample_time_utc);
    const raw = r.data?.solis;
    const promotedKw = r.active_power_kw ?? (typeof r.active_power_w === "number" ? r.active_power_w / 1000 : null);
    const promoted = r.solis_state != null || promotedKw != null || r.communication_quality != null;
    if (!ts || (!raw && !promoted)) continue;
    /* Top-level fields first (v2), data.solis for the rest and for v1 rows. */
    const solis: SolisState = {
      ...raw,
      state: r.solis_state ?? raw?.state ?? null,
      power_mode: r.power_mode ?? raw?.power_mode ?? null,
      online: r.online ?? raw?.online ?? null,
      communication_quality: r.communication_quality ?? raw?.communication_quality ?? null,
      unit_id: r.unit_id ?? raw?.unit_id ?? null,
      active_power_kw: promotedKw ?? raw?.active_power_kw ?? null,
      target_power_kw: r.target_power_kw ?? raw?.target_power_kw ?? null,
    };
    out.push({
      ts, solis,
      decision: r.decision ?? r.data?.decision ?? null,
      controllerState: r.controller_state ?? r.data?.controller_state ?? null,
    });
  }
  return out;
}

/** The event rows, newest first. */
export function eventsOf(rows: SolisRecord[]): SolisEventRow[] {
  const out: SolisEventRow[] = [];
  for (const r of rows) {
    const e = r.data?.event;
    const ts = ms(r.sample_time_utc);
    if (e && ts) out.push({ ts, event: e });
  }
  return out;
}

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** True when the snapshot is a fresh read of the inverter, not a repeat or blank. */
export const isGoodRead = (s: SolisState | undefined): boolean =>
  (s?.communication_quality ?? "").toUpperCase() === "GOOD" && s?.online !== false;

/** PV kW from a snapshot, or null unless it is a GOOD read. */
export function solarKw(s: SolisState | undefined): number | null {
  if (!isGoodRead(s)) return null;
  const kw = finite(s?.active_power_kw);
  return kw == null ? null : Math.max(0, kw);
}

/** The derate limit as kW, where the snapshot states one. */
export const limitKw = (s: SolisState | undefined): number | null => finite(s?.power_limit_equivalent_kw);
