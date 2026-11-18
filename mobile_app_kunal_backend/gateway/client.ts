"use client";

/**
 * Browser-side gateway access. Every call goes to the proxy at /api/gw, never
 * to the gateway host — see app/api/gw/[...path]/route.ts for why.
 *
 * "Local" for the web build, which is served by the app that hosts the proxy.
 * The Android bundle has no server, so apiBase() prefixes the deployed origin;
 * it returns "" everywhere else, leaving the web request byte-identical.
 */

import type { FastBessRow, GatewayMode } from "./types";
import { apiBase, appToken, SITE_HEADER } from "./config";
import { activeSiteId, bearerToken, onUnauthorized } from "./auth";
import type { AlarmExplanation, Advice, Evidence } from "./aiTypes";

export interface GwResponse<T> {
  data: T;
  mode: GatewayMode;
  note?: string;
  windowUtc?: [string, string];
  /**
   * The instant the backend considers "now". Live gateways omit it and
   * wall-clock applies. The reference capture supplies its playhead, because
   * its samples carry their real August timestamps and measuring their age
   * against today would report every one of them as ten days stale.
   */
  nowMs?: number;
}

/**
 * The live gateway wraps every collection in a single `items` envelope, while
 * the reference capture names each one for its domain — `rows`, `alarms`,
 * `sources`. Callers were written against the capture's names, so a live
 * response would read as an empty list rather than an error: the alarms screen
 * quietly showed nothing while the plant reported 150 active alarms. `listKey`
 * names the key that caller wants, and the envelope is mapped onto it here.
 */
/* Exported because the website reads endpoints this file has no wrapper for
   — telemetry, logs, the register map — and a second copy of the token,
   site-header and 401 handling below is a second place for them to be
   wrong. See lib/gateway/fetch.ts. */
export async function gw<T>(pathAndQuery: string, listKey = "rows"): Promise<GwResponse<T>> {
  const token = appToken();
  const bearer = bearerToken();
  /* The bearer and the site are read together on purpose: auth.ts scopes the
     token to the active site, so a request that carried one without the other
     would present site A's credentials to site B's gateway. Reading both at
     call time — rather than closing over them — is what keeps them in step
     across a switch. */
  const site = activeSiteId();
  const r = await fetch(`${apiBase()}/api/gw/${pathAndQuery}`, {
    cache: "no-store",
    headers: {
      ...(token ? { "x-gw-app-token": token } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(site ? { [SITE_HEADER]: site } : {}),
    },
  });

  /* The gateway rejected a token this client thought was good — revoked, or
     expired sooner than advertised. Dropping it here is what surfaces the login
     screen, instead of every panel independently rendering an error. */
  if (r.status === 401) {
    onUnauthorized();
    throw new Error("Session expired. Please sign in again.");
  }

  const body = await r.json();
  if (!r.ok) throw new Error(body?.detail ?? body?.error ?? `gateway ${r.status}`);
  if (Array.isArray(body?.items) && !Array.isArray(body?.[listKey])) body[listKey] = body.items;
  return {
    data: body as T,
    mode: (body?._mode as GatewayMode) ?? (r.headers.get("x-gw-mode") as GatewayMode) ?? "live",
    note: body?._note,
    windowUtc: body?._windowUtc,
    nowMs: typeof body?._playhead_ms === "number" ? body._playhead_ms : undefined,
  };
}

export const getHealth        = () => gw<Record<string, unknown>>("health");
export const getSources       = () => gw<{ sources: unknown[] }>("sources/summary", "sources");
export const getLoggerStatus  = () => gw<Record<string, unknown>>("fast-bess/status");
/* §1 of the API Reference specifies format=compact for this endpoint; it is
   what returns the value_only schema_version 2 rows for both BESS. */
export const getLatest        = () => gw<{ rows: FastBessRow[] }>("fast-bess/latest?format=compact");
/**
 * Live alarm rows are shaped for the whole plant — `asset_id`, `display_name`,
 * `severity` — while the screens expect the capture's BESS-centric row. The
 * two are reconciled here so the screen stays declarative. `severity` is new
 * on the live gateway and is carried through rather than dropped.
 */
export interface GatewayAlarm {
  source_id: string;
  bess_id: string;
  /**
   * Which asset raised it, as a readable label.
   *
   * Was `"PCS" | "BMS"`, decided by testing the id for "_pcs" and calling
   * everything else BMS. The gateway raises alarms on nine assets, so that
   * mislabelled the other seven — and the only genuine alarm on the
   * commissioned site is `external_ems_2_dehumidifier.alarm_status`, which the
   * screen was therefore attributing to the battery.
   */
  asset: string;
  signal_name: string;
  label: string;
  value: number;
  since_utc: string | null;
  severity?: string;
}

/* ── The rest of the read-only surface ─────────────────────────────────────
   The gateway publishes 50 endpoints (API Inventory, 10 Aug 2026). Roughly a
   third are control and command: every one is internal_admin, the reference
   classifies them "never public customer UI", and proxy.ts refuses them
   server-side. They are deliberately absent here and must stay absent.

   What follows is the read-only remainder that the screens can honestly use.
   Nothing here invents a figure: each call maps to one documented endpoint,
   and a field the gateway omits stays undefined rather than being defaulted. */

/** Who the bearer token belongs to, and what the gateway lets them do. */
export interface AuthMe {
  username?: string;
  role?: string;
  source_ids?: string[];
  [k: string]: unknown;
}
/* The gateway's own answer, not the client's. The session stores the username
   that was typed at the login form, which is what the user believes they are;
   this is what the gateway agrees they are, including the role that actually
   decides what the token can read. When the two disagree the second one is the
   truth, and until now nothing on any screen could tell them apart. */
export const getAuthMe = () => gw<AuthMe>("auth/me");

/** The historian's own account of its storage. */
export interface StorageStatus { [k: string]: unknown }
/* Worth surfacing rather than leaving to whoever reads the docs: §8 of the
   handover warns that the gateway keeps ninety days at one second in SQLite
   and that the file does not shrink until it is vacuumed. That is a condition
   an operator can act on, and the only place it is reported is here. */
export const getStorageStatus = () => gw<StorageStatus>("storage/status");
export const getStorageHealth = () => gw<Record<string, unknown>>("storage/health");

/**
 * One stored signal's history, out of `telemetry_points`.
 *
 * The only way to get a time axis for anything OUTSIDE the 63-signal fast
 * profile. `/fast-bess/history` covers those 63 at 1 Hz; everything else in
 * the 2,844-point dictionary — the 260 cell voltages, the cooling loop, the
 * meter's energy counters — is stored at the snapshot cadence and reachable
 * only here.
 *
 * THREE CONSTRAINTS, and every caller has to be built around them:
 *
 *   1. ONE SIGNAL PER CALL. There is no multi-signal form, so a screen that
 *      wants N signals costs N round trips against a board whose cheapest
 *      measured reply is 2.5 s. Anything per-cell must therefore be designed
 *      to cost a fixed number of calls rather than one per cell — see
 *      cellTrend.service.ts, which reads six regardless of pack size.
 *   2. NO TIME RANGE. It takes `limit` and nothing else, so it answers with
 *      the most recent N rows and the window is whatever those happen to
 *      span. A caller must read the covered period back off the data and say
 *      so, never label the result "30 days" because it asked for enough rows
 *      to be thirty days at a cadence it guessed.
 *   3. CADENCE IS NOT STATED ANYWHERE. The handover specifies 1 s only for
 *      the fast profile; the snapshot store's interval is a deployment
 *      property nothing publishes. Derive it from consecutive timestamps.
 *
 * The row shape is `telemetry_points` joined to its sample — numeric_value,
 * quality, unit, and the sample's timestamp. Field spellings are read
 * defensively in the service because the reference documents the table's
 * columns and not this endpoint's JSON.
 */
export interface StoredPointRow {
  timestamp_utc?: string;
  source_timestamp?: string;
  ingest_timestamp?: string;
  numeric_value?: number | null;
  value?: number | null;
  quality?: string;
  unit?: string;
  [k: string]: unknown;
}

export const getStoredPoints = (assetId: string, signalName: string, limit = 2000) =>
  gw<{ rows: StoredPointRow[]; count?: number }>(
    `storage/points?asset_id=${encodeURIComponent(assetId)}` +
      `&signal_name=${encodeURIComponent(signalName)}&limit=${Math.max(1, Math.min(limit, 20_000))}`,
    "rows",
  );

/** The 63-signal profile the fast historian is actually logging. */
export const getFastBessProfile = () => gw<Record<string, unknown>>("fast-bess/profile");

/** Assets the gateway knows about, optionally narrowed to one source. */
export interface GatewayAsset {
  asset_id?: string;
  base_asset_id?: string;
  display_name?: string;
  source_id?: string;
  [k: string]: unknown;
}
/* Named `items` by the live gateway and `assets` by the capture — the same
   split gw() already reconciles for rows, alarms and sources. */
export const getAssets = (sourceId?: string) =>
  gw<{ assets: GatewayAsset[] }>(
    sourceId ? `sources/${encodeURIComponent(sourceId)}/assets` : "assets",
    "assets",
  );

/** Whether the gateway is pushing to a server, and when it last managed it. */
export const getServerUploadStatus = () => gw<Record<string, unknown>>("server-upload/status");

/**
 * Which asset an alarm came from, as something a person can read.
 *
 * The runtime id is `{source_id}_{base}` and the base is not always the
 * dictionary's `base_asset_id` — the meter runs as `..._grid_meter` against a
 * base of `utility_meter`, the battery as `..._bms` against `bms_1`. Only the
 * prefix is reliably strippable, so that is all this does, and the result is
 * titled rather than mapped through a table that would need a new row every
 * time the vendor adds an asset.
 */
function assetLabel(assetId: string, sourceId: string): string {
  const base = assetId.startsWith(`${sourceId}_`) ? assetId.slice(sourceId.length + 1) : assetId;
  if (!base) return "Unknown";
  /* Acronyms stay upper — "Bms" and "Pcs" read as typos next to the rest of
     the app, which writes them the way the industry does. */
  if (/^(bms|pcs|ems|io)(_|$)/.test(base)) {
    return base.replace(/_/g, " ").replace(/^\w+/, (w) => w.toUpperCase());
  }
  const words = base.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Whether an /api/alarms row is an alarm at all, as opposed to the protection
 * setpoint it is configured against.
 *
 * The gateway's alarm engine reports both. On the commissioned site it returns
 * 149 "active alarms", of which 148 are limit registers holding their proper
 * values — `rack_cell_over_voltage_l3_alarm_limit_early_warning` at 3500 mV,
 * `rack_charge_over_current_l3_alarm_limit_early_warning` at 226.1 A — and
 * exactly one is a real asserted state. An operator opening that screen reads
 * "149, action needed" over a healthy plant, and the one thing genuinely wrong
 * is buried under the other 148.
 *
 * Both the name and the value are tested, because each alone leaks and they
 * leak differently. Measured against the site's own 149 rows:
 *
 *   name only   (`_limit`, `_value`)   →  53 survive
 *   value only  (integer 0-8)          →  13 survive
 *   both                               →   1 survives, the real one
 *
 * The value rule alone lets through a dozen limits that happen to sit at 5 —
 * `rack_soc_too_low_l2_alarm_limit`, `outlet_low_temp_alarm_value` — because 5
 * is a perfectly ordinary °C or % setpoint. The name rule alone misses every
 * limit the vendor spelled differently. Together they agree on one row.
 *
 * 8 is the ceiling because the dictionary's enum text does not go above it:
 * plain bits are 0/1, `fire_alarm` runs to 4, and the fire modules use 8 for
 * "Open". A setpoint carries an engineering quantity — mV, V, A — and lands
 * far outside that.
 *
 * This is a client-side guard over a gateway defect, and deliberately the
 * narrow kind: nothing is discarded, the excluded rows stay reachable on their
 * own tab, and the screen states how many it set aside. The fix belongs in the
 * gateway's alarm engine, which should not be raising a limit register as an
 * active alarm in the first place.
 */
const ALARM_STATE_MAX = 8;

/** Names the gateway uses for configured limits rather than states. */
const SETPOINT_NAME = /_limit(_|$)|_value$/;

export function isAlarmState(a: Pick<GatewayAlarm, "value" | "signal_name">): boolean {
  if (SETPOINT_NAME.test(a.signal_name)) return false;
  return Number.isInteger(a.value) && a.value >= 0 && a.value <= ALARM_STATE_MAX;
}

export async function getAlarms(): Promise<GwResponse<{ alarms: GatewayAlarm[]; count: number }>> {
  const r = await gw<{ alarms: Record<string, unknown>[]; count?: number; active_count?: number }>(
    "alarms",
    "alarms",
  );
  const alarms: GatewayAlarm[] = (r.data.alarms ?? []).map((a) => {
    const assetId = String(a.asset_id ?? "");
    const sourceId = String(a.source_id ?? "");
    return {
      source_id: sourceId,
      // The gateway names sources external_ems_N and their BESS bess_N.
      bess_id: (a.bess_id as string) ?? sourceId.replace(/^external_ems_/, "bess_"),
      asset: assetLabel(assetId, sourceId),
      signal_name: String(a.signal_name ?? ""),
      label: String(a.display_name ?? a.label ?? a.signal_name ?? ""),
      value: Number(a.value ?? 0),
      since_utc: (a.since_utc as string) ?? null,
      severity: a.severity as string | undefined,
    };
  });
  return { ...r, data: { alarms, count: r.data.active_count ?? r.data.count ?? alarms.length } };
}

/* ── Control ───────────────────────────────────────────────────────────────
   Every one of these is internal_admin at the gateway and refused by the proxy
   unless GW_ALLOW_WRITES is set. Both checks are real and independent: the
   proxy narrows what may be attempted, the gateway decides who may attempt it.
   A client that called these with a customer token gets 403 from the gateway,
   which is correct and is not something the UI should try to work around. */

async function gwPost<T>(pathAndQuery: string, body: unknown): Promise<GwResponse<T>> {
  const token = appToken();
  const bearer = bearerToken();
  const r = await fetch(`${apiBase()}/api/gw/${pathAndQuery}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-gw-app-token": token } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (r.status === 401) {
    onUnauthorized();
    throw new Error("Session expired. Please sign in again.");
  }

  const text = await r.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* gateway sent non-JSON */ }

  if (!r.ok) {
    /* The two refusals a caller must be able to tell apart, because the
       remedy is completely different: the deployment has dispatch switched
       off, versus this account is not permitted to dispatch. Both arrive as
       403 and neither is retryable. */
    const err = String(parsed.error ?? "");
    if (r.status === 403 && err === "write_disabled") {
      throw new ControlError("disabled", String(parsed.detail ?? "Dispatch is disabled on this deployment."));
    }
    if (r.status === 403) {
      throw new ControlError("forbidden", String(parsed.detail ?? "This account is not permitted to dispatch."));
    }
    throw new ControlError("failed", String(parsed.detail ?? parsed.error ?? `gateway ${r.status}`));
  }
  return { data: parsed as T, mode: "live" };
}

export class ControlError extends Error {
  constructor(readonly kind: "disabled" | "forbidden" | "failed", message: string) {
    super(message);
  }
}

/** Read-only: the limited runtime configuration the gateway exposes. */
export const getRuntimeConfig = () => gw<Record<string, unknown>>("config/runtime");
/** Read-only: the SOC protection controller's current state. */
export const getSocProtection = () => gw<Record<string, unknown>>("control/soc-protection/status");

const src = (sourceId: string) => encodeURIComponent(sourceId);

/** Charge at a power setpoint, in kW. */
export const cmdCharge = (sourceId: string, powerKw: number) =>
  gwPost(`control/sources/${src(sourceId)}/charge`, { power_kw: powerKw });

/** Discharge at a power setpoint, in kW. */
export const cmdDischarge = (sourceId: string, powerKw: number) =>
  gwPost(`control/sources/${src(sourceId)}/discharge`, { power_kw: powerKw });

/** Stop dispatching and hold. */
export const cmdStandby = (sourceId: string) =>
  gwPost(`control/sources/${src(sourceId)}/standby`, {});

/** On-grid or off-grid, for one source. */
export const cmdGridMode = (sourceId: string, mode: string) =>
  gwPost(`control/sources/${src(sourceId)}/grid-mode`, { mode });

/* ── Site telemetry ────────────────────────────────────────────────────────
   The fast historian carries 63 signals; the gateway's full cached snapshot
   carries 1,422 per source, across nine assets — bms_1, pcs_1, ems_system,
   utility_meter, liquid_cooling, dehumidifier, fire_protection, io_module and
   remote_control. Everything the dashboard needs beyond the battery itself
   lives here and nowhere else: grid metering, site load, available power and
   the cumulative energy counters.

   /api/telemetry rather than /api/telemetry/key-signals, because "key" is 603
   signals per source and is dominated by fault bits the Alarms screen already
   reads through /api/alarms — the handful of figures this screen wants are not
   all flagged key. */

/**
 * One decoded point.
 *
 * The gateway wraps each signal as { value, quality, unit, address, ... } but
 * returns a bare scalar on some assets, so both are accepted.
 *
 * A point whose quality is anything but "good" resolves to null rather than to
 * its value. The gateway keeps the last decoded number in place when a read
 * fails, so trusting the value alone would present a stale register as a live
 * reading — which is the same failure the dashboard already calls out for
 * Modbus 192, and one the screens cannot detect downstream.
 */
function leafValue(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.quality === "string" && o.quality !== "good") return null;
    if (typeof o.value === "number") return Number.isFinite(o.value) ? o.value : null;
  }
  return null;
}

/**
 * A source's cached telemetry, flattened to "<base_asset_id>.<signal_name>".
 *
 * Plain data, deliberately. An earlier version returned an accessor function
 * and it broke on the first render: this app persists its query cache to
 * localStorage, JSON drops functions, and the rehydrated entry arrived with
 * the accessor missing. Anything a query returns has to survive a round trip
 * through JSON — the caller builds its own lookup over this.
 */
export interface SiteTelemetry {
  /** Assets the snapshot actually contained, so absence can be stated. */
  assets: string[];
  /** asset → signal → decoded value, null where the gateway sent none. */
  signals: Record<string, Record<string, number | null>>;
}

export async function getSiteTelemetry(sourceId: string): Promise<GwResponse<SiteTelemetry>> {
  const r = await gw<Record<string, unknown>>(`telemetry?source_id=${encodeURIComponent(sourceId)}`);

  /* Keyed by each node's own base_asset_id, which is the only reliable source
     for it. Deriving the base id by stripping the source prefix looks
     equivalent and is not: the runtime id for the utility meter is
     external_ems_1_grid_meter while its base id is utility_meter, and the BMS
     is external_ems_1_bms against a base id of bms_1. Stripping the prefix
     produced keys that matched nothing and every site figure read as absent. */
  const raw =
    (r.data as {
      assets?: Record<string, { base_asset_id?: string; signals?: Record<string, unknown> }>;
    }).assets ?? {};
  const signals: Record<string, Record<string, number | null>> = {};

  for (const [runtimeId, node] of Object.entries(raw)) {
    const base =
      node?.base_asset_id ??
      (runtimeId.startsWith(`${sourceId}_`) ? runtimeId.slice(sourceId.length + 1) : runtimeId);
    const out: Record<string, number | null> = {};
    for (const [name, v] of Object.entries(node?.signals ?? {})) out[name] = leafValue(v);
    signals[base] = out;
  }

  return { ...r, data: { assets: Object.keys(signals), signals } };
}

/* ── History ───────────────────────────────────────────────────────────────
   The browser no longer reads historian rows, and must not start again.

   It used to: getHistoryPaged followed the epoch cursor from here and pulled
   raw pages onto the phone. One hour of it was 3,456 rows and 8.7 MB for the
   four figures a chart uses, and the page budget was sized from a guess about
   resolution that was wrong by 15x — so a "6h" window drew 2 h 16 m and said so
   nowhere.

   Both failures shared one cause: the client was doing work it has no way to
   check. It cannot know the true resolution before it asks, and it cannot
   afford the rows. The server can do both, so it does — see gateway/series.ts.
   What arrives here is already bucketed, already totalled, and honest about
   what it covers. */

/* Type-only, and it must stay that way: series.ts is server code and pulls in
   node:crypto. `import type` is erased at compile time, so this is a shared
   contract rather than a dependency. */
import type { SeriesResponse } from "./series";

export type HistorySeries = SeriesResponse;

export interface SeriesQuery {
  sourceId: string;
  bessId: string;
  fromEpochMs: number;
  toEpochMs: number;
  /** Points wanted back. The server picks the bucket size from this. */
  points?: number;
  /** The clock the window was measured against — playhead, or wall-clock. */
  nowMs?: number;
}

export function getSeries(q: SeriesQuery) {
  const p = new URLSearchParams({
    from_epoch_ms: String(Math.round(q.fromEpochMs)),
    to_epoch_ms: String(Math.round(q.toEpochMs)),
    points: String(q.points ?? 720),
  });
  if (q.sourceId) p.set("source_id", q.sourceId);
  if (q.bessId) p.set("bess_id", q.bessId);
  if (q.nowMs) p.set("now_epoch_ms", String(Math.round(q.nowMs)));
  return gw<HistorySeries>(`history-series?${p}`);
}

/* ── Inference service ─────────────────────────────────────────────────────
   /api/gw/ai, which is this app's own route rather than a gateway endpoint —
   see app/api/gw/ai/route.ts. It contacts no plant, so unlike every call
   above it carries no site header and returns no GwResponse envelope: there
   is no mode, no playhead and no capture equivalent to reconcile.

   Deliberately its own transport rather than gwPost's. That helper translates
   failures into ControlError, whose three cases are all about dispatch
   permission, and an explanation that failed is none of those things. */

async function aiFetch<T>(body: unknown): Promise<T> {
  const token = appToken();
  const bearer = bearerToken();
  const r = await fetch(`${apiBase()}/api/gw/ai`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-gw-app-token": token } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (r.status === 401) {
    onUnauthorized();
    throw new Error("Session expired. Please sign in again.");
  }

  const parsed = await r.json().catch(() => ({}) as Record<string, unknown>);
  if (!r.ok) {
    /* The route's own detail strings are written for a customer to read, so
       they are surfaced as-is. Only the bare status is a fallback. */
    throw new Error(String(parsed.detail ?? parsed.error ?? `request failed (${r.status})`));
  }
  return parsed as T;
}

/**
 * Whether this deployment has an inference service at all.
 *
 * Feature detection rather than a build-time flag: the web build and the
 * packaged Android bundle are the same code and differ only in what the server
 * they talk to will admit to. A deployment with no key answers `false` here
 * and the app draws no AI affordance anywhere.
 */
/**
 * Which optional services this deployment has.
 *
 * Two, independently: the hosted inference service that costs per call, and a
 * local model used only to rewrite questions the grammar cannot parse. The
 * History screen asks about the second and nothing else.
 */
export async function getAiCapabilities(): Promise<{ available: boolean; interpret: boolean }> {
  const token = appToken();
  const r = await fetch(`${apiBase()}/api/gw/ai`, {
    cache: "no-store",
    headers: { ...(token ? { "x-gw-app-token": token } : {}) },
  });
  if (!r.ok) return { available: false, interpret: false };
  const body = await r.json().catch(() => ({}));
  return { available: Boolean(body?.available), interpret: Boolean(body?.interpret) };
}

/**
 * Ask the local model to rewrite a question into the grammar's vocabulary.
 *
 * Returns null whenever there is no usable rewrite — declined, unreachable,
 * not configured, rate limited. The caller treats every one of those the same
 * way, because to a reader they mean the same thing.
 */
export async function interpretQuestion(question: string): Promise<string | null> {
  try {
    const out = await aiFetch<{ question: string | null }>({ task: "interpret", question });
    return out.question ?? null;
  } catch {
    return null;
  }
}

export async function getAiAvailable(): Promise<boolean> {
  const token = appToken();
  const r = await fetch(`${apiBase()}/api/gw/ai`, {
    cache: "no-store",
    headers: { ...(token ? { "x-gw-app-token": token } : {}) },
  });
  if (!r.ok) return false;
  const body = await r.json().catch(() => ({ available: false }));
  return Boolean(body?.available);
}

/** Explain one asserted register. The name is validated against the dictionary server-side. */
export function explainSignal(args: {
  signalName: string;
  value: number;
  assetLabel?: string;
  unitLabel?: string;
}): Promise<AlarmExplanation> {
  return aiFetch<AlarmExplanation>({ task: "explain", ...args });
}

/** Findings over figures this client already computed. Nothing here is measured by the model. */
export function requestAdvice(evidence: Evidence, unitLabel?: string): Promise<Advice> {
  return aiFetch<Advice>({ task: "advise", evidence, unitLabel });
}

/* ── Solar ─────────────────────────────────────────────────────────────────
   The PV inverter, which lives outside the signal dictionary.

   Every other reading in this file comes from the historian or from the
   telemetry snapshot, and both are keyed by the gateway's 2,844-row signal
   dictionary. `solar` appears nowhere in it, which is why this app said for
   months that the site had none. It has one: /api/solis/status reports a Solis
   inverter on a Modbus RTU port, and on 3 September 2026 it answered a
   customer_admin token with 57.81 kW.

   Read as its own call rather than folded into getSiteTelemetry because it is
   a different device answered by a different endpoint on a different cadence —
   and because it is slow. Measured at 6.5 s against the commissioned gateway,
   which is why data.ts polls it at 30 s rather than at the 15 s the snapshot
   uses. See docs/gateway-findings-2026-09-03.md. */

export interface SolisStatus {
  /** False when the gateway has no PV integration, or could not be asked. */
  available: boolean;
  /** The inverter answering on its serial port. */
  online: boolean;
  /** "ON" | "OFF" | "UNKNOWN_0x…" — the inverter's own reported state. */
  state: string | null;
  /** AC power now, kW. Null whenever the reading cannot be trusted. */
  powerKw: number | null;
  /** The SOC-protection controller's current decision, verbatim. */
  decision: string | null;
  /** When the gateway took this reading. */
  timestampUtc: string | null;
}

const SOLIS_ABSENT: SolisStatus = {
  available: false, online: false, state: null,
  powerKw: null, decision: null, timestampUtc: null,
};

export async function getSolis(): Promise<GwResponse<SolisStatus>> {
  /* Failure is an answer here, not an error.

     A deployment without PV — or the bundled reference capture, which has no
     equivalent for this endpoint and returns 503 by design — must render as
     "no solar reported", exactly as a site with no liquid cooling renders. If
     this threw, every such deployment would show an error banner on the
     dashboard for a device it does not have.

     Note what is NOT swallowed: a 401 still clears the session inside gw()
     before the throw reaches this catch, so an expired token surfaces the
     login screen rather than being reported as a missing inverter. */
  let r: GwResponse<Record<string, unknown>>;
  try {
    r = await gw<Record<string, unknown>>("solis/status");
  } catch {
    return { data: SOLIS_ABSENT, mode: "live" };
  }

  const body = r.data ?? {};
  const s = (body.solis ?? {}) as Record<string, unknown>;

  const online = Boolean(s.online);
  const kw = typeof s.active_power_kw === "number" ? s.active_power_kw
    : typeof s.active_power_w === "number" ? s.active_power_w / 1000
    : null;

  return {
    ...r,
    data: {
      available: Boolean(body.available) && Boolean(s.enabled),
      online,
      state: typeof s.state === "string" ? s.state : null,
      /* Gated on `online`, for the reason siteOf gates the utility meter: an
         inverter that is not answering reports zero, and a measured 0.0 kW at
         night is a different fact from an inverter nobody can reach. Null
         renders as a dash; zero would render as a working inverter producing
         nothing. */
      powerKw: online ? kw : null,
      decision: typeof body.decision === "string" ? body.decision : null,
      timestampUtc: typeof body.timestamp_utc === "string" ? body.timestamp_utc : null,
    },
  };
}
