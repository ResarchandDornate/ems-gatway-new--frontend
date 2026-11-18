/**
 * The demo plant.
 *
 * A synthetic two-cabinet C&I site, served in gateway shape so every screen in
 * this app can be opened and reviewed while ems-api.unityess.cloud is down.
 * Switched on with GW_DEMO=true, and when it is on it takes precedence over
 * GW_SITES and GW_BASE_URL both — a deployment in demo mode does not talk to a
 * plant at all, which is the only version of this that is safe to ship with.
 *
 * THIS IS NOT THE REFERENCE CAPTURE. The capture that used to live here was
 * real plant telemetry and was removed on purpose (see the header of proxy.ts):
 * an unconfigured deployment came up showing a recording of somebody's site
 * with nothing on screen saying so. Nothing here is a recording of anything.
 * Every number is computed from the clock by the model below, every response
 * carries `_mode: "demo"`, and the proxy stamps `x-gw-mode: demo` on top of it,
 * so a screen that wants to say "this is not your plant" has two ways to know.
 *
 * WHY IT IS A MODEL AND NOT A TABLE OF NUMBERS. History has to agree with
 * itself: series.ts fetches a window in 80-minute chunks, caches them, and
 * integrates energy across the joins. Random values would make the same
 * instant answer differently on two fetches, and the seam would show up as
 * a step in every energy total. So the plant is a pure function of the
 * timestamp — ask for 14:03:15 a hundred times and it answers the same number
 * a hundred times — and the noise on top of it is hash-based for the same
 * reason.
 *
 * THE DAY IT MODELS is a standard Indian C&I arbitrage day, because that is
 * what the screens are for: charge in the night valley, discharge into the
 * morning peak, take the midday solar surplus, discharge into the 18:00-22:00
 * evening peak. The ToD boundaries the schedule turns on are the same ones
 * curveReport.service.ts classifies against, so the Power Quantity and Profit
 * reports show a plant that is actually playing the tariff rather than noise
 * that happens to cross a slot boundary.
 */

import { SIGNALS } from "./signals";

/* ── Switch ───────────────────────────────────────────────────────────────── */

export const DEMO_BASE = "demo://synthetic-plant";

/** Whether this deployment is in demo mode. Read per call; it is one env read. */
export function demoEnabled(): boolean {
  return (process.env.GW_DEMO ?? "").trim().toLowerCase() === "true";
}

export function isDemoSite(site: { baseUrl: string }): boolean {
  return site.baseUrl.startsWith("demo://");
}

/* ── The site ─────────────────────────────────────────────────────────────── */

/* The same source ids the commissioned site uses, deliberately. They are what
   lib/api/overlay/stations.ts names, so the demo inherits the real display
   names and the real per-site metadata rather than appearing as two unknown
   sources under DEFAULT_OVERLAY — which would render them offline, with no
   rated capacity, on a dashboard whose whole job is to show those figures. */
export const DEMO_SOURCES = ["external_ems_1", "external_ems_2"] as const;
type SourceId = (typeof DEMO_SOURCES)[number];

/** One UnityESS UESS-125-261 cabinet per source. */
const CAP_KWH = 261;
const RATED_KW = 125;

/**
 * Nominal pack: 260 LFP cells in series, 160 temperature probes.
 *
 * Both taken from the Telemetry Data Dictionary of 10 Aug 2026, which lists
 * `cell_voltage_1..260` and `battery_temperature_1..160` on bms_1, and
 * cross-checked against the 20 h reference capture: pack 849–871 V over cells
 * of 3270–3366 mV puts 259.4 cells in series, so the register block is very
 * nearly full and 260 is the real series count rather than a padded ceiling.
 *
 * 260 cells share 160 probes — the probes are per module, not per cell.
 */
const CELLS = 260;
const PROBES = 160;
const NOMINAL_CELL_MV = 3_200;

/** When the demo site was commissioned. Lifetime counters are grown from it. */
const COMMISSIONED_MS = Date.UTC(2026, 2, 15, 0, 0, 0);

/* ── Clock ────────────────────────────────────────────────────────────────── */

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 86_400_000;

/** Hours since IST midnight, as a float in [0, 24). */
function istHour(ms: number): number {
  const local = ms + IST_OFFSET_MS;
  return ((local % DAY_MS) + DAY_MS) % DAY_MS / 3_600_000;
}

/** Whole days since the IST epoch — the day's identity, for per-day variation. */
function istDay(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
}

/** IST day of week, 0 = Sunday. 1 Jan 1970 IST was a Thursday. */
function istDow(ms: number): number {
  return (istDay(ms) + 4) % 7;
}

/* ── Deterministic noise ──────────────────────────────────────────────────── */

/** Integer hash → [0, 1). Same input, same output, for the life of the file. */
function hash01(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Smooth value noise in [-1, 1], on a lattice of `periodMs`.
 *
 * Interpolated rather than sampled so a 15-second history row and the live
 * snapshot taken two seconds later do not disagree by the full noise
 * amplitude — a chart drawn from one and a tile drawn from the other are
 * showing the same plant and have to look like it.
 */
function noise(ms: number, periodMs: number, seed: number): number {
  const t = ms / periodMs;
  const i = Math.floor(t);
  const u = t - i;
  const s = u * u * (3 - 2 * u);
  const a = hash01(i * 2654435761 + seed) * 2 - 1;
  const b = hash01((i + 1) * 2654435761 + seed) * 2 - 1;
  return a + (b - a) * s;
}

/* ── The dispatch schedule ────────────────────────────────────────────────── */

/**
 * SOC knots through the day, in IST hours.
 *
 * The schedule is written as SOC and power is its derivative, not the other
 * way round. Integrating a power curve to get SOC would drift — every chunk
 * boundary in series.ts would start from a slightly different place — whereas
 * differentiating a stated SOC curve cannot: both are exact at every instant
 * and they agree by construction.
 *
 * The valley charge is spread over five hours rather than three, and that too
 * is a demand decision. Refilling 62% of a 261 kWh cabinet in three hours is
 * 81 kW per unit, 162 kW across the site on top of a 285 kW night base — which
 * made 01:45 the highest-demand block of the month. The site would have been
 * billed on its own battery charging. Over five hours the same energy draws
 * 97 kW and the night disappears back under the evening peak, where it belongs.
 *
 * The slots: valley charge to 05:00, hold, morning-peak discharge 06:30-09:30,
 * solar-surplus charge through the middle of the day, then a discharge that
 * runs unbroken from 14:00 to 21:30 — across the afternoon load peak and the
 * evening ToD peak both. 125% of capacity moves each way per day, about 1.25
 * cycles, which is what a site on a four-slot ToD card actually runs.
 *
 * The afternoon and evening are ONE segment, 14:00 to 21:30, not two meeting
 * at 18:00. Power here is the derivative of a smoothstep, so it falls to zero
 * at every knot — and a knot at 18:00 put a moment of zero dispatch exactly on
 * the site's highest load of the day. The demand screen duly reported the
 * battery saving 12 kVA when it should have been saving eighty. A knot is not
 * a neutral place to subdivide a schedule; it is a hole in it.
 *
 * NOTHING CHARGES BETWEEN 14:00 AND 21:30, and that is the point rather than a
 * detail. Charging inside the site's own peak draws grid power at the exact
 * moment the maximum-demand meter is watching, so a schedule that tops up at
 * 16:00 ADDS to the billed demand — the battery makes the bill worse. An
 * earlier version of this model did precisely that and the demand screen
 * caught it, reporting a peak 20 kVA higher WITH the battery than without.
 * That is a real and common misconfiguration, it is what that screen is for,
 * and the demo plant should not be the one committing it by default.
 */
const SOC_KNOTS: readonly [number, number][] = [
  [0.0, 30], [5.0, 92], [6.5, 92], [9.5, 40], [14.0, 95],
  [21.5, 22], [23.0, 22], [24.0, 30],
];

const smoothstep = (u: number) => u * u * (3 - 2 * u);

/** Which knot segment an hour falls in, and how far through it. */
function segment(h: number): { a: number; b: number; span: number; u: number } {
  const x = Math.min(23.999, Math.max(0, h));
  for (let i = 0; i < SOC_KNOTS.length - 1; i++) {
    const [h0, a] = SOC_KNOTS[i];
    const [h1, b] = SOC_KNOTS[i + 1];
    if (x >= h0 && x < h1) return { a, b, span: h1 - h0, u: (x - h0) / (h1 - h0) };
  }
  const [, last] = SOC_KNOTS[SOC_KNOTS.length - 1];
  return { a: last, b: last, span: 1, u: 0 };
}

/** Scheduled SOC, %, before per-unit offset. */
function scheduledSoc(h: number): number {
  const { a, b, u } = segment(h);
  return a + (b - a) * smoothstep(u);
}

/**
 * Scheduled DC power, kW, discharge positive.
 *
 * d(smoothstep)/du is 6u(1-u), so power is zero at every knot and peaks in the
 * middle of a slot. That is also how a real dispatch looks — the PCS ramps
 * rather than stepping — and it keeps the derivative continuous, so no chart
 * drawn from this has a vertical edge in it.
 */
function scheduledPowerKw(h: number): number {
  const { a, b, span, u } = segment(h);
  const dSocPerHour = ((b - a) * 6 * u * (1 - u)) / span;
  return (-dSocPerHour * CAP_KWH) / 100;
}

/** Per-unit character: unit 2 lags slightly and runs a little shallower. */
function unitTrim(source: SourceId): { lagH: number; scale: number; socOffset: number } {
  return source === "external_ems_1"
    ? { lagH: 0, scale: 1, socOffset: 0 }
    : { lagH: 0.35, scale: 0.94, socOffset: -3.5 };
}

/* ── Site-level curves ────────────────────────────────────────────────────── */

const SUNRISE_H = 6.3;
const SUNSET_H = 18.6;
/**
 * Rooftop array size.
 *
 * 700 kWp against a 540 kW working-hours load, which is the ratio an Indian
 * C&I site actually builds to: the array is sized for the ToD bill and the
 * roof it has, not to sit under the load curve. It was 430 kWp, which never
 * exceeded the load for a moment — so the site never exported, self-
 * consumption was trivially 100%, and there was nothing for an export screen
 * to be right or wrong about.
 *
 * The evening demand peak is unaffected: the sun is down by 18:00 and that is
 * when the peak is set.
 */
const PV_PEAK_KW = 700;

/** Whole-site PV output, kW. Zero outside daylight, never negative. */
export function solarKw(ms: number): number {
  const h = istHour(ms);
  if (h <= SUNRISE_H || h >= SUNSET_H) return 0;
  const x = (h - SUNRISE_H) / (SUNSET_H - SUNRISE_H);
  const clearSky = PV_PEAK_KW * Math.pow(Math.sin(Math.PI * x), 1.25);
  /* One cloudiness factor per day, plus passing cloud within it. A flawless
     bell every day makes the performance-ratio screens meaningless. */
  const dayFactor = 0.72 + 0.28 * hash01(istDay(ms) * 7919);
  const passing = 1 - 0.22 * Math.max(0, noise(ms, 11 * 60_000, 3301));
  return Math.max(0, clearSky * dayFactor * passing);
}

/** Whole-site load, kW. A two-shift factory with a lunch dip. */
export function loadKw(ms: number): number {
  const h = istHour(ms);
  const base = 285;
  const shift =
    h < 7.5 ? 0
      : h < 9.0 ? ((h - 7.5) / 1.5) * 255
        : h < 12.75 ? 255
          : h < 13.75 ? 255 - 70 * Math.sin(Math.PI * (h - 12.75))
            : h < 18.0 ? 255
              : h < 20.0 ? ((20.0 - h) / 2.0) * 255
                : 0;
  /* Sunday runs a skeleton shift; Saturday a short one. */
  const dow = istDow(ms);
  const week = dow === 0 ? 0.32 : dow === 6 ? 0.78 : 1;
  const wobble = 1 + 0.045 * noise(ms, 4 * 60_000, 771);
  return Math.max(60, (base + shift * week) * wobble);
}

/** One cabinet's AC power, kW, discharge positive. */
export function bessKw(source: SourceId, ms: number): number {
  const { lagH, scale } = unitTrim(source);
  const p = scheduledPowerKw(istHour(ms - lagH * 3_600_000)) * scale;
  /* PCS regulation ripple, and a floor: below 1.5 kW the cabinet is idling,
     not dispatching, and showing 0.4 kW invites somebody to read meaning into
     it. */
  const ripple = 1 + 0.03 * noise(ms, 90_000, source === "external_ems_1" ? 41 : 97);
  const kw = p * ripple;
  return Math.abs(kw) < 1.5 ? 0 : Math.max(-RATED_KW, Math.min(RATED_KW, kw));
}

/** One cabinet's SOC, %. */
export function bessSoc(source: SourceId, ms: number): number {
  const { lagH, socOffset } = unitTrim(source);
  const soc = scheduledSoc(istHour(ms - lagH * 3_600_000)) + socOffset;
  return Math.max(5, Math.min(100, soc + 0.4 * noise(ms, 6 * 60_000, 613)));
}

/** Site grid import, kW. Negative is export. */
export function gridKw(ms: number): number {
  const bess = DEMO_SOURCES.reduce((sum, s) => sum + bessKw(s, ms), 0);
  return loadKw(ms) - solarKw(ms) - bess;
}

/* ── Energy counters ──────────────────────────────────────────────────────── */

/**
 * One-way conversion efficiency, which DEGRADES.
 *
 * 95.2% each way at commissioning — a round trip of 90.6% — losing about
 * 0.04 points a week. Over a year that is a round trip falling from 90.6% to
 * roughly 86.8%, which is the order a real LFP system loses and is well inside
 * what a warranty argues about.
 *
 * It is a function of time rather than a constant because a constant makes the
 * efficiency trend screen a flat line, and a flat line cannot show whether the
 * screen would notice a decline. A demo that cannot fail the thing it is
 * demonstrating is not demonstrating it.
 */
const ETA_AT_COMMISSIONING = 0.952;
const ETA_LOSS_PER_WEEK = 0.0004;

/** One-way efficiency on the Nth day after commissioning. */
function etaAtDay(dayIndex: number): number {
  const weeks = Math.max(0, dayIndex) / 7;
  return Math.max(0.85, ETA_AT_COMMISSIONING - weeks * ETA_LOSS_PER_WEEK);
}

/** Today's one-way efficiency, for the live conversion figures. */
function etaAt(ms: number): number {
  return etaAtDay(istDay(ms) - istDay(COMMISSIONED_MS));
}

/** Charged and discharged kWh from IST midnight to `h`, one cabinet, AC side. */
function energyToday(h: number, eta: number): { charge: number; discharge: number } {
  let charge = 0;
  let discharge = 0;
  for (let i = 0; i < SOC_KNOTS.length - 1; i++) {
    const [h0, a] = SOC_KNOTS[i];
    const [h1, b] = SOC_KNOTS[i + 1];
    if (h <= h0) break;
    /* A partial segment is exact, not prorated: the SOC curve is closed-form,
       so the energy moved so far is just the SOC actually travelled. */
    const end = Math.min(h, h1);
    const socAtEnd = a + (b - a) * smoothstep((end - h0) / (h1 - h0));
    const dSoc = socAtEnd - a;
    const dc = (Math.abs(dSoc) * CAP_KWH) / 100;
    if (dSoc > 0) charge += dc / eta;
    else discharge += dc * eta;
  }
  return { charge, discharge };
}

/**
 * Cumulative AC energy at the START of day N, one cabinet, unscaled.
 *
 * Summed day by day at each day's own efficiency rather than multiplied out
 * from a single average, because the counters have to be consistent with the
 * efficiency that produced them: the whole point of the trend screen is to
 * recover `etaAtDay` by differencing these, and a shortcut here would have it
 * recover a straight line that was never in the model.
 *
 * Built lazily and kept, so a request that walks three thousand samples pays
 * for the prefix sum once rather than once per sample.
 */
const CUM: { charge: number[]; discharge: number[] } = { charge: [0], discharge: [0] };

function cumulativeAt(dayIndex: number): { charge: number; discharge: number } {
  const n = Math.max(0, dayIndex);
  for (let i = CUM.charge.length - 1; i < n; i++) {
    const day = energyToday(24, etaAtDay(i));
    CUM.charge.push(CUM.charge[i] + day.charge);
    CUM.discharge.push(CUM.discharge[i] + day.discharge);
  }
  return { charge: CUM.charge[n], discharge: CUM.discharge[n] };
}

/** Lifetime AC counters, one cabinet, monotone in time by construction. */
function lifetimeEnergy(source: SourceId, ms: number): { charge: number; discharge: number } {
  const { scale } = unitTrim(source);
  /* Days counted in IST, because `energyToday` resets at IST midnight and the
     two have to agree. Counting them from the UTC epoch — which is what this
     did — meant the day index stepped at 05:30 IST while the within-day term
     had already reset five and a half hours earlier, so between IST midnight
     and 05:30 the counter went BACKWARDS by a full day's energy every night.
     A cumulative register that decreases is not a cumulative register, and
     anything differencing it across a day boundary (round-trip efficiency
     reads exactly this way) would have seen a large negative charge. */
  const days = Math.max(0, istDay(ms) - istDay(COMMISSIONED_MS));
  const past = cumulativeAt(days);
  const today = energyToday(istHour(ms), etaAtDay(days));
  return {
    charge: (past.charge + today.charge) * scale,
    discharge: (past.discharge + today.discharge) * scale,
  };
}

/** Month-to-date AC counters, one cabinet. */
function monthEnergy(source: SourceId, ms: number): { charge: number; discharge: number } {
  const { scale } = unitTrim(source);
  const d = new Date(ms + IST_OFFSET_MS);
  const dayOfMonth = d.getUTCDate() - 1;
  const dayIdx = istDay(ms) - istDay(COMMISSIONED_MS);
  const day = energyToday(24, etaAtDay(dayIdx));
  const today = energyToday(istHour(ms), etaAtDay(dayIdx));
  return {
    charge: (dayOfMonth * day.charge + today.charge) * scale,
    discharge: (dayOfMonth * day.discharge + today.discharge) * scale,
  };
}

/* ── One cabinet, fully decoded ───────────────────────────────────────────── */

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Cabinet {
  kw: number;
  soc: number;
  soh: number;
  packV: number;
  packA: number;
  cellMaxMv: number;
  cellMinMv: number;
  spreadMv: number;
  tempMax: number;
  tempMin: number;
  tempAvg: number;
  phaseV: [number, number, number];
  phaseA: [number, number, number];
  freq: number;
  pf: number;
  kvar: number;
  kva: number;
  igbt: [number, number, number];
  cavityTemp: number;
  inletTemp: number;
  coolantIn: number;
  coolantOut: number;
  ambient: number;
  humidity: number;
  lifetime: { charge: number; discharge: number };
  month: { charge: number; discharge: number };
  /** 0 idle, 1 charging, 2 discharging — the BMS's own encoding. */
  chgDsgState: number;
}

export function cabinet(source: SourceId, ms: number): Cabinet {
  const kw = bessKw(source, ms);
  const soc = bessSoc(source, ms);
  const soh = source === "external_ems_1" ? 97.4 : 96.8;

  /* Pack voltage tracks SOC the way LFP does: flat through the middle, with
     the knees at the ends. A linear V(SOC) would make the whole voltage screen
     a straight line and hide the only shape that matters on this chemistry. */
  const socN = soc / 100;
  const cellMv =
    NOMINAL_CELL_MV +
    260 * (socN - 0.5) * 0.35 +
    150 * Math.tanh((socN - 0.93) * 12) +
    -170 * Math.tanh((0.08 - socN) * 12);
  const packV = (cellMv * CELLS) / 1000;
  /* Sag under load, recovery on charge — the same resistance either way. */
  const packA = kw === 0 ? 0 : (kw * 1000) / packV;
  const sagV = -packA * 0.012;

  const spread = 14 + 9 * Math.abs(noise(ms, 20 * 60_000, 55)) + (Math.abs(kw) > 40 ? 6 : 0);
  const ambient = 27 + 6 * Math.sin((Math.PI * (istHour(ms) - 6)) / 12) + 1.2 * noise(ms, 30 * 60_000, 17);
  /* Cell temperature follows throughput with a lag — the thermal mass is the
     whole reason a liquid-cooled cabinet exists. */
  const heat = Math.abs(bessKw(source, ms - 25 * 60_000)) / RATED_KW;
  const tempAvg = 24.5 + 6.5 * heat + 0.25 * (ambient - 27);
  const tempMax = tempAvg + 2.4 + 0.8 * Math.abs(noise(ms, 15 * 60_000, 83));
  const tempMin = tempAvg - 2.1 - 0.6 * Math.abs(noise(ms, 15 * 60_000, 29));

  const freq = 49.98 + 0.06 * noise(ms, 45_000, 7);
  const phaseVbase = 238.5 + 3.2 * noise(ms, 5 * 60_000, 211);
  const phaseV: [number, number, number] = [
    phaseVbase + 0.6 * noise(ms, 2 * 60_000, 1),
    phaseVbase - 0.9 + 0.6 * noise(ms, 2 * 60_000, 2),
    phaseVbase + 0.4 + 0.6 * noise(ms, 2 * 60_000, 3),
  ];
  const pf = kw === 0 ? 1 : Math.sign(kw) * (0.985 + 0.012 * noise(ms, 8 * 60_000, 501));
  const kva = kw === 0 ? 0 : Math.abs(kw) / Math.abs(pf);
  const kvar = kw === 0 ? 0 : Math.sign(kw) * Math.sqrt(Math.max(0, kva * kva - kw * kw));
  const ampsBase = kw === 0 ? 0 : (Math.abs(kw) * 1000) / (3 * phaseVbase * Math.abs(pf));
  const phaseA: [number, number, number] = [
    ampsBase * (1 + 0.012 * noise(ms, 3 * 60_000, 11)),
    ampsBase * (1 - 0.008 + 0.012 * noise(ms, 3 * 60_000, 12)),
    ampsBase * (1 + 0.005 + 0.012 * noise(ms, 3 * 60_000, 13)),
  ];

  const stageHeat = 32 + 22 * (Math.abs(kw) / RATED_KW);
  const igbt: [number, number, number] = [
    stageHeat + 1.1 * noise(ms, 60_000, 21),
    stageHeat + 0.8 + 1.1 * noise(ms, 60_000, 22),
    stageHeat - 0.6 + 1.1 * noise(ms, 60_000, 23),
  ];

  /* The coolant loop works when the pack does. Outlet is what leaves the
     chiller and enters the pack, so it sits below the return. */
  const duty = Math.abs(kw) / RATED_KW;
  const coolantOut = 18.5 + 2.5 * duty + 0.3 * noise(ms, 10 * 60_000, 31);
  const coolantIn = coolantOut + 2.8 + 3.4 * duty;

  return {
    kw: r2(kw),
    soc: r1(soc),
    soh,
    packV: r1(packV + sagV),
    packA: r1(packA),
    cellMaxMv: Math.round(cellMv + spread * 0.55),
    cellMinMv: Math.round(cellMv - spread * 0.45),
    spreadMv: Math.round(spread),
    tempMax: r1(tempMax),
    tempMin: r1(tempMin),
    tempAvg: r1(tempAvg),
    phaseV: [r1(phaseV[0]), r1(phaseV[1]), r1(phaseV[2])],
    phaseA: [r1(phaseA[0]), r1(phaseA[1]), r1(phaseA[2])],
    freq: r2(freq),
    pf: r2(pf),
    kvar: r2(kvar),
    kva: r2(kva),
    igbt: [r1(igbt[0]), r1(igbt[1]), r1(igbt[2])],
    cavityTemp: r1(30 + 8 * duty + 0.4 * (ambient - 27)),
    inletTemp: r1(ambient + 1.5),
    coolantIn: r1(coolantIn),
    coolantOut: r1(coolantOut),
    ambient: r1(ambient),
    humidity: r1(46 + 12 * Math.abs(noise(ms, 40 * 60_000, 67))),
    lifetime: lifetimeEnergy(source, ms),
    month: monthEnergy(source, ms),
    chgDsgState: kw > 1.5 ? 2 : kw < -1.5 ? 1 : 0,
  };
}

/* ── The pack, cell by cell ───────────────────────────────────────────────── */

/** Index of the cell seeded to be going out of family, 0-based. */
const WEAK_CELL = 136;

/** Where the weak cell's degradation starts. Before this it sits in family. */
const DRIFT_START_MS = Date.UTC(2026, 6, 15);

/**
 * How far cell `k` sits from the pack mean, in units of half the pack spread.
 *
 * Fixed per cell and drawn from its index, so the same cell is the weak one on
 * every poll and the map has real structure rather than 260 copies of the
 * average.
 *
 * WEAK_CELL additionally DRIFTS, and the drift is what makes the trend screen
 * mean anything. A cell that is simply low is indistinguishable from a cell
 * that happens to be lowest at this SOC — which is the whole reason a snapshot
 * cannot answer the question and a slope over weeks can. It widens roughly
 * 2 mV a week from DRIFT_START_MS, so a window of stored samples has a real
 * gradient in it and the least-squares fit in cellTrend.service.ts has
 * something true to find.
 */
function cellOffset(source: SourceId, k: number, ms: number, spreadMv: number): number {
  const base = (hash01(k * 7717 + (source === "external_ems_1" ? 1 : 2)) - 0.5) * 2;
  if (source !== "external_ems_1" || k !== WEAK_CELL) return base;
  const weeks = Math.max(0, (ms - DRIFT_START_MS) / 604_800_000);
  /* Expressed in mV and converted back into offset units, because the drift is
     a property of the cell and the spread it is divided by is not constant. */
  const driftMv = -(6 + weeks * 2.0);
  return base + driftMv / Math.max(spreadMv * 0.5, 1);
}

/** Every cell's voltage, mV. */
function packCellVoltages(source: SourceId, ms: number, c: Cabinet): number[] {
  const mid = (c.cellMaxMv + c.cellMinMv) / 2;
  return Array.from({ length: CELLS }, (_, k) =>
    Math.round(mid + cellOffset(source, k, ms, c.spreadMv) * c.spreadMv * 0.5),
  );
}

/* ── Telemetry snapshot ───────────────────────────────────────────────────── */

type Point = { value: number | null; quality: "good"; unit: string | null };

const pt = (value: number | null, unit: string | null = null): Point =>
  ({ value: value == null ? null : Number(value.toFixed(3)), quality: "good", unit });

/**
 * `/api/telemetry?source_id=` — the payload the whole website reads.
 *
 * Keyed by runtime asset id with `base_asset_id` alongside, exactly as the
 * live gateway does, because that mismatch is load-bearing: the meter runs as
 * `{source}_grid_meter` against a base of `utility_meter`, and
 * lib/gateway/fetch.ts flattens by the base. A demo that keyed both the same
 * way would work here and break the moment the gateway came back.
 */
export function telemetry(source: SourceId, ms: number): unknown {
  const c = cabinet(source, ms);
  const siteLoad = loadKw(ms);
  const siteGrid = gridKw(ms);
  const pv = solarKw(ms);

  const pcs: Record<string, Point> = {
    phase_a_voltage: pt(c.phaseV[0], "V"),
    phase_b_voltage: pt(c.phaseV[1], "V"),
    phase_c_voltage: pt(c.phaseV[2], "V"),
    phase_a_current: pt(c.phaseA[0], "A"),
    phase_b_current: pt(c.phaseA[1], "A"),
    phase_c_current: pt(c.phaseA[2], "A"),
    grid_frequency: pt(c.freq, "Hz"),
    total_active_power: pt(c.kw, "kW"),
    total_reactive_power: pt(c.kvar, "kVar"),
    total_apparent_power: pt(c.kva, "kVA"),
    total_power_factor: pt(c.pf, null),
    charge_discharge_power: pt(c.kw, "kW"),
    dc_voltage: pt(c.packV, "V"),
    pcs_total_dc_voltage: pt(c.packV, "V"),
    dc_current: pt(c.packA, "A"),
    /* DC side carries the conversion loss, so it is larger on charge and
       smaller on discharge than the AC figure beside it. */
    dc_power: pt(c.kw >= 0 ? c.kw / etaAt(ms) : c.kw * etaAt(ms), "kW"),
    dc_power_2: pt(c.kw >= 0 ? c.kw / etaAt(ms) : c.kw * etaAt(ms), "kW"),
    soc: pt(c.soc, "%"),
    rated_power: pt(RATED_KW, "kW"),
    /* Headroom, not rating: what the BMS will accept right now. Full at mid
       SOC, tapering to nothing at the ends, which is what makes the limit
       worth drawing at all. */
    bms_available_charge_power: pt(RATED_KW * Math.max(0, Math.min(1, (100 - c.soc) / 15)), "kW"),
    bms_available_discharge_power: pt(RATED_KW * Math.max(0, Math.min(1, (c.soc - 5) / 15)), "kW"),
    available_charge_power: pt(RATED_KW * Math.max(0, Math.min(1, (100 - c.soc) / 15)), "kW"),
    available_discharge_power: pt(RATED_KW * Math.max(0, Math.min(1, (c.soc - 5) / 15)), "kW"),
    ac_cumulative_charge_energy: pt(c.lifetime.charge, "kWh"),
    ac_cumulative_discharge_energy: pt(c.lifetime.discharge, "kWh"),
    phase_a_temperature: pt(c.igbt[0], "degC"),
    phase_b_temperature: pt(c.igbt[1], "degC"),
    phase_c_temperature: pt(c.igbt[2], "degC"),
    cavity_temperature: pt(c.cavityTemp, "degC"),
    heat_sink_temperature: pt(Math.max(...c.igbt) + 2.5, "degC"),
    air_inlet_temperature: pt(c.inletTemp, "degC"),
    on_grid_status: pt(1, null),
    off_grid_status: pt(0, null),
    running_status_2: pt(c.kw === 0 ? 0 : 1, null),
    standby_status: pt(c.kw === 0 ? 1 : 0, null),
    shutdown_status: pt(0, null),
    pcs_online_status: pt(1, null),
    bms_online_status: pt(1, null),
    liquid_cooling_online_status: pt(1, null),
    remote_local_status: pt(1, null),
    e_stop_input_status: pt(0, null),
    system_abnormal: pt(0, null),
  };
  /* Every fault and alarm bit the profile declares, all clear. Enumerated from
     the profile rather than listed by hand so a screen that reads one this
     file forgot gets a healthy zero instead of a dash. */
  for (const s of SIGNALS) {
    if (s.asset === "PCS" && s.category === "fault_alarm" && !(s.name in pcs)) {
      pcs[s.name] = pt(0, null);
    }
  }

  const bms: Record<string, Point> = {
    cluster_total_voltage_collected: pt(c.packV, "V"),
    cluster_total_current: pt(c.packA, "A"),
    can_hall_sampling_current: pt(c.packA * 0.998, "A"),
    display_soc: pt(c.soc, "%"),
    soh: pt(c.soh, "%"),
    cell_max_voltage: pt(c.cellMaxMv, "mV"),
    cell_min_voltage: pt(c.cellMinMv, "mV"),
    max_min_cell_voltage_diff: pt(c.spreadMv, "mV"),
    battery_max_temperature: pt(c.tempMax, "degC"),
    battery_min_temperature: pt(c.tempMin, "degC"),
    average_temperature: pt(c.tempAvg, "degC"),
    charge_discharge_status: pt(c.chgDsgState, null),
    system_status: pt(c.kw === 0 ? 3 : 0, null),
    total_cumulative_charge_capacity: pt(c.lifetime.charge / etaAt(ms), "kWh"),
    total_cumulative_discharge_capacity: pt(c.lifetime.discharge / etaAt(ms), "kWh"),
    monthly_cumulative_charge_energy: pt(c.month.charge, "kWh"),
    monthly_cumulative_discharge_energy: pt(c.month.discharge, "kWh"),
    cell_average_voltage: pt((c.cellMaxMv + c.cellMinMv) / 2, "mV"),
    cluster_internal_soc: pt(c.soc, "%"),
    battery_cluster_internal_resistance: pt(source === "external_ems_1" ? 0.62 : 0.58, "mohm"),
    contactor_fault: pt(0, null),
    fuse_fault: pt(0, null),
    online_points: pt(1, null),
    yearly_cumulative_charge_energy: pt(c.lifetime.charge * 0.82, "kWh"),
    yearly_cumulative_discharge_energy: pt(c.lifetime.discharge * 0.82, "kWh"),
  };

  /* ── Per-cell families ──────────────────────────────────────────────────
     260 voltages and 160 probes, the shape bms_1 actually publishes.

     A pack is not 260 copies of its average, and a demo that made it one
     would show a flat cell map and prove nothing about the screen that reads
     it. Each cell carries a fixed offset drawn from its index — its place in
     the family, stable for the life of the process — so the map has real
     structure, the same cell is the weak one on every poll, and the extreme
     ids below point at cells that genuinely hold the extremes.

     Cell 137 is seeded as an outlier on unit 1: a pack where nothing stands
     out cannot exercise outlier detection, and every screen downstream of
     this exists to find exactly that cell. */
  const cellV = packCellVoltages(source, ms, c);
  const probeT = Array.from({ length: PROBES }, (_, k) => {
    /* Warmer towards the middle of the cabinet, where the airflow is worst. */
    const x = k / (PROBES - 1);
    const middle = 1 - Math.abs(x - 0.5) * 2;
    const jitter = (hash01(k * 3313 + 9) - 0.5) * 0.8;
    return Number((c.tempMin + (c.tempMax - c.tempMin) * (0.35 + 0.65 * middle) + jitter).toFixed(1));
  });

  for (let k = 0; k < CELLS; k++) bms[`cell_voltage_${k + 1}`] = pt(cellV[k], "mV");
  for (let k = 0; k < PROBES; k++) bms[`battery_temperature_${k + 1}`] = pt(probeT[k], "degC");
  /* Four HV-box connector probes — a different sensor set from the per-cell
     ones, which is why the profile leaves cell.poleTemperatures unmapped. */
  const hvBox = Array.from({ length: 4 }, (_, k) => c.tempAvg + 1.5 + k * 0.3);
  for (let k = 0; k < 4; k++) bms[`hv_box_temperature_${k + 1}`] = pt(hvBox[k], "degC");
  /* The aggregate the BMS publishes alongside the four probes, taken from them
     rather than stated separately — the whole reason a screen shows both is to
     be able to check one against the other. */
  bms.hv_box_max_temperature = pt(Math.max(...hvBox), "degC");

  /* The extreme ids are the argmax/argmin of the arrays above, not separate
     numbers. A demo whose stated extreme disagreed with its own cells would
     hide exactly the class of bug these registers are used to catch. */
  const argmax = (a: number[]) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0) + 1;
  const argmin = (a: number[]) => a.reduce((b, v, i) => (v < a[b] ? i : b), 0) + 1;
  bms.cell_max_voltage_id = pt(argmax(cellV), null);
  bms.cell_min_voltage_id = pt(argmin(cellV), null);
  bms.battery_max_temperature_id = pt(argmax(probeT), null);
  bms.battery_min_temperature_id = pt(argmin(probeT), null);

  /* And the pack figures are restated from the arrays for the same reason.
     They were computed from the spread model a few lines up, which is close
     but not identical — and "close" is the failure mode here: a max that is
     not any cell's voltage is the bug this whole screen is for. */
  bms.cell_max_voltage = pt(Math.max(...cellV), "mV");
  bms.cell_min_voltage = pt(Math.min(...cellV), "mV");
  bms.max_min_cell_voltage_diff = pt(Math.max(...cellV) - Math.min(...cellV), "mV");
  bms.battery_max_temperature = pt(Math.max(...probeT), "degC");
  bms.battery_min_temperature = pt(Math.min(...probeT), "degC");
  bms.cell_average_voltage = pt(cellV.reduce((a, b) => a + b, 0) / CELLS, "mV");
  for (const s of SIGNALS) {
    if (s.asset === "BMS" && s.category === "fault_alarm" && !(s.name in bms)) {
      bms[s.name] = pt(0, null);
    }
  }

  /* Site figures are whole-plant and identical on both sources, because that
     is what they are: one grid connection, one load, one PV array. Splitting
     them per cabinet would invent two plants. */
  const ems: Record<string, Point> = {
    load_power: pt(siteLoad, "kW"),
    grid_current_total_power: pt(siteGrid, "kW"),
    metering_current_total_power: pt(siteGrid, "kW"),
    energy_storage_power: pt(c.kw, "kW"),
    soc: pt(c.soc, "%"),
    total_available_charge_power: pt(RATED_KW, "kW"),
    total_available_discharge_power: pt(RATED_KW, "kW"),
    master_communication_status: pt(1, null),
    system_fault: pt(0, null),
    e_stop: pt(0, null),
    /* The EMS's own demand limiter. Published switched OFF on purpose: a site
       with a battery and no demand control is the common real finding, and the
       Maximum Demand screen exists partly to say so. Flip demand_enable to 1
       to see the armed case. */
    demand_enable: pt(0, null),
    demand: pt(400, "kW"),
    demand_limit_percentage: pt(90, "%"),
    anti_reverse_flow_enable: pt(1, null),
  };

  /* Import and export integrated from the same grid power the line above
     reports, so the counters and the curve are two views of one plant. */
  const gridEnergy = gridEnergyAt(ms);
  const meter: Record<string, Point> = {
    total_active_power: pt(siteGrid, "kW"),
    frequency: pt(c.freq, "Hz"),
    forward_total_active_energy: pt(gridEnergy.imp, "kWh"),
    reverse_total_active_energy: pt(gridEnergy.exp, "kWh"),
    phase_a_voltage: pt(c.phaseV[0] * Math.sqrt(3), "V"),
    phase_b_voltage: pt(c.phaseV[1] * Math.sqrt(3), "V"),
    phase_c_voltage: pt(c.phaseV[2] * Math.sqrt(3), "V"),
    power_factor: pt(0.97, null),
    communication_status: pt(1, null),
  };

  const cooling: Record<string, Point> = {
    inlet_water_temperature: pt(c.coolantIn, "degC"),
    outlet_water_temperature: pt(c.coolantOut, "degC"),
    inlet_water_pressure: pt(2.4 + 0.08 * noise(ms, 5 * 60_000, 91), "Bar"),
    outlet_water_pressure: pt(2.9 + 0.08 * noise(ms, 5 * 60_000, 92), "Bar"),
    outdoor_temperature: pt(c.ambient, "degC"),
    power_on_off: pt(1, null),
    system_a_compressor_frequency: pt(28 + 34 * (Math.abs(c.kw) / RATED_KW), "Hz"),
    meter_communication_fault: pt(0, null),
  };

  const fire: Record<string, Point> = {
    fire_alarm: pt(0, null),
    fire_alarm_temperature: pt(0, null),
    communication_status: pt(1, null),
    fault: pt(0, null),
  };

  /* The one asserted alarm on the demo site, and it is on the dehumidifier of
     unit 2 — the same asset that was genuinely alarming on the commissioned
     site in September. A demo plant with nothing wrong anywhere makes the
     alarm screens untestable, and a demo plant with a battery fault makes
     every other screen shout. A humidity alarm is the right size. */
  const humid: Record<string, Point> = {
    current_temperature: pt(c.ambient - 3.5, "degC"),
    current_humidity: pt(source === "external_ems_2" ? 71.5 : c.humidity, "%"),
    alarm_status: pt(source === "external_ems_2" ? 1 : 0, null),
    running_status: pt(1, null),
  };

  const io: Record<string, Point> = {
    di_1_door_contact: pt(0, null),
    di_2_emergency_stop: pt(0, null),
    do_1_alarm_beacon: pt(source === "external_ems_2" ? 1 : 0, null),
  };

  return {
    _mode: "demo",
    source_id: source,
    timestamp_utc: new Date(ms).toISOString(),
    /* PV lives outside the telemetry snapshot on the real gateway too — it is
       published at /api/solis/status — so it is not smuggled in here. */
    assets: {
      [`${source}_pcs`]: { base_asset_id: "pcs_1", signals: pcs },
      [`${source}_bms`]: { base_asset_id: "bms_1", signals: bms },
      [`${source}_ems`]: { base_asset_id: "ems_system", signals: ems },
      [`${source}_grid_meter`]: { base_asset_id: "utility_meter", signals: meter },
      [`${source}_liquid_cooling`]: { base_asset_id: "liquid_cooling", signals: cooling },
      [`${source}_fire_protection`]: { base_asset_id: "fire_protection", signals: fire },
      [`${source}_dehumidifier`]: { base_asset_id: "dehumidifier", signals: humid },
      [`${source}_io_module`]: { base_asset_id: "io_module", signals: io },
    },
    _pv_site_kw: Number(pv.toFixed(2)),
  };
}

/* ── Historian rows ───────────────────────────────────────────────────────── */

/** Resolution the demo historian publishes. Matches what the real logger keeps
 *  once a window is wider than its burst — and 15 s over an 80-minute chunk is
 *  320 rows, which fits a single page of series.ts's walk. */
const ROW_MS = 15_000;

function historyRow(source: SourceId, ms: number) {
  const c = cabinet(source, ms);
  const pcsValues: Record<string, number | null> = {};
  const bmsValues: Record<string, number | null> = {};
  const t = telemetry(source, ms) as {
    assets: Record<string, { base_asset_id: string; signals: Record<string, Point> }>;
  };
  const pcsSignals = t.assets[`${source}_pcs`].signals;
  const bmsSignals = t.assets[`${source}_bms`].signals;
  for (const s of SIGNALS) {
    const from = s.asset === "PCS" ? pcsSignals : bmsSignals;
    const target = s.asset === "PCS" ? pcsValues : bmsValues;
    target[s.name] = from[s.name]?.value ?? null;
  }
  const good = [...Object.values(pcsValues), ...Object.values(bmsValues)].filter((v) => v != null).length;
  return {
    timestamp_utc: new Date(ms).toISOString(),
    timestamp_epoch_ms: ms,
    source_id: source,
    bess_id: source.replace(/^external_ems_/, "bess_"),
    quality: "good" as const,
    max_data_age_ms: 0,
    selected_signal_count: SIGNALS.length,
    good_signal_count: good,
    bad_signal_count: SIGNALS.length - good,
    pcs_values: pcsValues,
    bms_values: bmsValues,
    _soc: c.soc,
  };
}

/* ── Grid energy ──────────────────────────────────────────────────────────── */

/**
 * Cumulative import and export at the utility meter, kWh.
 *
 * Integrated from `gridKw` rather than stated as a rate times a day count,
 * which is what this used to be. The old version grew import at a flat 4,820
 * kWh a day and export at a figure derived from the instantaneous power — so
 * the counters disagreed with the power curve beside them, and export was not
 * even monotonic.
 *
 * That matters here more than anywhere: self-consumption is the ratio of two
 * of these counters, and export-avoidance is measured by differencing them
 * across an interval. Counters that were not the integral of the power they
 * sit next to would make every figure on that screen a statement about the
 * wrong plant.
 *
 * Five-minute steps, summed day by day into a lazy prefix cache, the same
 * shape as the efficiency counters above. A real meter integrates
 * continuously; five minutes is fine against a load curve whose fastest real
 * feature is the solar ramp.
 */
const GRID_STEP_MS = 5 * 60_000;
const GRID_CUM: { imp: number[]; exp: number[] } = { imp: [0], exp: [0] };

/** Import and export over one IST day index, kWh. */
function gridEnergyForDay(dayIndex: number): { imp: number; exp: number } {
  const start = (istDay(COMMISSIONED_MS) + dayIndex) * DAY_MS - IST_OFFSET_MS;
  let imp = 0, exp = 0;
  for (let t = start; t < start + DAY_MS; t += GRID_STEP_MS) {
    const kw = gridKw(t);
    const kwh = (Math.abs(kw) * GRID_STEP_MS) / 3_600_000;
    if (kw > 0) imp += kwh; else exp += kwh;
  }
  return { imp, exp };
}

function gridCumulativeAt(dayIndex: number): { imp: number; exp: number } {
  const n = Math.max(0, dayIndex);
  for (let i = GRID_CUM.imp.length - 1; i < n; i++) {
    const d = gridEnergyForDay(i);
    GRID_CUM.imp.push(GRID_CUM.imp[i] + d.imp);
    GRID_CUM.exp.push(GRID_CUM.exp[i] + d.exp);
  }
  return { imp: GRID_CUM.imp[n], exp: GRID_CUM.exp[n] };
}

/** Meter counters at an instant: whole days plus the part-day so far. */
function gridEnergyAt(ms: number): { imp: number; exp: number } {
  const dayIndex = Math.max(0, istDay(ms) - istDay(COMMISSIONED_MS));
  const past = gridCumulativeAt(dayIndex);
  const start = ms - istHour(ms) * 3_600_000;
  let imp = 0, exp = 0;
  for (let t = start; t < ms; t += GRID_STEP_MS) {
    const kw = gridKw(t);
    const kwh = (Math.abs(kw) * Math.min(GRID_STEP_MS, ms - t)) / 3_600_000;
    if (kw > 0) imp += kwh; else exp += kwh;
  }
  /* A baseline so the counters do not start at zero on a site commissioned
     months ago — a meter that reads 0 kWh lifetime is the one thing an
     operator would notice instantly. */
  return { imp: 182_400 + past.imp + imp, exp: 6_300 + past.exp + exp };
}

/* ── The snapshot store ───────────────────────────────────────────────────── */

/**
 * Cadence of the snapshot store behind `/api/storage/points`.
 *
 * Distinct from ROW_MS, which is the fast historian's. The two stores are
 * different things on this gateway: 63 signals at 1 s, and the whole
 * 2,844-point snapshot at whatever the deployment polls at. Nothing in the
 * handover states the second, so the service reads it back off consecutive
 * timestamps — and this is the number it will find.
 */
const SNAPSHOT_STORE_MS = 5 * 60_000;

/**
 * One stored signal's value at one instant, from the same model as everything
 * else.
 *
 * Only the families the trend screens read are answered; anything else returns
 * null and the endpoint reports an empty history rather than inventing one. A
 * demo that answered every conceivable signal name would hide the case where a
 * screen asks for a register this gateway does not keep.
 */
function storedSignalAt(source: SourceId, asset: string, signal: string, ms: number): number | null {
  const c = cabinet(source, ms);

  /* The site's one grid connection, as the utility meter sees it. Demand is a
     property of this asset and of no other, which is why the demand service
     reads it from a single source however many cabinets are behind it. */
  if (asset === "grid_meter" || asset === "utility_meter") {
    const kw = gridKw(ms);
    const pf = 0.965 + 0.02 * noise(ms, 20 * 60_000, 137);
    switch (signal) {
      case "total_active_power":    return kw;
      case "forward_total_active_energy": return gridEnergyAt(ms).imp;
      case "reverse_total_active_energy": return gridEnergyAt(ms).exp;
      /* Apparent power is a magnitude — unsigned even while the site exports.
         Published that way on purpose: it is what the register does, and the
         demand service is written to take the sign from the active power
         rather than to be handed a convenient one. */
      case "total_apparent_power":  return Math.abs(kw) / pf;
      case "total_reactive_power":  return Math.sign(kw) * Math.abs(kw) * Math.tan(Math.acos(pf));
      case "total_power_factor":    return pf;
      case "frequency":             return c.freq;
      default:                      return null;
    }
  }

  if (asset === "pcs_1" || asset === "pcs") {
    switch (signal) {
      case "total_active_power":  return bessKw(source, ms);
      case "soc":                 return c.soc;
      case "dc_voltage":          return c.packV;
      /* Cumulative AC-side counters, monotonic by construction — they come
         from lifetimeEnergy(), which grows with the clock and never steps
         back. That matters more here than anywhere else in this file: round
         trip efficiency is read by DIFFERENCING these across a day boundary,
         so a counter that wobbled by a kilowatt-hour would put percentage
         points of noise on the efficiency. */
      case "ac_cumulative_charge_energy":     return c.lifetime.charge;
      case "ac_cumulative_discharge_energy":  return c.lifetime.discharge;
      default:                    return null;
    }
  }

  if (asset === "ems" || asset === "ems_system") {
    switch (signal) {
      case "load_power":               return loadKw(ms);
      case "grid_current_total_power": return gridKw(ms);
      case "energy_storage_power":     return bessKw(source, ms);
      default:                         return null;
    }
  }

  if (asset !== "bms_1" && asset !== "bms") return null;

  const cellN = /^cell_voltage_(\d+)$/.exec(signal);
  if (cellN) {
    const k = Number(cellN[1]) - 1;
    if (k < 0 || k >= CELLS) return null;
    return packCellVoltages(source, ms, c)[k];
  }
  const probeN = /^battery_temperature_(\d+)$/.exec(signal);
  if (probeN) {
    const k = Number(probeN[1]) - 1;
    if (k < 0 || k >= PROBES) return null;
    const x = k / (PROBES - 1);
    const middle = 1 - Math.abs(x - 0.5) * 2;
    return c.tempMin + (c.tempMax - c.tempMin) * (0.35 + 0.65 * middle)
      + (hash01(k * 3313 + 9) - 0.5) * 0.8;
  }

  switch (signal) {
    /* The extremes and their ids come off the array, not off the spread model,
       for the same reason the snapshot restates them: an id that does not
       point at the actual minimum is the bug the screen exists to catch. */
    case "cell_min_voltage":
    case "cell_max_voltage":
    case "cell_average_voltage":
    case "cell_min_voltage_id":
    case "cell_max_voltage_id":
    case "max_min_cell_voltage_diff": {
      const v = packCellVoltages(source, ms, c);
      const lo = Math.min(...v), hi = Math.max(...v);
      switch (signal) {
        case "cell_min_voltage":        return lo;
        case "cell_max_voltage":        return hi;
        case "cell_average_voltage":    return v.reduce((a, b) => a + b, 0) / CELLS;
        case "cell_min_voltage_id":     return v.indexOf(lo) + 1;
        case "cell_max_voltage_id":     return v.indexOf(hi) + 1;
        default:                        return hi - lo;
      }
    }
    case "display_soc":                      return c.soc;
    case "cluster_internal_soc":             return c.soc;
    case "cluster_total_voltage_collected":  return c.packV;
    case "cluster_total_current":            return c.packA;
    case "battery_max_temperature":          return c.tempMax;
    case "battery_min_temperature":          return c.tempMin;
    case "average_temperature":              return c.tempAvg;
    case "soh":                              return c.soh;
    default:                                 return null;
  }
}

/* ── Event log ────────────────────────────────────────────────────────────── */

interface DemoEvent {
  id: string;
  severity: string;
  source_id: string;
  asset_id: string;
  signal_name: string;
  display_name: string;
  message: string;
  timestamp_utc: string;
  cleared_utc: string | null;
}

const EVENT_KINDS: readonly {
  severity: string; asset: string; signal: string; label: string; message: string;
  /** Roughly how often, in events per day across the whole site. */
  rate: number;
  /** Typical minutes until it clears. 0 means it is still asserted. */
  clearsAfterMin: number;
  /**
   * IST hour this kind fires around, when it is driven by the clock rather
   * than by chance, and how tightly (hours either side).
   *
   * Real alarm logs are not uniformly distributed and the interesting ones are
   * the least uniform. An event that lands at 18:40 every evening is telling
   * you about the dispatch schedule, not about the equipment — the pack is
   * simply at full discharge then — and the recurrence screen exists mainly to
   * separate those from the ones that arrive at random. A demo whose events
   * were all uniform over the day could not show that distinction, so the ones
   * that would genuinely be duty-driven are modelled as duty-driven.
   */
  atHour?: number;
  spreadH?: number;
  /**
   * Multiplier on the rate across the window, oldest to newest.
   *
   * >1 is a fault getting worse — the pattern a recurrence screen has to catch
   * early, and the one a flat list of events hides completely.
   *
   * It has to be a big multiplier to be detectable, and that is a real fact
   * about alarm rates rather than a convenience. An alarm firing twice a week
   * produces a few dozen events over two months, and a few dozen events split
   * into halves carry Poisson noise of a fifth or more — so a fault that
   * merely doubles is indistinguishable from a quiet one. Sixfold over the
   * window is a seal or a desiccant genuinely giving up, and it is roughly
   * where the evidence becomes strong enough to act on.
   */
  growth?: number;
}[] = [
  /* Duty-driven: the coolant loop is hottest when the pack is, which on this
     schedule is the middle of the 14:00-21:30 discharge. Fires most evenings
     within an hour of the same time. */
  { severity: "warning", asset: "liquid_cooling", signal: "outlet_water_temperature", label: "Coolant Outlet Temperature High", message: "Coolant outlet above setpoint while compressor at full duty", rate: 0.9, clearsAfterMin: 22, atHour: 18.6, spreadH: 0.8 },
  /* Also duty-driven, at the other end: spread opens up as the pack empties,
     so this lands near the end of the evening discharge. */
  { severity: "minor", asset: "bms", signal: "max_min_cell_voltage_diff", label: "Cell Voltage Spread High", message: "Pack cell voltage spread exceeded 45 mV during discharge", rate: 0.8, clearsAfterMin: 35, atHour: 21.1, spreadH: 0.6 },
  /* Balancing engages at the top of the midday solar charge. */
  { severity: "info", asset: "bms", signal: "balancing_status", label: "Cell Balancing Started", message: "Passive balancing engaged at end of charge", rate: 1.0, clearsAfterMin: 48, atHour: 13.8, spreadH: 0.5 },
  /* The scheduler announces each slot change, so this is the most clock-bound
     of the lot — and the least interesting, which is the point: volume is not
     severity and a recurrence screen must not rank on count alone. */
  { severity: "info", asset: "ems", signal: "dispatch_mode", label: "Dispatch Mode Changed", message: "Scheduler moved to peak-discharge slot", rate: 2.0, clearsAfterMin: 1, atHour: 14.0, spreadH: 0.2 },

  /* Getting worse. A seal or a desiccant losing the fight over six weeks — the
     rate roughly triples across the window. Nothing about any single one of
     these events says so; only the rate does. */
  { severity: "warning", asset: "dehumidifier", signal: "alarm_status", label: "Cabinet Humidity High", message: "Cabinet relative humidity above 70% for 15 minutes", rate: 0.30, clearsAfterMin: 0, growth: 6.0 },

  /* Genuinely random: grid events arrive when the grid decides. */
  { severity: "minor", asset: "pcs", signal: "grid_frequency", label: "Grid Frequency Excursion", message: "Grid frequency outside 49.5-50.5 Hz band", rate: 0.9, clearsAfterMin: 4 },
  { severity: "major", asset: "pcs", signal: "ac_over_current_warning", label: "AC Current Near Limit", message: "Phase current within 5% of the converter limit", rate: 0.18, clearsAfterMin: 8 },
  { severity: "critical", asset: "fire_protection", signal: "communication_status", label: "Fire Panel Comms Lost", message: "Fire protection panel did not answer for 3 polls", rate: 0.05, clearsAfterMin: 12 },
];

/** How far back the generated log runs. Bounds the growth ramp. */
const LOG_DAYS = 60;

/**
 * The event log, generated per IST day and stable for that day.
 *
 * Generated rather than stored so History and Alarms can be opened over any
 * range without a fixture that runs out. The rate table above decides how many
 * events a day holds; the day's hash decides which, and when.
 */
function eventsForDay(day: number): DemoEvent[] {
  const out: DemoEvent[] = [];
  const dayStart = day * DAY_MS - IST_OFFSET_MS;
  let seq = 0;
  /* Where this day sits in the window, 0 oldest to 1 newest — the ramp the
     growing kinds are scaled along. */
  const age = Math.max(0, Math.min(1, 1 - (istDay(Date.now()) - day) / LOG_DAYS));

  for (let k = 0; k < EVENT_KINDS.length; k++) {
    const kind = EVENT_KINDS[k];
    const rate = kind.growth ? kind.rate * (1 + (kind.growth - 1) * age) : kind.rate;
    const draws = Math.floor(rate) + (hash01(day * 131 + k) < rate % 1 ? 1 : 0);
    for (let n = 0; n < draws; n++) {
      /* Clock-bound kinds land near their hour with a little jitter; the rest
         fall anywhere in the day. */
      const h = kind.atHour != null
        ? kind.atHour + (hash01(day * 977 + k * 31 + n) - 0.5) * 2 * (kind.spreadH ?? 0.5)
        : hash01(day * 977 + k * 31 + n) * 24;
      const at = dayStart + h * 3_600_000;
      if (at > Date.now()) continue;
      const source = hash01(day * 13 + k * 7 + n) < 0.5 ? DEMO_SOURCES[0] : DEMO_SOURCES[1];
      const cleared = kind.clearsAfterMin > 0
        ? new Date(at + kind.clearsAfterMin * 60_000).toISOString()
        : null;
      out.push({
        id: `demo-${day}-${k}-${n}`,
        severity: kind.severity,
        source_id: source,
        asset_id: `${source}_${kind.asset}`,
        signal_name: kind.signal,
        display_name: kind.label,
        message: kind.message,
        timestamp_utc: new Date(at).toISOString(),
        cleared_utc: cleared,
      });
      seq++;
    }
  }
  void seq;
  return out.sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc));
}

/** Every event between two instants, newest first unless asked otherwise. */
function eventsBetween(fromMs: number, toMs: number): DemoEvent[] {
  const out: DemoEvent[] = [];
  for (let d = istDay(fromMs); d <= istDay(toMs); d++) {
    for (const e of eventsForDay(d)) {
      const t = Date.parse(e.timestamp_utc);
      if (t >= fromMs && t <= toMs) out.push(e);
    }
  }
  return out;
}

/* ── The endpoint table ───────────────────────────────────────────────────── */

const meta = (now: number) => ({
  _mode: "demo" as const,
  _note:
    "Synthetic demo plant — two UnityESS UESS-125-261 cabinets on a modelled " +
    "C&I load with rooftop PV. No reading here came from a gateway.",
  _playhead_ms: now,
});

const DEMO_TOKEN = "demo.synthetic-plant.token";

/**
 * Answer one gateway path from the model.
 *
 * Returns null for a path the demo has no equivalent for, so the caller can
 * refuse it rather than invent a shape the real gateway does not publish. That
 * is the same rule the removed capture followed and it is the one that keeps a
 * demo honest: a screen that is broken against the real gateway must be broken
 * here too, or the demo is worse than no demo.
 */
export function serveDemo(
  method: string,
  suffix: string,
  params: URLSearchParams,
  now = Date.now(),
): { status: number; body: unknown } | null {
  const m = meta(now);
  /* `sources/{id}/assets` is the same answer as `assets` narrowed to one
     source, and the gateway publishes both. Rewritten to the plain path with
     the id moved into the query rather than given a case of its own. */
  const perSource = /^sources\/([^/]+)\/assets$/.exec(suffix);
  if (perSource) {
    const narrowed = new URLSearchParams(params);
    narrowed.set("source_id", perSource[1]);
    return serveDemo(method, "assets", narrowed, now);
  }

  const askedSource = params.get("source_id") as SourceId | null;
  const sources: SourceId[] = askedSource && (DEMO_SOURCES as readonly string[]).includes(askedSource)
    ? [askedSource]
    : [...DEMO_SOURCES];

  if (method === "POST" && suffix === "auth/login") {
    /* Any credentials. The demo authenticates nothing — there is no plant
       behind it to protect — and a sign-in that could fail would just be a
       gate in front of a page with nothing private on it. */
    return {
      status: 200,
      body: { ...m, access_token: DEMO_TOKEN, token_type: "bearer", expires_in_sec: 28_800, role: "operator" },
    };
  }
  if (method !== "GET") return null;

  switch (suffix) {
    case "health":
      return {
        status: 200,
        body: {
          ...m, status: "ok", version: "demo", assets_online: 16,
          runtime_telemetry_points: 2_844,
          fast_logger: { enabled: true, interval_sec: 1, profile: "pcs_bms_critical_lean_90d" },
          storage: { backend: "model", telemetry_history_enabled: true },
        },
      };

    case "auth/me":
      return {
        status: 200,
        body: { ...m, username: "demo", role: "operator", source_ids: [...DEMO_SOURCES] },
      };

    case "sources/summary":
      return {
        status: 200,
        body: {
          ...m,
          sources: DEMO_SOURCES.map((id) => ({
            source_id: id,
            display_name: id === "external_ems_1" ? "Chinese EMS 1" : "Chinese EMS 2",
            online: true,
            signal_count: 1_422,
            last_seen_utc: new Date(now).toISOString(),
          })),
        },
      };

    case "assets":
      return {
        status: 200,
        body: {
          ...m,
          assets: sources.flatMap((s) =>
            ["pcs", "bms", "ems", "grid_meter", "liquid_cooling", "fire_protection", "dehumidifier", "io_module"]
              .map((base) => ({
                asset_id: `${s}_${base}`,
                base_asset_id: base === "grid_meter" ? "utility_meter"
                  : base === "ems" ? "ems_system"
                    : base === "pcs" ? "pcs_1"
                      : base === "bms" ? "bms_1" : base,
                display_name: base.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                source_id: s,
                online: true,
              })),
          ),
        },
      };

    case "telemetry":
    case "telemetry/key-signals":
      return { status: 200, body: { ...m, ...(telemetry(sources[0], now) as object) } };

    /* Shaped the way client.ts's getSolis actually reads it: `available` and
       `decision` at the top level, the inverter itself nested under `solis`
       with `enabled`, `online`, `state` and `active_power_kw`. The first
       version of this was flat, which parsed to available: false — so the
       screens would have shown "no solar reported" over a demo plant with a
       700 kWp array, and the bug would have looked like the app's rather than
       the fixture's. */
    case "solis/status": {
      const pv = solarKw(now);
      return {
        status: 200,
        body: {
          ...m,
          available: true,
          decision: pv > 5 ? "PV_SURPLUS_CHARGE" : "IDLE",
          timestamp_utc: new Date(now).toISOString(),
          solis: {
            enabled: true,
            online: true,
            state: "ON",
            active_power_kw: Number(pv.toFixed(2)),
          },
        },
      };
    }

    case "fast-bess/status":
    case "logger/status":
      return {
        status: 200,
        body: {
          ...m, enabled: true, thread_alive: true, interval_seconds: 1,
          profile_name: "pcs_bms_critical_lean_90d", write_mode: "value_only",
          selected_signal_count: SIGNALS.length, retention_days: 90, sources: DEMO_SOURCES.length,
        },
      };

    case "fast-bess/profile":
      return { status: 200, body: { ...m, profile_name: "pcs_bms_critical_lean_90d", signals: SIGNALS } };

    case "fast-bess/latest":
      return {
        status: 200,
        body: { ...m, rows: sources.map((s) => historyRow(s, now)) },
      };

    case "fast-bess/history": {
      const limit = Math.min(Number(params.get("limit") ?? 1_000) || 1_000, 20_000);
      const order = params.get("order") === "asc" ? "asc" : "desc";
      const to = Math.min(Number(params.get("to_epoch_ms") ?? now) || now, now);
      const from = Number(params.get("from_epoch_ms") ?? to - 3_600_000) || to - 3_600_000;

      /* Snapped to the row lattice so the same instant is a row whichever
         window asks for it. Without the snap, two chunks that overlap by a
         second would carry two different samples of the same moment and
         series.ts would integrate the overlap twice. */
      const first = Math.ceil(from / ROW_MS) * ROW_MS;
      const rows: ReturnType<typeof historyRow>[] = [];
      outer: for (let t = first; t <= to; t += ROW_MS) {
        for (const s of sources) {
          rows.push(historyRow(s, t));
          if (rows.length >= limit) break outer;
        }
      }
      if (order === "desc") rows.reverse();
      const last = rows.length ? rows[rows.length - 1].timestamp_epoch_ms : null;
      return {
        status: 200,
        body: {
          ...m, _resolution_sec: ROW_MS / 1000,
          rows, count: rows.length,
          has_more: rows.length >= limit,
          next_cursor: last,
        },
      };
    }

    case "alarms": {
      /* Asserted now, read from the model rather than from the event log —
         the same rule the real screens follow: /api/alarms is about the
         plant's present state, /api/logs is about what happened. */
      const active = sources.flatMap((s) => {
        const t = telemetry(s, now) as {
          assets: Record<string, { signals: Record<string, Point> }>;
        };
        const humidity = t.assets[`${s}_dehumidifier`].signals.alarm_status.value;
        const rows: Record<string, unknown>[] = [];
        if (humidity) {
          rows.push({
            source_id: s, bess_id: s.replace(/^external_ems_/, "bess_"),
            asset_id: `${s}_dehumidifier`, signal_name: "alarm_status",
            display_name: "Cabinet Humidity High", value: 1, severity: "warning",
            since_utc: new Date(now - 3 * 3_600_000).toISOString(),
          });
        }
        const spread = t.assets[`${s}_bms`].signals.max_min_cell_voltage_diff.value ?? 0;
        if (spread > 32) {
          rows.push({
            source_id: s, bess_id: s.replace(/^external_ems_/, "bess_"),
            asset_id: `${s}_bms`, signal_name: "max_min_cell_voltage_diff",
            display_name: "Cell Voltage Spread High", value: 1, severity: "minor",
            since_utc: new Date(now - 25 * 60_000).toISOString(),
          });
        }
        return rows;
      });
      return { status: 200, body: { ...m, alarms: active, count: active.length, active_count: active.length } };
    }

    case "logs": {
      const limit = Math.min(Number(params.get("limit") ?? 50) || 50, 500);
      const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
      const src = params.get("source");
      const search = (params.get("search") ?? "").toLowerCase();
      const fromTime = params.get("from_time");
      const toTime = params.get("to_time");
      const from = fromTime ? Date.parse(fromTime) : now - 30 * DAY_MS;
      const to = toTime ? Date.parse(toTime) : now;

      let rows = eventsBetween(
        Number.isFinite(from) ? from : now - 30 * DAY_MS,
        Number.isFinite(to) ? to : now,
      );
      if (src) rows = rows.filter((e) => e.source_id === src);
      if (search) {
        rows = rows.filter((e) =>
          `${e.display_name} ${e.message} ${e.asset_id} ${e.signal_name}`.toLowerCase().includes(search),
        );
      }
      if (params.get("order") !== "asc") rows.reverse();
      return {
        status: 200,
        body: { ...m, rows: rows.slice(offset, offset + limit), total: rows.length, count: rows.length },
      };
    }

    /* One stored signal's history, out of the snapshot store rather than the
       fast historian — which is what makes the per-cell families reachable on
       a time axis at all. See getStoredPoints for the three constraints this
       mirrors: one signal per call, no time range, and a cadence that is a
       deployment property rather than a documented one.

       SNAPSHOT_STORE_MS is this deployment's answer to the third. Five minutes
       is coarse next to the 1 Hz fast profile and is the right order for a
       2,844-point snapshot: at 2000 rows it reaches back about a week, which
       is enough window for a drift slope to be worth fitting. */
    case "storage/points": {
      const assetId = params.get("asset_id") ?? "";
      const signalName = params.get("signal_name") ?? "";
      const limit = Math.min(Number(params.get("limit") ?? 2_000) || 2_000, 20_000);
      const src = DEMO_SOURCES.find((s) => assetId.startsWith(`${s}_`));
      if (!src || !signalName) return { status: 200, body: { ...m, rows: [], count: 0 } };
      /* The runtime id is `{source}_{asset}`, and the asset part is what
         decides which register block answers. */
      const asset = assetId.slice(src.length + 1);

      const rows: Record<string, unknown>[] = [];
      /* Walked backwards from now and snapped to the store's lattice, so two
         signals asked for separately land on the same instants and the
         service can line them up. Without the snap every deviation would be
         computed across a half-interval gap. */
      const newest = Math.floor(now / SNAPSHOT_STORE_MS) * SNAPSHOT_STORE_MS;
      for (let i = limit - 1; i >= 0; i--) {
        const t = newest - i * SNAPSHOT_STORE_MS;
        const value = storedSignalAt(src, asset, signalName, t);
        if (value == null) continue;
        rows.push({
          asset_id: assetId,
          signal_name: signalName,
          source_timestamp: new Date(t).toISOString(),
          ingest_timestamp: new Date(t + 400).toISOString(),
          numeric_value: Math.round(value * 1000) / 1000,
          quality: "good",
        });
      }
      /* Newest first, the way a `limit` on a descending store answers. The
         service sorts rather than trusting this, which is correct of it. */
      rows.reverse();
      return { status: 200, body: { ...m, rows, count: rows.length } };
    }

    case "storage/status":
    case "storage/health":
      return {
        status: 200,
        body: {
          ...m, ok: true, backend: "model", telemetry_history_enabled: true,
          retention_days: 90, database_size_mb: 1_842, oldest_row_utc: new Date(COMMISSIONED_MS).toISOString(),
        },
      };

    case "config/runtime":
      return { status: 200, body: { ...m, poll_interval_sec: 1, write_enabled: false, demo: true } };

    case "control/soc-protection/status":
      return {
        status: 200,
        body: {
          ...m, enabled: true, mode: "solar", floor_pct: 15, ceiling_pct: 97,
          decision: solarKw(now) > 5 ? "PV_SURPLUS_CHARGE" : "HOLD",
        },
      };

    case "server-upload/status":
      return { status: 200, body: { ...m, enabled: false, last_success_utc: null } };

    default:
      return null;
  }
}
