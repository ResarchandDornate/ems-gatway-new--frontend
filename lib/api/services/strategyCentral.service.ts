"use client";

/**
 * Strategy settings, read from the cabinet itself.
 *
 * ── What the backend has, and what it does not ─────────────────────────────
 *
 * There is no policy endpoint. Charge-discharge templates stay where they have
 * always been — this browser's storage, via policyTemplate.service.ts — and
 * nothing here changes that.
 *
 * What IS readable now is the cabinet's own configuration: whether
 * anti-backflow is armed and at what limits, and the dispatch schedule the
 * remote-control block is actually programmed with. That is a different and
 * more useful thing than a saved template. A template is what somebody
 * intended; these registers are what the equipment will do tonight.
 *
 * ── The anti-backflow chart ────────────────────────────────────────────────
 *
 * It plots grid power against the threshold over a day. The threshold is real
 * — p0057 upper and p0056 lower on ems_system — and so is battery power, from
 * S1 for the chosen day. Grid power comes from the utility meter, which reads
 * 0.0 on all 43 of its registers because it is not communicating (p1354 = 0).
 * While it is offline the grid line is left empty, not drawn as a flat zero:
 * a zero against a live threshold would show a site that never once
 * approached its export limit, a claim about the plant rather than about a
 * dead instrument.
 */

import { fetchGeneral, numeric, type GeneralRecord } from "@/lib/central";
import { fetchRecentFast } from "./powerStationCentral.service";
import { installedAssets } from "./devicePresence";
import { deviceType } from "@/lib/devices/registry";
import { isoToMs, istDate, msToHm } from "@/lib/api/time";

async function points(
  gatewayId: string, sourceId: string, substream: string, assetSuffix: string,
): Promise<Map<string, GeneralRecord>> {
  const rows = await fetchGeneral(gatewayId, { substream, limit: 1000 })
    .catch(() => [] as GeneralRecord[]);
  const asset = `${sourceId}_${assetSuffix}`;
  const out = new Map<string, GeneralRecord>();
  for (const r of rows) {
    if (r.asset_id !== asset || !r.signal) continue;
    if (!out.has(r.signal)) out.set(r.signal, r);
  }
  return out;
}

const n = (m: Map<string, GeneralRecord>, k: string): number | null => {
  const r = m.get(k);
  return r ? numeric(r) : null;
};

export interface AntiBackflowConfig {
  /** null when the register did not report — not "disabled". */
  enabled: boolean | null;
  upperLimitKw: number | null;
  lowerLimitKw: number | null;
}

export async function fetchAntiBackflowConfig(
  gatewayId: string, sourceId: string,
): Promise<AntiBackflowConfig | null> {
  if (!gatewayId || !sourceId) return null;
  const ems = await points(gatewayId, sourceId, "ems_system", "ems_system");
  if (ems.size === 0) return null;

  const en = n(ems, "anti_reverse_flow_enable");
  return {
    enabled: en === null ? null : en === 1,
    upperLimitKw: n(ems, "anti_reverse_flow_power_upper_limit_setting"),
    lowerLimitKw: n(ems, "anti_reverse_flow_power_lower_limit_setting"),
  };
}

/** One programmed dispatch slot, as the cabinet holds it. */
export interface DeviceSlot {
  index: number;
  /** "HH:MM", or null when the slot's hour/minute registers did not report. */
  start: string | null;
  end: string | null;
  /** kW. Positive discharges, negative charges, per the register's convention. */
  activePowerKw: number | null;
  /** True when the slot has a time span and a non-zero power — i.e. it does something. */
  programmed: boolean;
}

export interface DeviceSchedule {
  slots: DeviceSlot[];
  remoteMode: number | null;
  socLimitEnabled: boolean | null;
  chargeCutoffSocPct: number | null;
  dischargeCutoffSocPct: number | null;
  /** How many slots actually do something. 0 means nothing is programmed. */
  programmedCount: number;
}

const hhmm = (h: number | null, m: number | null): string | null =>
  h === null || m === null
    ? null
    : `${String(Math.round(h)).padStart(2, "0")}:${String(Math.round(m)).padStart(2, "0")}`;

/**
 * The cabinet's programmed schedule.
 *
 * Slots are numbered from 1 and read until a numbered set stops appearing, so
 * a firmware with more or fewer than the ten seen here needs no change. A slot
 * whose registers are all zero is returned rather than dropped: "slot 3 is
 * empty" and "slot 3 does not exist" are different facts, and the screen shows
 * the difference.
 */
export async function fetchDeviceSchedule(
  gatewayId: string, sourceId: string,
): Promise<DeviceSchedule | null> {
  if (!gatewayId || !sourceId) return null;
  const rc = await points(gatewayId, sourceId, "remote_control", "remote_control");
  if (rc.size === 0) return null;

  const slots: DeviceSlot[] = [];
  for (let i = 1; i <= 24; i++) {
    const sh = n(rc, `time_period_${i}_start_hour`);
    const sm = n(rc, `time_period_${i}_start_minute`);
    const eh = n(rc, `time_period_${i}_end_hour`);
    const em = n(rc, `time_period_${i}_end_minute`);
    const kw = n(rc, `time_period_${i}_active_power`);
    if (sh === null && sm === null && eh === null && em === null && kw === null) break;

    const start = hhmm(sh, sm);
    const end = hhmm(eh, em);
    slots.push({
      index: i,
      start,
      end,
      activePowerKw: kw,
      programmed: start !== null && end !== null && start !== end && (kw ?? 0) !== 0,
    });
  }

  const socEn = n(rc, "remote_mode_soc_limit_enable");
  return {
    slots,
    remoteMode: n(rc, "remote_control_mode") ?? n(rc, "remote_mode"),
    socLimitEnabled: socEn === null ? null : socEn === 1,
    chargeCutoffSocPct: n(rc, "remote_mode_charge_cutoff_soc"),
    dischargeCutoffSocPct: n(rc, "remote_mode_discharge_cutoff_soc"),
    programmedCount: slots.filter((s) => s.programmed).length,
  };
}

/* ── What the cabinet is set to do right now ──────────────────────────────── */

/**
 * The live set points on ems_system and the PCS, for one cabinet.
 *
 * Mode registers come back as raw codes. The gateway dictionary names them
 * (manual/auto, manual-mode control, charge/discharge control mode) but does
 * not publish what 0, 1 and 2 mean, so the screen shows the code rather than
 * guessing a word for it. A wrong word here would tell an operator the cabinet
 * is in auto when it is in manual.
 *
 * The SOC limits here are the ones the EMS enforces in local operation
 * (p0043..p0045) — distinct from the remote-mode cutoffs on remote_control,
 * which only apply when the cabinet takes its orders from the remote block.
 */
export interface CabinetSetpoints {
  remoteMode: number | null;
  manualAutoMode: number | null;
  manualModeControl: number | null;
  autoModeControl: number | null;
  chargeDischargeControlMode: number | null;
  socLimitEnabled: boolean | null;
  chargeCutoffSocPct: number | null;
  dischargeCutoffSocPct: number | null;
  manualChargeKw: number | null;
  manualDischargeKw: number | null;
  autoChargePlannedKw: number | null;
  autoDischargePlannedKw: number | null;
  chargeValueKw: number | null;
  dischargeValueKw: number | null;
  remoteDispatchKw: number | null;
  controlStepKw: number | null;
  controlCycleS: number | null;
  /** pcs_extended p0242 / p0243 — what the PCS has actually been told. */
  pcsActivePowerSettingKw: number | null;
  pcsReactivePowerSettingKvar: number | null;
}

const flag = (v: number | null): boolean | null => (v === null ? null : v === 1);

export async function fetchCabinetSetpoints(
  gatewayId: string, sourceId: string,
): Promise<CabinetSetpoints | null> {
  if (!gatewayId || !sourceId) return null;
  const [ems, pcs] = await Promise.all([
    points(gatewayId, sourceId, "ems_system", "ems_system"),
    points(gatewayId, sourceId, "pcs_extended", "pcs"),
  ]);
  if (ems.size === 0 && pcs.size === 0) return null;

  return {
    remoteMode: n(ems, "remote_mode"),
    manualAutoMode: n(ems, "manual_auto_mode"),
    manualModeControl: n(ems, "manual_mode_control"),
    autoModeControl: n(ems, "auto_mode_control"),
    chargeDischargeControlMode: n(ems, "charge_discharge_control_mode"),
    socLimitEnabled: flag(n(ems, "soc_limit_enable")),
    chargeCutoffSocPct: n(ems, "charge_cutoff_soc_setting"),
    dischargeCutoffSocPct: n(ems, "discharge_cutoff_soc_setting"),
    manualChargeKw: n(ems, "manual_charge_value_setting"),
    manualDischargeKw: n(ems, "manual_discharge_value_setting"),
    autoChargePlannedKw: n(ems, "auto_charge_planned_value"),
    autoDischargePlannedKw: n(ems, "auto_discharge_planned_value"),
    chargeValueKw: n(ems, "charge_value_setting"),
    dischargeValueKw: n(ems, "discharge_value_setting"),
    remoteDispatchKw: n(ems, "remote_power_dispatch"),
    controlStepKw: n(ems, "control_step"),
    controlCycleS: n(ems, "control_cycle"),
    pcsActivePowerSettingKw: n(pcs, "active_power_setting"),
    pcsReactivePowerSettingKvar: n(pcs, "reactive_power_setting"),
  };
}

/* ── Demand management ────────────────────────────────────────────────────── */

/**
 * The demand limiter's configuration, per cabinet.
 *
 * This is configuration only. What the site actually drew against the limit
 * needs grid power from the meter, which is offline, and a day of it, which
 * the backend cannot return (35 minutes at most, no range query).
 */
export interface DemandConfig {
  enabled: boolean | null;
  demandKw: number | null;
  limitPct: number | null;
  rateLimitEnabled: boolean | null;
}

export async function fetchDemandConfig(
  gatewayId: string, sourceId: string,
): Promise<DemandConfig | null> {
  if (!gatewayId || !sourceId) return null;
  const ems = await points(gatewayId, sourceId, "ems_system", "ems_system");
  if (ems.size === 0) return null;

  /* The limit percentage is shown beside the demand setting, not multiplied
     into a threshold: the dictionary does not say what it is a percentage of,
     and a derived kW figure would read as documented behaviour. */
  return {
    enabled: flag(n(ems, "demand_enable")),
    demandKw: n(ems, "demand"),
    limitPct: n(ems, "demand_limit_percentage"),
    rateLimitEnabled: flag(n(ems, "rate_limit_enable")),
  };
}

/* ── Anti-backflow: the meters, and a day's trace ─────────────────────────── */

export interface BackflowMeter {
  meterId: string;
  name: string;
  /** p1354 communication_status: false at 0, null when unread. */
  online: boolean | null;
}

const P_METER_COMMS = deviceType("grid_meter").linkPoint!;
const P_METER_POWER = "p1368";        // utility_meter total_active_power, kW
const P_BACKFLOW_ON = "p0051";
const P_BACKFLOW_UPPER = "p0057";
const P_BACKFLOW_LOWER = "p0056";
const BUCKET_MS = 5 * 60_000;

function newestPerAsset(rows: GeneralRecord[]): Map<string, GeneralRecord> {
  const out = new Map<string, GeneralRecord>();
  for (const r of rows) {                                       // newest first
    if (r.asset_id && !out.has(r.asset_id)) out.set(r.asset_id, r);
  }
  return out;
}

/** The site's fitted grid meters. A slot the gateway publishes with no meter
 *  behind it (link never 1 — lib/devices/registry) is not one, so a site
 *  without a meter lists none rather than a meter that is always offline. */
export async function fetchBackflowMeters(gatewayId: string): Promise<BackflowMeter[]> {
  if (!gatewayId) return [];
  const rows = await fetchGeneral(gatewayId, { pointId: P_METER_COMMS, limit: 50 }).catch(() => [] as GeneralRecord[]);
  const byAsset = new Map<string, GeneralRecord[]>();
  for (const r of rows) if (r.asset_id) (byAsset.get(r.asset_id) ?? byAsset.set(r.asset_id, []).get(r.asset_id)!).push(r);
  const fitted = await installedAssets(byAsset);
  return [...newestPerAsset(rows)].filter(([assetId]) => fitted.has(assetId)).map(([assetId, r]) => {
    const v = numeric(r);
    const cab = /external_ems_(\d+)/.exec(assetId)?.[1];
    return {
      meterId: assetId,
      name: `Grid Meter${cab ? ` · BESS ${cab}` : ""}`,
      online: v === null ? null : v !== 0,
    };
  }).sort((a, b) => a.meterId.localeCompare(b.meterId));
}

export interface BackflowRow {
  t: string;
  ts: number;
  /** Null while the meter is offline or did not report in this bucket. */
  gridPowerKw: number | null;
  /** Sum over cabinets, PCS AC (S1 total_active_power); + discharges. */
  batteryPowerKw: number | null;
}

export interface BackflowDay {
  rows: BackflowRow[];
  meterOnline: boolean | null;
  enabled: boolean | null;
  upperLimitKw: number | null;
  lowerLimitKw: number | null;
}

/** The point's newest value — the given cabinet's where it reported, else any. */
async function firstValue(gatewayId: string, pointId: string, sourceId?: string): Promise<number | null> {
  const rows = await fetchGeneral(gatewayId, { pointId, limit: 20 }).catch(() => [] as GeneralRecord[]);
  const latest = [...newestPerAsset(rows)].sort(([a], [b]) =>
    Number(!!sourceId && !a.startsWith(`${sourceId}_`)) - Number(!!sourceId && !b.startsWith(`${sourceId}_`)));
  for (const [, r] of latest) {
    const v = numeric(r);
    if (v !== null) return v;
  }
  return null;
}

export async function fetchBackflowDay(
  gatewayId: string, date: string, meterId?: string, sourceId?: string,
): Promise<BackflowDay> {
  const from = isoToMs(`${date}T00:00:00+05:30`);
  const to = Math.min(from + 86_400_000, Date.now());
  const [meters, fast, on, upper, lower] = await Promise.all([
    fetchBackflowMeters(gatewayId),
    from < to ? fetchRecentFast(gatewayId, undefined, [from, to]).catch(() => null) : Promise.resolve(null),
    firstValue(gatewayId, P_BACKFLOW_ON, sourceId),
    firstValue(gatewayId, P_BACKFLOW_UPPER, sourceId),
    firstValue(gatewayId, P_BACKFLOW_LOWER, sourceId),
  ]);
  const chosen = meters.filter((m) => !meterId || m.meterId === meterId);
  const meterOnline = chosen.length === 0 ? null : chosen.some((m) => m.online === true)
    ? true : chosen.every((m) => m.online === false) ? false : null;

  /* Grid power: S2 has no time filter, so this is whatever of the newest
     1,000 readings falls on the day — only read when a meter is talking. */
  const grid = new Map<number, number[]>();
  if (meterOnline) {
    const ids = new Set(chosen.filter((m) => m.online).map((m) => m.meterId));
    const rows = await fetchGeneral(gatewayId, { pointId: P_METER_POWER, limit: 1000 }).catch(() => [] as GeneralRecord[]);
    for (const r of rows) {
      const ts = Date.parse(r.sample_time_utc ?? "");
      const v = numeric(r);
      if (!r.asset_id || !ids.has(r.asset_id) || v === null || ts < from || ts >= to) continue;
      const k = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(v);
    }
  }

  const bat = new Map<number, number[]>();
  for (const p of fast?.points ?? []) {
    if (p.power == null) continue;
    const k = Math.floor(p.ts / BUCKET_MS) * BUCKET_MS;
    (bat.get(k) ?? bat.set(k, []).get(k)!).push(p.power);
  }

  const avg = (xs: number[] | undefined) => (xs?.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null);
  const keys = [...new Set([...grid.keys(), ...bat.keys()])].sort((a, b) => a - b);
  return {
    rows: keys.filter((k) => istDate(k) === date).map((k) => ({
      t: msToHm(k), ts: k, gridPowerKw: avg(grid.get(k)), batteryPowerKw: avg(bat.get(k)),
    })),
    meterOnline,
    enabled: on === null ? null : on === 1,
    upperLimitKw: upper,
    lowerLimitKw: lower,
  };
}
