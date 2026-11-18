import type { SiteAsset } from "@/lib/energy/topology";
// ─── Shared primitives ────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  code: number;       // 200 = success
  message: string;
  data: T;
}

export interface PagedData<T> {
  records: T[];
  total: number;
  size: number;
  current: number;
  pages: number;
}

// ─── Station ─────────────────────────────────────────────────────────────────

export type StationStatus = "online" | "offline" | "abnormal";
export type StationType   = "industrial" | "utility" | "commercial" | "hospital";

export interface Station {
  /**
   * The SITE, not a source.
   *
   * Changed 25 Sep 2026. A station used to be one `source_id` — one EMS
   * controller and the BESS behind it — which made the commissioned plant
   * render as two stations when it is one site with two cabinets. The id is
   * now the gateway's, because that is the only site-level identifier the
   * backend has: there is no /sites endpoint and no site entity.
   *
   * Anything that needs a source reads `sourceIds`, or the selected unit's
   * `sourceId` from UnitContext.
   */
  id: string;
  /** Organisation that owns the site. Written in the overlay: the backend has
   *  no organisation entity. */
  organisation?: string;
  /** The gateway serving this site. Today it is also `id` — one gateway is one
   *  site until the backend can list sites — but it is its own level in the
   *  organisation → site → gateway → BESS unit hierarchy. */
  gatewayId?: string;
  /** Shown in place of the gateway UUID: the overlay's name, else the S1 profile_name. */
  gatewayName?: string;
  /** What the site has — load, BESS, PV, grid, DG. Decides which of the five
   *  single-line configurations the energy twin draws. From the overlay. */
  assets?: SiteAsset[];
  /** The EMS controllers under this site, in the gateway's order. */
  sourceIds: string[];
  powerStationName: string;
  powerStationEnglishName: string;
  hasBess: boolean;               // true only when a UnityESS cabinet is installed
  installedCapacity: number;      // kWh — varies by unit count; do NOT use as hasBess proxy
  installedPower: number;         // kW
  energyStorageCabinetNum: number;
  matrixNum: number;
  electricMeterId: string;
  electricMeterNumber: string;
  operationTime: string;          // ISO date
  status: StationStatus;
  tacticsLevel: number;
  powerStationType: StationType;
  stationLocation: string;
  accumulations: {
    totalCharge: number;          // kWh lifetime
    totalDischarge: number;       // kWh lifetime
    totalRevenue: number;         // INR
  };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface GroupHomepageData {
  installedCapacityMw: number;
  installedEnergyMwh: number;
  stationCount: number;
  cabinetCount: number;
  chargingCapacityGwh: number;
  dischargeCapacityGwh: number;
  cumulativeRevenueInr: number;
  topByRevenue: Array<{
    id: string;
    name: string;
    location: string;
    totalRevenue: number;
  }>;
  stationEfficiency: Array<{
    name: string;
    efficiencyPct: number;
  }>;
  monthlyRevenue: Array<{ month: string; revenue: number }>;
  capacityMonthly: Array<{ month: string; charge: number; discharge: number }>;
  peakValley: Array<{ region: string; diffInr: number }>;
}

export interface StationOverview {
  powerStationId: string;
  powerStationName: string;
  stationLocation: string;
  installedKw: number;
  capacityKwh: number;
  safeRunDays: number;
  totalRevenue: number;
  lastMonthRevenue: number;
  thisMonthRevenue: number;
  chargeCapacityMonth: number;
  dischargeCapacityMonth: number;
  fileId: string;                 // Station photo fileId
  alarms: { failure: number; alarm: number; inform: number };
  cabinets: CabinetRealtimeData[];
}

export interface SocPowerPoint {
  t: string;       // "HH:mm"
  power: number;   // kW (positive = discharge, negative = charge)
  soc: number;     // %
}

export interface CabinetRealtimeData {
  id: string;
  label: string;
  cluster: string;
  realtimePowerKw: number;
  socPct: number;
}

export interface DailyRevenue {
  date: string;
  revenue: number;
}

export interface DailyChargeDischarge {
  date: string;
  charge: number;
  discharge: number;
}

// ─── Alarms ───────────────────────────────────────────────────────────────────

export type AlarmType   = "failure" | "alarm" | "inform";
export type AlarmStatus = "active" | "acknowledged" | "resolved";

export interface Alarm {
  id: string;
  serial: number;
  powerStationId: string;
  powerStationName: string;
  deviceName: string;
  deviceType: string;   // e.g. "BMS", "PCS", "Water Chiller", "Fire Protection"
  device: string;       // full path e.g. "1#Grid-1#Matrix-1# ESS Cabinet"
  alertContent: string;
  alarmCode: string;    // e.g. "BMS-0x01", "PCS-E01"
  alarmType: AlarmType;
  alertTime: string;    // ISO datetime
  status: AlarmStatus;
}

export interface AlarmStatistics {
  failure: number;
  alarm: number;
  inform: number;
  total: number;
}

export interface AlarmFilters {
  powerStationId?: string;
  deviceName?: string;
  deviceType?: string;
  alarmStatus?: AlarmStatus | "";
  startTime?: string;
  endTime?: string;
  page?: number;
  size?: number;
  /** Cabinets (source ids) the unit picker has selected; empty/absent = all. */
  sourceIds?: string[];
}

// ─── Devices (UGX Section 3) ─────────────────────────────────────────────────

export type DeviceActiveStatus = "active" | "inactive";

export interface Device {
  id: string;                 // UGX id.id
  name: string;               // e.g. "GXORN00021"
  type: string;               // device profile type
  active: boolean;
  status: DeviceActiveStatus; // derived: active → "active"
  ownerName: string;
  customerId: string;         // parent customer UUID
  deviceProfileId: string;
  version: number;
}

// ─── Equipment ───────────────────────────────────────────────────────────────

export interface DeviceTreeNode {
  id: string;
  name: string;
  type: "Grid" | "Matrix" | "Cabinet" | "Pile" | "Rack" | "Cell";
  status: "normal" | "abnormal";
  isDevice: boolean;
  subDevice: DeviceTreeNode[];
}

/**
 * Every reading nullable, as elsewhere in this file. Two of these have no
 * register on any asset — ambient temperature and pump speed — so they are
 * permanently null rather than 0, which on a thermal panel would read as a
 * stopped pump in a freezing room.
 */
export interface WaterChillerInfo {
  /** The unit's decoded mode word (Self-Circulation, Cooling, …) on the
   *  central backend; the three literals are the older adapters' values. */
  tmsStatus: "auto" | "manual" | "off" | (string & {});
  outletTempC: number | null;
  inletTempC: number | null;
  ambientTempC: number | null;
  inletPressureBar: number | null;
  outletPressureBar: number | null;
  compressorSpeedRpm: number | null;
  pumpSpeedRpm: number | null;
}

export interface CabinetDetail {
  cabinetId: string;
  label: string;
  commStatus: {
    edgeController: "normal" | "abnormal" | "offline";
    pcs: "normal" | "abnormal" | "offline";
    bms: "normal" | "abnormal" | "offline";
  };
  operationInfo: {
    chargeDischargeStatus: "charging" | "discharging" | "standby" | "shutdown";
    realtimePowerKw: number | null;
    /** Null on PCS / solar devices, which carry no battery. */
    socPct: number | null;
    realtimeCapacityKwh: number | null;
  };
  waterChillers: WaterChillerInfo[];
}

/**
 * Every reading is nullable: a register the device did not report has no
 * substitute, and rendering it as 0 makes an absent measurement look like a
 * real one — a 0 V bank reads as a fault rather than as "no data".
 */
export interface BmsData {
  pileId: string;
  label: string;
  /**
   * When the device last published any of these readings (ms), or null if it
   * never has. UGX returns the newest stored point regardless of age, so this
   * is the only thing separating a live pile from one that stopped reporting.
   * Age it with lib/freshness before presenting any field below as current.
   */
  telemetryTs: number | null;
  systemStatus: "charging" | "discharging" | "standby" | "shutdown" | "unknown";
  totalVoltageV: number | null;
  totalCurrentA: number | null;
  totalPowerKw: number | null;
  maxTempC: number | null;
  socPct: number | null;
  maxCellTempC: number | null;
  minCellTempC: number | null;
  maxCellVoltageM: number | null;
  minCellVoltageMv: number | null;
  /** Bank state of health % — profile binding bank.soh. */
  sohPct: number | null;
  /** Average cell voltage in mV — profile binding bank.cellVoltAvg. */
  avgCellVoltageMv: number | null;
  /** Average cell temperature — profile binding bank.cellTempAvg. */
  avgCellTempC: number | null;
  /** Which cell / probe holds the extreme. Identifiers, not measurements. */
  maxVoltCellNo: number | null;
  minVoltCellNo: number | null;
  maxTempProbeNo: number | null;
  minTempProbeNo: number | null;
}

// ─── Equipment hierarchy: Grid → Matrix → Cabinet → Pile → Rack → Cell ────────

export interface EquipmentHierarchy {
  stationId: string;
  grids: Grid[];
}

export interface Grid   { id: string; name: string; matrices: Matrix[]; }
export interface Matrix { id: string; name: string; gridId: string; cabinets: Cabinet[]; }
export interface Cabinet { id: string; name: string; matrixId: string; piles: Pile[]; }
export interface Pile   { id: string; name: string; cabinetId: string; racks: Rack[]; }
export interface Rack   { id: string; name: string; pileId: string; cells: Cell[]; }
export interface Cell   { id: string; name: string; rackId: string; }

// ─── Sub-device monitoring ───────────────────────────────────────────────────

export interface BmsSubDevice {
  cabinetPath: string;      // e.g. "1#Grid-1#Matrix-1# Energy Storage Cabinet-1# Pile-BMS"
  cabinetId: string;
  pileId: string;
  status: "normal" | "abnormal";
  systemStatus: "charging" | "discharging" | "standby" | "shutdown" | "unknown";
  totalVoltageV: number | null;
  totalCurrentA: number;
  totalPowerKw: number;
  maxTempDiffC: number;
  maxCellVoltageDiffMv: number;
  socPct: number;
  // Battery Information
  maxCellTempC: number;     maxTempCellId: string;
  minCellTempC: number;     minTempCellId: string;
  maxCellVoltageMv: number; maxCellVoltageId: string;
  minCellVoltageMv: number; minCellVoltageId: string;
  maxCellSocPct: number | null; maxSocCellId: string;
  minCellSocPct: number | null; minSocCellId: string;
}

export interface PcsSubDevice {
  cabinetPath: string;
  cabinetId: string;
  pileId: string;
  status: "normal" | "abnormal";
  // Status Information
  pcsOperationStatus: string;
  pcsOperationMode: string;
  dcContactorStatus: string;
  acContactorStatus: string;
  // Temperature Information
  ambientTempC: number | null;
  cabinetTempC: number | null;
  igbtATempC: number | null;
  igbtBTempC: number | null;
  igbtCTempC: number | null;
  // DC Side
  dcVoltageV: number | null;
  dcCurrentA: number | null;
  dcPowerKw: number | null;
  // AC Side
  abLineVoltageV: number | null;
  bcLineVoltageV: number | null;
  acLineVoltageV: number | null;
  phaseACurrentA: number | null;
  phaseBCurrentA: number | null;
  phaseCCurrentA: number | null;
  activePowerKw: number | null;
  reactivePowerKvar: number | null;
  apparentPowerKva: number | null;
  powerFactor: number | null;
}

// ─── PCS / cluster / cell / auxiliary equipment ──────────────────────────────

/**
 * Every reading is nullable. A register the device does not publish has no
 * substitute, and rendering it as 0 makes an absent measurement look like a
 * real one — 0.0 V on a live bus reads as a fault, not as "no data".
 */
export interface PcsData {
  cabinetId: string;
  activePowerKw: number | null;
  reactivePowerKvar: number | null;
  acVoltageV: number | null;
  acCurrentA: number | null;
  dcVoltageV: number | null;
  dcCurrentA: number | null;
  dcPowerKw: number | null;
  frequency: number | null;
  /** Inverter efficiency %, or null when the device publishes no efficiency register. */
  efficiency: number | null;
  /** Battery SOC %, or null for non-BESS devices. */
  socPct: number | null;
  temperature: number | null;
  runState: string;
}

export interface ClusterData {
  rackId: string;
  name: string;
  /** Null where the rack did not report — never 0-as-placeholder. */
  voltage: number | null;
  current: number | null;
  soc: number | null;
  maxCellTemp: number | null;
  minCellTemp: number | null;
  maxCellVolt: number | null;
  minCellVolt: number | null;
  /** Rack state of health % — profile binding rack.soh. */
  soh: number | null;
  /** Which cell / probe holds the extreme. Identifiers, not measurements. */
  maxVoltCellNo: number | null;
  minVoltCellNo: number | null;
  maxTempProbeNo: number | null;
  minTempProbeNo: number | null;
  status: "normal" | "abnormal" | "unknown";
}

export interface CellData {
  cellId: string;
  name: string;
  voltMv: number | null;
  tempC: number | null;
  /**
   * Null on UGX: the firmware mirrors rack SOC into every per-cell register, so
   * there is no per-cell measurement to show. Render a placeholder, not a value.
   */
  socPct: number | null;
  /**
   * Sample time of the reading, ISO, when known. Set on a last-known snapshot
   * served because fresh cell registers could not be read — say "as of".
   */
  sampleTime?: string | null;
}

export interface WaterChillerData {
  cabinetId: string;
  cabinetName: string;
  status: "normal" | "abnormal";
  tmsWorkingStatus: string;
  /* Nullable for the same reason as WaterChillerInfo: ambient temperature and
     pump speed have no register on any asset, and 0 would read as a stopped
     pump in a freezing room. The compressor field carries a FREQUENCY in Hz,
     which is what the unit reports. */
  outletWaterTempC: number | null;
  returnWaterTempC: number | null;
  ambientTempC: number | null;
  returnWaterPressureBar: number | null;
  supplyWaterPressureBar: number | null;
  compressorSpeedRpm: number | null;
  waterPumpSpeedRpm: number | null;
}

export interface FireProtectionData {
  cabinetId: string;
  cabinetName: string;
  status: "normal" | "abnormal";
}

export interface MeterTodData {
  meterId: string;
  meterName: string;
  date: string;
  charge:    { peak: number; shoulder: number; flat: number; valley: number; total: number };
  discharge: { peak: number; shoulder: number; flat: number; valley: number; total: number };
}

// ─── Curve Report ─────────────────────────────────────────────────────────────

export interface PowerCurvePoint {
  t: string;
  activePowerKw: number;
}

export type TodBucket = "peak" | "shoulder" | "flat" | "valley";

export interface TodReportRow {
  date: string;
  peak: number;
  shoulder: number;
  flat: number;
  valley: number;
  total: number;
}

// ─── Curve Report series ──────────────────────────────────────────────────────

export interface WholePowerPoint { t: string; realtimePower: number }

export interface PcsCurvePoint {
  t: string; power: number;
  /** Null — UGX v1.0 publishes no IGBT temperatures. */
  tempA: number | null; tempB: number | null; tempC: number | null;
  phaseACurrent: number | null; phaseBCurrent: number | null; phaseCCurrent: number | null;
  phaseAVoltage: number | null; phaseBVoltage: number | null; phaseCVoltage: number | null;
}

export interface ClusterCurvePoint {
  t: string; maxTemp: number | null; minTemp: number | null; maxVoltDiff: number | null;
  /** Null on UGX — the firmware publishes no minimum-of-spread register. */
  minVoltDiff: number | null;
}

export interface ClusterStatInfo {
  clusterMaxTempC: number | null; clusterMinTempC: number | null;
  clusterMaxVoltDiffMv: number | null;
  /** Null on UGX — the firmware publishes no minimum-of-spread register. */
  clusterMinVoltDiffMv: number | null;
}

export interface CellCurvePoint { t: string; voltage: number; temperature: number }

export interface TodRow {
  date: string; peak: number; shoulder: number; flat: number; valley: number; total: number;
  /** The gateway uploaded nothing for this day: the zeros are not a reading. */
  missing?: boolean;
  /** Share of the day's buckets that were measured, 0–1. Under 1 is a partial day. */
  coverage?: number;
  /** Total is the PCS energy counters' rise; the band split is from sampled power. */
  metered?: boolean;
}

export interface ProfitRow extends TodRow { actualRevenue: number }

// ─── Power Station dashboard ──────────────────────────────────────────────────

export interface StationSummary {
  stationId: string;
  stationName: string;
  stationLocation: string;
  hasBess: boolean;              // true = UnityESS cabinet present; false = solar/DG-PV only
  installedKw: number;
  capacityKwh: number;
  /* Null where unavailable, not 0 — all four are meter-derived and the grid
     meter is silent. "0.00 GWh" beside a discharging battery reads as a
     measurement; an em dash does not. */
  totalChargeKwh: number | null;
  totalDischargeKwh: number | null;
  todayChargeKwh: number | null;
  todayDischargeKwh: number | null;
  /** Set when today's pair is an estimate from power, not counters: from when. */
  todayEnergyEstimatedSince?: number | null;
  /** null = no billing/settlement source. UI renders "—", never a number. */
  totalRevenueInr: number | null;
  yesterdayRevenueInr: number | null;
  todayRevenueInr: number | null;
  /** Yesterday's discharge, kWh — null unless the counters cover the whole day. */
  yesterdayDischargeKwh?: number | null;
  /** Active flags right now (not a daily tally); null when no alarm source could be read. */
  todayAlarms: number | null;
  stationEfficiencyPct: number | null;
  fileId: string;
}

export interface ChartRangeType { type: "7d" | "month" | "year" | "all" }

export interface DailyPoint { date: string; charge: number; discharge: number; revenue: number | null }

export interface MatrixData {
  matrixId: string;
  matrixName: string;
  /**
   * Null where the figure is unavailable, not 0.
   *
   * Every one of these is meter-derived, and the grid meter reads 0.0 on all
   * 43 of its registers because it is not communicating. Rendering that as
   * "0.0 kWh" puts a measurement on screen beside a discharging battery and
   * invites the reader to conclude the site moved no energy. An em dash says
   * the true thing: nobody knows.
   */
  energy: {
    remainingDischargeKwh: number | null;
    todayChargeKwh: number | null;
    remainingChargeKwh: number | null;
    todayDischargeKwh: number | null;
    /** Set when today's pair is an estimate from power: from when. */
    todayEstimatedSince?: number | null;
  };
  power: {
    totalActivePowerKw: number | null;
    /** Null unless the site publishes per-phase voltage and current. */
    totalReactivePowerKvar: number | null;
    /** Null — UGX exposes no bank-level charge/discharge power limit. */
    maxChargeablePowerKw: number | null;
    maxDischargePowerKw: number | null;
  };
  /** Null on pure-BESS sites, which publish no per-phase inverter currents. */
  current: { phaseA: number | null; phaseB: number | null; phaseC: number | null };
  totalSocPct: number | null;
  /**
   * Null on UGX: there is no edge-controller device in the platform, so there
   * is no run status to report. Previously hardcoded to a green "normal".
   */
  edgeController: { name: string; runStatus: "normal" | "abnormal" } | null;
  cabinets: Array<{ id: string; name: string; powerKw: number | null; socPct: number | null }>;
}

export interface CommDevice {
  id: string;
  /** Its device type (lib/devices/registry): `external_ems_1_grid_meter` → `grid_meter`. */
  kind: string;
  name: string;
  /** Null — UGX deviceInfos carries no network address. */
  ip: string | null;
  port: number | null;
  /** ThingsBoard device-profile name, not a comms protocol. Null when absent. */
  protocol: string | null;
  lastSeen: string;
  status: "online" | "offline" | "abnormal";
  /** Which register decided `status`, or null when it came from source liveness. */
  statusRegister?: string | null;
}

// ─── Data Analysis ────────────────────────────────────────────────────────────

export interface MeasurementPoint {
  tagId: string;
  name: string;
  unit: string;
  category: string;
}

export interface PointHistoryEntry {
  t: string;
  value: number;
}

// ─── Plant Configuration (from UGX device_config attribute) ──────────────────

/** One physical device connected to the GXORN data-logger */
export interface PlantAsset {
  index: number;
  type: string;        // "inv" | "meter" | "omd"
  subType: string;     // "inv" | "grid" | "load" | "pv" | "xfmr" | "plc1" | "plc2" | "wms"
  oem: string;
  make: string;
  mode: string;        // "RS485-1" | "RS485-2" | "TCP"
  slaveId: number;
  slaveIp?: string;
  slavePort?: string;
  monitor: boolean;
}

export interface PlantFeatures {
  monitorOnly: boolean;
  dgSync:         { enabled: boolean; capacityKva: number; thresholdPct: number };
  exportControl:  { enabled: boolean; sanctionLoadKw: number; thresholdPct: number };
  exportAllow:    { enabled: boolean };
}

/**
 * Derived plant topology — parsed once from the GXORN device's `device_config`
 * server attribute and optionally enriched by the telemetry key list.
 * Cached with staleTime: Infinity since hardware config rarely changes.
 */
export interface PlantConfig {
  customerId: string;     // UGX customer UUID  (= station ID in our app)
  deviceId:   string;     // UGX GXORN device UUID
  gridxId:    string;     // e.g. "GXORN00021"
  version:    number;
  features:   PlantFeatures;
  inverters:     PlantAsset[];   // type === "inv"
  meters:        PlantAsset[];   // type === "meter"  (grid / load / pv)
  transformers:  PlantAsset[];   // subType === "xfmr"
  plcs:          PlantAsset[];   // subType === "plc1" | "plc2"
  wms:           boolean;        // detected from telemetry keys (ird_a / temp_module)
  hasBess:       boolean;        // detected from telemetry keys (soc_*)
  /** Convenience: total rated kW derived from inverter count (0 if unknown) */
  derivedInstalledKw: number;
  /** Convenience: total rated kWh derived from BESS unit count (0 if unknown) */
  derivedInstalledKwh: number;
  raw: PlantAsset[];
}

// ─── Plant Key Map (Point 5) ──────────────────────────────────────────────────

export type KeyCategory =
  | "power"        // active power kW — station or per-inverter
  | "energy"       // kWh counters — generation, import, export
  | "voltage"      // AC/DC voltage
  | "current"      // AC/DC current
  | "frequency"    // Hz_*
  | "battery"      // SOC, BESS voltage/current/temp
  | "wms"          // irradiance, module temp, wind, humidity
  | "temperature"  // non-WMS temperature sensors
  | "grid"         // grid import/export/power
  | "status"       // mode, runhour, backup flag
  | "performance"  // CUF, PR, yield, carbon
  | "other";

import type { MetricId } from "../metrics/registry";

export interface PlantKey {
  key:            string;   // raw UGX key, e.g. "kW_inv_3"
  deviceId:       string;   // UGX device UUID
  deviceName:     string;   // e.g. "GXORN00021"
  label:          string;   // display label, e.g. "Inverter 3 Power"
  unit:           string;   // SI unit, e.g. "kW", "°C", "%"
  category:       KeyCategory;
  subcategory:    string;   // e.g. "Inverter 3", "Grid Meter", "WMS"
  /**
   * Canonical metric this key carries, resolved through the active telemetry
   * profile. undefined = no mapping yet; the tag mapping inspector lists these.
   */
  metric?:        MetricId;
  /** Unit-conversion multiplier from the profile binding (undefined = none). */
  scale?:         number;
  inverterIndex?: number;   // 1-based inverter number for per-inv keys
  isRealtime:     boolean;  // suitable for live value display
  isHistoric:     boolean;  // suitable for trend charts
}

export interface PlantKeyMap {
  all:              PlantKey[];
  byCategory:       Partial<Record<KeyCategory, PlantKey[]>>;
  /** Canonical metric → the keys on this plant that carry it (priority order). */
  byMetric:         Partial<Record<MetricId, PlantKey[]>>;
  stationPowerKeys: PlantKey[];   // inv_power, kW_inv_all
  perInverterPower: PlantKey[];   // kW_inv_1 … kW_inv_N (sorted)
  energyKeys:       PlantKey[];   // gen_inv_*, kWh_inv_*, grid_imported/exported
  gridKeys:         PlantKey[];   // grid_power, kW_grid_1, grid_imported/exported
  batteryKeys:      PlantKey[];   // soc_*, bess_*, battery_*
  wmsKeys:          PlantKey[];   // ird_*, temp_module, GII_daily, wind_*, etc.
  voltageKeys:      PlantKey[];   // V_r/y/b, Vdc_*
  currentKeys:      PlantKey[];   // I_r/y/b, Idc_*
  performanceKeys:  PlantKey[];   // CUF, PR, yield, carbon, efficiency
}

// ─── Strategy ─────────────────────────────────────────────────────────────────

export interface AntiBackflowEntry {
  t: string;
  gridPowerKw: number;
  batteryPowerKw: number;
  threshold: number;
}
