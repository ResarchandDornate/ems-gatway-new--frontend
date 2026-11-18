/**
 * The shape the 3D energy scene consumes.
 *
 * This is the contract between "where the numbers come from" and "how they are
 * drawn". Nothing in components/energy3d/ may read a hook, a query or a socket
 * directly — it receives an EnergySnapshot and renders it. Swapping the mock
 * source for MQTT, a WebSocket or the existing UGX poller is then a change of
 * one provider prop, not a change to the visualisation.
 *
 * Sign conventions, stated once so every source has to agree:
 *
 *   solar.power   kW, >= 0. Generation only; PV does not consume.
 *   bess.power    kW, POSITIVE = discharging (energy leaving the bank),
 *                     NEGATIVE = charging (energy entering the bank).
 *                 This matches the UnityESS `stack_power` register, so the
 *                 existing telemetry needs no sign flip on the way in.
 *   grid.power    kW, POSITIVE = importing from the utility,
 *                     NEGATIVE = exporting to the utility.
 *   load.power    kW, >= 0. Site consumption.
 *
 * Every scalar is `number | null`. null means "this source has no value for
 * this field" — not zero. A dead PV meter and a PV array at midnight are
 * different facts and the scene draws them differently: null greys the asset
 * out, 0 shows it idle but alive.
 */

export type AssetId = "solar" | "bess" | "grid" | "load";

export type SolarStatus = "generating" | "idle" | "offline";
export type BessStatus = "charging" | "discharging" | "idle" | "fault" | "offline";
/**
 * "balanced" is zero net flow at the meter — the site happens to be matching
 * its own demand. That is NOT the same as "islanded", which means physically
 * disconnected from the utility, and labelling one as the other on an EMS is
 * the kind of mistake an operator acts on.
 */
export type GridStatus = "importing" | "exporting" | "balanced" | "offline";
export type LoadStatus = "consuming" | "idle" | "offline";

export interface SolarState {
  /** Instantaneous AC generation, kW. */
  power: number | null;
  /**
   * Set when `power` is not measured but inferred from the battery on a site
   * with no grid: "min" — the battery is charging, so solar makes at least
   * that much; "zero" — the battery is discharging, which happens only with
   * no solar. See lib/energy/sources/gateway.ts.
   */
  inferred?: "min" | "zero";
  /** Energy generated today, kWh. */
  energy: number | null;
  /** `energy` is at least this: the readings start after sunrise or have gaps. */
  energyIsFloor?: boolean;
  /** First reading integrated into `energy`, epoch ms. */
  energyFrom?: number | null;
  status: SolarStatus;
}

export interface BessState {
  /** State of charge, 0–100 %. */
  soc: number | null;
  /** kW. Positive = discharging, negative = charging. */
  power: number | null;
  /** Usable energy currently in the bank, kWh. */
  energy: number | null;
  /** Representative cell temperature, °C. */
  temperature: number | null;
  /** State of health, 0–100 %. */
  soh: number | null;
  status: BessStatus;
}

export interface GridState {
  /** kW. Positive = import, negative = export. */
  power: number | null;
  /** Line voltage, kV at the point of common coupling. */
  voltage: number | null;
  /** Hz. */
  frequency: number | null;
  status: GridStatus;
}

export interface LoadState {
  /** Site consumption, kW. */
  power: number | null;
  /** Energy consumed today, kWh. */
  energy: number | null;
  /**
   * `energy` is a floor, not a measurement: solar today is only partly
   * covered, or unknown and then today's discharge alone. See
   * lib/energy/sources/gateway.ts.
   */
  energyIsFloor?: boolean;
  status: LoadStatus;
}

/** Plant-level figures shown in the top strip of the reference layout. */
export interface SiteState {
  /** Days since commissioning. */
  runDays: number | null;
  /** Lifetime CO₂ avoided, tonnes. */
  co2Avoided: number | null;
  /** Lifetime PV yield, MWh. */
  lifetimeYield: number | null;
  /** Share of site demand met by solar + battery, 0–100 %. */
  renewableShare: number | null;
}

export interface EnergySnapshot {
  solar: SolarState;
  bess: BessState;
  grid: GridState;
  load: LoadState;
  site: SiteState;
  /** Device time of the newest reading, epoch ms. null if it never published. */
  timestamp: number | null;
  /** False while the first read is in flight. */
  ready: boolean;
  /** True when at least one field came back real. */
  live: boolean;
  /** True when the newest reading is older than the source's staleness window. */
  stale: boolean;
}

// ── Flows ────────────────────────────────────────────────────────────────────

/**
 * A directed transfer between two assets, in kW.
 *
 * Flows are always positive and always drawn from → to. A battery exporting to
 * the grid is `{from: "bess", to: "grid"}`, never a negative bess→grid. That
 * keeps the renderer free of sign logic: it animates whatever it is handed, in
 * the direction it is handed, and `reverse` on <PowerFlow> stays a purely
 * visual affordance rather than a second encoding of direction.
 */
export interface EnergyFlow {
  id: string;
  from: AssetId;
  to: AssetId;
  /** kW, always >= 0. */
  power: number;
  active: boolean;
}

/** What a source must provide. Implemented by the mock and the UGX adapter. */
export interface EnergySource {
  snapshot: EnergySnapshot;
  flows: EnergyFlow[];
}

// ── Null snapshot ────────────────────────────────────────────────────────────

/** Everything unknown. Used while loading and by sources with nothing to say. */
export const EMPTY_SNAPSHOT: EnergySnapshot = {
  solar: { power: null, energy: null, status: "offline" },
  bess: { soc: null, power: null, energy: null, temperature: null, soh: null, status: "offline" },
  grid: { power: null, voltage: null, frequency: null, status: "offline" },
  load: { power: null, energy: null, status: "offline" },
  site: { runDays: null, co2Avoided: null, lifetimeYield: null, renewableShare: null },
  timestamp: null,
  ready: false,
  live: false,
  stale: false,
};
