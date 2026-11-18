/**
 * The demo plant, for the `customer` / `customer` sign-in.
 *
 * Nothing here is a recording of a real site, but it is modelled on one: the
 * commissioned site's own data (21 Oct 2026) — an off-grid site with one 110 kW
 * Solis inverter and two 261 kWh cabinets feeding a spiky 2–40 kW load. The
 * cabinets charge off the solar through the morning, the controller derates
 * the inverter to 20 kW at 90 % and turns it off at 98 %, and the load drains
 * them overnight in a straight line. Unlike the real site, which bottoms out
 * near 60 %, the demo runs each cabinet all the way down to 0 % before dawn.
 *
 * Every value is computed from the clock, so the plant is "live" and every
 * range — an hour, a day, a week — is complete, and two people looking at the
 * same minute see the same numbers.
 *
 * ── How it is wired ────────────────────────────────────────────────────────
 *
 * The demo sign-in returns a token this module minted. The /api/central proxy
 * and the app's own server routes (fast-slices, history, monthly-discharge,
 * alarm-acks) check for it FIRST and answer from here, so the token never
 * reaches the central backend and never reads, writes or subscribes to
 * anything real. verifyBearer is untouched on purpose: a route nobody taught
 * about the demo refuses it (401) rather than serving the real site to it.
 *
 * The rows have the backend's own shapes (lib/central/*), so no screen knows
 * it is looking at a demo.
 */

import pointCatalog from "@/lib/central/pointCatalog.json";

/* ── The account ──────────────────────────────────────────────────────────── */

export const DEMO_LOGIN = "customer";
export const DEMO_PASSWORD = "customer";
const DEMO_SIG = "demo";
const TOKEN_TTL_MS = 30 * 86_400_000;

export const DEMO_USER = {
  id: "demo-customer",
  username: "Demo Customer",
  email: "customer@demo.unityess",
  roles: ["customer", "demo"],
};

export { DEMO_GATEWAY_ID } from "@/lib/central/demoGateway";

const b64url = (s: string) => Buffer.from(s).toString("base64url");

export const isDemoCredentials = (email: unknown, password: unknown): boolean =>
  typeof email === "string" && typeof password === "string" &&
  email.trim().toLowerCase() === DEMO_LOGIN && password === DEMO_PASSWORD;

/** A JWT-shaped token: session.ts reads `exp` off the middle part. */
export function mintDemoToken(): string {
  const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub: DEMO_USER.id, demo: true, exp: Math.floor((Date.now() + TOKEN_TTL_MS) / 1000) }));
  return `${header}.${payload}.${DEMO_SIG}`;
}

/**
 * True for a demo bearer. Unsigned on purpose: holding one only ever gets the
 * synthetic plant, so there is nothing a forged one could unlock.
 */
export function isDemoBearer(auth: string | null): boolean {
  const token = /^Bearer\s+(\S+)$/i.exec(auth ?? "")?.[1];
  if (!token) return false;
  const [, payload, sig] = token.split(".");
  if (sig !== DEMO_SIG || !payload) return false;
  try {
    return (JSON.parse(Buffer.from(payload, "base64url").toString()) as { demo?: unknown }).demo === true;
  } catch {
    return false;
  }
}

/* ── The plant ────────────────────────────────────────────────────────────── */

const SEC = 1000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const IST = 330 * MIN;
/** Cadence of every stream. Fine enough to read as live, coarse enough that a
 *  day pages in whole (6 × 1,000 rows = 50 h), so no range is left half-drawn. */
const CADENCE = 30 * SEC;

interface Cabinet { source: string; bess: string; ctl: "X" | "Y"; host: string; shiftMs: number }
/* The second cabinet runs about 20 minutes behind the first, as on site. */
const CABINETS: Cabinet[] = [
  { source: "external_ems_1", bess: "bess_1", ctl: "X", host: "192.168.100.151", shiftMs: 0 },
  { source: "external_ems_2", bess: "bess_2", ctl: "Y", host: "192.168.100.153", shiftMs: 20 * MIN },
];

const RATED_KW = 130;      // the PCS rated-power register on site
const RATED_KWH = 261;
const CELLS = 260;
const SOLIS_KW = 110;
const DERATE_KW = 20;
const SOC_FULL = 98;
const SOC_DERATE = 90;
const SOC_RECOVERY = 75;
/** Commissioning day: lifetime counters count whole days from here (~9,000 kWh
 *  discharged by late October, as on site). */
const DAY0 = Date.parse("2026-09-15T00:00:00+05:30");

/** Deterministic noise in [-1, 1) for a key and a time (to the second). */
function noise(key: string, t: number): number {
  /* The key is hashed first and the time mixed in after, with a full avalanche
     on both, so neighbouring seconds — and neighbouring days — come out
     unrelated rather than as near-twins. */
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const x = Math.floor(t / 1000);
  h ^= Math.imul(x | 0, 0x9e3779b1);
  h ^= Math.imul((x / 4294967296) | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 31 - 1;
}
/** Noise that holds for a while — the load steps and clouds pass, they do not flicker. */
const minuteNoise = (key: string, t: number, minutes = 1) => noise(key, Math.floor(t / (minutes * MIN)) * minutes * MIN);
/** Noise that holds for a whole cycle (or any other integer index). */
const u01 = (key: string, i: number) => (noise(key, i * SEC) + 1) / 2;

const istHour = (t: number) => ((((t + IST) % DAY) + DAY) % DAY) / HOUR;
const istDay = (t: number) => Math.floor((t + IST) / DAY);
const iso = (t: number) => new Date(t).toISOString();
const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ── The daily cycle ──────────────────────────────────────────────────────────

   A cabinet's day runs from 07:00 to 07:00 IST (shifted by its lag), as a
   "cycle": empty at dawn → charged off the solar → limited at 90 % → full at
   98 % → drained by the load to 0 % before the next dawn. No two cycles are
   the same. Each has its own weather (two days in three clear, some hazy, the
   odd cloudy one that never reaches the derate) and its own overnight load,
   so the drain ends anywhere from 05:30 to 06:45. Hours below are counted
   from the cycle's 07:00. */

const CYCLE_START_H = 7;

interface Cycle {
  /** Index of the cycle (the IST day it starts on). */
  cd: number;
  /** Sky clearness 0.4–1. */
  wx: number;
  clear: boolean;
  /** Charging starts / ends; derate ends; hold ends; drain ends (hours from 07:00). */
  start: number; chargeTo: number; derateTo: number; fullTo: number; drainTo: number;
  /** SOC the charge reaches before any derate, and the cycle's top. */
  chargeTop: number; top: number;
}

const cycleCache = new Map<string, Cycle>();

/** The cycle `cd` for cabinet `c` (weather is the site's; the load wobbles per cabinet). */
function cycleOf(c: Cabinet, cd: number): Cycle {
  const key = `${c.bess}|${cd}`;
  const hit = cycleCache.get(key);
  if (hit) return hit;
  const u = u01("wx", cd);
  const wx = u < 0.66 ? 0.9 + 0.1 * u01("wx2", cd) : u < 0.9 ? 0.68 + 0.2 * u01("wx2", cd) : 0.42 + 0.22 * u01("wx2", cd);
  const clear = wx >= 0.85;
  const start = 0.05 + 0.35 * (1 - wx) + 0.12 * u01("st", cd);
  const chargeTo = clear ? 6.3 + 0.5 * u01("ct", cd) : 8.6 + 0.6 * u01("ct", cd);
  const chargeTop = clear ? SOC_DERATE : clamp(Math.round(102 * wx), 42, 88);
  const derateTo = clear ? chargeTo + 1.8 + 0.5 * u01("dt", cd) : chargeTo;
  const top = clear ? SOC_FULL : chargeTop;
  const fullTo = clear ? derateTo + 0.2 + 0.15 * u01("ft", cd) : derateTo;
  const drainTo = 22.45 + 1.2 * u01("load", cd) + 0.12 * noise(c.bess + "dz", cd * SEC);
  const cy: Cycle = { cd, wx, clear, start, chargeTo, derateTo, fullTo, drainTo, chargeTop, top };
  cycleCache.set(key, cy);
  if (cycleCache.size > 4000) cycleCache.clear();
  return cy;
}

/** The cycle a moment belongs to, and the hours since that cycle's 07:00. */
function cycleAt(c: Cabinet, t: number): { cy: Cycle; hh: number } {
  const local = t - c.shiftMs + IST - CYCLE_START_H * HOUR;
  const cd = Math.floor(local / DAY);
  return { cy: cycleOf(c, cd), hh: (local - cd * DAY) / HOUR };
}

type Phase = "empty" | "charge" | "derate" | "full" | "drain";
interface State { phase: Phase; hh: number; soc: number; ratePctH: number; cy: Cycle }

/** Where a cabinet is in its cycle: phase, SOC % and SOC rate (%/h, + charging). */
function stateAt(c: Cabinet, t: number): State {
  const { cy, hh } = cycleAt(c, t);
  if (hh < cy.start || hh >= cy.drainTo) return { phase: "empty", hh, soc: 0, ratePctH: 0, cy };
  if (hh < cy.chargeTo) {
    /* Half linear, half the solar bell: the rate peaks near noon at ~45 kW a
       cabinet on a clear day, so the two together stay inside the inverter. */
    const span = cy.chargeTo - cy.start, x = (hh - cy.start) / span;
    const soc = cy.chargeTop * (0.5 * x + 0.25 * (1 - Math.cos(Math.PI * x)));
    const ratePctH = cy.chargeTop / span * (0.5 + 0.25 * Math.PI * Math.sin(Math.PI * x));
    return { phase: "charge", hh, soc, ratePctH, cy };
  }
  if (hh < cy.derateTo) {
    const r = (SOC_FULL - SOC_DERATE) / (cy.derateTo - cy.chargeTo);
    return { phase: "derate", hh, soc: SOC_DERATE + r * (hh - cy.chargeTo), ratePctH: r, cy };
  }
  if (hh < cy.fullTo) return { phase: "full", hh, soc: cy.top, ratePctH: 0, cy };
  const r = cy.top / (cy.drainTo - cy.fullTo);
  return { phase: "drain", hh, soc: Math.max(0, cy.top - r * (hh - cy.fullTo)), ratePctH: -r, cy };
}

/** Displayed SOC: the BMS reports in tenths. */
const socAt = (c: Cabinet, t: number) => round(stateAt(c, t).soc, 1);

/**
 * PCS AC power, kW, + discharge / − charge. Around the SOC slope, shaped like
 * the site's: overnight a ~10 kW base with load steps to 30–45 kW (the real
 * site reads 2 kW with steps to 25), by day the solar surplus with cloud —
 * more of it on a hazy or cloudy day.
 */
function powerAt(c: Cabinet, t: number): number {
  const s = stateAt(c, t);
  const avgKw = Math.abs(s.ratePctH) / 100 * RATED_KWH;
  const n = minuteNoise(c.bess + "load", t, 6);
  switch (s.phase) {
    case "empty": return 0;
    case "full": return round(1.4 + 1.2 * noise(c.bess + "f", t), 1);
    case "drain": {
      /* 30 % of the time carries a step; the mix averages to 1.0 × the slope. */
      const step = n > 0.4 ? 2.05 + 0.3 * minuteNoise(c.bess + "st", t, 2) : 0.56 + 0.12 * n + 0.05 * noise(c.bess + "j", t);
      return round(avgKw * step, 1);
    }
    default: {
      const haze = 1 - s.cy.wx;
      const passing = minuteNoise("cloud", t, 4) > 0.8 - haze ? 0.35 + 0.3 * haze : 0;
      const cloud = 1 + (0.12 + 0.3 * haze) * n + 0.04 * noise(c.bess + "j", t) - passing;
      return round(-avgKw * Math.max(0.15, cloud), 1);
    }
  }
}

/* ── Energy counters ──────────────────────────────────────────────────────── */

/**
 * Each cycle's conversion: discharge out per kWh of SOC used, and charge in
 * per kWh stored. They wander cycle to cycle (temperature, how hard the
 * cabinet was driven), so round-trip efficiency reads 85–89 %, not one line.
 */
const cycleEff = (c: Cabinet, cd: number) => ({
  dis: 0.972 + 0.012 * noise(c.bess + "ed", cd * SEC),
  chg: 1 / (0.962 + 0.01 * noise(c.bess + "ec", cd * SEC)),
});

/** SOC-% moved so far in the cycle at `hh`: charged in, discharged out. */
function movedPct(cy: Cycle, hh: number, s: State): { chg: number; dis: number } {
  if (hh < cy.start) return { chg: 0, dis: 0 };
  if (s.phase === "charge" || s.phase === "derate") return { chg: s.soc, dis: 0 };
  if (s.phase === "full") return { chg: cy.top, dis: 0 };
  return { chg: cy.top, dis: cy.top - s.soc };            // draining, or empty after it
}

const CYCLE0_OFFSET = CYCLE_START_H * HOUR;
const lifetimeCache = new Map<string, number>();

/** Whole cycles since commissioning, summed (cached per cabinet, kind and cycle). */
function cyclesKwh(c: Cabinet, upTo: number, kind: "dis" | "chg"): number {
  const first = Math.floor((DAY0 + IST - CYCLE0_OFFSET) / DAY);
  const key = `${c.bess}|${kind}|${upTo}`;
  const hit = lifetimeCache.get(key);
  if (hit != null) return hit;
  let kwh = 0;
  for (let cd = first; cd < upTo; cd++) kwh += cycleOf(c, cd).top / 100 * RATED_KWH * cycleEff(c, cd)[kind];
  lifetimeCache.set(key, kwh);
  if (lifetimeCache.size > 2000) lifetimeCache.clear();
  return kwh;
}

/** A lifetime counter: every whole cycle since commissioning, plus this one so far. */
function lifetimeKwh(c: Cabinet, t: number, kind: "dis" | "chg"): number {
  if (t < DAY0) return 0;
  const s = stateAt(c, t);
  const part = movedPct(s.cy, s.hh, s)[kind] / 100 * RATED_KWH * cycleEff(c, s.cy.cd)[kind];
  return round(cyclesKwh(c, s.cy.cd, kind) + part, 1);
}

/** Counter rise since IST midnight on the 1st of the month (or Jan 1st). */
function sinceKwh(c: Cabinet, t: number, kind: "dis" | "chg", unit: "month" | "year"): number {
  const d = new Date(t + IST);
  const start = Date.UTC(d.getUTCFullYear(), unit === "month" ? d.getUTCMonth() : 0, 1) - IST;
  return round(lifetimeKwh(c, t, kind) - lifetimeKwh(c, Math.max(start, DAY0), kind), 1);
}

/* ── Controller and solar ─────────────────────────────────────────────────── */

type CtlState = "NORMAL" | "BOTH_SOLAR_DERATED" | "BOTH_HIGH_SOLAR_OFF";

/** The controller's state and decision, as v1.14_soc_solar_derate_90_98 names them. */
function ctlAt(t: number): { state: CtlState; decision: string } {
  const s = CABINETS.map((c) => stateAt(c, t));
  /* Both reached 98 % this cycle: solar off until both are back under 75 %. */
  const latched = s.every((x) => x.cy.top >= SOC_FULL && (x.phase === "full" || (x.phase === "drain" && x.soc >= SOC_RECOVERY)));
  if (latched) return { state: "BOTH_HIGH_SOLAR_OFF", decision: "both_high_solar_off_waiting_for_recovery" };
  if (s.every((x) => x.soc >= SOC_DERATE && (x.phase === "derate" || x.phase === "full"))) {
    return { state: "BOTH_SOLAR_DERATED", decision: "both_above_90_keep_bess_on_solar_derated" };
  }
  /* The first quarter hour after the latch lets go. */
  const recovered = s[0].cy.top >= SOC_FULL && s[0].phase === "drain" && s[0].soc < SOC_RECOVERY && s[0].soc > SOC_RECOVERY - 2;
  return { state: "NORMAL", decision: recovered ? "post_both_high_recovered_solar_normal_both_bess_on" : "normal_keep_both_on_solar_normal" };
}

/** Site load by day, kW — what the panels carry beside the charging. */
const dayLoadKw = (t: number) => round(13 + 4 * minuteNoise("dayload", t, 3), 1);

/** Today's sky, 0.4–1 (the first cabinet's cycle). */
const skyOf = (t: number) => cycleAt(CABINETS[0], t).cy.wx;

/** Solis output, kW: the load plus what the cabinets take, capped by the sky. */
function solarKw(t: number): number {
  const h = istHour(t);
  if (h < 6.4 || h > 18.2) return 0;
  const wx = skyOf(t);
  const bell = Math.sin(Math.PI * (h - 6.4) / 11.8) ** 1.1;
  const sky = SOLIS_KW * 1.02 * bell * wx * (1 - (1 - wx) * 0.6 * Math.max(0, minuteNoise("cl", t, 3)));
  const { state } = ctlAt(t);
  if (state === "BOTH_HIGH_SOLAR_OFF") return 0;
  if (state === "BOTH_SOLAR_DERATED") return round(Math.min(sky, DERATE_KW + 0.15 * noise("der", t)), 2);
  const charging = CABINETS.reduce((sum, c) => sum + Math.max(0, -powerAt(c, t)), 0);
  const want = charging + (charging > 0 ? dayLoadKw(t) : 0);
  return round(clamp(want, 0, Math.min(sky, SOLIS_KW)), 2);
}

/* ── The grid connection ──────────────────────────────────────────────────────

   The real site runs off-grid and its meter reads zero. The demo has a
   working connection, used only where it would be: it carries the load while
   both cabinets sit empty before dawn (import), and a few kW of solar spill
   out while the inverter is being limited near full (export, inside the
   cabinets' own 3–7 kW anti-reverse-flow band). That is what Maximum Demand
   and Self-Consumption & Export read. */

const IMPORT_KW = 7.5;     // per cabinet that is empty
const EXPORT_KW = 2.2;     // per cabinet in the derate
const FWD0 = 61_240;       // meter readings at commissioning, kWh
const REV0 = 3_180;

/** Grid import (+) / export (−), kW. */
function gridKw(t: number): number {
  let kw = 0;
  for (const c of CABINETS) {
    const s = stateAt(c, t);
    if (s.phase === "empty") kw += IMPORT_KW + 1.4 * minuteNoise(c.bess + "imp", t, 2);
    if (s.phase === "derate") kw -= EXPORT_KW + 0.6 * minuteNoise(c.bess + "exp", t, 2);
  }
  return round(kw, 2);
}

/** Hours a cycle spends importing / exporting, up to `hh` (or all of it). */
function gridHours(cy: Cycle, hh = 24): { imp: number; exp: number } {
  const before = Math.min(hh, cy.start);
  const after = Math.max(0, Math.min(hh, 24) - cy.drainTo);
  return { imp: before + after, exp: clamp(hh - cy.chargeTo, 0, cy.derateTo - cy.chargeTo) };
}

/** The meter's forward (import) / reverse (export) energy register, kWh. */
function meterKwh(t: number, kind: "imp" | "exp"): number {
  let kwh = kind === "imp" ? FWD0 : REV0;
  const rate = kind === "imp" ? IMPORT_KW : EXPORT_KW;
  for (const c of CABINETS) {
    const { cy, hh } = cycleAt(c, t);
    const first = Math.floor((DAY0 + IST - CYCLE0_OFFSET) / DAY);
    const key = `${c.bess}|${kind}|grid|${cy.cd}`;
    let whole = lifetimeCache.get(key);
    if (whole == null) {
      whole = 0;
      for (let cd = first; cd < cy.cd; cd++) whole += gridHours(cycleOf(c, cd))[kind] * rate;
      lifetimeCache.set(key, whole);
    }
    kwh += whole + gridHours(cy, hh)[kind] * rate;
  }
  return round(kwh, 1);
}

/** What the site is drawing, kW: the battery and grid by night, the panels by day. */
function loadKw(t: number): number {
  const batt = CABINETS.reduce((s, c) => s + Math.max(0, powerAt(c, t)), 0);
  const charging = CABINETS.some((c) => powerAt(c, t) < -0.5);
  return round(batt + Math.max(0, gridKw(t)) + (charging ? dayLoadKw(t) : 0), 1);
}

/* ── Cells ────────────────────────────────────────────────────────────────── */

/* LFP open-circuit voltage, mV, by SOC — flat through the middle, as the site's
   cells read 3,303–3,319 mV between 66 and 88 % and 3,345 at 98. */
const OCV: [number, number][] = [[0, 2985], [3, 3110], [8, 3195], [15, 3245], [30, 3280], [50, 3298], [70, 3311], [88, 3320], [95, 3334], [98, 3345], [100, 3390]];
function ocv(soc: number): number {
  for (let i = 1; i < OCV.length; i++) {
    const [s1, v1] = OCV[i], [s0, v0] = OCV[i - 1];
    if (soc <= s1) return v0 + (v1 - v0) * (soc - s0) / (s1 - s0);
  }
  return OCV[OCV.length - 1][1];
}

/** Average cell voltage, mV: OCV plus the IR rise charging and sag discharging. */
const cellMv = (c: Cabinet, t: number) => {
  const p = powerAt(c, t);
  return ocv(socAt(c, t)) + (p < 0 ? -p * 0.62 : -p * 0.45);
};
/** Max − min cell, mV: 1–2 at rest, wider under current and near empty. */
const cellSpread = (c: Cabinet, t: number) => {
  const p = Math.abs(powerAt(c, t)), soc = socAt(c, t);
  return Math.round(1 + p / 9 + (soc < 10 ? (10 - soc) * 2.6 : 0) + Math.abs(noise(c.bess + "sp", t)));
};
const packV = (c: Cabinet, t: number) => cellMv(c, t) * CELLS / 1000;
/** Average cell temperature, °C: the chiller holds 24–26 all day. */
const cellTempC = (c: Cabinet, t: number) =>
  24.3 + 0.012 * Math.abs(powerAt(c, t)) + 0.5 * Math.sin((istHour(t) - 9) / 24 * 2 * Math.PI) + 0.1 * noise(c.bess + "t", Math.floor(t / 300_000) * 300_000);
/** Outdoor air, °C: 26 at dawn, 37 mid-afternoon. */
const outdoorC = (t: number) => round(31.5 + 5.5 * Math.sin((istHour(t) - 9.5) / 24 * 2 * Math.PI) + 0.3 * noise("out", t), 1);

/* ── S1 fast-bess ─────────────────────────────────────────────────────────── */

function fastSample(c: Cabinet, t: number) {
  const p = powerAt(c, t), soc = socAt(c, t);
  const mv = cellMv(c, t), spread = cellSpread(c, t), pack = mv * CELLS / 1000;
  const dcV = pack - 0.5 - 0.004 * Math.abs(p);
  const n = (k: string, a: number) => noise(c.bess + k, t) * a;
  const iPhase = Math.sqrt((p * 1000 / (3 * 237)) ** 2 + 10.6 ** 2);
  const temp = cellTempC(c, t);
  const cds = p > 1 ? 1 : p < -1 ? 2 : 0;
  const bmsI = p * 1000 / pack;
  const pcs_values: Record<string, number> = {
    soc,
    dc_current: round(p * 1000 / dcV + n("dci", 0.4), 1),
    dc_voltage: round(dcV, 1),
    fault_status: 0,
    grid_frequency: round((p < -20 ? 50.3 : p < 0 ? 50.05 : 49.95) + n("f", 0.04), 2),
    on_grid_status: 0,
    off_grid_status: 1,
    phase_a_current: round(iPhase + n("ia", 0.6), 1),
    phase_a_voltage: round(236 + n("va", 5), 1),
    phase_b_current: round(iPhase + n("ib", 0.6), 1),
    phase_b_voltage: round(236 + n("vb", 5), 1),
    phase_c_current: round(iPhase + n("ic", 0.6), 1),
    phase_c_voltage: round(236.5 + n("vc", 5), 1),
    running_status_2: 1,
    bms_online_status: 1,
    pcs_online_status: 1,
    total_active_power: p,
    total_alarm_status: 0,
    total_fault_status: 0,
    charge_discharge_power: 0,
    hw_fault_ac_over_current: 0, sw_fault_ac_over_current: 0, sw_fault_ac_over_voltage: 0, sw_fault_ac_under_voltage: 0,
    sw_fault_ac_over_frequency: 0, sw_fault_ac_under_frequency: 0, sw_fault_dc_charge_over_current: 0, sw_fault_dc_discharge_over_current: 0,
  };
  const bms_values: Record<string, number> = {
    soh: 100,
    fuse_fault: 0,
    display_soc: soc,
    system_status: 0,
    contactor_fault: 0,
    cell_max_voltage: Math.round(mv + spread / 2),
    cell_min_voltage: Math.round(mv - spread / 2),
    insulation_fault: 0,
    average_temperature: round(temp, 1),
    charge_over_current: 0,
    cluster_total_current: round(bmsI + n("ci", 0.3), 1),
    insulation_resistance: 20000,
    voltage_sampling_fault: 0,
    battery_max_temperature: round(temp + 1.7, 1),
    battery_min_temperature: round(temp - 0.5, 1),
    bau_communication_fault: 0,
    bmu_communication_fault: 0,
    charge_discharge_status: cds,
    pcs_communication_fault: 0,
    pre_charge_total_voltage: round(pack + 10, 1),
    can_hall_sampling_current: round(bmsI + n("hi", 0.4), 1),
    cell_over_voltage_level_1: 0,
    max_min_cell_voltage_diff: spread,
    negative_contactor_status: 1,
    cell_under_voltage_level_1: 0,
    insulation_monitoring_fault: 0,
    pre_charge_contactor_status: 0,
    discharge_over_current_level_1: 0,
    cluster_total_voltage_collected: round(pack, 1),
    battery_temperature_sensor_fault: 0,
    battery_pack_over_voltage_alarm_voltage_value: 0,
    battery_pack_under_voltage_alarm_voltage_value: 0,
    current_sampling_fault_functional_safety_fault: 0,
    battery_charge_over_current_alarm_current_value: 0,
    battery_discharge_over_current_alarm_current_value: 0,
  };
  return {
    source_id: c.source,
    bess_id: c.bess,
    sample_time_utc: iso(t),
    received_at_utc: iso(t + 1550),
    quality: "good",
    max_data_age_ms: 900 + Math.round(Math.abs(n("age", 5000))),
    data: {
      bess_id: c.bess, quality: "good", source_id: c.source,
      record_type: "fast_bess_sample",
      pcs_values, bms_values,
      pcs_asset_id: `${c.source}_pcs`, bms_asset_id: `${c.source}_bms`,
      profile_name: "pcs_bms_critical_lean_90d",
      sample_source: "asset_manager_live_cache",
      timestamp_utc: iso(t), schema_version: 1,
      pcs_signal_count: 28, bms_signal_count: 35,
      good_signal_count: 63, bad_signal_count: 0, selected_signal_count: 63,
      pcs_good_signal_count: 28, bms_good_signal_count: 35, pcs_bad_signal_count: 0, bms_bad_signal_count: 0,
    },
  };
}

/** The newest sample time there is: on the cadence, a couple of seconds behind now. */
const latest = (now = Date.now()) => Math.floor((now - 2000) / CADENCE) * CADENCE;

/** Grid times in [from, to), newest first, at most `limit`. */
function times(from: number, to: number, step: number, limit: number): number[] {
  const out: number[] = [];
  let t = Math.floor(Math.min(to - 1, latest()) / step) * step;
  for (; t >= from && out.length < limit; t -= step) out.push(t);
  return out;
}

function cabinetsFor(bessId: string | null): Cabinet[] {
  return bessId ? CABINETS.filter((c) => c.bess === bessId || c.source === bessId) : CABINETS;
}

function fastBess(q: URLSearchParams) {
  const limit = clampLimit(q, 50);
  const { from, to } = windowOf(q, limit * CADENCE);
  const cabs = cabinetsFor(q.get("bess_id"));
  const out = [];
  for (const t of times(from, to, CADENCE, limit)) {
    for (const c of cabs) { if (out.length < limit) out.push(fastSample(c, t)); }
  }
  return out;
}

/** One sample per window: the window's newest, or none. */
export function demoFastSlices(bessId: string, windows: [number, number][]) {
  const c = cabinetsFor(bessId)[0];
  if (!c) return windows.map(() => []);
  return windows.map(([a, b]) => {
    const t = times(a, b, CADENCE, 1)[0];
    return t == null ? [] : [fastSample(c, t)];
  });
}

/* ── S2 general ───────────────────────────────────────────────────────────── */

type CatalogRow = [string[], string, string | null, string];
const POINTS = Object.entries((pointCatalog as unknown as { points: Record<string, CatalogRow> }).points);

/** substream → [catalog device type, asset suffix]. */
const SUBSTREAM_ASSET: Record<string, [string, string]> = {
  ems_system: ["ems_system", "ems_system"],
  pcs_extended: ["pcs", "pcs"],
  bms_extended: ["bms", "bms"],
  utility_meter: ["grid_meter", "grid_meter"],
  liquid_cooling: ["liquid_cooling", "liquid_cooling"],
  fire_protection: ["fire_protection", "fire_protection"],
  dehumidifier: ["dehumidifier", "dehumidifier"],
  io_module: ["io_module", "io_module"],
  remote_control: ["remote_control", "remote_control"],
};

/**
 * Registers that hold still, with the values the site's read on 21 Oct 2026.
 * Keyed `type:signal`; anything not listed and not computed below reads 0,
 * which is what most of the site's ~1,400 registers per cabinet read too.
 * The grid meter and remote control read all zeros on site (the meter is not
 * communicating), and so they do here.
 */
const STATIC: Record<string, number> = {
  "ems_system:power_on_command": 1, "ems_system:pcs_power_on_off_control": 1, "ems_system:pcs_status": 1,
  "ems_system:pcs_running_status": 2, "ems_system:e_stop_timer": 5, "ems_system:fire_protection_communication_status": 1,
  "ems_system:demand": 100, "ems_system:manual_mode_control": 2, "ems_system:charge_discharge_control_mode": 2,
  "ems_system:soc_limit_enable": 1, "ems_system:charge_cutoff_soc_setting": 75, "ems_system:discharge_cutoff_soc_setting": 3,
  "ems_system:master_charge_cutoff_soc_setting": 97, "ems_system:master_discharge_cutoff_soc_setting": 3,
  "ems_system:control_step": 1, "ems_system:control_cycle": 2, "ems_system:demand_limit_percentage": 90,
  "ems_system:anti_reverse_flow_power_lower_limit_setting": 3, "ems_system:anti_reverse_flow_power_upper_limit_setting": 7,
  "ems_system:off_grid_shutdown_soc": 5, "ems_system:available_count": 1, "ems_system:master_slave_mode": 1,
  "ems_system:auto_mode_control": 1, "ems_system:master_control_mode": 1, "ems_system:remote_control_mode": 1,
  "ems_system:running_indicator": 1, "ems_system:master_off_grid_shutdown_soc_dispatch": 10,

  "pcs:pcs_communication_status_word": 7923, "pcs:liquid_cooling_equipment_status": 3,
  "pcs:bms_max_available_discharge_current": 157, "pcs:bms_max_available_charge_current": 157,
  "pcs:bms_available_discharge_power": 136.42, "pcs:bms_available_charge_power": 136.42,
  "pcs:auto_available_status": 1, "pcs:liquid_cooling_online_status": 1, "pcs:online_points": 1, "pcs:vf_off_grid_status": 1,
  "pcs:bms_operating_status": 48059, "pcs:start_stop_control": 1, "pcs:power_on_control": 1, "pcs:auto_start_stop_command": 1,
  "pcs:equipment_start": 1, "pcs:charge_discharge_control_mode": 2, "pcs:running_status": 2, "pcs:pcs_running_status": 2,
  "pcs:off_grid_phase_a_voltage_setting": 230, "pcs:off_grid_phase_b_voltage_setting": 230, "pcs:off_grid_phase_c_voltage_setting": 230,
  "pcs:power_factor_setting": 1, "pcs:leakage_current_threshold_setting": 1500, "pcs:insulation_resistance_threshold_setting": 0.05,
  "pcs:rated_power": RATED_KW, "pcs:soc_limit_enable": 1, "pcs:charge_cutoff_soc_setting": 75, "pcs:discharge_cutoff_soc_setting": 3,
  "pcs:action_timeout_setting": 30, "pcs:offline_timeout_setting": 10, "pcs:off_grid_shutdown_soc": 5,
  "pcs:off_grid_output_voltage_setpoint": 230, "pcs:action_time": 30, "pcs:offline_time": 10, "pcs:on_off_grid_switching": 1,
  "pcs:battery_pre_charge_control": 3, "pcs:off_grid_power_on_timer": -1, "pcs:control_mode": 1, "pcs:remote_local_setting": 1,
  "pcs:remote_local_status": 1, "pcs:operating_mode_selection": 3, "pcs:on_off_grid_setting": 1,
  "pcs:active_power_control_method": 1, "pcs:insulation_detection_enable": 1, "pcs:leakage_current_value": 0.23,
  "pcs:insulation_resistance_value": 1888,

  "bms:positive_contact_status": 1, "bms:isolation_switch_feedback_status": 1, "bms:online_points": 1, "bms:pre_power_on_phase": 3,
  "bms:cell_max_voltage_id": 2, "bms:max_cell_module_id": 1, "bms:max_cell_id_in_module": 2, "bms:cell_min_voltage_id": 1,
  "bms:min_cell_module_id": 1, "bms:min_cell_id_in_module": 1, "bms:battery_max_temperature_id": 129, "bms:max_temp_slave_id": 5,
  "bms:max_temp_id_in_module": 1, "bms:battery_min_temperature_id": 83, "bms:min_temp_module_id": 3, "bms:min_temp_id_in_module": 19,
  "bms:max_pole_temperature": -40, "bms:max_pole_module_id": 1, "bms:battery_max_temperature_diff": 2.2,
  "bms:cluster_max_cell_temp_rise_pack_id": 1, "bms:cluster_max_cell_temp_rise_cell_temp_id_in_pack": 1,
  "bms:cluster_max_cell_temp_rise_id_among_all_cells": 1, "bms:positive_end_insulation_resistance": 20000,
  "bms:negative_end_insulation_resistance": 20000, "bms:power_supply_sampling_voltage": 23920, "bms:pre_charge_end_voltage_diff": 15,
  "bms:max_acceptable_discharge_current": 157, "bms:max_acceptable_charge_current": 157,

  "liquid_cooling:online_points": 1, "liquid_cooling:power_on_off": 1, "liquid_cooling:cooling_battery_max_temperature": 28,
  "liquid_cooling:cooling_battery_avg_temperature": 25, "liquid_cooling:heating_battery_min_temperature": 12,
  "liquid_cooling:heating_battery_avg_temperature": 15, "liquid_cooling:inlet_outlet_water_pressure_diff": 6552.9,
  "liquid_cooling:system_heating_demand": 6353.6, "liquid_cooling:system_cooling_demand": 35,
  "liquid_cooling:unit_operating_mode": 1, "liquid_cooling:unit_control_mode": 3,
  "liquid_cooling:outlet_high_pressure_alarm_value": 2.9, "liquid_cooling:inlet_low_pressure_alarm_value": 0.3,
  "liquid_cooling:outlet_high_temp_alarm_value": 40, "liquid_cooling:outlet_low_temp_alarm_value": 5,
  "liquid_cooling:cooling_set_temperature": 23, "liquid_cooling:heating_set_temperature": 12,
  "liquid_cooling:cooling_battery_temp_hysteresis": 3, "liquid_cooling:heating_battery_temp_hysteresis": 8,

  "fire_protection:communication_status": 1, "fire_protection:temperature_value": 72, "fire_protection:ir_low_position": 5,

  "dehumidifier:online_points": 1, "dehumidifier:temperature_setting": 40, "dehumidifier:temperature_hysteresis": 5,
  "dehumidifier:humidity_setting": 60, "dehumidifier:humidity_hysteresis": 10, "dehumidifier:communication_device_no": 1,
  "dehumidifier:communication_baud_rate": 3,

  "io_module:circuit_breaker_feedback": 1, "io_module:running_indicator": 1, "io_module:communication_status": 1,
};

/** The grid meter's registers. Both cabinets publish the same meter, as on site. */
function meterValue(sig: string, t: number): number {
  const p = gridKw(t);
  const n = (a: number) => noise("meter" + sig, t) * a;
  const i = Math.abs(p) * 1000 / (Math.sqrt(3) * 415 * 0.97);
  const m = /^phase_([abc])_(\w+)$/.exec(sig);
  if (m) {
    switch (m[2]) {
      case "voltage": return round(239.5 + n(1.2), 1);
      case "current": return round(i + 0.4 + n(0.3), 1);
      case "active_power": return round(p / 3, 2);
      case "reactive_power": return round(Math.abs(p) * 0.08, 2);
      case "apparent_power": return round(Math.abs(p) / 3 / 0.97 + 0.1, 2);
      case "power_factor": return Math.abs(p) > 0.5 ? 0.97 : 0;
      case "voltage_angle": return { a: 0, b: 240, c: 120 }[m[1]]!;
      case "current_angle": return { a: 14, b: 254, c: 134 }[m[1]]!;
    }
  }
  switch (sig) {
    case "communication_status": return 1;
    case "ab_line_voltage": case "bc_line_voltage": case "ca_line_voltage": return round(415 + n(1.8), 1);
    case "phase_n_current": return round(0.8 + n(0.2), 1);
    case "total_active_power": return p;
    case "total_reactive_power": return round(Math.abs(p) * 0.25, 2);
    case "total_apparent_power": return round(Math.abs(p) / 0.97 + 0.3, 2);
    case "total_power_factor": return Math.abs(p) > 0.5 ? 0.97 : 0;
    case "frequency": return round(50 + n(0.04), 2);
    case "voltage_unbalance": return round(0.9 + n(0.2), 2);
    case "current_unbalance": return round(Math.abs(p) > 0.5 ? 3 + n(1) : 0, 2);
    case "temperature_1": case "temperature_2": case "temperature_3": case "temperature_4": return round(outdoorC(t) + 3, 1);
    case "forward_total_active_energy": return meterKwh(t, "imp");
    case "reverse_total_active_energy": return meterKwh(t, "exp");
    case "total_active_energy": return round(meterKwh(t, "imp") - meterKwh(t, "exp"), 1);
  }
  return 0;
}

/** A register's reading — computed when it moves with the plant, else STATIC, else 0. */
function s2Value(c: Cabinet, type: string, sig: string, t: number): number {
  if (type === "remote_control") return 0;
  if (type === "grid_meter") return meterValue(sig, t);
  const p = powerAt(c, t), soc = socAt(c, t);
  const n = (a: number) => noise(c.source + sig, t) * a;
  const d = new Date(t + IST);
  const pack = packV(c, t), mv = cellMv(c, t), spread = cellSpread(c, t);
  const temp = cellTempC(c, t), out = outdoorC(t);

  let m: RegExpExecArray | null;
  if ((m = /^cell_voltage_(\d+)$/.exec(sig))) {
    /* Each cell keeps its place in the spread, so the heat map is stable. */
    const rank = (noise(c.source + "cell" + m[1], 0) + 1) / 2;
    return Math.round(mv - spread / 2 + rank * spread);
  }
  if ((m = /^battery_temperature_(\d+)$/.exec(sig))) {
    const rank = (noise(c.source + "temp" + m[1], 0) + 1) / 2;
    return round(temp - 0.5 + rank * 2.2, 1);
  }

  switch (`${type}:${sig}`) {
    case "ems_system:soc": return soc;
    case "ems_system:load_power": return loadKw(t);
    case "ems_system:grid_current_total_power": case "ems_system:metering_current_total_power": return gridKw(t);
    case "ems_system:grid_meter_communication_status": return 1;
    case "ems_system:energy_storage_power": return p;

    case "pcs:pcs_total_dc_voltage": return round(pack - 9.5, 1);
    case "pcs:bms_total_voltage": return round(pack, 1);
    case "pcs:dc_power": return round(p * 1.012 + n(0.3), 1);
    case "pcs:dc_power_2": return round(p * 1.02 + n(0.4), 1);
    case "pcs:phase_a_active_power": case "pcs:phase_b_active_power": case "pcs:phase_c_active_power": return round(p / 3 + n(0.3), 1);
    case "pcs:total_reactive_power": return round(-2.4 + n(0.3), 1);
    case "pcs:phase_a_reactive_power": case "pcs:phase_b_reactive_power": case "pcs:phase_c_reactive_power": return round(-0.8 + n(0.15), 1);
    case "pcs:total_apparent_power": return round(Math.hypot(p, 2.4) + 3, 1);
    case "pcs:phase_a_apparent_power": case "pcs:phase_b_apparent_power": case "pcs:phase_c_apparent_power": return round(Math.hypot(p, 2.4) / 3 + 1, 1);
    case "pcs:total_power_factor": case "pcs:phase_a_power_factor": case "pcs:phase_b_power_factor": case "pcs:phase_c_power_factor":
      return round(clamp(100 * Math.abs(p) / (Math.abs(p) + 2.7), 0, 99.6) + n(0.3), 2);
    case "pcs:phase_n_current_rms": return round(11.6 + n(0.4), 1);
    case "pcs:pcs_capacitor_upper_dc_voltage": return round(pack / 2 - 3.3, 1);
    case "pcs:pcs_capacitor_lower_dc_voltage": return round(pack / 2 - 6.7, 1);
    case "pcs:phase_a_temperature": case "pcs:phase_b_temperature": case "pcs:phase_c_temperature": case "pcs:phase_n_temperature":
      return round(out + 2.5 + Math.abs(p) * 0.07 + n(0.3), 1);
    case "pcs:air_inlet_temperature": return round(out + 1.4, 1);
    case "pcs:air_outlet_temperature": return round(out + 8.9 + Math.abs(p) * 0.05, 1);
    case "pcs:cavity_temperature": return round(out + 4.5 + Math.abs(p) * 0.03, 1);
    case "pcs:control_chip_junction_temperature": return round(out - 5.3, 1);
    case "pcs:communication_chip_junction_temperature": return round(out - 2.5, 1);
    case "pcs:year": return d.getUTCFullYear();
    case "pcs:month": return d.getUTCMonth() + 1;
    case "pcs:day": return d.getUTCDate();
    case "pcs:hour": return d.getUTCHours();
    case "pcs:minute": return d.getUTCMinutes();
    case "pcs:second": return d.getUTCSeconds();
    case "pcs:ac_cumulative_charge_energy": return lifetimeKwh(c, t, "chg");
    case "pcs:ac_cumulative_discharge_energy": return lifetimeKwh(c, t, "dis");
    case "pcs:dc_cumulative_charge_energy": return round(lifetimeKwh(c, t, "chg") * 1.043, 1);
    case "pcs:dc_cumulative_discharge_energy": return round(lifetimeKwh(c, t, "dis") * 0.966, 1);

    case "bms:shunt_sampling_current": return round(p * 1000 / pack, 1);
    case "bms:cell_voltage_sum_total": return round(pack, 1);
    case "bms:cluster_internal_soc": return soc;
    case "bms:cell_average_voltage": return Math.round(mv);
    case "bms:hv_box_temperature_1": return round(out + 5, 1);
    case "bms:hv_box_temperature_2": return round(out + 5.1, 1);
    case "bms:hv_box_temperature_3": return round(out + 8.1, 1);
    case "bms:hv_box_temperature_4": case "bms:hv_box_max_temperature": return round(out + 10.2, 1);
    case "bms:monthly_cumulative_discharge_energy": return sinceKwh(c, t, "dis", "month");
    case "bms:monthly_cumulative_charge_energy": return sinceKwh(c, t, "chg", "month");
    case "bms:yearly_cumulative_discharge_energy": return sinceKwh(c, t, "dis", "year");
    case "bms:yearly_cumulative_charge_energy": return sinceKwh(c, t, "chg", "year");
    case "bms:total_cumulative_discharge_capacity": return lifetimeKwh(c, t, "dis");
    case "bms:total_cumulative_charge_capacity": return lifetimeKwh(c, t, "chg");

    case "liquid_cooling:inlet_water_temperature": return round(24.2 + Math.abs(p) * 0.01 + n(0.2), 1);
    case "liquid_cooling:outlet_water_temperature": return round(23.3 + n(0.2), 1);
    case "liquid_cooling:inlet_outlet_water_temperature_diff": return round(1 + Math.abs(p) * 0.008, 1);
    case "liquid_cooling:outdoor_temperature": return out;
    case "liquid_cooling:inlet_water_pressure": return round(0.4 + n(0.03), 2);
    case "liquid_cooling:outlet_water_pressure": return round(1.1 + n(0.03), 2);
    case "liquid_cooling:system_a_compressor_frequency": return out > 30 || Math.abs(p) > 25 ? 45 : 0;

    case "dehumidifier:controller_internal_temperature": return round(out - 4, 1);
    case "dehumidifier:current_temperature": return round(out - 3.7 + n(0.2), 1);
    case "dehumidifier:current_humidity": return round(dehumidity(c, t), 1);
    case "dehumidifier:alarm_status": return dehumAlarm(c, t) ? 1 : 0;
    case "dehumidifier:dehumidification_status": return dehumidity(c, t) > 60 ? 1 : 0;
  }
  return STATIC[`${type}:${sig}`] ?? 0;
}

/** Cabinet humidity, %: damp before dawn, drier through the day. */
const dehumidity = (c: Cabinet, t: number) =>
  52 + 9 * Math.cos((istHour(t) - 5) / 24 * 2 * Math.PI) + 2 * minuteNoise(c.source + "rh", t);

/** Register values come as strings of float32s, "1.0" for whole numbers, as on site. */
const valueText = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(Math.fround(v)));

function generalRow(c: Cabinet, substream: string, pointId: string, row: CatalogRow, t: number) {
  const [type, suffix] = SUBSTREAM_ASSET[substream];
  const [, sig, unit, cat] = row;
  return {
    substream, asset_id: `${c.source}_${suffix}`, point_id: pointId, signal: sig,
    value: valueText(s2Value(c, type, sig, t)), unit, category: cat, quality: "good",
    sample_time_utc: iso(t), received_at_utc: iso(t + 1800),
    data: {
      display_name: sig.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()),
      key_signal: /^(soc|energy_storage_power|inlet_water_temperature|outlet_water_temperature|current_humidity|current_temperature|cluster_internal_soc|outdoor_temperature)$/.test(sig),
      policy: "periodic", rw: "r", source_id: c.source,
    },
  };
}

const pointsOf = (substream: string) => {
  const type = SUBSTREAM_ASSET[substream]?.[0];
  return type ? POINTS.filter(([, r]) => r[0].includes(type)) : [];
};

function general(q: URLSearchParams) {
  const limit = clampLimit(q, 50);
  const pointId = q.get("point_id");
  const substream = q.get("substream");

  /* One point: a history, both cabinets interleaved, newest first. */
  if (pointId) {
    const entry = POINTS.find(([id]) => id === pointId);
    if (!entry) return [];
    const subs = Object.keys(SUBSTREAM_ASSET).filter((s) => entry[1][0].includes(SUBSTREAM_ASSET[s][0]) && (!substream || s === substream));
    const out = [];
    for (const t of times(0, Infinity, CADENCE, limit)) {
      for (const s of subs) for (const c of CABINETS) if (out.length < limit) out.push(generalRow(c, s, pointId, entry[1], t));
    }
    return out;
  }

  /* A snapshot. A substream wider than `limit` answers a different slice on
     each poll, as the real one does, and the client's merge fills it in. */
  const subs = substream ? (SUBSTREAM_ASSET[substream] ? [substream] : []) : Object.keys(SUBSTREAM_ASSET);
  const t = latest();
  const all = subs.flatMap((s) => CABINETS.flatMap((c) => pointsOf(s).map(([id, r]) => generalRow(c, s, id, r, t))));
  if (all.length <= limit) return all;
  const start = (Math.floor(Date.now() / 10_000) * limit) % all.length;
  return all.slice(start).concat(all.slice(0, start)).slice(0, limit);
}

/** A point's history over [from, to) for /api/history/general. */
function generalHistory(pointId: string, assetId: string | null, from: number, to: number, step: number) {
  const entry = POINTS.find(([id]) => id === pointId);
  if (!entry) return [];
  const subs = Object.keys(SUBSTREAM_ASSET).filter((s) => entry[1][0].includes(SUBSTREAM_ASSET[s][0]));
  const out = [];
  for (const t of times(from, to, step, 20_000)) {
    for (const s of subs) for (const c of CABINETS) {
      const r = generalRow(c, s, pointId, entry[1], t);
      if (!assetId || r.asset_id === assetId) out.push(r);
    }
  }
  return out;
}

/* ── Health ───────────────────────────────────────────────────────────────── */

function health(q: URLSearchParams) {
  const limit = clampLimit(q, 50);
  return times(0, Infinity, MIN, limit).map((t) => ({
    sample_time_utc: iso(t + 5_258),
    received_at_utc: iso(t + 8_541),
    data: {
      reason: "interval",
      record_type: "heartbeat",
      api_reachable: true,
      observed_at_utc: iso(t + 5_258),
      health: {
        status: "ok",
        gateway_mode: "ems_read_write",
        source_count: 2, online_source_count: 2,
        asset_count: 18, online_asset_count: 18,
        total_signal_count: 2_844, bad_signal_count: 0,
        storage_can_write: null,
        control_enabled: true, commands_enabled: true,
        poll_error_count: 0, poll_error_active: false, api_error: null,
        gateway_timestamp_utc: iso(t + 7_601),
        sources: CABINETS.map((c, i) => ({
          online: true, source_id: c.source, asset_count: 9, signal_count: 1_422,
          last_update_utc: iso(t + 3_890 + i * 3_659), bad_signal_count: 0, online_asset_count: 9,
        })),
        storage: { enabled: false, mount_ok: null, can_write: null, db_size_mb: null, used_percent: null, free_space_mb: null, last_skip_reason: null, skipped_write_count: null },
        fast_bess_logger: { enabled: true, running: true, last_error: null, thread_alive: true, last_sample_utc: iso(latest()) },
      },
    },
  }));
}

/* ── S5 controller & Solis ────────────────────────────────────────────────── */

function solisAt(t: number) {
  const { state, decision } = ctlAt(t);
  const kw = solarKw(t);
  const derated = state === "BOTH_SOLAR_DERATED", off = state === "BOTH_HIGH_SOLAR_OFF";
  const pct = derated ? 20 : 110;
  const solis = {
    state: off ? "OFF" : "ON", online: true, enabled: true, unit_id: 1,
    power_mode: derated ? "DERATED" : "NORMAL",
    serial_port: "/dev/ems_solis_rtu",
    target_state: off ? "OFF" : "ON",
    active_power_w: Math.round(kw * 1000), active_power_kw: kw,
    target_power_kw: derated ? DERATE_KW : SOLIS_KW,
    command_verified: true,
    last_read_age_sec: round(4 + 3 * Math.abs(noise("solis", t)), 3),
    last_exception_code: null, last_error: null, command_id: null,
    limiting_status_raw: null,
    power_limit_percent: pct, power_limit_percent_raw: pct * 100,
    communication_quality: "GOOD",
    last_successful_read_utc: iso(t - 6_000),
    limited_power_feedback_w: null, power_limit_feedback_raw: pct * 100,
    power_limit_equivalent_kw: derated ? DERATE_KW : SOLIS_KW, power_limit_feedback_percent: pct,
  };
  return { state, decision, solis };
}

function controllerRow(t: number) {
  const { state, decision, solis } = solisAt(t);
  const prev = ctlAt(t - CADENCE).state;
  const socs = CABINETS.map((c) => socAt(c, t));
  const avg = (socs[0] + socs[1]) / 2;
  const oldAvg = (socAt(CABINETS[0], t - MIN) + socAt(CABINETS[1], t - MIN)) / 2;
  const solarTarget = state === "BOTH_HIGH_SOLAR_OFF" ? "OFF" : state === "BOTH_SOLAR_DERATED" ? "ON_DERATED" : "ON";
  return {
    controller_state: state, previous_state: prev, decision, mode: "LIVE",
    version: "v1.14_soc_solar_derate_90_98", healthy: true, available: true,
    sample_time_utc: iso(t + 1_254), received_at_utc: iso(t + 8_442),
    data: {
      bess: Object.fromEntries(CABINETS.map((c, i) => [c.ctl, { host: c.host, online: true, soc_percent: socs[i], target_state: "ON" }])),
      mode: "LIVE", error: null, solis, healthy: true,
      version: "v1.14_soc_solar_derate_90_98", available: true,
      controller: {
        state, trend: { window_sec: 60, new_avg_soc: round(avg, 2), old_avg_soc: round(oldAvg, 2), sample_count: 10, avg_soc_delta: round(avg - oldAvg, 2), oldest_age_sec: 105.9 },
        decision, previous_state: prev, solar_off_reason: null, low_cutoff_reason: null,
      },
      thresholds: {
        derate_power_kw: DERATE_KW, high_soc_percent: SOC_FULL, settings_revision: 6, derate_soc_percent: SOC_DERATE,
        low_cutoff_enabled: false, low_cutoff_percent: 10, settings_updated_by: "commissioning",
        low_recovery_percent: 10, recovery_soc_percent: SOC_RECOVERY, settings_updated_at_utc: "2026-09-11T05:25:50+00:00",
      },
      action_plan: [
        ...CABINETS.map((c) => ({ id: c.ctl, kind: "bess", target: "ON" })),
        { id: "Solis", kind: "solar", target: solarTarget },
      ],
      last_actions: [
        ...CABINETS.map((c) => ({ device: c.ctl, reason: "already_commanded", target: "ON", dry_run: false, skipped: true, verified: true })),
        { device: "Solis", reason: "already_in_target_power_mode_and_on", target: solarTarget, dry_run: false, skipped: true, verified: true },
      ],
      timestamp_utc: iso(t),
    },
  };
}

function solisRow(t: number) {
  const { state, decision, solis } = solisAt(t);
  return {
    controller_state: state, decision, solis_state: solis.state, power_mode: solis.power_mode,
    online: true, communication_quality: "GOOD", unit_id: 1,
    active_power_kw: solis.active_power_kw, target_power_kw: solis.target_power_kw, active_power_w: solis.active_power_w,
    sample_time_utc: iso(t + 3_590), received_at_utc: iso(t + 18_541),
    data: { solis, decision, available: true, timestamp_utc: iso(t), controller_state: state },
  };
}

function controller(q: URLSearchParams) {
  const limit = clampLimit(q, 50);
  const { from, to } = windowOf(q, limit * CADENCE);
  const want = q.get("state");
  return times(from, to, CADENCE, limit * (want ? 40 : 1)).map(controllerRow).filter((r) => !want || r.controller_state === want).slice(0, limit);
}

function solis(q: URLSearchParams) {
  const limit = clampLimit(q, 50);
  const { from, to } = windowOf(q, limit * CADENCE);
  return times(from, to, CADENCE, limit).map(solisRow);
}

/* ── S6 edge AI ───────────────────────────────────────────────────────────── */

const EDGE_STEP = 30 * SEC;
const THRESHOLD = 0.5691796048965233;
const MODEL = { version: "v0_3", threshold: THRESHOLD, model_type: "IsolationForest", feature_count: 33, threshold_direction: "anomaly_score_ml >= threshold means anomaly" };

/**
 * The model's score: ~0.47 in steady running, and over the threshold for a
 * couple of minutes when the solar derate cuts in — the step change it flags
 * on site too (11:14–11:15 on 21 Oct).
 */
function edgeScore(c: Cabinet, t: number): number {
  const st = stateAt(c, t);
  /* Only a clear day reaches the derate; a cloudy one has no step to flag. */
  const sinceDerate = st.cy.clear ? (st.hh - st.cy.chargeTo) * 60 : -1;
  const base = 0.472 + 0.012 * noise(c.bess + "ai", t);
  return round(sinceDerate >= 0 && sinceDerate < 2.5 ? 0.61 + 0.06 * Math.abs(noise(c.bess + "an", t)) : base, 6);
}

function edgeRows(t: number) {
  const cycle = Math.floor(t / EDGE_STEP) % 100_000;
  const sources = CABINETS.map((c) => {
    const score = edgeScore(c, t), p = powerAt(c, t);
    return {
      ok: true, bess_id: c.bess, source_id: c.source, threshold: THRESHOLD,
      key_features: {
        bms_fault_flag_count: 0, pcs_fault_flag_count: 0,
        bms_temperature_spread: 2.2, bms_cell_voltage_spread: cellSpread(c, t),
        pcs_phase_current_imbalance: round(1.8 + Math.abs(noise(c.bess + "pi", t)) * 0.4, 6),
        pcs_phase_voltage_imbalance: round(0.5 + Math.abs(noise(c.bess + "pv", t)) * 0.2, 6),
        pcs_dc_current_vs_bms_current_delta: round(1.3 + Math.abs(p) * 0.02, 6),
        pcs_dc_voltage_vs_bms_voltage_delta: round(0.1 + Math.abs(noise(c.bess + "dv", t)) * 0.5, 6),
      },
      anomaly_score_ml: score,
      inference_latency_ms: round(15_100 + 40 * noise(c.bess + "lat", t), 2),
      ml_predicted_anomaly: score >= THRESHOLD,
    };
  });
  return sources.map((s) => ({
    cycle_index: cycle, edge_ai_status: "GOOD", model_version: MODEL.version, model_type: MODEL.model_type,
    source_id: s.source_id, bess_id: s.bess_id, ml_predicted_anomaly: s.ml_predicted_anomaly,
    anomaly_score_ml: s.anomaly_score_ml, threshold: THRESHOLD,
    sample_time_utc: iso(t + 86), received_at_utc: iso(t + 31_305),
    data: {
      phase: "8", sources, cycle_time: iso(t + 86), model_info: MODEL, cycle_index: cycle,
      edge_ai_status: "GOOD", latest_age_sec: 30.302, stale_after_sec: 90, cycle_latency_ms: 30_254.85,
    },
  }));
}

function edgeAi(q: URLSearchParams) {
  const limit = clampLimit(q, 50);
  const only = q.get("only_anomalies") === "true";
  const bess = q.get("bess_id"), src = q.get("source_id");
  const keep = (r: ReturnType<typeof edgeRows>[number]) =>
    (!bess || r.bess_id === bess) && (!src || r.source_id === src) && (!only || r.ml_predicted_anomaly);

  if (only) {
    /* Straight to the few minutes a day the model flags, for the last month. */
    const { from, to } = windowOf(q, 31 * DAY);
    const out = [];
    for (let day = istDay(Math.min(to, Date.now())); day >= istDay(from) && out.length < limit; day--) {
      const cy = cycleOf(CABINETS[0], day);
      if (!cy.clear) continue;
      const at = day * DAY - IST + (CYCLE_START_H + cy.chargeTo) * HOUR;
      for (const t of times(Math.max(from, at - MIN), Math.min(to, at + 25 * MIN), EDGE_STEP, 200)) {
        for (const r of edgeRows(t)) if (keep(r) && out.length < limit) out.push(r);
      }
    }
    return out;
  }
  const { from, to } = windowOf(q, limit * EDGE_STEP);
  const out = [];
  for (const t of times(from, to, EDGE_STEP, limit)) {
    for (const r of edgeRows(t)) if (keep(r)) out.push(r);
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/* ── S4 alarms ────────────────────────────────────────────────────────────── */

/**
 * The one alarm the site raises: the second cabinet's dehumidifier, a Warning
 * that comes and goes several times a day (18 raises in two days on site).
 * Episodes are fixed per IST day, so the S2 register and the log agree.
 */
const DEHUM = CABINETS[1];

function dehumEpisodes(day: number): [number, number][] {
  const out: [number, number][] = [];
  const count = 4 + Math.floor((noise("dh-n", day * SEC) + 1) * 2.5);
  for (let k = 0; k < count; k++) {
    /* Mostly the damp hours: night and early morning. */
    const u = (noise("dh-at", (day * 100 + k) * SEC) + 1) / 2;
    const hour = u < 0.7 ? (u / 0.7) * 8 : 8 + ((u - 0.7) / 0.3) * 16;
    const start = day * DAY - IST + hour * HOUR + Math.floor(u * 3600) * SEC;
    const lasts = (6 + 70 * (noise("dh-len", (day * 100 + k) * SEC) + 1) / 2) * MIN;
    out.push([start, start + lasts]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function dehumAlarm(c: Cabinet, t: number): boolean {
  if (c !== DEHUM) return false;
  return dehumEpisodes(istDay(t)).some(([a, b]) => t >= a && t < b);
}

/** A short stable hex id, uuid-shaped. */
function uid(seed: string): string {
  const h = (k: string) => ((noise(seed + k, 0) + 1) * 2 ** 31 >>> 0).toString(16).padStart(8, "0");
  return `${h("a")}-${h("b").slice(0, 4)}-4${h("c").slice(0, 3)}-8${h("d").slice(0, 3)}-${h("e")}${h("f").slice(0, 4)}`;
}

/** Every alarm event of the last 31 days, newest first. */
function alarmEvents(now = Date.now()) {
  const out = [];
  const dedupe = `demo-gw-001:${DEHUM.source}:dehumidifier:alarm_status`;
  for (let day = istDay(now - 31 * DAY); day <= istDay(now); day++) {
    for (const [a, b] of dehumEpisodes(day)) {
      if (a > now) continue;
      const corr = uid(`corr${a}`);
      const base = {
        correlation_id: corr, source_id: DEHUM.source, asset_id: `${DEHUM.source}_dehumidifier`,
        signal_name: "alarm_status", severity: "Warning", dedupe_key: dedupe, occurrence_count: 1,
      };
      const payload = (state: "ACTIVE" | "CLEARED", at: number, eventId: string, message: string) => ({
        state, message,
        payload: {
          address: 2590, quality: "good", point_id: "p1296", display_name: "Alarm Status", asset_display: "Dehumidifier",
          base_asset_id: "dehumidifier", current_label: state === "ACTIVE" ? "Alarm" : "Normal",
          previous_label: state === "ACTIVE" ? "Normal" : "Alarm", sample_source: "general_asset_live",
          sampled_at_utc: iso(at), trigger_reason: state === "ACTIVE" ? "activation" : "clear",
          enumeration_description: "0,Normal;1,Alarm", primary_telemetry_stream: "S2 general_asset_telemetry",
        },
        site_id: "demo-site-001", gateway_id: "demo-gw-001", event_id: eventId, correlation_id: corr,
        current_value: state === "ACTIVE" ? 1 : 0, previous_value: state === "ACTIVE" ? 0 : 1,
      });
      const msgA = `${DEHUM.source} Dehumidifier Alarm Status ACTIVE: Normal (0) -> Alarm (1)`;
      const idA = uid(`ev-a${a}`);
      out.push({
        ...base, event_id: idA, event_type: "DEHUMIDIFIER_ALARM_STATUS_ACTIVE", state: "ACTIVE", message: msgA,
        event_time_utc: iso(a), cleared_at_utc: null, received_at_utc: iso(a + 4_000), data: payload("ACTIVE", a, idA, msgA),
      });
      if (b <= now) {
        const msgC = `${DEHUM.source} Dehumidifier Alarm Status CLEARED: Alarm (1) -> Normal (0)`;
        const idC = uid(`ev-c${b}`);
        out.push({
          ...base, event_id: idC, event_type: "DEHUMIDIFIER_ALARM_STATUS_CLEARED", state: "CLEARED", message: msgC,
          event_time_utc: iso(b), cleared_at_utc: iso(b), received_at_utc: iso(b + 4_000), data: payload("CLEARED", b, idC, msgC),
        });
      }
    }
  }
  return out.sort((x, y) => Date.parse(y.event_time_utc) - Date.parse(x.event_time_utc));
}

function alarms(q: URLSearchParams) {
  const limit = clampLimit(q, 1000);
  const sev = q.get("severity"), state = q.get("state"), asset = q.get("asset_id");
  return alarmEvents()
    .filter((e) => (!sev || e.severity === sev) && (!state || e.state === state) && (!asset || e.asset_id === asset))
    .slice(0, limit);
}

/* ── S7 config audit ──────────────────────────────────────────────────────── */

/** Empty, as on site: nothing has been changed through the audited paths. */
function configAudit(_q: URLSearchParams) {
  return [];
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function clampLimit(q: URLSearchParams, dflt: number): number {
  const n = Number(q.get("limit") ?? dflt);
  return Number.isFinite(n) ? Math.max(1, Math.min(1000, Math.floor(n))) : dflt;
}

/** from_time / to_time, else the `span` before now. */
function windowOf(q: URLSearchParams, span: number): { from: number; to: number } {
  const to = Date.parse(q.get("to_time") ?? "") || Date.now() + 1;
  const from = Date.parse(q.get("from_time") ?? "") || Math.min(to, Date.now()) - span - CADENCE;
  return { from, to };
}

/* ── Entry points ─────────────────────────────────────────────────────────── */

/** An answer for `/api/central/<path>` under a demo bearer: [status, body]. */
export function demoCentral(path: string[], q: URLSearchParams): [number, unknown] {
  if (path.join("/") === "auth/me") return [200, DEMO_USER];
  if (path[0] === "health") return [200, { status: "ok", mode: "demo" }];
  if (path[0] === "gateways" && path.length === 3) {
    switch (path[2]) {
      case "health": return [200, health(q)];
      case "fast-bess": return [200, fastBess(q)];
      case "general": return [200, general(q)];
      case "alarms": return [200, alarms(q)];
      case "controller": return [200, controller(q)];
      case "solis": return [200, solis(q)];
      case "edge-ai": return [200, edgeAi(q)];
      case "config-audit": return [200, configAudit(q)];
    }
  }
  /* Anything else the demo has no data for reads as empty, never as the real site. */
  return [200, []];
}

/** `/api/history/<stream>` under a demo bearer. */
export function demoHistory(stream: string, q: URLSearchParams): unknown[] {
  const now = Date.now();
  const to = Math.min(Number(q.get("to") ?? now), now + MIN);
  const from = Number(q.get("from") ?? now - DAY);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const askStep = Math.max(0, Number(q.get("step") ?? 0)) || 0;
  /* Coarse enough to stay a few thousand rows a cabinet, whatever was asked. */
  const step = (min: number) => Math.max(min, askStep, Math.ceil((to - from) / 6_000 / min) * min);
  const shape = q.get("shape");

  switch (stream) {
    case "fast": {
      const cabs = cabinetsFor(q.get("bess_id"));
      return times(from, to, step(CADENCE), 100_000).flatMap((t) => cabs.map((c) => fastSample(c, t)));
    }
    case "controller":
    case "solis": {
      const ts = times(from, to, step(CADENCE), 100_000);
      const rows: { sample_time_utc: string; controller_state: string; data: unknown }[] =
        stream === "controller" ? ts.map(controllerRow) : ts.map(solisRow);
      if (shape === "solar") return rows.map((r) => ({ sample_time_utc: r.sample_time_utc, kw: (r.data as { solis: { active_power_kw: number } }).solis.active_power_kw }));
      if (shape === "soc" && stream === "controller") return rows.map((r) => ({ sample_time_utc: r.sample_time_utc, controller_state: r.controller_state, data: { bess: (r.data as { bess: unknown }).bess } }));
      return rows;
    }
    case "alarms":
      return alarmEvents().filter((e) => { const t = Date.parse(e.event_time_utc); return t >= from && t < to; });
    case "general": {
      const pointId = q.get("point_id");
      return pointId ? generalHistory(pointId, q.get("asset_id"), from, to, step(CADENCE)) : [];
    }
  }
  return [];
}

/** `/api/monthly-discharge` under a demo bearer: six closed months and this one. */
export function demoMonthlyDischarge() {
  const now = Date.now();
  const months: Record<string, Record<string, { kwh: number; at: number }>> = {};
  const lifetime: Record<string, Record<string, { first: { kwh: number; at: number }; last: { kwh: number; at: number } }>> = {};
  const d = new Date(now + IST);
  for (let back = 6; back >= 0; back--) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() - back;
    const start = Date.UTC(y, m, 1) - IST;
    const end = Math.min(Date.UTC(y, m + 1, 1) - IST - 1, now);
    if (end < DAY0) continue;
    const key = new Date(start + IST).toISOString().slice(0, 7);
    for (const c of CABINETS) {
      const a = Math.max(start, DAY0);
      (months[key] ??= {})[`${c.source}_bms`] = { kwh: sinceKwh(c, end, "dis", "month"), at: end };
      (lifetime[key] ??= {})[`${c.source}_pcs`] = {
        first: { kwh: lifetimeKwh(c, a, "dis"), at: a },
        last: { kwh: lifetimeKwh(c, end, "dis"), at: end },
      };
    }
  }
  return { months, lifetime };
}
