/**
 * Active alarms, derived from the central backend's fault flags.
 *
 * ── There is no alarm endpoint ─────────────────────────────────────────────
 *
 * The backend publishes health, fast-BESS and general telemetry, and nothing
 * else. So this is not a log: it is the set of fault bits that are raised
 * right now, presented as alarm rows.
 *
 * What the screen has to live with, stated here so nobody has to rediscover it:
 *
 *   • `alertTime` is when the flag was last OBSERVED raised, not when it was
 *     raised. S1 and S2 give a sample time; nothing carries a raised-at.
 *   • `status` is always "active". A cleared alarm has no representation —
 *     the flag simply reads 0 again and the row disappears. End time,
 *     duration and acknowledgement have nowhere to come from.
 *   • `alarmType` is derived from the signal name. No flag carries a severity.
 *
 * ── Which points count ─────────────────────────────────────────────────────
 *
 * See alarmCatalog.service.ts. `category: "fault_alarm"` is 345 points of
 * which 207 are flags; the rest are thresholds, at-alarm snapshots, reset
 * coils and statuses, and the classification there is point-by-point because
 * a word list got it wrong in both directions.
 *
 * ── Two sources ────────────────────────────────────────────────────────────
 *
 * S2 (the nine substreams) carries the PCS detail, the chiller, fire
 * protection, IO, the meter and the EMS summary bits. S1 (fast-BESS) carries
 * 25 fault bits that S2 does not — the BMS contactor, fuse, insulation and
 * sampling faults, and the PCS AC/DC protection trips — plus the two online
 * bits. Both are read, and the row says which one it came from.
 *
 * ── A zero has to be earned ────────────────────────────────────────────────
 *
 * "No active alarms" is only true of flags that were actually read. The S2
 * reads are 1,000 rows per substream, newest first, and a substream that
 * fails or a flag that did not appear in the window is not evidence of a
 * healthy plant. `coverage` carries what was read, so the screen can say
 * "0 of 214 raised" rather than "0".
 */

import {
  fetchFastBess, fetchGeneral, fetchAlarmEvents, openOccurrences, episodes, numeric, SUBSTREAMS,
  type AlarmEvent, type AlarmOccurrence, type FastBessSample, type GeneralRecord,
} from "@/lib/central";
import { SITE_OVERLAY_FOR } from "../overlay/stations";
import type { Alarm, AlarmFilters, AlarmStatistics, AlarmType, PagedData } from "../types";
import {
  classifyS2, S1_CONTEXT, S1_FLAGS, S1_INVERTED,
} from "./alarmCatalog.service";
import { istDate } from "@/lib/api/time";
import { priorityOf, type AlarmPriority } from "@/lib/alarms/priority";
import { ackOf, ackKeys, pruneAcks } from "@/lib/alarms/ack";
import { commLostOf } from "@/lib/alarms/commLost";
import { bessLabel } from "./bessLabel";

/* ── Shape ────────────────────────────────────────────────────────────────── */

export interface AlarmContextValue {
  label: string;
  value: string;
  unit: string | null;
}

/** An Alarm, plus the evidence behind it — for the detail row. */
export interface CentralAlarm extends Alarm {
  /** S1/S2: a raised flag. S4: an open event in the alarm log with no flag behind it. */
  source: "S1" | "S2" | "S4";
  /**
   * When the alarm was raised, from an open S4 event matching this flag
   * (same cabinet, same signal). Absent when S4 has no such event — then
   * `alertTime` is only when the flag was last seen raised.
   */
  raisedAt?: string;
  /** When it cleared — resolved alarms only, from the S4 log's CLEARED event. */
  clearedAt?: string;
  /** P1 (critical) – P4 (low); see lib/alarms/priority.ts. */
  priority: AlarmPriority;
  /** When it was acknowledged, and by whom — kept by this app's server (app/api/alarm-acks). */
  ackedAt?: number;
  ackedBy?: string;
  /** Acknowledged here but not yet saved to the server. */
  ackLocal?: boolean;
  /** S4's own severity (High / Medium / Low), where an event matched. */
  logSeverity?: string;
  /** The raw signal name (S2 `signal`, or the S1 key). */
  signal: string;
  /** The raw code (S2 point id, S1 key, S4 event type) — tooltips and exports. */
  rawCode?: string;
  /** The value as read — "1", "1.0", or "0" for an inverted online bit. */
  rawValue: string;
  /** Values the BMS recorded at its last alarm, where there are any. */
  context: AlarmContextValue[];
  /** CG-33: catalogue description + operator action (S4 events, when resolved). */
  description?: string;
  operatorAction?: string;
}

export interface AlarmCoverage {
  /** Distinct (asset, flag) pairs actually read on this pass, S1 + S2. */
  flagsRead: number;
  s2FlagsRead: number;
  s1FlagsRead: number;
  /** Substreams whose request failed. Their flags are unknown, not clear. */
  unreadSubstreams: string[];
  /** S1 failed outright — its 27 bits per cabinet are unknown. */
  s1Unread: boolean;
  /** Threshold / setpoint registers seen and deliberately NOT counted. */
  settingsSkipped: number;
}

export interface CentralAlarmPage extends PagedData<CentralAlarm> {
  /** Counts over the whole filtered set, not the page. */
  stats: AlarmStatistics;
  coverage: AlarmCoverage;
}

/* ── Labels ───────────────────────────────────────────────────────────────── */

/** `external_ems_1_liquid_cooling` → `BESS 1 · Liquid Cooling`. */
function deviceName(assetId: string): string {
  const m = /^external_ems_(\d+)_(.+?)(?:_\d+)?$/.exec(assetId);
  if (!m) return /^external_ems_\d+$/.test(assetId) ? bessLabel(assetId) : assetId;
  return `${bessLabel(`external_ems_${m[1]}`)} · ${kindLabel(m[2])}`;
}

/* ── Readable alarm text ──────────────────────────────────────────────────── */

/** Asset kinds, as an id spells them and as the screen names them. */
const KIND_LABEL: [string, string][] = [
  ["liquid_cooling", "Liquid Cooling"], ["fire_protection", "Fire Protection"],
  ["dehumidifier", "Dehumidifier"], ["grid_meter", "Utility Meter"], ["utility_meter", "Utility Meter"],
  ["io_module", "IO Module"], ["ems_system", "EMS"], ["bms_extended", "BMS"], ["pcs_extended", "PCS"],
  ["bms", "BMS"], ["pcs", "PCS"], ["ems", "EMS"],
];

const ACRONYM = new Set(["bms", "pcs", "ems", "io", "soc", "soh", "dc", "ac", "igbt", "ups", "hvac", "rtc", "can", "pv"]);

/** `ALARM_STATUS` / `alarm status` → `Alarm Status`, acronyms kept upper case. */
export function titleCase(text: string): string {
  return text
    .replace(/[_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (ACRONYM.has(w.toLowerCase()) ? w.toUpperCase() : `${w.charAt(0).toUpperCase()}${w.slice(1).toLowerCase()}`))
    .join(" ");
}

/** `liquid_cooling` → `Liquid Cooling`; unknown kinds Title Cased. */
export function kindLabel(kind: string): string {
  const k = kind.toLowerCase().replace(/_\d+$/, "");
  return KIND_LABEL.find(([id]) => id === k)?.[1] ?? titleCase(k);
}

/** The kind an S4 event is about: from its asset id, else its event type's prefix. */
function kindOfEvent(e: { asset_id?: string | null; event_type?: string | null; message?: string | null }): string | null {
  const fromAsset = /^external_ems_\d+_(.+?)(?:_\d+)?$/.exec(e.asset_id ?? "")?.[1];
  if (fromAsset) return kindLabel(fromAsset);
  const hay = `${e.event_type ?? ""} ${e.message ?? ""}`.replace(/external_ems_\d+\S*/gi, "").toLowerCase().replace(/\s+/g, "_");
  const hit = KIND_LABEL.find(([id]) => hay.startsWith(id) || hay.includes(`_${id}_`));
  return hit?.[1] ?? null;
}

const STATE_SUFFIX = /[_\s]+(ACTIVE|CLEARED|CLEAR|RAISED|INACTIVE|NORMAL)$/i;
const RAW_ID = /^p\d{3,}$/i;

export interface ReadableAlarm {
  /** `BESS 2 · Dehumidifier`. */
  device: string;
  /** `Dehumidifier`, or "" when unknown. */
  kind: string;
  /** `Alarm Status`. */
  content: string;
  /** `Dehumidifier Alarm Status` — the event type, readable. */
  code: string;
  /** CG-6.3.4: device type from the S4 catalogue payload, when present. */
  deviceType?: string;
  /** CG-6.3.4: the alarm's current value, when the catalogue sends one. */
  value?: string;
  /** CG-33: operator-facing description from the backend alarm catalogue. */
  description?: string;
  /** CG-33: recommended operator action from the backend alarm catalogue. */
  operatorAction?: string;
  /** CG-33: catalogue severity / category, when resolved. */
  severity?: string;
  category?: string;
}

/**
 * An S4 event's text, readable. The log carries
 *   message    "external_ems_2 Dehumidifier Alarm Status ACTIVE: Normal (0) -> Alarm (1)"
 *   event_type "DEHUMIDIFIER_ALARM_STATUS_ACTIVE"
 *   signal     "p1296"
 * and the screen wants "BESS 2 · Dehumidifier", "Alarm Status" and a code a
 * person can read. Raw ids stay on the row for tooltips and exports.
 */
export function readableAlarm(e: {
  asset_id?: string | null; source_id?: string | null; message?: string | null;
  event_type?: string | null; signal_name?: string | null;
  payload?: Record<string, unknown> | null; current_value?: unknown;
  catalog?: {
    code?: string; english_name?: string; severity?: string | null; category?: string | null;
    device_type?: string | null; description?: string | null; operator_action?: string | null;
  } | null;
}): ReadableAlarm {
  /* CG-6.3.4 (Phase 6.3.4): when the S4 catalogue sends operator-facing fields,
     prefer them over names parsed from signal strings. */
  const _pl = e.payload && typeof e.payload === "object" ? (e.payload as Record<string, unknown>) : undefined;
  const _plStr = (k: string): string | undefined => {
    const v = _pl?.[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const _pDevice = _plStr("device");
  const _pDeviceType = _plStr("device_type");
  const _pName = _plStr("name");
  const _pValue = e.current_value == null || e.current_value === "" ? undefined : String(e.current_value);
  const src = /external_ems_\d+/.exec(`${e.asset_id ?? ""} ${e.source_id ?? ""} ${e.message ?? ""}`)?.[0] ?? "";
  const kind = kindOfEvent(e) ?? "";
  const bess = src ? bessLabel(src) : "";
  const device = [bess, kind].filter(Boolean).join(" · ") || (e.asset_id ?? e.source_id ?? "—");

  const stripKind = (t: string) => {
    if (!kind) return t;
    const k = kind.toLowerCase().replace(/\s+/g, "[_\\s]+");
    return t.replace(new RegExp(`^${k}[_\\s]*`, "i"), "");
  };

  /* Message: drop the asset id, the state transition, then the kind. */
  let content = (e.message ?? "")
    .replace(/^\s*external_ems_\d+\S*\s*/i, "")
    .replace(/\s+(ACTIVE|CLEARED|RAISED|INACTIVE)\b[\s\S]*$/, "")
    .replace(/:\s.*$/, "")
    .trim();
  content = stripKind(content).trim();
  const type = (e.event_type ?? "").replace(STATE_SUFFIX, "");
  if (!content && type) content = stripKind(type);
  if (!content && e.signal_name && !RAW_ID.test(e.signal_name)) content = e.signal_name;
  content = content ? titleCase(content) : kind || "Alarm";

  const code = type ? titleCase(type) : e.signal_name && !RAW_ID.test(e.signal_name) ? titleCase(e.signal_name) : "";
  // CG-33: the backend alarm catalogue is authoritative over the gateway's
  // embedded copy — prefer it for name, code and device type, and surface its
  // description + operator action.
  const _cat = e.catalog ?? undefined;
  return {
    device: _pDevice ?? device,
    kind,
    content: _cat?.english_name ?? _pName ?? content,
    code: _cat?.code ?? (e.signal_name && e.signal_name.includes(".") ? e.signal_name : code),
    deviceType: _cat?.device_type ?? _pDeviceType,
    value: _pValue,
    description: _cat?.description ?? undefined,
    operatorAction: _cat?.operator_action ?? undefined,
    severity: _cat?.severity ?? undefined,
    category: _cat?.category ?? undefined,
  };
}

/**
 * Device types, as the filter offers them and the rows carry them.
 *
 * One list for both. They had drifted — the rows said "Water Chiller" and
 * "Energy Meter" while the filter offered "Liquid Cooling" and "Utility
 * Meter" — so choosing either returned nothing on a plant that had alarms.
 */
export const DEVICE_TYPES = [
  "BMS", "PCS", "EMS", "Utility Meter", "Liquid Cooling",
  "Fire Protection", "Dehumidifier", "IO Module",
] as const;

const TYPE_LABEL: Record<string, (typeof DEVICE_TYPES)[number]> = {
  bms_extended: "BMS",
  bms_values: "BMS",
  pcs_extended: "PCS",
  pcs_values: "PCS",
  liquid_cooling: "Liquid Cooling",
  fire_protection: "Fire Protection",
  utility_meter: "Utility Meter",
  dehumidifier: "Dehumidifier",
  io_module: "IO Module",
  ems_system: "EMS",
};

/**
 * An asset id's substream, for S4 rows. S4 may number an asset the way the
 * gateway's own dictionary does (`external_ems_1_pcs_1`) where S2 does not
 * (`external_ems_1_pcs`), so the kind is matched, not the whole id.
 */
function substreamOfAsset(assetId: string): string {
  const kind = /^external_ems_\d+_(.+?)(?:_\d+)?$/.exec(assetId)?.[1] ?? "";
  const map: Record<string, string> = {
    pcs: "pcs_extended", bms: "bms_extended", liquid_cooling: "liquid_cooling",
    fire_protection: "fire_protection", grid_meter: "utility_meter", dehumidifier: "dehumidifier",
    io_module: "io_module", ems_system: "ems_system",
  };
  return map[kind] ?? "";
}

/** A readable kind as a device type the filter offers, or "—". */
function s4TypeOf(kind: string): string {
  return (DEVICE_TYPES as readonly string[]).includes(kind) ? kind : "—";
}

/** `sw_fault_ac_over_current` → `Sw Fault AC Over Current`, for S1 keys. */
function humanise(key: string): string {
  return titleCase(key);
}

function displayName(r: GeneralRecord): string {
  const d = r.data?.display_name;
  return (typeof d === "string" && d) || r.signal || r.point_id || "—";
}

/* ── Kept for callers that classify a single row ──────────────────────────── */

/** One S2 row: is it a flag, and is it raised? */
export function isRaisedAlarm(r: GeneralRecord): boolean {
  if (classifyS2(r).kind !== "flag") return false;
  const n = numeric(r);
  return n !== null && n !== 0;
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

/** Newest sample per bess_id. Two cabinets, so a handful of rows is plenty. */
function newestPerBess(rows: FastBessSample[]): FastBessSample[] {
  const seen = new Map<string, FastBessSample>();
  for (const r of rows) if (r.bess_id && !seen.has(r.bess_id)) seen.set(r.bess_id, r);
  return [...seen.values()];
}

/** `external_ems_1` + `bms` → the asset id S2 uses for the same unit. */
function s1Asset(s: FastBessSample, group: "pcs_values" | "bms_values"): string {
  const meta = group === "pcs_values" ? s.data?.pcs_asset_id : s.data?.bms_asset_id;
  if (typeof meta === "string" && meta) return meta;
  return `${s.source_id}_${group === "pcs_values" ? "pcs" : "bms"}`;
}

export async function fetchAlarms(
  gatewayId: string,
  filters: AlarmFilters = {},
): Promise<CentralAlarmPage> {
  const page = filters.page ?? 1;
  const size = filters.size ?? 20;
  const empty: CentralAlarmPage = {
    records: [], total: 0, size, current: page, pages: 0,
    stats: { failure: 0, alarm: 0, inform: 0, total: 0 },
    coverage: {
      flagsRead: 0, s2FlagsRead: 0, s1FlagsRead: 0,
      unreadSubstreams: [], s1Unread: false, settingsSkipped: 0,
    },
  };
  if (!gatewayId) return empty;

  /* remote_control carries a schedule and one reset coil — no flags. */
  const substreams = SUBSTREAMS.filter((ss) => ss !== "remote_control");
  const unreadSubstreams: string[] = [];

  const [per, s1] = await Promise.all([
    Promise.all(
      substreams.map((ss) =>
        fetchGeneral(gatewayId, { substream: ss, limit: 1000 }).catch(() => {
          unreadSubstreams.push(ss);
          return [] as GeneralRecord[];
        }),
      ),
    ),
    fetchFastBess(gatewayId, { limit: 10 }).then(newestPerBess).catch(() => null),
  ]);
  /* S4, the alarm log: open events give the raise time the flags cannot.
     Read separately so a log failure costs only the times, never the list. */
  const log: AlarmEvent[] = await fetchAlarmEvents(gatewayId, { limit: 1000 }).catch(() => []);
  const open: AlarmOccurrence[] = openOccurrences(log);

  /* Nothing read at all is an outage, not a healthy plant — let the screen
     show its error state instead of an empty table. */
  if (unreadSubstreams.length === substreams.length && s1 === null) {
    throw new Error("No alarm source could be read");
  }

  const siteName =
    SITE_OVERLAY_FOR(gatewayId).powerStationEnglishName ??
    SITE_OVERLAY_FOR(gatewayId).powerStationName ??
    gatewayId;

  const base = (assetId: string) => ({
    powerStationId: gatewayId,
    powerStationName: siteName,
    deviceName: deviceName(assetId),
    device: assetId,
    status: "active" as const,
    priority: 4 as AlarmPriority,   // set below, once the row is complete
  });

  /* ── S2: newest first, so the first sighting of a point is its value ── */
  const seen = new Set<string>();
  const raised: GeneralRecord[] = [];
  const bmsContext = new Map<string, AlarmContextValue[]>();   // by asset
  let s2FlagsRead = 0;
  let settingsSkipped = 0;

  for (const r of per.flat()) {
    if (!r.asset_id || !r.point_id) continue;
    const k = `${r.asset_id}:${r.point_id}`;
    if (seen.has(k)) continue;
    seen.add(k);

    const c = classifyS2(r);
    if (c.kind === "setting") settingsSkipped++;
    if (c.kind === "context") {
      /* Zero means "no alarm recorded", not a cell numbered zero. */
      const n = numeric(r);
      if (n !== null && n !== 0) {
        const list = bmsContext.get(r.asset_id) ?? [];
        list.push({ label: displayName(r), value: r.value ?? "", unit: r.unit });
        bmsContext.set(r.asset_id, list);
      }
    }
    if (c.kind !== "flag") continue;
    s2FlagsRead++;
    const n = numeric(r);
    if (n !== null && n !== 0) raised.push(r);
  }

  const out: CentralAlarm[] = raised.map((r) => {
    const c = classifyS2(r);
    return {
      ...base(r.asset_id!),
      id: `${r.asset_id}:${r.point_id}`,
      serial: 0,
      deviceType: TYPE_LABEL[r.substream ?? ""] ?? (r.substream ?? "—"),
      alertContent: displayName(r),
      alarmCode: r.signal ? titleCase(r.signal) : r.point_id!,
      rawCode: r.point_id!,
      alarmType: c.severity ?? "alarm",
      /* Last observed raised — see the header. Not a raised-at. */
      alertTime: r.sample_time_utc ?? "",
      source: "S2",
      signal: r.signal ?? "",
      rawValue: r.value ?? "",
      context: [],
    };
  });

  /* ── S1: the bits S2 does not carry ───────────────────────────────────── */
  let s1FlagsRead = 0;
  for (const s of s1 ?? []) {
    for (const group of ["pcs_values", "bms_values"] as const) {
      const vals = s.data?.[group] ?? {};
      const assetId = s1Asset(s, group);

      const push = (key: string, content: string, type: AlarmType, raw: number) =>
        out.push({
          ...base(assetId),
          id: `${assetId}:s1:${key}`,
          serial: 0,
          deviceType: TYPE_LABEL[group],
          alertContent: content,
          alarmCode: titleCase(key),
          rawCode: key,
          alarmType: type,
          alertTime: s.sample_time_utc ?? "",
          source: "S1",
          signal: key,
          rawValue: String(raw),
          context: [],
        });

      for (const [key, type] of Object.entries(S1_FLAGS[group])) {
        const v = vals[key];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        s1FlagsRead++;
        if (v !== 0) push(key, humanise(key), type, v);
      }
      for (const [key, content] of Object.entries(S1_INVERTED[group])) {
        const v = vals[key];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        s1FlagsRead++;
        if (v === 0) push(key, content, "failure", v);
      }
      if (group === "bms_values") {
        for (const [key, label] of Object.entries(S1_CONTEXT)) {
          const v = vals[key];
          if (typeof v === "number" && Number.isFinite(v) && v !== 0) {
            const list = bmsContext.get(assetId) ?? [];
            list.push({ label, value: String(v), unit: null });
            bmsContext.set(assetId, list);
          }
        }
      }
    }
  }

  /* The at-alarm snapshot belongs to that BMS's alarms. */
  for (const a of out) {
    const ctx = bmsContext.get(a.device);
    if (ctx && a.deviceType === "BMS") a.context = ctx;
  }

  /* ── Communication Lost: devices whose data has stopped arriving ───────── */
  /* From the same rows the flags came from (lib/alarms/commLost): a device
     silent past its reporting interval, or reporting itself offline. Raised
     at its last reading, so an acknowledgement holds while it stays silent;
     gone the moment data resumes. Fire protection is critical — a silent fire
     panel cannot report a fire. */
  /* The fast stream counts as the PCS's and BMS's data arriving, as on the
     Communication Status screen and the Equipment tiles. */
  const fastRows = (s1 ?? []).flatMap((f) => (["pcs_values", "bms_values"] as const).map((g) => ({
    asset_id: s1Asset(f, g),
    substream: g === "pcs_values" ? "pcs_extended" : "bms_extended",
    signal: "fast_sample",
    sample_time_utc: f.sample_time_utc,
  })));
  for (const lost of commLostOf([...per.flat(), ...fastRows], Date.now())) {
    const fire = lost.substream === "fire_protection";
    out.push({
      ...base(lost.assetId),
      id: `${lost.assetId}:communication_lost`,
      serial: 0,
      deviceType: TYPE_LABEL[lost.substream] ?? lost.substream,
      alertContent: lost.reason === "offline" ? "Communication Lost · Offline" : "Communication Lost",
      alarmCode: "COMMUNICATION_LOST",
      alarmType: fire ? "failure" : "alarm",
      alertTime: new Date(lost.lastSeen).toISOString(),
      /* Silent: since its last reading (stable while silent). Offline: no
         reliable start, so none — its acknowledgement then keys on the id. */
      raisedAt: lost.reason === "silent" ? new Date(lost.lastSeen).toISOString() : undefined,
      source: "S2",
      signal: "communication_lost",
      rawValue: lost.reason,
      context: [],
    });
  }

  /* ── S4: raise times, and open events no flag accounts for ────────────── */
  /* S4's live vocabulary: High / Medium / Low, plus Warning seen live and the
     Critical / Fault / Info the backend may send. */
  const S4_TYPE: Record<string, AlarmType> = {
    critical: "failure", fault: "failure", high: "failure",
    medium: "alarm", warning: "alarm",
    low: "inform", info: "inform",
  };
  const sourceOf = (assetId: string) => /^(external_ems_\d+)/.exec(assetId)?.[1] ?? "";
  const matched = new Set<AlarmOccurrence>();
  for (const a of out) {
    const o = open.find((x) =>
      !matched.has(x) &&
      x.event.signal_name === a.signal &&
      (x.event.source_id ?? sourceOf(x.event.asset_id ?? "")) === sourceOf(a.device));
    if (!o) continue;
    matched.add(o);
    a.raisedAt = new Date(o.raisedTs!).toISOString();
    a.logSeverity = o.event.severity ?? undefined;
  }
  for (const o of open) {
    if (matched.has(o)) continue;
    const e = o.event;
    const assetId = e.asset_id ?? e.source_id ?? "";
    const rd = readableAlarm(e);
    out.push({
      ...base(assetId),
      deviceName: rd.device,
      id: `${assetId}:s4:${e.correlation_id ?? e.event_id ?? e.dedupe_key ?? ""}`,
      serial: 0,
      deviceType: rd.deviceType ?? TYPE_LABEL[substreamOfAsset(assetId)] ?? s4TypeOf(rd.kind),
      alertContent: rd.content,
      alarmCode: rd.code || (e.event_type ?? e.signal_name ?? ""),
      rawCode: e.event_type ?? e.signal_name ?? "",
      alarmType: S4_TYPE[(e.severity ?? "").toLowerCase()] ?? "alarm",
      alertTime: e.event_time_utc,
      raisedAt: new Date(o.raisedTs!).toISOString(),
      logSeverity: e.severity ?? undefined,
      source: "S4",
      signal: e.signal_name ?? "",
      rawValue: e.state ?? "ACTIVE",
      context: [],
      description: rd.description,
      operatorAction: rd.operatorAction,
    });
  }

  let records = out;

  /* Filters. Applied here because the backend has no alarm query to push them
     into — and paging likewise, on a set that is at most a few hundred rows. */
  /* Resolved: the S4 log's closed episodes — a raise and the clear after it
     (or a raise superseded by a later one with no clear logged). */
  if (filters.alarmStatus === "resolved") {
    records = episodes(log).filter((ep) => !ep.open).map((ep) => {
      const e = ep.event;
      const assetId = e.asset_id ?? e.source_id ?? "";
      const rd = readableAlarm(e);
      return {
        ...base(assetId),
        deviceName: rd.device,
        status: "resolved" as const,
        id: `${assetId}:s4:${e.dedupe_key ?? e.event_id ?? ""}:${ep.raisedTs}`,
        serial: 0,
        deviceType: rd.deviceType ?? TYPE_LABEL[substreamOfAsset(assetId)] ?? s4TypeOf(rd.kind),
        alertContent: rd.content,
        alarmCode: rd.code || (e.event_type ?? e.signal_name ?? ""),
        rawCode: e.event_type ?? e.signal_name ?? "",
        alarmType: S4_TYPE[(e.severity ?? "").toLowerCase()] ?? "alarm",
        alertTime: new Date(ep.raisedTs).toISOString(),
        raisedAt: new Date(ep.raisedTs).toISOString(),
        clearedAt: ep.clearedTs != null ? new Date(ep.clearedTs).toISOString() : undefined,
        logSeverity: e.severity ?? undefined,
        source: "S4" as const,
        signal: e.signal_name ?? "",
        rawValue: "CLEARED",
        context: [],
        description: rd.description,
        operatorAction: rd.operatorAction,
      };
    });
  }

  /* Priority on every row; the shared acknowledgements on active ones. */
  for (const a of records) {
    a.priority = priorityOf(a);
    if (a.status !== "resolved") {
      const ack = ackOf(a);
      if (ack) { a.ackedAt = ack.at; a.ackedBy = ack.by; a.ackLocal = ack.local; a.status = "acknowledged"; }
    }
  }
  /* Forget acknowledgements of alarms that are no longer raised — only from
     the unfiltered active list, which is the whole set. */
  if (!filters.alarmStatus && !filters.sourceIds?.length && !filters.deviceType && !filters.deviceName) {
    pruneAcks(records.flatMap(ackKeys));
  }
  if (filters.alarmStatus === "active") records = records.filter((a) => a.status === "active");
  if (filters.alarmStatus === "acknowledged") records = records.filter((a) => a.status === "acknowledged");

  /* Highest priority first, then unacknowledged, then newest raise. */
  records.sort((a, b) =>
    a.priority - b.priority ||
    Number(a.status === "acknowledged") - Number(b.status === "acknowledged") ||
    (b.raisedAt ?? b.alertTime).localeCompare(a.raisedAt ?? a.alertTime));

  /* The unit picker: only the selected cabinets' alarms. */
  if (filters.sourceIds?.length) {
    const ids = filters.sourceIds;
    records = records.filter((a) => ids.some((id) => a.device === id || a.device?.startsWith(`${id}_`)));
  }
  if (filters.deviceType) {
    records = records.filter((a) => a.deviceType === filters.deviceType);
  }
  if (filters.deviceName) {
    const needle = filters.deviceName.toLowerCase();
    records = records.filter((a) => a.deviceName.toLowerCase().includes(needle));
  }
  /* Date range, by raise time in IST (last-seen time where none is logged). */
  if (filters.startTime || filters.endTime) {
    records = records.filter((a) => {
      const d = istDate(Date.parse(a.raisedAt ?? a.alertTime));
      return (!filters.startTime || d >= filters.startTime) && (!filters.endTime || d <= filters.endTime);
    });
  }

  const stats: AlarmStatistics = { failure: 0, alarm: 0, inform: 0, total: records.length };
  for (const a of records) stats[a.alarmType]++;

  const total = records.length;
  const start = (page - 1) * size;
  return {
    records: records.slice(start, start + size).map((a, i) => ({ ...a, serial: start + i + 1 })),
    total,
    size,
    current: page,
    pages: Math.max(1, Math.ceil(total / size)),
    stats,
    coverage: {
      flagsRead: s2FlagsRead + s1FlagsRead,
      s2FlagsRead,
      s1FlagsRead,
      unreadSubstreams,
      s1Unread: s1 === null,
      settingsSkipped,
    },
  };
}

/* ── Export ───────────────────────────────────────────────────────────────── */

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The alarms raised right now, as CSV.
 *
 * Of the active set, because that is all there is — the retired gateway's
 * `/api/logs/export.csv` was a log export and nothing replaces it. The file
 * says "last seen", not "raised at", for the same reason the table does.
 */
export async function exportActiveAlarms(gatewayId: string, filters: AlarmFilters = {}): Promise<void> {
  const all = await fetchAlarms(gatewayId, { ...filters, page: 1, size: 100_000 });
  const head = ["priority", "device", "device_type", "alarm", "code", "source", "severity_derived", "status", "log_severity", "value", "last_seen_utc", "raised_utc", "cleared_utc", "duration_min"];
  const lines = [head.join(",")].concat(
    all.records.map((a) =>
      [`P${a.priority}`, a.device, a.deviceType, a.alertContent, a.rawCode ?? a.alarmCode, a.source, a.alarmType, a.status, a.logSeverity, a.rawValue, a.alertTime, a.raisedAt, a.clearedAt,
        /* Raise → clear, both backend times. Blank while still active: measuring
           to the export moment would put the clock into the data. */
        a.raisedAt && a.clearedAt ? Math.round((Date.parse(a.clearedAt) - Date.parse(a.raisedAt)) / 60_000) : ""]
        .map((v) => csvCell(String(v ?? "")))
        .join(","),
    ),
  );

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filters.alarmStatus === "resolved" ? "resolved" : "active"}-alarms-${istDate()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
