"use client";

/**
 * S5, the site's SOC controller, off the central backend.
 *
 *   GET /gateways/{id}/controller?limit=&state=&from_time=&to_time=
 *
 * The control-logic layer, not telemetry: what the controller decided this
 * cycle and why. A row is written when it reports, so timestamps are sparse
 * and irregular, and the newest row is its live state. `limit` and `state`
 * are the live filters; from/to is in the Oct 2026 reference and is sent,
 * and applied here too until the backend honours it (see inWindow).
 *
 * ── More than the promoted fields ──────────────────────────────────────────
 *
 * The backend promotes state / decision / mode / version / healthy, but
 * `data` is the controller's whole record, and it carries what nothing else
 * on this backend does (checked 6 Oct 2026, v1.14_soc_solar_derate_90_98):
 *
 *   data.bess.X / .Y      each cabinet's SOC, online flag and ON/OFF target
 *   data.solis            the Solis PV inverter — online, power mode, active
 *                         power and its derate limit. The only solar reading
 *                         on the backend; S1/S2 do not carry the inverter.
 *   data.thresholds       derate / high / recovery SOC, derate power, low
 *                         cutoff, and who changed them last
 *   data.action_plan      the target per device this cycle
 *   data.last_actions     what was commanded, skipped or verified
 *
 * Every nested field is optional: one row on 6 Oct came back with every
 * promoted field null, and a controller version may drop or rename any of it.
 */

import { getSession } from "./session";
import { CentralReadError, inWindow, setWindow, type ReadWindow } from "./gateways";

export const CONTROLLER_MAX_LIMIT = 1000;

export interface ControllerBess {
  host?: string;
  online?: boolean;
  soc_percent?: number;
  target_state?: string;
}

export interface ControllerSolis {
  state?: string;
  online?: boolean;
  enabled?: boolean;
  power_mode?: string;
  target_state?: string;
  active_power_kw?: number;
  target_power_kw?: number;
  power_limit_percent?: number;
  power_limit_equivalent_kw?: number;
}

export interface ControllerThresholds {
  derate_power_kw?: number;
  high_soc_percent?: number;
  derate_soc_percent?: number;
  recovery_soc_percent?: number;
  low_cutoff_enabled?: boolean;
  low_cutoff_percent?: number;
  low_recovery_percent?: number;
  settings_revision?: number;
  settings_updated_by?: string;
  settings_updated_at_utc?: string;
}

export interface ControllerAction {
  device?: string;
  target?: string;
  reason?: string;
  dry_run?: boolean;
  skipped?: boolean;
  verified?: boolean;
}

export interface ControllerData {
  bess?: Record<string, ControllerBess>;
  solis?: ControllerSolis;
  thresholds?: ControllerThresholds;
  action_plan?: Array<{ id?: string; kind?: string; target?: string }>;
  last_actions?: ControllerAction[];
  error?: string | null;
  controller?: {
    state?: string;
    previous_state?: string;
    decision?: string;
    solar_off_reason?: string | null;
    low_cutoff_reason?: string | null;
    trend?: { window_sec?: number; avg_soc_delta?: number; new_avg_soc?: number };
  };
}

/** `ControllerRecord`. The promoted strings and `healthy` may be null. */
export interface ControllerRecord {
  controller_state: string | null;
  previous_state: string | null;
  decision: string | null;
  mode: string | null;
  version: string | null;
  healthy: boolean | null;
  /** Controller runtime up (Oct 2026 reference). Absent on older rows. */
  available?: boolean | null;
  sample_time_utc: string;
  received_at_utc: string;
  data: ControllerData | null;
}

const ms = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? 0 : t;
};

export async function fetchController(
  gatewayId: string,
  opts: { limit?: number; state?: string } & ReadWindow = {},
): Promise<ControllerRecord[]> {
  const s = getSession();
  if (!s) throw new CentralReadError("Not signed in");

  const limit = Math.max(1, Math.min(opts.limit ?? 50, CONTROLLER_MAX_LIMIT));
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.state) qs.set("state", opts.state);
  setWindow(qs, opts);

  const r = await fetch(
    `/api/central/gateways/${encodeURIComponent(gatewayId)}/controller?${qs}`,
    { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" },
  );
  if (r.status === 422) throw new CentralReadError("Gateway id rejected by the backend", 422);
  if (!r.ok) throw new CentralReadError(`Central backend answered ${r.status}`, r.status);

  const body: unknown = await r.json();
  if (!Array.isArray(body)) return [];
  /* Newest first by sample time — a reconnecting gateway uploads late, so
     arrival order is not report order. Rows with no state at all say nothing
     about what the controller did and are dropped. */
  return (body as ControllerRecord[])
    .filter((x) => x.controller_state != null || x.data?.controller?.state != null)
    .filter((x) => inWindow(x.sample_time_utc, opts))
    .sort((a, b) => ms(b.sample_time_utc) - ms(a.sample_time_utc));
}

/** The record's state, from the promoted field or the nested block. */
export const stateOf = (r: ControllerRecord): string | null =>
  r.controller_state ?? r.data?.controller?.state ?? null;

/** `X_HIGH_ONLY` → `X high only`; `derate_both_inverters` → `Derate both inverters`. */
export function controllerLabel(code: string | null | undefined): string {
  if (!code) return "—";
  const s = code.replace(/_/g, " ").toLowerCase().replace(/\b(x|y)\b/g, (m) => m.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * State changes, newest first: each record whose state differs from the one
 * before it in time. The backend's `previous_state` is the controller's own
 * claim and is shown on the row; this is what the rows read here show.
 */
export function stateChanges(rows: ControllerRecord[]): ControllerRecord[] {
  const out: ControllerRecord[] = [];
  for (let i = 0; i < rows.length; i++) {
    const older = rows[i + 1];
    if (!older || stateOf(older) !== stateOf(rows[i])) out.push(rows[i]);
  }
  return out;
}

/* ── Cabinet SOC from the controller ─────────────────────────────────────── */

/**
 * The controller's cabinet names → bess_id. Checked 8 Oct 2026: over 32
 * moments where both streams reported, X matched bess_1 and Y bess_2 exactly
 * (to 0.1 %), and the other way round was off by ~10 %. socByBess re-checks
 * against S1 whenever the two overlap, so a rewiring shows instead of being
 * drawn under the wrong cabinet.
 */
export const CONTROLLER_BESS: Record<string, string> = { X: "bess_1", Y: "bess_2" };

export interface SocPoint { ts: number; value: number }

/**
 * Each cabinet's SOC as the controller reported it, keyed by bess_id, oldest
 * first. The controller is the one stream the gateway back-fills after an
 * outage (8 Oct: 609 reports overnight while S1 and S2 sent nothing), so it
 * can stand in where S1 is silent.
 *
 * `s1` is the fast stream's SOC per bess_id, for the name check: a name whose
 * readings do not match its mapped cabinet where they overlap is dropped.
 */
export function socByBess(
  rows: ControllerRecord[],
  s1: Record<string, SocPoint[]> = {},
): Record<string, SocPoint[]> {
  const out: Record<string, SocPoint[]> = {};
  for (const r of rows) {
    const ts = Date.parse(r.sample_time_utc);
    if (Number.isNaN(ts)) continue;
    for (const [name, b] of Object.entries(r.data?.bess ?? {})) {
      const bessId = CONTROLLER_BESS[name];
      const v = b?.soc_percent;
      if (!bessId || typeof v !== "number" || !Number.isFinite(v)) continue;
      (out[bessId] ??= []).push({ ts, value: v });
    }
  }
  for (const [bessId, pts] of Object.entries(out)) {
    pts.sort((a, b) => a.ts - b.ts);
    const ref = s1[bessId] ?? [];
    let n = 0, err = 0;
    for (const p of pts) {
      const near = ref.find((q) => Math.abs(q.ts - p.ts) <= 5_000);
      if (near) { n++; err += Math.abs(near.value - p.value); }
    }
    if (n >= 3 && err / n > 1) delete out[bessId];   // not this cabinet any more
  }
  return out;
}
