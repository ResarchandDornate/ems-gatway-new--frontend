/**
 * Demo fixtures — a plausible UnityESS station, for design review only.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS IS NOT REAL DATA AND MUST NEVER REACH A CUSTOMER BUILD.
 *
 * It exists so the mobile design can be reviewed before UGX credentials are
 * available. Everything here is invented. It is reachable only from /m/demo,
 * every screen served from that path carries a permanent DEMO badge, and the
 * live routes at /m are untouched and still gated.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Shapes mirror the real hook return types exactly, so screens cannot tell the
 * difference and no screen needs a demo-specific branch.
 *
 * Every value is deterministic — no Math.random, no drift between renders.
 * The station is modelled on a 418 kWh / 250 kW cabinet on a Jaipur C&I site
 * with a Rajasthan ToD tariff: charge overnight, hold through the solar day,
 * discharge into the evening peak.
 */

import type { BessLiveData } from "@/hooks/useBessLive";
import type { Station, StationSummary, Alarm, CommDevice, AlarmStatistics } from "@/lib/api/types";

export const DEMO_CAPACITY_KWH = 418;
export const DEMO_RATED_KW = 250;

/* ── Stations ─────────────────────────────────────────────────────────────── */

export const demoStations: Station[] = [
  {
    id: "demo-jaipur-01",
    powerStationName: "Ornate Solar Jaipur",
    powerStationEnglishName: "Ornate Solar · Jaipur",
    hasBess: true,
    installedCapacity: DEMO_CAPACITY_KWH,
    installedPower: DEMO_RATED_KW,
    energyStorageCabinetNum: 1,
    matrixNum: 4,
    electricMeterId: "demo-meter-01",
    electricMeterNumber: "RJ-C&I-88214",
    operationTime: "2026-02-11",
    status: "online",
    tacticsLevel: 2,
    powerStationType: "commercial",
    stationLocation: "Sitapura, Rajasthan",
    accumulations: { totalCharge: 214_580, totalDischarge: 198_640 },
  } as Station,
  {
    id: "demo-pune-02",
    powerStationName: "Ornate Solar Pune",
    powerStationEnglishName: "Ornate Solar · Pune",
    hasBess: true,
    installedCapacity: 261,
    installedPower: 150,
    energyStorageCabinetNum: 1,
    matrixNum: 3,
    electricMeterId: "demo-meter-02",
    electricMeterNumber: "MH-C&I-40917",
    operationTime: "2026-05-03",
    status: "abnormal",
    tacticsLevel: 1,
    powerStationType: "commercial",
    stationLocation: "Chakan, Maharashtra",
    accumulations: { totalCharge: 61_240, totalDischarge: 55_910 },
  } as Station,
];

/* ── Live telemetry ───────────────────────────────────────────────────────── */

export const demoLive: BessLiveData = {
  /* Taken from the intraday curve at the point where SOC reads 64.2% —
     roughly 19.25h, mid evening-peak. The hero, the curve and the daily
     totals therefore all describe one consistent day. */
  battKw: 34.3,          // positive = discharging into the evening peak
  gridKw: 92.7,
  loadKw: 128.5,
  soc: 64.2,
  soh: 99.1,
  tempC: 28.4,
  maxCellTempC: 30.1,
  solarKw: null,         // no PV bound on this site — stays absent, not zeroed
  gridHz: 49.98,
  voltDC: 787.4,
  currA: 104.6,
  chargedKwh: 184.2,
  dischargedKwh: 171.8,
  totalChargedKwh: 214_580,
  totalDischargedKwh: 198_640,
  isLoading: false,
  isLive: true,
  lastTs: 0,             // replaced with a live-relative stamp by the provider
  isStale: false,
};

/* ── Summary ──────────────────────────────────────────────────────────────── */

export const demoSummary: StationSummary = {
  stationId: "demo-jaipur-01",
  stationName: "Ornate Solar · Jaipur",
  stationLocation: "Sitapura, Rajasthan",
  hasBess: true,
  installedKw: DEMO_RATED_KW,
  capacityKwh: DEMO_CAPACITY_KWH,
  totalChargeKwh: 214_580,
  totalDischargeKwh: 198_640,
  todayChargeKwh: 184.2,
  todayDischargeKwh: 171.8,
  totalRevenueInr: 1_284_600,
  yesterdayRevenueInr: 4_015,
  todayRevenueInr: 4_280,
  todayAlarms: 3,
  stationEfficiencyPct: 92.6,
  fileId: "",
};

/* ── Intraday curve ───────────────────────────────────────────────────────────
   96 points at 15-minute spacing. Power follows the tariff day; SOC is
   integrated from power rather than drawn independently, so the two series
   agree the way real telemetry does — SOC rises exactly while power is
   negative. A hand-drawn SOC curve is the usual tell in a fake dashboard. */

export interface DemoCurvePoint { t: string; power: number; soc: number | null; load: number }

/**
 * Power at a given hour, in kW. Positive discharges.
 *
 * Tuned so the day INTEGRATES to the headline totals: 184.2 kWh charged and
 * 171.8 kWh discharged. A curve that disagrees with the numbers printed above
 * it is the first thing an engineer notices, and it would undermine a demo in
 * front of a customer.
 */
function powerAt(hour: number): number {
  if (hour < 5.5)  return -28;                     // off-peak charge   154 kWh
  if (hour < 7)    return -20;                     // taper              30 kWh
  if (hour < 9.5)  return 2;                       // morning shoulder    5 kWh
  if (hour < 17)   return 1;                       // solar day, idle     7 kWh
  if (hour < 18)   return 25;                      // peak ramp          25 kWh
  if (hour < 22)   return 26 + Math.sin((hour - 18) / 4 * Math.PI) * 10;  // 130 kWh
  return 3;                                         // late evening        6 kWh
}

export function buildDemoCurve(): DemoCurvePoint[] {
  const pts: DemoCurvePoint[] = [];
  let soc = 41;   // start of day, post-discharge; the cycle returns it to ~44
  for (let i = 0; i < 96; i++) {
    const hour = i / 4;
    const power = Number(powerAt(hour).toFixed(1));
    // 15 min at `power` kW against the pack, as a percentage of capacity.
    soc -= (power * 0.25) / DEMO_CAPACITY_KWH * 100;
    soc = Math.max(8, Math.min(97, soc));
    const hh = String(Math.floor(hour)).padStart(2, "0");
    const mm = String((i % 4) * 15).padStart(2, "0");
    pts.push({
      t: `${hh}:${mm}`,
      power,
      soc: Number(soc.toFixed(1)),
      load: Number((96 + Math.sin(hour / 24 * Math.PI * 2) * 34).toFixed(1)),
    });
  }
  return pts;
}

/* ── Alarms ───────────────────────────────────────────────────────────────── */

/** Offsets in minutes from "now", so the list always reads as today. */
const ALARM_SEED: Array<Omit<Alarm, "alertTime"> & { agoMin: number }> = [
  {
    id: "d1", serial: 1, powerStationId: "demo-jaipur-01",
    powerStationName: "Ornate Solar · Jaipur",
    deviceName: "Chiller-1", deviceType: "Water Chiller",
    device: "1#Grid-1#Matrix-1# ESS Cabinet",
    alertContent: "Chiller high discharge pressure",
    alarmCode: "CHL-E02", alarmType: "failure", status: "active", agoMin: 42,
  },
  {
    id: "d2", serial: 2, powerStationId: "demo-jaipur-01",
    powerStationName: "Ornate Solar · Jaipur",
    deviceName: "BMS-1", deviceType: "BMS",
    device: "1#Grid-1#Matrix-2# ESS Cabinet",
    alertContent: "Cell voltage imbalance above threshold",
    alarmCode: "BMS-0x11", alarmType: "alarm", status: "active", agoMin: 168,
  },
  {
    id: "d3", serial: 3, powerStationId: "demo-jaipur-01",
    powerStationName: "Ornate Solar · Jaipur",
    deviceName: "PCS-2", deviceType: "PCS",
    device: "1#Grid-1#Matrix-3# ESS Cabinet",
    alertContent: "Communication link restored",
    alarmCode: "INF-004", alarmType: "inform", status: "resolved", agoMin: 322,
  },
  {
    id: "d4", serial: 4, powerStationId: "demo-jaipur-01",
    powerStationName: "Ornate Solar · Jaipur",
    deviceName: "PCS-1", deviceType: "PCS",
    device: "1#Grid-1#Matrix-1# ESS Cabinet",
    alertContent: "Active power derated — ambient temperature",
    alarmCode: "PCS-E07", alarmType: "alarm", status: "active", agoMin: 405,
  },
];

export function buildDemoAlarms(now: number): Alarm[] {
  return ALARM_SEED.map(({ agoMin, ...a }) => ({
    ...a,
    alertTime: new Date(now - agoMin * 60_000).toISOString(),
  }));
}

export const demoAlarmStats: AlarmStatistics = { failure: 1, alarm: 2, inform: 1, total: 4 };

/* ── Devices ──────────────────────────────────────────────────────────────── */

export const demoDevices: CommDevice[] = [
  { id: "d-bms1", kind: "bms", name: "BMS-1",     ip: null, port: null, protocol: "UnityESS_BMS", lastSeen: "", status: "online" },
  { id: "d-pcs1", kind: "pcs", name: "PCS-1",     ip: null, port: null, protocol: "UnityESS_PCS", lastSeen: "", status: "online" },
  { id: "d-pcs2", kind: "pcs", name: "PCS-2",     ip: null, port: null, protocol: "UnityESS_PCS", lastSeen: "", status: "online" },
  { id: "d-chl1", kind: "liquid_cooling", name: "Chiller-1", ip: null, port: null, protocol: "UnityESS_HVAC", lastSeen: "", status: "abnormal" },
  { id: "d-fps1", kind: "fire_protection", name: "FPS-1",     ip: null, port: null, protocol: "UnityESS_FPS", lastSeen: "", status: "online" },
  { id: "d-mtr1", kind: "grid_meter", name: "Meter-1",   ip: null, port: null, protocol: "UnityESS_MTR", lastSeen: "", status: "online" },
];
