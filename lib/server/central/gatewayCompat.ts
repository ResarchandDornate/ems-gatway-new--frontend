/**
 * Adapter for the site-scoped Central EMS backend (ems-gateway-api, branch tarun-DB).
 *
 * The screens were written against bess-ems-api's per-gateway paths
 * (gateways/{id}/<stream>). This translates those requests and responses inside
 * the /api/central proxy onto the paths in the Frontend API Integration Guide
 * (bess/fast/*, telemetry/*, health/*, alarms, controller/*, solis/*, edge-ai/*,
 * config-audit, commands). Enabled by CENTRAL_BACKEND=gateway or a
 * CENTRAL_BASE_URL containing "ems-gateway-api". Needs CENTRAL_SITE_ID.
 *
 * S3–S9 rows are unwrapped from the {site_id, rows, more, limit, offset}
 * envelope but not renamed; S1 is mapped onto FastBessSample.
 */

export const GATEWAY_MODE =
  process.env.CENTRAL_BACKEND === "gateway" || /ems-gateway-api/.test(process.env.CENTRAL_BASE_URL ?? "");

export const SITE_ID = () => process.env.CENTRAL_SITE_ID?.trim() ?? "";

export interface Translated {
  /** path under /api/v1, plus query string (no leading ?) */
  path: string;
  query: string;
  /** answer straight away instead of calling the backend */
  local?: [number, unknown];
  mapBody?: (b: unknown) => unknown;
}

const STREAM: Record<string, { path: string; history?: boolean }> = {
  alarms: { path: "alarms" },
  "config-audit": { path: "config-audit" },
  controller: { path: "controller", history: true },
  solis: { path: "solis", history: true },
  "edge-ai": { path: "edge-ai", history: true },
  health: { path: "health", history: true },
};

/** Arrays come back wrapped ({results|items|records}); the client wants the bare array. */
function unwrap(b: unknown): unknown {
  if (Array.isArray(b) || !b || typeof b !== "object") return b;
  const o = b as Record<string, unknown>;
  for (const k of ["results", "rows", "items", "records", "data"]) if (Array.isArray(o[k])) return o[k];
  return b;
}

/* New backend name -> the name the screens were written against. */
const ALIAS: Record<string, string> = {
  active_power_kw: "total_active_power",
  reactive_power_kvar: "total_reactive_power",
  power_factor: "total_power_factor",
  soc_percent: "display_soc",
  dc_voltage_v: "dc_voltage",
  dc_power_kw: "dc_power",
  dc_current_a: "dc_current",
  max_cell_voltage_v: "cell_max_voltage",
  min_cell_voltage_v: "cell_min_voltage",
  soh_percent: "soh",
  max_cell_temperature_c: "battery_max_temperature",
  min_cell_temperature_c: "battery_min_temperature",
  current_a: "cluster_total_current",
  grid_frequency_hz: "grid_frequency",
};

/** {sig:{value,unit,quality,...}} -> {sig:value}, plus old-name aliases. */
function flatten(group: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!group || typeof group !== "object") return out;
  for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
    const val = v && typeof v === "object" && "value" in (v as object) ? (v as { value: unknown }).value : v;
    out[k] = val;
    if (ALIAS[k] && !(ALIAS[k] in out)) out[ALIAS[k]] = val;
    if (k === "soc_percent") out.soc = val;
  }
  return out;
}

/* A boolean flag as the 1/0 register the screens read; null/absent stays absent
   (a missing contactor must read "—", never "open"). */
const bit = (v: unknown): number | undefined =>
  typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" && Number.isFinite(v) ? v : undefined;
const setIf = (m: Record<string, unknown>, k: string, v: number | undefined) => {
  if (v !== undefined && m[k] == null) m[k] = v;
};

/** Online when the device's last update is within 120 s of the sample's OWN
 *  timestamp (gateway clock both sides, so browser/backend skew cannot flip it)
 *  and it delivered good signals. The screens' comm-lost timer still applies on
 *  top, so a feed that stops does not read online forever. Unparseable → absent. */
const FRESH_MS = 120_000;
function freshBit(last: unknown, at: unknown, good: unknown): number | undefined {
  const a = Date.parse(String(last ?? "")), b = Date.parse(String(at ?? ""));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return Math.abs(b - a) <= FRESH_MS && (typeof good !== "number" || good > 0) ? 1 : 0;
}

/**
 * TEMPORARY gateway-bug workaround — the cleanedge_kinetics profile was fixed on
 * 13 Nov 2026 (sends 51.1 / 100.0 now), so this no longer fires; delete it once
 * that fix is confirmed permanent. It sent SOC and SOH ×10 (523 for 52.3 %).
 * Scoped to that profile and to the 100–1000 band only, so a corrected gateway
 * (≤100) passes through untouched and nothing is ever divided twice.
 */
function kineticsPercentFix(profile: unknown, bms: Record<string, unknown>) {
  if (!String(profile ?? "").startsWith("cleanedge_kinetics")) return;
  for (const k of ["soc_percent", "display_soc", "soc", "soh_percent", "soh"]) {
    const v = bms[k];
    if (typeof v === "number" && v > 100 && v <= 1000) bms[k] = Math.round(v) / 10;
  }
}

/** This backend's S1 names → the names the screens were written against. */
function s1Aliases(p: Record<string, unknown>, pcs: Record<string, unknown>, bms: Record<string, unknown>) {
  setIf(pcs, "pcs_total_dc_voltage", bit(pcs.dc_bus_voltage_v));
  setIf(pcs, "ab_line_voltage", bit(pcs.grid_voltage_ab_v));
  setIf(pcs, "bc_line_voltage", bit(pcs.grid_voltage_bc_v));
  setIf(pcs, "ca_line_voltage", bit(pcs.grid_voltage_ca_v));
  /* pcs_running_status: 2 running / 0 stopped (old state word); the rest are flags. */
  if (typeof pcs.running === "boolean") setIf(pcs, "pcs_running_status", pcs.running ? 2 : 0);
  setIf(pcs, "shutdown_status", bit(pcs.shutdown));
  setIf(pcs, "standby_status", bit(pcs.standby));
  setIf(pcs, "off_grid_status", bit(pcs.off_grid));
  /* BMS limits are read off the PCS asset by the screens (old layout). */
  setIf(pcs, "bms_max_available_charge_current", bit(bms.max_charge_current_a));
  setIf(pcs, "bms_max_available_discharge_current", bit(bms.max_discharge_current_a));
  setIf(pcs, "bms_available_charge_power", bit(bms.max_charge_power_kw));
  setIf(pcs, "bms_available_discharge_power", bit(bms.max_discharge_power_kw));
  setIf(pcs, "pcs_online_status", freshBit(p.pcs_last_update_utc, p.timestamp_utc, p.pcs_good_signal_count));
  setIf(pcs, "bms_online_status", freshBit(p.bms_last_update_utc, p.timestamp_utc, p.bms_good_signal_count));
  setIf(bms, "cluster_total_voltage_collected", bit(bms.voltage_v));
  setIf(bms, "positive_contact_status", bit(bms.positive_contactor_closed));
  setIf(bms, "negative_contactor_status", bit(bms.negative_contactor_closed));
  setIf(bms, "pre_charge_contactor_status", bit(pcs.dc_precharge_connected));
  /* Old register: 1 discharging, 2 charging, 0 neither. Only when the gateway
     sent both flags — one missing is not "idle". */
  if (typeof pcs.charging === "boolean" && typeof pcs.discharging === "boolean") {
    setIf(bms, "charge_discharge_status", pcs.discharging ? 1 : pcs.charging ? 2 : 0);
  }
  /* The screens read cell extremes in mV; this backend's *_cell_voltage_v is V.
     Below 100 it is volts and is converted; at or above, a gateway already sent
     mV in the _v field (cleanedge_kinetics did until 13 Nov) and it passes as is. */
  for (const k of ["cell_max_voltage", "cell_min_voltage"]) {
    const v = bms[k];
    if (typeof v === "number" && Math.abs(v) < 100) bms[k] = Math.round(v * 1000 * 10) / 10;
  }
  /* Insulation deliberately NOT mapped: the old register is kΩ, the new field is
     named _mohm but carries no declared unit, and the Kinetics value (20,000)
     cannot be confirmed as MΩ. Left "—" until the gateway states the unit. */
}

export function fastSample(r: Record<string, unknown>) {
  const p = (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<string, unknown>;
  const pcs = flatten(p.pcs_values);
  const bms = flatten(p.bms_values);
  kineticsPercentFix(p.profile_name, bms);
  s1Aliases(p, pcs, bms);
  return {
    source_id: r.source_id ?? "",
    bess_id: r.bess_id ?? "",
    sample_time_utc: (p.timestamp_utc as string) ?? r.recorded_at,
    received_at_utc: r.recorded_at,
    quality: (p.quality as string) ?? "unknown",
    max_data_age_ms: (p.max_data_age_ms as number) ?? null,
    data: { ...p, pcs_values: pcs, bms_values: bms },
  };
}

/* ── S3–S9 rows -> the record shapes the screens read ─────────────────────
   The backend returns {gateway_id, message_id, recorded_at|occurred_at,
   <promoted columns>, payload:{...gateway record}}. The screens were written
   against flat records with sample_time_utc / received_at_utc and the gateway's
   own record under `data`. Promoted columns win over their payload copies. */
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function record(r: Record<string, unknown>): Record<string, unknown> {
  const p = obj(r.payload);
  const top: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (k !== "payload" && v != null) top[k] = v;
  const when = (p.timestamp_utc ?? r.occurred_at ?? r.recorded_at ?? null) as string | null;
  return {
    ...p, ...top,
    sample_time_utc: when,
    event_time_utc: when,
    received_at_utc: (r.recorded_at ?? r.occurred_at ?? when) as string | null,
    data: p,
  };
}

/** S3: the snapshot goes under data.health, its status is promoted. */
export function healthRecord(r: Record<string, unknown>): Record<string, unknown> {
  const p = obj(r.payload);
  const when = (p.timestamp_utc ?? r.recorded_at ?? null) as string | null;
  const sources = Array.isArray(p.sources) ? (p.sources as { online?: boolean }[]) : [];
  return {
    status: (p.status as string | undefined) ?? null,
    sample_time_utc: when,
    received_at_utc: (r.recorded_at as string | undefined) ?? when,
    data: {
      record_type: "gateway_health",
      observed_at_utc: when,
      health: {
        ...p,
        gateway_timestamp_utc: when,
        online_source_count: p.online_source_count ?? sources.filter((s) => s.online === true).length,
      },
    },
  };
}

const mapRow = (stream: string, r: Record<string, unknown>) =>
  stream === "health" ? healthRecord(r) : record(r);

export function translate(path: string[], sp: URLSearchParams, method: string): Translated | null {
  const joined = path.join("/");
  if (joined === "auth/me") {
    return {
      path: joined, query: "",
      mapBody: (b) => {
        const u = (b ?? {}) as { id?: string; email?: string; phone?: string };
        return { ...u, username: u.email ?? u.phone ?? "user", roles: [] };
      },
    };
  }
  /* Every gateway on the site, for the site picker. The backend lists them on
     an admin route; an account without that scope gets 403 and the client
     falls back to the configured gateway alone. */
  if (joined === "gateways" && method === "GET") {
    const site = SITE_ID();
    if (!site) return { path: joined, query: "", local: [200, []] };
    return { path: `admin/sites/${site}/gateways`, query: "", mapBody: unwrap };
  }
  if (path[0] !== "gateways" || path.length !== 3) return null;
  const [, gw, stream] = path;
  const site = SITE_ID();
  if (!site) {
    return {
      path: joined, query: "",
      local: [400, { detail: "CENTRAL_SITE_ID is not set (ems-gateway-api reads are site-scoped)" }],
    };
  }

  const q = new URLSearchParams({ site_id: site, gateway_id: gw });
  const limit = sp.get("limit");
  if (limit) q.set("limit", limit);
  const from = sp.get("from_time"), to = sp.get("to_time");
  if (from) q.set("start", from);
  if (to) q.set("stop", to);

  if (stream === "fast-bess") {
    const bess = sp.get("bess_id");
    if (bess) q.set("bess_id", bess);
    return {
      path: "bess/fast/history", query: q.toString(),
      mapBody: (b) => {
        const rows = unwrap(b);
        return Array.isArray(rows)
          ? (rows as Record<string, unknown>[])
              .slice().sort((a, b) => Date.parse(String(b.recorded_at)) - Date.parse(String(a.recorded_at)))
              .map(fastSample)
          : [];
      },
    };
  }
  if (stream === "general") {
    /* S2 lives in InfluxDB on this backend. Latest-per-signal for a substream
       is /monitor/live; a single point's history needs /telemetry/series and
       the new signal keys (not mapped yet -> empty). */
    /* Handled by s2General (telemetry/latest fan-out) in the proxy. */
    return { path: joined, query: "", local: [200, []] };
  }
  const s = STREAM[stream];
  if (!s) return null;
  /* Filters the backend takes (alarms: severity/state/event_type; controller:
     controller_state). asset_id is not a backend filter, so it is applied here. */
  for (const k of ["severity", "state", "event_type", "controller_state", "offset"]) {
    const v = sp.get(k);
    if (v) q.set(k, v);
  }
  const asset = sp.get("asset_id");
  return {
    path: s.history ? `${s.path}/history` : s.path,
    query: q.toString(),
    mapBody: (b) => {
      const rows = unwrap(b);
      if (!Array.isArray(rows)) return [];
      const out = (rows as Record<string, unknown>[]).map((r) => mapRow(stream, r));
      return asset ? out.filter((r) => r.asset_id === asset) : out;
    },
  };
}

/* ── S2 via /telemetry/latest, one call per signal key ───────────────────────
   The guide lists no signal registry, so the keys come from s2Signals.json
   (captured once from the backend). Cached 20 s per substream. */
import S2_SIGNALS from "./s2Signals.json";

const s2Cache = new Map<string, { at: number; p: Promise<unknown[]> }>();

export function s2General(base: string, auth: string, gw: string, sub: string, signal?: AbortSignal): Promise<unknown[]> {
  const ck = `${gw}|${sub}`;
  const hit = s2Cache.get(ck);
  if (hit && Date.now() - hit.at < 20_000) return hit.p;
  const keys = (S2_SIGNALS as Record<string, string[]>)[sub] ?? [];
  const rows: unknown[] = [];
  let next = 0;
  let assets: AssetMap = { toNew: new Map(), toOld: new Map() };
  const one = async (key: string) => {
    const qs = new URLSearchParams({ site_id: SITE_ID(), stream: "S2", substream: sub, signal_key: key });
    try {
      const r = await fetch(`${base}/api/v1/telemetry/latest?${qs}`, { headers: { authorization: auth, accept: "application/json" }, cache: "no-store", signal });
      if (!r.ok) return;
      const b = (await r.json()) as { results?: { asset_id?: string; source_id?: string; value?: number | null; time?: string }[] };
      for (const p of b.results ?? []) {
        if (!own.has(tokenOf(p.source_id))) continue;   // another gateway's source
        rows.push({
          substream: sub, asset_id: (p.asset_id && assets.toOld.get(p.asset_id)) ?? p.asset_id ?? null, point_id: key, signal: key,
          value: p.value == null ? null : String(s2Value(key, p.value)), unit: null, category: null, quality: "good",
          sample_time_utc: p.time ?? null, received_at_utc: null, data: {},
        });
      }
    } catch { /* one signal failing must not sink the substream */ }
  };
  let own = new Set<string>();
  const p = Promise.all([assetMap(base, auth, gw), ownedS2Tokens(base, auth, gw)]).then(([m, o]) => { assets = m; own = o; }).then(() => own.size === 0 ? [] : Promise.all(Array.from({ length: 24 }, async () => {
    while (next < keys.length) await one(keys[next++]);
  }))).then(() => rows.sort((a, b) => Date.parse(String((b as { sample_time_utc: string }).sample_time_utc)) - Date.parse(String((a as { sample_time_utc: string }).sample_time_utc))));
  s2Cache.set(ck, { at: Date.now(), p });
  return p;
}

/* ── S2 cell voltages: V on this backend, mV on every screen ──────────────
   The one conversion point for S2 — live rows (s2General), mapped points
   (s2Point) and history all pass through here, so nothing is converted twice.
   Below 100 the value is volts; at or above, a gateway already sent mV and it
   passes untouched. (S1's cell extremes are converted in s1Aliases.) */
const CELL_V = /^(cell_voltage_\d+|rack_(average|max|min)_cell_voltage)$/;
export const s2Value = (key: string, v: number): number =>
  CELL_V.test(key) && Math.abs(v) < 100 ? Math.round(v * 1000 * 10) / 10 : v;

/* ── Which S2 sources belong to a gateway ──────────────────────────────────
   TEMPORARY until /telemetry/* takes gateway_id. Those endpoints are site-wide
   and two gateways name their assets alike (pcs_1, bms_rack_1), so without this
   one gateway's screens showed another's values. An S2 row is shown for a
   gateway only when its source_id's vendor token (elecod_source → "elecod")
   matches a token of one of that gateway's own health sources
   (elecod_pcs_source → "elecod"). Health unreadable → nothing is owned: a blank
   is safer than another site's number. */
const tokenOf = (src: unknown) => String(src ?? "").split("_")[0];
const ownCache = new Map<string, { at: number; ttl: number; p: Promise<Set<string>> }>();

export function ownedS2Tokens(base: string, auth: string, gw: string): Promise<Set<string>> {
  const hit = ownCache.get(gw);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.p;
  const entry = { at: Date.now(), ttl: 5 * 60_000, p: Promise.resolve(new Set<string>()) };
  entry.p = (async () => {
    try {
      const qs = new URLSearchParams({ site_id: SITE_ID(), gateway_id: gw, limit: "1" });
      const hdrs = { authorization: auth, accept: "application/json" };
      const [hr, fr] = await Promise.all([
        fetch(`${base}/api/v1/health/latest?${qs}`, { headers: hdrs, cache: "no-store" }),
        fetch(`${base}/api/v1/bess/fast/latest?${qs}`, { headers: hdrs, cache: "no-store" }).catch(() => null),
      ]);
      const rows = hr.ok ? unwrap(await hr.json()) : [];
      const p = obj(Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined)?.payload : undefined);
      const sources = Array.isArray(p.sources) ? (p.sources as { source_id?: unknown }[]) : [];
      const own = new Set(sources.map((s) => tokenOf(s.source_id)).filter(Boolean));
      /* The S1 profile name lists the gateway's vendors too
         (cleanedge_kinetics_fast_v1 → cleanedge, kinetics). Needed because a
         gateway's health roster can use generic ids (test-gw-01 reports
         bms_bms_source / pcs_pcs_source) while its S2 rows carry the vendor
         ones (kinetics_pcs_source) — without this it owned none of its S2. */
      try {
        const frows = fr?.ok ? unwrap(await fr.json()) : [];
        const fp = obj(Array.isArray(frows) ? (frows[0] as Record<string, unknown> | undefined)?.payload : undefined);
        for (const t of String(fp.profile_name ?? "").split("_")) {
          if (t && !/^(fast|slow|v\d+|bms|pcs|source)$/i.test(t)) own.add(t);
        }
      } catch { /* health tokens alone */ }
      if (!own.size) entry.ttl = 30_000;   // retry soon rather than hold "owns nothing"
      return own;
    } catch {
      entry.ttl = 30_000;
      return new Set<string>();
    }
  })();
  ownCache.set(gw, entry);
  return entry.p;
}

/* ── Asset names: this backend's S2 ids <-> the screens' <source>_<role> ───
   S2 names assets pcs_1 / bms_rack_1; the screens were written against
   <source_id>_pcs / <source_id>_bms (the cabinet's S1 source_id). Each S1
   sample states its own pcs_asset_id and bms_asset_id, so the pairing is read
   from the gateway, not assumed. Cached 5 min per gateway; an empty answer is
   not cached. */
export interface AssetMap { toNew: Map<string, string>; toOld: Map<string, string> }
const assetCache = new Map<string, { at: number; p: Promise<AssetMap> }>();

export function assetMap(base: string, auth: string, gw: string): Promise<AssetMap> {
  const hit = assetCache.get(gw);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.p;
  const p = (async () => {
    const m: AssetMap = { toNew: new Map(), toOld: new Map() };
    try {
      const qs = new URLSearchParams({ site_id: SITE_ID(), gateway_id: gw, limit: "20" });
      const r = await fetch(`${base}/api/v1/bess/fast/latest?${qs}`, { headers: { authorization: auth, accept: "application/json" }, cache: "no-store" });
      const rows = r.ok ? unwrap(await r.json()) : [];
      for (const x of Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []) {
        const src = typeof x.source_id === "string" ? x.source_id : "";
        const pl = obj(x.payload);
        for (const [role, id] of [["pcs", pl.pcs_asset_id], ["bms", pl.bms_asset_id]] as const) {
          if (!src || typeof id !== "string" || !id) continue;
          m.toNew.set(`${src}_${role}`, id);
          m.toOld.set(id, `${src}_${role}`);
        }
      }
    } catch { /* empty map: S2 rows keep their own asset ids */ }
    return m;
  })();
  assetCache.set(gw, { at: Date.now(), p });
  p.then((m) => { if (m.toNew.size === 0) assetCache.delete(gw); });
  return p;
}

/* ── Old S2 point ids -> their counterpart on this backend ─────────────────
   The screens still read S2 by the old backend's point ids (p0181, p1023, …).
   This backend has no point ids, so each is mapped to substream + signal_key.
   Only true equivalents are listed; a point with no counterpart here (energy
   counters, grid meter, load, demand, rated power) stays empty rather than
   being approximated. `scale` converts units where they differ. */
export const POINT_MAP: Record<string, { substream: string; key: string; scale?: number }> = {
  p0181: { substream: "pcs_extended", key: "activepower_a" },            // phase A active power, kW
  p0182: { substream: "pcs_extended", key: "activepower_b" },
  p0183: { substream: "pcs_extended", key: "activepower_c" },
  p1023: { substream: "bms_extended", key: "rack_average_cell_voltage" },  // mV via s2Value
  /* Lifetime charge / discharge per PCS, kWh (dashboard "Charge · Lifetime",
     Power Station "Total Charge / Discharge"). The backend's signal registry
     names them cumulative_*_energy_kwh (source cleanhedge, T3_3Y); /telemetry
     answers 422 "unknown signal" for any other key. As of 18 Nov 2026 the
     Cleanedge gateway publishes them vendor-prefixed
     (cleanedge_total__cumulative_*), which the API will not serve, so these
     read empty until the gateway sends the registry names. */
  p0205: { substream: "pcs_extended", key: "cumulative_charge_energy_kwh" },
  p0206: { substream: "pcs_extended", key: "cumulative_discharge_energy_kwh" },
  /* Not an old point id: the Average Battery Temperature card reads this
     (S1 on this backend carries only the max and min). */
  avg_cell_temperature: { substream: "bms_extended", key: "rack_average_cell_temperature" },
};

const pointRow = (asset: string, pointId: string, m: { substream: string; key: string; scale?: number }, value: number | null | undefined, time: string | null | undefined) => ({
  substream: m.substream, asset_id: asset, point_id: pointId, signal: m.key,
  value: value == null || !Number.isFinite(value) ? null : String(Math.round(s2Value(m.key, value) * (m.scale ?? 1) * 1e6) / 1e6),
  unit: null, category: null, quality: "good",
  sample_time_utc: time ?? null, received_at_utc: null, data: {},
});

/** Newest value per asset of one mapped point, as /general rows. [] for an unmapped point. */
export async function s2Point(base: string, auth: string, gw: string, pointId: string): Promise<unknown[]> {
  const m = POINT_MAP[pointId];
  if (!m) return [];
  const [assets, own] = await Promise.all([assetMap(base, auth, gw), ownedS2Tokens(base, auth, gw)]);
  if (!own.size) return [];
  const qs = new URLSearchParams({ site_id: SITE_ID(), stream: "S2", substream: m.substream, signal_key: m.key });
  try {
    const r = await fetch(`${base}/api/v1/telemetry/latest?${qs}`, { headers: { authorization: auth, accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return [];
    const b = (await r.json()) as { results?: { asset_id?: string; source_id?: string; value?: number | null; time?: string }[] };
    return (b.results ?? []).flatMap((x) => {
      if (!own.has(tokenOf(x.source_id))) return [];   // another gateway's source
      const old = x.asset_id ? assets.toOld.get(x.asset_id) : undefined;
      return old ? [pointRow(old, pointId, m, x.value, x.time)] : [];
    });
  } catch {
    return [];
  }
}

/* ── History for /api/history/*, straight from the backend ───────────────────
   fast: one newest-sample read per step-window (like /api/fast-slices), capped
   so a month never becomes thousands of calls. Other streams: one page of
   <stream>/history for the window. */
const HIST_PATH: Record<string, string> = {
  alarms: "alarms", controller: "controller/history", solis: "solis/history",
  "edge-ai": "edge-ai/history", health: "health/history",
};

export async function gatewayHistoryRows(
  base: string, auth: string, gw: string, stream: string,
  from: number, to: number, step: number, bessId: string | null, signal?: AbortSignal,
  point?: { pointId: string | null; assetId: string | null },
): Promise<{ ts: number; r: Record<string, unknown> }[]> {
  const get = async (path: string, qs: URLSearchParams) => {
    try {
      const r = await fetch(`${base}/api/v1/${path}?${qs}`, { headers: { authorization: auth, accept: "application/json" }, cache: "no-store", signal });
      if (!r.ok) return null;
      /* Live envelope is {results, has_more}; the guide writes {rows, more}. Accept both. */
      const body = (await r.json()) as { more?: boolean; has_more?: boolean };
      const rows = unwrap(body);
      return Array.isArray(rows)
        ? { rows: rows as Record<string, unknown>[], more: body?.has_more === true || body?.more === true }
        : null;
    } catch { return null; }
  };
  const out: { ts: number; r: Record<string, unknown> }[] = [];
  if (stream === "fast") {
    const span = to - from;
    const st = Math.max(step || 0, Math.ceil(span / 288), 60_000);
    const wins: [number, number][] = [];
    for (let t = from; t < to; t += st) wins.push([t, Math.min(t + st, to)]);
    let next = 0;
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (next < wins.length) {
        const [a, b] = wins[next++];
        const q = new URLSearchParams({ site_id: SITE_ID(), gateway_id: gw, limit: "1", start: new Date(a).toISOString(), stop: new Date(b).toISOString() });
        if (bessId) q.set("bess_id", bessId);
        const page = await get("bess/fast/history", q);
        for (const x of page?.rows ?? []) {
          const m = fastSample(x);
          out.push({ ts: Date.parse(String(m.sample_time_utc)), r: m as unknown as Record<string, unknown> });
        }
      }
    }));
  } else if (stream === "general" && point?.pointId && point.assetId && POINT_MAP[point.pointId]) {
    /* One aggregated read (~300 points) instead of paging raw samples. */
    const m = POINT_MAP[point.pointId];
    const asset = (await assetMap(base, auth, gw)).toNew.get(point.assetId);
    /* The asset's S2 source, if this gateway owns one — read off the newest value. */
    let source: string | undefined;
    if (asset) {
      const own = await ownedS2Tokens(base, auth, gw);
      const lq = new URLSearchParams({ site_id: SITE_ID(), stream: "S2", substream: m.substream, signal_key: m.key, asset_id: asset });
      try {
        const lr = await fetch(`${base}/api/v1/telemetry/latest?${lq}`, { headers: { authorization: auth, accept: "application/json" }, cache: "no-store", signal });
        const lb = lr.ok ? ((await lr.json()) as { results?: { source_id?: string }[] }) : {};
        source = (lb.results ?? []).map((x) => x.source_id).find((s) => s && own.has(tokenOf(s)));
      } catch { /* no source → no history */ }
    }
    if (asset && source) {
      const mins = Math.max(1, Math.round((to - from) / 300 / 60_000));
      const q = new URLSearchParams({
        site_id: SITE_ID(), stream: "S2", substream: m.substream, signal_key: m.key, asset_id: asset, source_id: source,
        start: new Date(from).toISOString(), stop: new Date(to).toISOString(), window: `${mins}m`, fn: "mean",
      });
      try {
        const r = await fetch(`${base}/api/v1/telemetry/aggregate?${q}`, { headers: { authorization: auth, accept: "application/json" }, cache: "no-store", signal });
        const b = r.ok ? ((await r.json()) as { points?: { time?: string; value?: number | null }[] }) : {};
        for (const p of b.points ?? []) {
          const t = Date.parse(String(p.time ?? ""));
          if (Number.isFinite(t) && p.value != null) out.push({ ts: t, r: pointRow(point.assetId, point.pointId, m, p.value, p.time) });
        }
      } catch { /* empty chart, not an error page */ }
    }
  } else if (HIST_PATH[stream]) {
    /* Backend caps limit at 1000 and signals further pages with `more` (guide §4).
       20 pages = 20,000 rows ceiling so a year-long window cannot run away. */
    const PAGE = 1000, MAX_PAGES = 20;
    for (let n = 0; n < MAX_PAGES; n++) {
      const q = new URLSearchParams({
        site_id: SITE_ID(), gateway_id: gw, limit: String(PAGE), offset: String(n * PAGE),
        start: new Date(from).toISOString(), stop: new Date(to).toISOString(),
      });
      const page = await get(HIST_PATH[stream], q);
      for (const x of page?.rows ?? []) {
        const m = mapRow(stream, x);
        const t = Date.parse(String(m.sample_time_utc ?? ""));
        out.push({ ts: Number.isFinite(t) ? t : from, r: m });
      }
      if (!page?.more) break;
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}
