/**
 * Fleet benchmarking — the same cabinet, measured twice, compared.
 *
 * ── Why comparison is the strongest tool available here ──────────────────
 * Every other analysis screen in this app has to argue from an absolute: is
 * 88.5% a good round trip, is 0.28 cycles a day low, is 34 mV of spread a
 * problem? Those questions need a datasheet, a warranty and a commissioning
 * baseline, and this deployment has none of them.
 *
 * Two cabinets on one site need none of that. They share a gateway, a grid
 * connection, a room, a weather, a tariff and a dispatch schedule. Anything
 * that differs between them is the equipment, because nothing else is left to
 * vary. A 2% efficiency gap between two units commissioned the same week is a
 * finding without needing to know what good looks like.
 *
 * ── What it will not do ──────────────────────────────────────────────────
 * It does not score. A single composite number over efficiency, duty, thermals
 * and alarms would rank the fleet authoritatively and hide every reason for the
 * ranking — and the weights would be invented here rather than derived from
 * anything. Each metric is ranked on its own, and a unit that comes last on
 * more than one is flagged as worth a look. That is as far as the data
 * supports.
 *
 * It also does not say "quartile". With two units a quartile is theatre: the
 * honest statement is the gap between them and whether it is bigger than the
 * noise on each. Language on screen changes with the fleet size for that
 * reason.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────
 * Six stored-signal reads per unit — four inside fetchRoundTrip and two here.
 * That is fine for the two this gateway has and would be 84 against a
 * fourteen-site deployment, so the caller is given `maxUnits` and the screen
 * says when it has stopped short rather than quietly benchmarking a subset.
 *
 * Round-trip efficiency is REUSED from roundTrip.service rather than
 * recomputed. It is the one figure here with a subtle definition — the
 * SOC-drift correction, the plausibility gates — and a second implementation
 * would be a second answer to "how efficient is this pack".
 */

import { storedSeries, cadenceOf, type Sample } from "./storedSeries";
import { fetchRoundTrip } from "./roundTrip.service";
import { bessLabel } from "./bessLabel";
import { parseIst } from "@/lib/api/time";
import { fetchAlarmRecurrenceCentral } from "./alarmRecurrence.service";
import { overlayFor } from "../overlay/stations";
import { appConfigInit } from "@/lib/central/appConfig";

/* ── Shape ────────────────────────────────────────────────────────────────── */

export interface FleetUnit {
  sourceId: string;
  name: string;
  capacityKwh: number | null;
  ratedKw: number | null;

  /** Measured from the converters' own counters. */
  chargedKwh: number;
  dischargedKwh: number;
  /** Equivalent full cycles per day. Null without a rated capacity. */
  cyclesPerDay: number | null;

  /** From roundTrip.service — one definition, reused. */
  rtePct: number | null;
  rteTrendPctPerMonth: number | null;
  rteTrendConfident: boolean;

  /** Highest absolute power seen, and what share of the rating that is. */
  peakKw: number | null;
  peakUtilisationPct: number | null;
  /** Hours a day the converter was moving more than a trickle. */
  activeHoursPerDay: number | null;

  meanTempC: number | null;
  maxTempC: number | null;
  meanSpreadMv: number | null;
  maxSpreadMv: number | null;

  /** Events logged against this unit's assets over the window. */
  alarmCount: number | null;

  /** Days that produced a reportable efficiency figure. */
  daysReported: number;
  /** Share of the expected samples that arrived, 0–100. */
  coveragePct: number | null;
}

/** One metric, ranked across the fleet. */
export interface FleetMetric {
  key: string;
  label: string;
  unit: string;
  /** True when a HIGHER value is better. */
  higherIsBetter: boolean;
  /** Per-unit values, aligned to `units`. Null where unavailable. */
  values: (number | null)[];
  /** Index of the best and worst unit, or null when fewer than two answered. */
  bestIndex: number | null;
  worstIndex: number | null;
  /** Spread between best and worst, in the metric's own units. */
  gap: number | null;
  /**
   * The smallest gap worth calling a difference, in the metric's own units.
   *
   * Per metric and absolute, because no single relative threshold works across
   * them: half a point is a large move in round-trip efficiency and nothing at
   * all in a cell temperature. Each value below is stated against what the
   * measurement's own noise is, not against a percentage.
   */
  material: number;
  /** Whether `gap` clears it. */
  isMaterial: boolean;
}

/**
 * A difference between units that is larger than the noise on the measurement.
 *
 * `flagged` used to be "units last on two or more health metrics", and with
 * two cabinets and four health metrics that is satisfied by arithmetic: one of
 * them is last on each, so on average both are last on two, and the screen duly
 * flagged BOTH — a verdict that carries no information at all.
 *
 * A finding is a property of a MEASUREMENT, not a verdict on a unit. This
 * reports which metrics actually separate the fleet and by how much, and lets
 * the reader decide what that means about a cabinet.
 */
export interface FleetFinding {
  metricKey: string;
  label: string;
  unit: string;
  /** The unit that is behind on this metric. */
  sourceId: string;
  name: string;
  gap: number;
  /** How many times the material threshold the gap is. */
  severity: number;
}

export interface Fleet {
  window: { fromTs: number; toTs: number; days: number } | null;
  units: FleetUnit[];
  metrics: FleetMetric[];
  /** Metrics that separate the fleet by more than their own noise. */
  findings: FleetFinding[];
  /** Sources the caller asked for but that were not read. */
  skipped: string[];
}

const EMPTY: Fleet = { window: null, units: [], metrics: [], findings: [], skipped: [] };

/** Below this the converter is idling, not dispatching. */
const ACTIVE_KW = 2;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Throughput and duty from one unit's power and counter history. */
function dutyOf(power: Sample[], windowDays: number): {
  peakKw: number | null; activeHoursPerDay: number | null; coveragePct: number | null;
} {
  if (!power.length) return { peakKw: null, activeHoursPerDay: null, coveragePct: null };

  const cadence = cadenceOf(power);
  let peak = 0, activeMs = 0;
  for (let i = 1; i < power.length; i++) {
    const dt = power[i].ts - power[i - 1].ts;
    peak = Math.max(peak, Math.abs(power[i].value));
    /* Gaps are not counted as active OR inactive — a converter nobody heard
       from was not idling, and charging the silence to either column would
       make a unit with patchy telemetry look different from one without. */
    if (dt > 0 && cadence != null && dt <= cadence * 3 && Math.abs(power[i].value) > ACTIVE_KW) {
      activeMs += dt;
    }
  }

  const spanMs = power[power.length - 1].ts - power[0].ts;
  const expected = cadence ? spanMs / cadence : 0;
  return {
    peakKw: r1(peak),
    activeHoursPerDay: windowDays > 0 ? r2(activeMs / 3_600_000 / windowDays) : null,
    coveragePct: expected > 0 ? Math.min(100, Math.round((power.length / expected) * 100)) : null,
  };
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

/** Rank one metric across the units. */
function rank(
  key: string, label: string, unit: string, higherIsBetter: boolean,
  material: number, values: (number | null)[],
): FleetMetric {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null);

  if (present.length < 2) {
    return {
      key, label, unit, higherIsBetter, values,
      bestIndex: null, worstIndex: null, gap: null, material, isMaterial: false,
    };
  }
  const sorted = [...present].sort((a, b) => (higherIsBetter ? b.v - a.v : a.v - b.v));
  const gap = r2(Math.abs(sorted[0].v - sorted[sorted.length - 1].v));
  return {
    key, label, unit, higherIsBetter, values,
    bestIndex: sorted[0].i,
    worstIndex: sorted[sorted.length - 1].i,
    gap,
    material,
    isMaterial: gap >= material,
  };
}

/**
 * Benchmark every unit behind the gateway against every other.
 *
 * @param sources  Source ids to compare. Order is preserved on screen.
 * @param maxUnits Ceiling on how many are actually read, so a large fleet
 *                 cannot turn one page load into a hundred gateway calls
 *                 without saying so.
 */
export async function fetchFleet(
  sources: string[],
  maxUnits = 8,
  limit = 12_000,
): Promise<Fleet> {
  if (!sources.length) return EMPTY;

  const take = sources.slice(0, maxUnits);
  const skipped = sources.slice(maxUnits);

  /* Alarms once for the whole site rather than once per unit: the recurrence
     service already groups by asset kind and carries a per-source breakdown,
     so one read answers every unit's count. */
  /* The central alarm log (S4); the gateway's own log went with NorthBound. */
  const alarmsP = fetch("/api/app-config", appConfigInit())
    .then((r) => r.json() as Promise<{ gatewayId?: string }>)
    .then((c) => fetchAlarmRecurrenceCentral(c.gatewayId ?? "", take))
    .catch(() => null);

  const perUnit = await Promise.all(
    take.map(async (sourceId) => {
      const [rt, power, spread] = await Promise.all([
        fetchRoundTrip(sourceId, limit),
        storedSeries(`${sourceId}_pcs_1`, "total_active_power", limit),
        storedSeries(`${sourceId}_bms_1`, "max_min_cell_voltage_diff", limit),
      ]);
      return { sourceId, rt, power, spread };
    }),
  );

  const alarms = await alarmsP;

  /* The window every unit is compared over: the WHOLE days (counted from
     their IST midnight, not today) that every unit has energy for. Each day's
     charge and discharge are fetchDailyEnergy's DC-counter figures — through
     roundTrip.service — so Fleet, Efficiency, Curves and the Power Station
     chart all report the same kWh for a cabinet's day. The intersection keeps
     every per-day figure on one denominator. */
  const wholeDays = (rt: (typeof perUnit)[number]["rt"]) =>
    new Set(rt.days.filter((d) => d.reason !== "partial-day").map((d) => d.date));
  const sets = perUnit.map((u) => wholeDays(u.rt));
  const shared = [...(sets[0] ?? [])].filter((d) => sets.every((s) => s.has(d))).sort();
  if (!shared.length) return { ...EMPTY, skipped };
  const DAY = 86_400_000;
  const fromTs = parseIst(shared[0]);
  const toTs = parseIst(shared[shared.length - 1]) + DAY;
  const windowDays = shared.length;
  const inShared = new Set(shared);

  const units: FleetUnit[] = perUnit.map(({ sourceId, rt, power, spread }) => {
    const ov = overlayFor(sourceId);
    const capacityKwh = ov.installedCapacity || null;
    const ratedKw = ov.installedPower || null;

    const days = rt.days.filter((d) => inShared.has(d.date));
    const chargedKwh = days.reduce((s, d) => s + d.chargedKwh, 0);
    const dischargedKwh = days.reduce((s, d) => s + d.dischargedKwh, 0);

    const duty = dutyOf(
      power.filter((p) => p.ts >= fromTs && p.ts <= toTs),
      windowDays,
    );
    const spreads = spread.filter((s) => s.ts >= fromTs && s.ts <= toTs).map((s) => s.value);
    const temps = days.map((d) => d.meanTempC).filter((v): v is number => v != null);

    const alarmCount = alarms
      ? alarms.groups.reduce((s, g) => s + (g.bySource[sourceId] ?? 0), 0)
      : null;

    return {
      sourceId,
      name: bessLabel(sourceId),
      capacityKwh,
      ratedKw,
      chargedKwh: Math.round(chargedKwh),
      dischargedKwh: Math.round(dischargedKwh),
      /* Equivalent full cycles: energy out over usable capacity. Null without
         a capacity, because a cycle count derived from a guessed capacity is a
         guess wearing a unit. */
      cyclesPerDay: capacityKwh ? r2(dischargedKwh / capacityKwh / windowDays) : null,
      rtePct: rt.meanRtePct,
      rteTrendPctPerMonth: rt.trendPctPerMonth,
      rteTrendConfident: rt.trendConfident,
      peakKw: duty.peakKw,
      peakUtilisationPct: duty.peakKw != null && ratedKw ? Math.round((duty.peakKw / ratedKw) * 100) : null,
      activeHoursPerDay: duty.activeHoursPerDay,
      meanTempC: (() => { const m = mean(temps); return m == null ? null : r1(m); })(),
      maxTempC: temps.length ? r1(Math.max(...temps)) : null,
      meanSpreadMv: (() => { const m = mean(spreads); return m == null ? null : r1(m); })(),
      maxSpreadMv: spreads.length ? Math.round(Math.max(...spreads)) : null,
      alarmCount,
      daysReported: rt.reported,
      coveragePct: duty.coveragePct,
    };
  });

  /* Material thresholds, each against the noise on its own measurement:
       rte        0.5 pts — about twice the day-to-day scatter the efficiency
                  screen measures, so a gap this size is not sampling
       cycles     0.15/day — a sixth of a cycle, below which the schedule
                  rather than the cabinet is doing the varying
       throughput 5% of the fleet's best (at least 20 kWh), so the bar scales
                  with the window
       active     1 h/day
       util       10 points of rating
       spread     5 mV — a pack's own spread moves by a few mV with SOC
       temp       2 °C — two cabinets in one room sit within about this
       alarms     20 events over the window */
  const metrics: FleetMetric[] = [
    rank("rte", "Round-Trip Efficiency", "%", true, 0.5, units.map((u) => u.rtePct)),
    rank("cycles", "Cycles Per Day", "", true, 0.15, units.map((u) => u.cyclesPerDay)),
    rank("throughput", "Energy Delivered", "kWh", true,
      Math.max(20, 0.05 * Math.max(0, ...units.map((u) => u.dischargedKwh))), units.map((u) => u.dischargedKwh)),
    rank("active", "Active Hours Per Day", "h", true, 1, units.map((u) => u.activeHoursPerDay)),
    rank("util", "Peak Utilisation", "%", true, 10, units.map((u) => u.peakUtilisationPct)),
    /* Lower is better below this line. Spread and temperature are stresses,
       not achievements, and alarms are events rather than work done. */
    rank("spread", "Mean Cell Spread", "mV", false, 5, units.map((u) => u.meanSpreadMv)),
    rank("temp", "Mean Cell Temperature", "°C", false, 2, units.map((u) => u.meanTempC)),
    rank("alarms", "Alarms Logged", "", false, 20, units.map((u) => u.alarmCount)),
  ];

  /* Findings are exactly the rows the table tags "Material", worst first —
     the verdict and the row tags read off the same test, so the banner can
     never say "nothing separates them" above a row marked Material. */
  const findings: FleetFinding[] = metrics
    .filter((m) => m.isMaterial && m.worstIndex != null && m.gap != null)
    .map((m) => ({
      metricKey: m.key,
      label: m.label,
      unit: m.unit,
      sourceId: units[m.worstIndex!].sourceId,
      name: units[m.worstIndex!].name,
      gap: m.gap!,
      severity: r2(m.gap! / m.material),
    }))
    .sort((a, b) => b.severity - a.severity);

  return {
    window: { fromTs, toTs, days: windowDays },
    units,
    metrics,
    findings,
    skipped,
  };
}
