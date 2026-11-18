"use client";

/**
 * The ESS cabinet views, on the central backend.
 *
 * ── PER-CELL DETAIL EXISTS NOW ─────────────────────────────────────────────
 *
 * The NorthBound adapter's header states flatly that it does not: "the gateway
 * exposes the battery as one aggregate bms_1", the /api/bms/* family 404s, and
 * "cluster and cell readers therefore return empty rather than fabricating a
 * rack". That was true of that backend and is not true of this one.
 *
 * `bms_extended` carries, per cabinet, 260 `cell_voltage_N` and 152
 * `battery_temperature_N` points alongside the cluster aggregates. So the cell
 * map can be drawn from measurements instead of the synthetic pack that used
 * to live on /scratch-cells.
 *
 * ── The two families are different lengths, and that is not a bug ──────────
 *
 * 260 voltages against 152 temperature probes: cells are monitored
 * individually for voltage and in groups for temperature. A cell above the
 * probe count gets `tempC: null` rather than a neighbour's reading — borrowing
 * one would invent a measurement, and a thermal map is exactly where that
 * would mislead.
 *
 * ── Ids carry their source ─────────────────────────────────────────────────
 *
 * The hooks pass an id and a station, and the station is now the site, so the
 * id is the only thing that can say which cabinet. They are therefore
 * asset-shaped — `external_ems_1`, `external_ems_1_bms` — and the source is
 * read back off the front rather than looked up.
 */

import {
  fetchGeneral, fetchFastBess, fetchGatewayHealth, numeric,
  type GeneralRecord, type FastBessSample,
} from "@/lib/central";
import { overlayFor } from "../overlay/stations";
import { signedTemp, fetchEquipmentReadings, STATE_FROM_POWER_KW } from "./equipmentReadings.service";
import type {
  CellData, ClusterData, CabinetDetail, BmsData, PcsData,
  BmsSubDevice, PcsSubDevice, WaterChillerData, FireProtectionData,
} from "../types";

/** `external_ems_1_bms_cluster` → `external_ems_1`. */
export function sourceOf(id: string): string {
  /* external_ems_1 (old backend) or pair_1 (site-scoped backend), with or
     without a role suffix: external_ems_1_bms_cluster → external_ems_1. */
  const m = /^((?:[a-z]+_)*?[a-z]+_\d+)(?=_|$)/.exec(id);
  return m ? m[1] : "";
}

async function substreamPoints(
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

/* One cabinet's BMS is ~726 points; the substream is ~1,450 a snapshot for
   two cabinets against a 1,000-row read, so a single read can miss a
   cabinet's cell voltages entirely. fetchGeneral merges successive reads, so
   read until this cabinet is all there, three times at most — and stop when
   a read adds nothing: a stalled stream answers the same 1,000 rows every
   time (1 Oct, 12:18 onwards: BESS 1's cell voltages were never among them),
   and no number of repeats reaches past them. */
const BMS_POINTS_FULL = 700;

async function bmsPoints(gatewayId: string, sourceId: string): Promise<Map<string, GeneralRecord>> {
  const asset = `${sourceId}_bms`;
  let out = new Map<string, GeneralRecord>();
  for (let i = 0, before = -1; i < 3 && out.size < BMS_POINTS_FULL && out.size > before; i++) {
    before = out.size;
    const rows = await fetchGeneral(gatewayId, { substream: "bms_extended", limit: 1000 })
      .catch(() => [] as GeneralRecord[]);
    out = new Map();
    for (const r of rows) {
      if (r.asset_id !== asset || !r.signal) continue;
      if (!out.has(r.signal)) out.set(r.signal, r);   // newest first
    }
  }
  return out;
}

/* Temperatures are signed 16-bit registers that arrive unsigned: a −0.1 °C
   reads 6553.5 — see signedTemp. */
const isTemp = (k: string) => /temperature/.test(k);

const num = (m: Map<string, GeneralRecord>, k: string): number | null => {
  const r = m.get(k);
  const v = r ? numeric(r) : null;
  return isTemp(k) ? signedTemp(v) : v;
};

async function s1For(gatewayId: string, sourceId: string): Promise<FastBessSample | undefined> {
  const rows = await fetchFastBess(gatewayId, { limit: 20 }).catch(() => []);
  return rows.find((r) => r.source_id === sourceId);
}

const pcsVal = (s: FastBessSample | undefined, k: string): number | null => {
  const v = s?.data?.pcs_values?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const bmsVal = (s: FastBessSample | undefined, k: string): number | null => {
  const v = s?.data?.bms_values?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/**
 * DC current, A, − charging: the BMS's cluster_total_current, not the PCS's
 * S1 dc_current.
 *
 * Checked over 18 min of S1 per cabinet (9 Oct 2026), against AC ÷ DC volts:
 * dc_current moves in step with the AC power (r ≈ 0.75) but is not to size —
 * slope ~0.7 with a +1–3 A offset, different charging and discharging, not
 * even monotonic (−4 A expected read +2.8 A) — and averaged about a third of
 * it. No factor corrects that. cluster_total_current averages to AC ÷ V
 * (−3.6 against −3.2 A, −6.9 against −7.1 A) and agrees with the BMS's
 * independent hall sensor; its one fault is arriving ~12 s out of step with
 * the PCS fields in the same S1 sample, so on a load that swings within
 * seconds it can briefly disagree in sign with the AC power. Measured and
 * late beats prompt and wrong. DC power is likewise the PCS's dc_power register (p0098),
 * the figure the PCS tab shows, not V × dc_current — and not
 * charge_discharge_power, which reads 0 on both cabinets while the PCS moves
 * ±20 kW (1 Oct 2026).
 */
const dcCurrent = (s: FastBessSample | undefined): number | null => bmsVal(s, "cluster_total_current");

/**
 * A BMS figure, S1 first and bms_extended second.
 *
 * Most of the cluster aggregates — cell_max/min_voltage, battery_max/min
 * temperature, average_temperature, cluster_total_current/voltage, soh,
 * charge_discharge_status — are published ONLY on S1. bms_extended carries the
 * per-cell voltages, the extreme-cell ids, cell_average_voltage and the energy
 * counters, and none of the above. Reading them off `pts` alone, as this file
 * did, answered null for every one of them on every poll.
 */
const bmsNum = (
  pts: Map<string, GeneralRecord>, s1: FastBessSample | undefined, k: string,
): number | null => {
  const v = bmsVal(s1, k);
  return v != null ? (isTemp(k) ? signedTemp(v) : v) : num(pts, k);
};

/** `v` when it lies within [lo, hi] (or either bound is unknown), else null. */
const between = (v: number | null, lo: number | null, hi: number | null): number | null =>
  v == null || (lo != null && v < lo) || (hi != null && v > hi) ? null : v;

/* ── Cells ────────────────────────────────────────────────────────────────── */

/* The last cell voltages read per cabinet, kept in the browser. When the S2
   stream stalls, the newest 1,000 rows can hold none of a cabinet's cell
   voltages for hours (1 Oct from 12:18: BESS 1's were never among them), and
   the pack diagrams vanished. The last known snapshot is served instead,
   stamped with its sample time so the screen can say how old it is. */
const LAST_CELLS_KEY = (gatewayId: string, sourceId: string) => `ems.lastCells.${gatewayId}.${sourceId}`;

function saveLastCells(gatewayId: string, sourceId: string, cells: CellData[]): void {
  try { localStorage.setItem(LAST_CELLS_KEY(gatewayId, sourceId), JSON.stringify(cells)); } catch { /* best effort */ }
}

function loadLastCells(gatewayId: string, sourceId: string): CellData[] {
  try {
    const raw = localStorage.getItem(LAST_CELLS_KEY(gatewayId, sourceId));
    const cells = raw ? (JSON.parse(raw) as CellData[]) : [];
    return Array.isArray(cells) ? cells : [];
  } catch { return []; }
}

export async function fetchCellData(rackId: string, gatewayId: string): Promise<CellData[]> {
  const sourceId = sourceOf(rackId);
  if (!gatewayId || !sourceId) return [];
  const fresh = await readCellData(gatewayId, sourceId);
  const last = loadLastCells(gatewayId, sourceId);
  /* A stalled read can be partial (BESS 2: 99 of 260 on 1 Oct), so cells it
     missed keep their last-known reading — each with its own sample time —
     rather than a partial read replacing a whole snapshot. */
  const freshIds = new Set(fresh.map((c) => c.cellId));
  const merged = [...fresh, ...last.filter((c) => !freshIds.has(c.cellId))]
    .sort((a, b) => cellNo(a) - cellNo(b));
  if (fresh.length) saveLastCells(gatewayId, sourceId, merged);
  return merged;
}

const cellNo = (c: CellData) => Number(/(\d+)$/.exec(c.cellId)?.[1] ?? 0);

async function readCellData(gatewayId: string, sourceId: string): Promise<CellData[]> {
  const pts = await bmsPoints(gatewayId, sourceId);

  const volts = new Map<number, number>();
  const temps = new Map<number, number>();
  let newest: string | null = null;
  for (const [sig, r] of pts) {
    let m = /^cell_voltage_(\d+)$/.exec(sig);
    if (m) {
      const v = numeric(r);
      if (v !== null) volts.set(Number(m[1]), v);
      if (r.sample_time_utc && (!newest || r.sample_time_utc > newest)) newest = r.sample_time_utc;
      continue;
    }
    m = /^battery_temperature_(\d+)$/.exec(sig);
    if (m) { const v = signedTemp(numeric(r)); if (v !== null) temps.set(Number(m[1]), v); }
  }
  if (volts.size === 0) return [];

  /* This build has 260 cells and 160 temperature probes (5 packs × 52 cells,
     5 × 32 probes), so probe N is not on cell N and nothing published says
     which cell a probe sits on. Pairing them by number would paint probe 160's
     reading onto cell 160. Until the BMS vendor supplies the probe layout,
     temperatures attach only when there is one probe per cell. */
  const onePerCell = temps.size === volts.size;

  return [...volts.keys()].sort((a, b) => a - b).map((n) => ({
    cellId: `${sourceId}_cell_${n}`,
    name: `Cell ${n}`,
    voltMv: volts.get(n) ?? null,
    /* null, not a neighbour's reading — see the header. */
    tempC: onePerCell ? (temps.get(n) ?? null) : null,
    /* The firmware mirrors cluster SOC into every cell register, so there is
       no per-cell measurement to show. Unchanged from the previous backend. */
    socPct: null,
    sampleTime: newest,
  }));
}

/* ── Temperature probes ───────────────────────────────────────────────────── */

export interface ProbeReading {
  /** 1-based probe number as the BMS publishes it (battery_temperature_N). */
  probe: number;
  tempC: number;
}

export interface ProbeTemps {
  probes: ProbeReading[];
  /** Newest sample time among the probes read, ISO. */
  sampleTime: string | null;
}

/**
 * The BMS's per-probe temperatures, battery_temperature_1..160, for one cabinet.
 *
 * Shown as their own map rather than on the cells: 160 probes for 260 cells,
 * and nothing published says which cell a probe sits on (see fetchCellData).
 *
 * Read through bmsPoints, which gathers the whole cabinet over up to three
 * merged reads.
 */
export async function fetchProbeTemps(sourceId: string, gatewayId: string): Promise<ProbeTemps> {
  if (!gatewayId || !sourceId) return { probes: [], sampleTime: null };
  const pts = await bmsPoints(gatewayId, sourceId);
  const by = new Map<number, ProbeReading>();
  let newest: string | null = null;
  let base: number | null = null;
  const take = (r: GeneralRecord) => {
    const m = /^battery_temperature_(\d+)$/.exec(r.signal ?? "");
    if (!m) return;
    const n = Number(m[1]);
    const pid = Number((r.point_id ?? "").slice(1));
    if (base === null && Number.isFinite(pid) && pid > n) base = pid - n;
    const v = signedTemp(numeric(r));
    if (v === null || by.has(n)) return;             // newest first
    by.set(n, { probe: n, tempC: v });
    if (r.sample_time_utc && (!newest || r.sample_time_utc > newest)) newest = r.sample_time_utc;
  };
  for (const r of pts.values()) take(r);

  /* The snapshot reads rarely hold every probe. The gateway sends the full
     ~725-point BMS snapshot about every 30 s and smaller batches between, and
     a 1,000-row read covers a few seconds of uploads — so most reads land
     between snapshots and see only some probes (56 of 160 on a fresh load,
     6 Oct 2026). A point read is not buried by later uploads, so whatever is
     missing is read probe by probe. */
  const missing = Array.from({ length: PROBE_COUNT }, (_, i) => i + 1).filter((n) => !by.has(n));
  const pointBase = base ?? PROBE_POINT_BASE;
  const asset = `${sourceId}_bms`;
  for (let i = 0; i < missing.length; i += PROBE_READ_CONCURRENCY) {
    const batch = missing.slice(i, i + PROBE_READ_CONCURRENCY);
    const reads = await Promise.all(batch.map((n) =>
      fetchGeneral(gatewayId, { pointId: `p${String(pointBase + n).padStart(4, "0")}`, limit: 4 })
        .catch(() => [] as GeneralRecord[])));
    for (const rows of reads) for (const r of rows) if (r.asset_id === asset) take(r);
  }

  return { probes: [...by.values()].sort((a, b) => a.probe - b.probe), sampleTime: newest };
}

/* battery_temperature_N is point p(741 + N) on both cabinets of this build
   (p0742 … p0901). Learnt from any probe a snapshot read did return; the
   constant is the fallback when none did. */
const PROBE_COUNT = 160;
const PROBE_POINT_BASE = 741;
const PROBE_READ_CONCURRENCY = 10;

/* ── Cluster ──────────────────────────────────────────────────────────────── */

export async function fetchClusterData(pileId: string, gatewayId: string): Promise<ClusterData[]> {
  const sourceId = sourceOf(pileId);
  if (!gatewayId || !sourceId) return [];

  const [pts, s1] = await Promise.all([bmsPoints(gatewayId, sourceId), s1For(gatewayId, sourceId)]);
  if (pts.size === 0) return [];

  return [{
    rackId: `${sourceId}_bms_cluster`,
    name: "Cluster 1",
    voltage: bmsNum(pts, s1, "cluster_total_voltage_collected") ?? num(pts, "k_total_voltage"),
    current: bmsNum(pts, s1, "cluster_total_current") ?? num(pts, "shunt_sampling_current"),
    soc: num(pts, "cluster_internal_soc") ?? bmsVal(s1, "display_soc"),
    maxCellTemp: bmsNum(pts, s1, "battery_max_temperature"),
    minCellTemp: bmsNum(pts, s1, "battery_min_temperature"),
    maxCellVolt: bmsNum(pts, s1, "cell_max_voltage"),
    minCellVolt: bmsNum(pts, s1, "cell_min_voltage"),
    soh: bmsNum(pts, s1, "soh"),
    maxVoltCellNo: num(pts, "cell_max_voltage_id"),
    minVoltCellNo: num(pts, "cell_min_voltage_id"),
    maxTempProbeNo: num(pts, "battery_max_temperature_id"),
    minTempProbeNo: num(pts, "battery_min_temperature_id"),
    /* The backend states no rack status register; "unknown" rather than a
       cheerful "normal" that nothing measured. */
    status: "unknown",
  }];
}

/* ── BMS ──────────────────────────────────────────────────────────────────── */

/*
  1 = DISCHARGING, 2 = CHARGING. This read 1 = charging, 2 = discharging, which
  is the wrong way round: the NorthBound adapter decoded it 1/2 = discharge/
  charge, equipmentReadings.service does the same, and the live S1 sample
  agrees with them — the cabinet reporting 1 has its PCS DC current positive
  (out of the battery), the one reporting 2 has it negative. 3 was mapped to
  "shutdown" on no evidence and is dropped; an undocumented code is "unknown".
*/
const CHARGE_STATE: Record<number, BmsData["systemStatus"]> = {
  0: "standby", 1: "discharging", 2: "charging",
};

export async function fetchBmsData(pileId: string, gatewayId: string): Promise<BmsData> {
  const sourceId = sourceOf(pileId);
  const [pts, s1] = await Promise.all([
    bmsPoints(gatewayId, sourceId),
    s1For(gatewayId, sourceId),
  ]);

  const cds = bmsNum(pts, s1, "charge_discharge_status");
  const stamp = Date.parse(s1?.sample_time_utc ?? "");

  return {
    pileId,
    label: `${sourceId} · BMS`,
    telemetryTs: Number.isNaN(stamp) ? null : stamp,
    systemStatus: cds !== null ? (CHARGE_STATE[cds] ?? "unknown") : "unknown",
    totalVoltageV: bmsNum(pts, s1, "cluster_total_voltage_collected") ?? num(pts, "k_total_voltage"),
    totalCurrentA: bmsNum(pts, s1, "cluster_total_current"),
    totalPowerKw: pcsVal(s1, "total_active_power"),
    maxTempC: bmsNum(pts, s1, "battery_max_temperature"),
    socPct: bmsVal(s1, "display_soc") ?? num(pts, "cluster_internal_soc"),
    maxCellTempC: bmsNum(pts, s1, "battery_max_temperature"),
    minCellTempC: bmsNum(pts, s1, "battery_min_temperature"),
    maxCellVoltageM: bmsNum(pts, s1, "cell_max_voltage"),
    minCellVoltageMv: bmsNum(pts, s1, "cell_min_voltage"),
    sohPct: bmsNum(pts, s1, "soh"),
    /* cell_average_voltage is S2's, a snapshot behind the S1 extremes beside
       it, and on a moving pack it fell outside them (3354 against 3359–3364).
       Shown only where it sits between them. */
    avgCellVoltageMv: between(num(pts, "cell_average_voltage"),
      bmsNum(pts, s1, "cell_min_voltage"), bmsNum(pts, s1, "cell_max_voltage")),
    avgCellTempC: bmsNum(pts, s1, "average_temperature"),
    maxVoltCellNo: num(pts, "cell_max_voltage_id"),
    minVoltCellNo: num(pts, "cell_min_voltage_id"),
    maxTempProbeNo: num(pts, "battery_max_temperature_id"),
    minTempProbeNo: num(pts, "battery_min_temperature_id"),
  };
}

/* ── PCS ──────────────────────────────────────────────────────────────────── */

export async function fetchPcsData(cabinetId: string, gatewayId: string): Promise<PcsData> {
  const sourceId = sourceOf(cabinetId);
  /* S1 carries no reactive power (checked against the live key set, 1 Oct
     2026); S2 pcs_extended has it as p0188 total_reactive_power. */
  const [s1, pcsPts] = await Promise.all([
    s1For(gatewayId, sourceId),
    substreamPoints(gatewayId, sourceId, "pcs_extended", "pcs"),
  ]);

  const running = pcsVal(s1, "running_status_2") ?? pcsVal(s1, "fault_status");
  return {
    cabinetId,
    activePowerKw: pcsVal(s1, "total_active_power"),
    reactivePowerKvar: pcsVal(s1, "total_reactive_power") ?? num(pcsPts, "total_reactive_power"),
    acVoltageV: pcsVal(s1, "phase_a_voltage"),
    acCurrentA: pcsVal(s1, "phase_a_current"),
    dcVoltageV: pcsVal(s1, "dc_voltage"),
    dcCurrentA: dcCurrent(s1),
    dcPowerKw: num(pcsPts, "dc_power"),
    frequency: pcsVal(s1, "grid_frequency"),
    /* No efficiency register on any asset. Null, never a computed ratio of two
       figures that were not measured for that purpose. */
    efficiency: null,
    socPct: pcsVal(s1, "soc"),
    temperature: null,
    runState: running === null ? "unknown" : running === 0 ? "stopped" : "running",
  };
}

/* ── Cabinet ──────────────────────────────────────────────────────────────── */

/** The source's own liveness, from gateway health. Null when health is silent. */
async function sourceOnline(gatewayId: string, sourceId: string): Promise<boolean | null> {
  const rows = await fetchGatewayHealth(gatewayId, 1).catch(() => []);
  const src = rows[0]?.data?.health?.sources?.find((s) => s.source_id === sourceId);
  return typeof src?.online === "boolean" ? src.online : null;
}

/* |kW| at and above which the state follows the sign of its power: STATE_FROM_POWER_KW,
   shared with the BMS card (equipmentReadings) so the two never disagree. */

export async function fetchCabinetDetail(cabinetId: string, gatewayId: string): Promise<CabinetDetail> {
  const sourceId = sourceOf(cabinetId);
  const [s1, edge] = await Promise.all([
    s1For(gatewayId, sourceId),
    sourceOnline(gatewayId, sourceId),
  ]);

  const pcsOnline = pcsVal(s1, "pcs_online_status");
  const bmsOnline = pcsVal(s1, "bms_online_status");
  const power = pcsVal(s1, "total_active_power");
  /* The BMS's own charge/discharge register first — at a few kW the sign of
     the AC power flips on noise and the register does not. The power sign is
     the fallback for a sample that lacks it (negative = charging). */
  const cds = bmsVal(s1, "charge_discharge_status");
  /* Past a couple of kW the power's sign is not noise, and the label must
     agree with the signed figure beside it (13 Oct 2026: "Standby" over
     +25.7 kW while SOC fell — the register lags the PCS in the same sample). */
  const state: CabinetDetail["operationInfo"]["chargeDischargeStatus"] =
    power !== null && Math.abs(power) >= STATE_FROM_POWER_KW ? (power > 0 ? "discharging" : "charging")
    : cds === 1 ? "discharging" : cds === 2 ? "charging" : cds === 0 ? "standby"
    : power === null ? "shutdown" : power > 0.1 ? "discharging" : power < -0.1 ? "charging" : "standby";

  const flag = (v: number | null): "normal" | "abnormal" | "offline" =>
    v === null ? "offline" : v === 1 ? "normal" : "abnormal";

  const soc = bmsVal(s1, "display_soc") ?? pcsVal(s1, "soc");
  /* Stored energy is SOC x rated capacity, and the rated capacity is a
     commissioning fact, not telemetry — no register on any asset carries one.
     It is read from the station overlay, where it is deliberately unset until
     somebody copies it from the commissioning documents; until then this is
     null and the tile shows a dash rather than a guess. */
  const ratedKwh = overlayFor(sourceId).installedCapacity || null;

  return {
    cabinetId,
    label: `${sourceId} · Cabinet`,
    commStatus: {
      /* The EMS controller IS the edge controller, and gateway health states
         per source whether it is talking. S1 being present is the fallback
         when health does not answer. */
      edgeController: edge === null ? (s1 ? "normal" : "offline") : edge ? "normal" : "offline",
      pcs: flag(pcsOnline),
      bms: flag(bmsOnline),
    },
    operationInfo: {
      chargeDischargeStatus: state,
      realtimePowerKw: power,
      socPct: soc,
      realtimeCapacityKwh: soc !== null && ratedKwh !== null ? (soc / 100) * ratedKwh : null,
    },
    /* The ESS Cabinet tab draws its chiller block from the Chiller tab's
       readings (fetchEquipmentReadings) rather than from here: a separate
       newest-1,000-rows read of liquid_cooling often held none of BESS 1's
       points (every figure "—") and could catch BESS 2's mode word at a
       different instant than the Chiller tab beside it. */
    waterChillers: [],
  };
}
/* ── Sub-device monitoring ────────────────────────────────────────────────── */

/**
 * The four sub-device panels.
 *
 * Everything here is a register that exists, with one documented exception —
 * pump speed on the chiller, which no asset publishes. (Ambient is the
 * unit's outdoor_temperature probe, p1169.)
 * Where a panel wants an identifier rather than a measurement (which cell holds
 * the extreme) the backend supplies one: cell_max_voltage_id and its siblings.
 */

const idStr = (m: Map<string, GeneralRecord>, k: string): string => {
  const v = num(m, k);
  return v === null ? "—" : String(Math.round(v));
};

function pcsStatusWord(v: number | null): string {
  if (v === null) return "unknown";
  return v === 0 ? "stopped" : v === 2 ? "running" : `code ${v}`;
}

export async function fetchBmsSubDeviceList(
  sourceIdOrCabinet: string, gatewayId: string,
): Promise<BmsSubDevice[]> {
  const sourceId = sourceOf(sourceIdOrCabinet);
  if (!gatewayId || !sourceId) return [];

  const [pts, s1] = await Promise.all([bmsPoints(gatewayId, sourceId), s1For(gatewayId, sourceId)]);
  if (pts.size === 0) return [];

  const cds = bmsNum(pts, s1, "charge_discharge_status");
  const z = (v: number | null) => v ?? 0;

  return [{
    cabinetPath: `${sourceId} · BMS`,
    cabinetId: sourceId,
    pileId: `${sourceId}_bms`,
    /* No rack status register exists; a fault bit being set is what "abnormal"
       can honestly mean here, and none are. */
    status: "normal",
    systemStatus: cds !== null ? (CHARGE_STATE[cds] ?? "unknown") : "unknown",
    totalVoltageV: bmsNum(pts, s1, "cluster_total_voltage_collected") ?? num(pts, "k_total_voltage"),
    totalCurrentA: z(bmsNum(pts, s1, "cluster_total_current")),
    totalPowerKw: z(pcsVal(s1, "total_active_power")),
    maxTempDiffC: z(num(pts, "max_min_temperature_diff")),
    maxCellVoltageDiffMv: z(bmsNum(pts, s1, "max_min_cell_voltage_diff")),
    socPct: z(bmsVal(s1, "display_soc") ?? num(pts, "cluster_internal_soc")),
    maxCellTempC: z(bmsNum(pts, s1, "battery_max_temperature")),
    maxTempCellId: idStr(pts, "battery_max_temperature_id"),
    minCellTempC: z(bmsNum(pts, s1, "battery_min_temperature")),
    minTempCellId: idStr(pts, "battery_min_temperature_id"),
    maxCellVoltageMv: z(bmsNum(pts, s1, "cell_max_voltage")),
    maxCellVoltageId: idStr(pts, "cell_max_voltage_id"),
    minCellVoltageMv: z(bmsNum(pts, s1, "cell_min_voltage")),
    minCellVoltageId: idStr(pts, "cell_min_voltage_id"),
    /* The firmware mirrors cluster SOC into every cell register, so there is no
       per-cell extreme to report. Null, and the panel shows a dash. */
    maxCellSocPct: null, maxSocCellId: "—",
    minCellSocPct: null, minSocCellId: "—",
  }];
}

export async function fetchPcsSubDeviceList(
  sourceIdOrCabinet: string, gatewayId: string,
): Promise<PcsSubDevice[]> {
  const sourceId = sourceOf(sourceIdOrCabinet);
  if (!gatewayId || !sourceId) return [];

  const [pts, s1] = await Promise.all([
    substreamPoints(gatewayId, sourceId, "pcs_extended", "pcs"),
    s1For(gatewayId, sourceId),
  ]);
  if (pts.size === 0) return [];

  return [{
    cabinetPath: `${sourceId} · PCS`,
    cabinetId: sourceId,
    pileId: `${sourceId}_pcs`,
    status: (pcsVal(s1, "total_fault_status") ?? 0) === 0 ? "normal" : "abnormal",
    pcsOperationStatus: pcsStatusWord(num(pts, "pcs_running_status") ?? num(pts, "running_status")),
    pcsOperationMode: pcsVal(s1, "on_grid_status") === 1 ? "on-grid"
      : pcsVal(s1, "off_grid_status") === 1 ? "off-grid" : "unknown",
    /* No contactor register on this asset. Stated as unknown, not closed. */
    dcContactorStatus: "unknown",
    acContactorStatus: "unknown",
    ambientTempC: num(pts, "air_inlet_temperature"),
    cabinetTempC: num(pts, "cavity_temperature"),
    igbtATempC: num(pts, "phase_a_temperature"),
    igbtBTempC: num(pts, "phase_b_temperature"),
    igbtCTempC: num(pts, "phase_c_temperature"),
    dcVoltageV: pcsVal(s1, "dc_voltage"),
    dcCurrentA: dcCurrent(s1),
    dcPowerKw: num(pts, "dc_power"),
    abLineVoltageV: num(pts, "ab_line_voltage"),
    bcLineVoltageV: num(pts, "bc_line_voltage"),
    acLineVoltageV: num(pts, "ca_line_voltage"),
    phaseACurrentA: pcsVal(s1, "phase_a_current"),
    phaseBCurrentA: pcsVal(s1, "phase_b_current"),
    phaseCCurrentA: pcsVal(s1, "phase_c_current"),
    activePowerKw: pcsVal(s1, "total_active_power"),
    reactivePowerKvar: num(pts, "total_reactive_power"),
    apparentPowerKva: num(pts, "total_apparent_power"),
    powerFactor: num(pts, "total_power_factor"),
  }];
}

export async function fetchWaterChillerData(
  sourceIdOrCabinet: string, gatewayId: string,
): Promise<WaterChillerData[]> {
  const sourceId = sourceOf(sourceIdOrCabinet);
  if (!gatewayId || !sourceId) return [];

  /* Same snapshot and decode as the Chiller tab — see fetchCabinetDetail. */
  const rd = await fetchEquipmentReadings(gatewayId, sourceId).catch(() => null);
  if (!rd || !rd.assets.includes("liquid_cooling")) return [];
  const C = rd.chiller;

  return [{
    cabinetId: sourceId,
    cabinetName: `${sourceId} · Liquid cooling`,
    status: "normal",
    tmsWorkingStatus: C.workMode === "—" ? "unknown" : C.workMode,
    outletWaterTempC: C.outletTempC,
    returnWaterTempC: C.inletTempC,
    ambientTempC: C.outdoorTempC,
    returnWaterPressureBar: C.inletPressureBar,
    supplyWaterPressureBar: C.outletPressureBar,
    compressorSpeedRpm: C.compressorAHz,
    waterPumpSpeedRpm: null,
  }];
}

export async function fetchFireProtectionData(
  sourceIdOrCabinet: string, gatewayId: string,
): Promise<FireProtectionData[]> {
  const sourceId = sourceOf(sourceIdOrCabinet);
  if (!gatewayId || !sourceId) return [];

  const fire = await substreamPoints(gatewayId, sourceId, "fire_protection", "fire_protection");
  if (fire.size === 0) return [];

  /* Every point on this substream is a fault_alarm flag. "abnormal" means one
     of them is raised — the comms flag excluded, where 1 means healthy. */
  let raised = false;
  for (const [sig, r] of fire) {
    if (sig === "communication_status") continue;
    const v = numeric(r);
    if (v !== null && v !== 0 && !/_value$/.test(sig)) raised = true;
  }

  return [{
    cabinetId: sourceId,
    cabinetName: `${sourceId} · Fire protection`,
    status: raised ? "abnormal" : "normal",
  }];
}
