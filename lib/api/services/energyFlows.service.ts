/**
 * Self-consumption and export — where the site's energy came from, where it
 * went, and how much of what left should never have left.
 *
 * ── The two ratios everybody confuses ────────────────────────────────────
 * They are not the same number and they answer opposite questions.
 *
 *   SELF-CONSUMPTION   (solar − exported) / solar
 *                      Of what the array made, how much did the site use?
 *                      Falls when the roof outruns the load. A site at 100%
 *                      is not necessarily doing well — it may simply have a
 *                      small array.
 *
 *   SELF-SUFFICIENCY   (load − imported) / load
 *                      Of what the site needed, how much did it cover itself?
 *                      Falls when the load outruns the roof. This is the one
 *                      that tracks the bill.
 *
 * A site can sit at 100% self-consumption and 20% self-sufficiency (tiny
 * array, never exports) or at 45% and 80% (large array, dumps the middle of
 * the day). Reporting one of them as "solar performance" is how a site ends up
 * buying panels it cannot use, or a battery it does not need.
 *
 * ── What is measured and what is derived ─────────────────────────────────
 * Measured exactly, from cumulative registers differenced across the day:
 *   import      utility_meter.forward_total_active_energy
 *   export      utility_meter.reverse_total_active_energy
 *   battery     pcs_1.ac_cumulative_charge/discharge_energy, summed over
 *               every cabinet
 *
 * Integrated, and therefore approximate: the load, from `ems_system.load_power`
 * sampled at the snapshot cadence. There is no load energy counter anywhere in
 * the dictionary.
 *
 * DERIVED, and the weakest figure on the screen: solar generation. The gateway
 * publishes PV power at `/api/solis/status`, which is outside the telemetry
 * snapshot and is therefore not in the historian — there is no PV energy
 * counter and no PV history at all. So generation comes out of the site's
 * energy balance:
 *
 *     solar = load + export + batteryCharge − import − batteryDischarge
 *
 * which is exact arithmetic on inexact inputs: it inherits the whole of the
 * load-integration error, and it absorbs every unmetered thing on the site —
 * auxiliary loads the EMS does not see, metering offsets, a DG set. A day
 * where it comes out negative is not a day the sun failed; it is a day the
 * balance did not close, and it is reported as such rather than clamped to
 * zero.
 *
 * ── The finding worth having ─────────────────────────────────────────────
 * Export is not automatically waste. It is waste when the battery had room to
 * take it and did not. So every increment of the export counter is paired with
 * the pack's state of charge at that instant, and the energy exported while the
 * pack was below full is separated out: that is the part a different dispatch
 * schedule would have kept. Priced at the gap between what the DISCOM pays for
 * an exported unit and what it charges for an imported one, it is a number
 * somebody can take to a scheduling meeting.
 */

import { fetchSourceTelemetry, signal } from "@/lib/gateway";
import {
  storedSeries, dayKey, dayEdges, cadenceOf, valueAt, type Sample,
} from "./storedSeries";
import { overlayFor } from "../overlay/stations";
import { istHour } from "@/lib/api/time";

/* ── Shape ────────────────────────────────────────────────────────────────── */

export interface FlowDay {
  date: string;
  /** Measured at the meter. */
  importKwh: number;
  exportKwh: number;
  /** Measured at the converters, summed over cabinets. */
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  /** Integrated from load_power — approximate. */
  loadKwh: number;
  /** Derived by balance. Null when the balance did not close. */
  solarKwh: number | null;
  /**
   * Export that left while the pack was below full AND not charging.
   *
   * The unambiguous part: the site was pushing power out to the grid while the
   * battery sat idle or was itself discharging.
   */
  avoidableExportKwh: number;
  /**
   * Export that left while the pack was below full but ALREADY charging.
   *
   * Recoverable only if the converter had headroom to charge faster, which
   * needs a charge-power limit this does not read. Reported separately rather
   * than folded into the figure above.
   */
  exportWhileChargingKwh: number;
  selfConsumptionPct: number | null;
  selfSufficiencyPct: number | null;
  /** True when the day's samples do not span it. */
  partial: boolean;
}

export interface EnergyFlows {
  window: { fromTs: number; toTs: number; days: number; cadenceMs: number | null } | null;
  days: FlowDay[];
  totals: {
    importKwh: number;
    exportKwh: number;
    loadKwh: number;
    solarKwh: number | null;
    batteryChargeKwh: number;
    batteryDischargeKwh: number;
    avoidableExportKwh: number;
    exportWhileChargingKwh: number;
    selfConsumptionPct: number | null;
    selfSufficiencyPct: number | null;
  } | null;
  /** Export energy by local hour, over the window. */
  exportByHour: number[];
  /** Days the balance failed to close, so solar could not be derived. */
  unbalancedDays: number;
  /** ₹ the avoidable export gave up, when both rates are configured. */
  avoidableValueRs: number | null;
  importRateRs: number | null;
  exportRateRs: number | null;
  /** The EMS's export-limiting configuration, read live. */
  antiReverseFlow: { enabled: boolean | null; upperKw: number | null } | null;
}

const EMPTY: EnergyFlows = {
  window: null, days: [], totals: null, exportByHour: new Array(24).fill(0),
  unbalancedDays: 0, avoidableValueRs: null, importRateRs: null, exportRateRs: null,
  antiReverseFlow: null,
};

/**
 * SOC above which the pack is treated as having no room left.
 *
 * Not 100: a BMS tapers hard at the top and the last few points accept almost
 * nothing, so counting export against a pack at 97% as "avoidable" would blame
 * the schedule for physics.
 */
const FULL_SOC = 95;

/** Gaps wider than this are not integrated across. */
const GAP_GUARD_MS = 30 * 60_000;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Read the site's energy flows.
 *
 * @param sourceId   Any source on the site. The METER and the LOAD are read
 *                   from this one only — one grid connection, one load.
 * @param allSources Every source behind the gateway, so the battery's
 *                   throughput is summed across cabinets.
 */
export async function fetchEnergyFlows(
  sourceId: string,
  allSources: string[],
  limit = 12_000,
): Promise<EnergyFlows> {
  if (!sourceId) return EMPTY;

  const meter = `${sourceId}_grid_meter`;
  const ems = `${sourceId}_ems_system`;

  const [impS, expS, loadS, arf, ...perSource] = await Promise.all([
    storedSeries(meter, "forward_total_active_energy", limit),
    storedSeries(meter, "reverse_total_active_energy", limit),
    storedSeries(ems, "load_power", limit),
    fetchSourceTelemetry(sourceId)
      .then((t) => ({
        enabled: (() => {
          const v = signal(t, "ems_system", "anti_reverse_flow_enable");
          return v == null ? null : v === 1;
        })(),
        upperKw: signal(t, "ems_system", "anti_reverse_flow_power_upper_limit_setting"),
      }))
      .catch(() => null),
    ...allSources.flatMap((s) => [
      storedSeries(`${s}_pcs_1`, "ac_cumulative_charge_energy", limit),
      storedSeries(`${s}_pcs_1`, "ac_cumulative_discharge_energy", limit),
      storedSeries(`${s}_bms_1`, "display_soc", limit),
    ]),
  ]);

  if (impS.length < 2 && expS.length < 2) return EMPTY;

  const chargeS: Sample[][] = [];
  const dischargeS: Sample[][] = [];
  const socS: Sample[][] = [];
  for (let i = 0; i < allSources.length; i++) {
    chargeS.push(perSource[i * 3] ?? []);
    dischargeS.push(perSource[i * 3 + 1] ?? []);
    socS.push(perSource[i * 3 + 2] ?? []);
  }

  const cadenceMs = cadenceOf(impS);
  const tol = Math.max(cadenceMs ?? 60_000, 60_000) * 2;

  /* ── Export, increment by increment, against the pack's SOC ─────────────
     Walked at sample resolution rather than per day, because "was there room"
     is a question about the moment the energy left, not about the day it left
     in. A pack that ends the day full says nothing about whether it was full
     at eleven in the morning. */
  const exportByHour = new Array<number>(24).fill(0);
  const avoidableByDay = new Map<string, number>();
  const chargingByDay = new Map<string, number>();

  /** Was any cabinet's charge counter advancing across this interval? */
  const wasCharging = (fromTs: number, toTs: number): boolean =>
    chargeS.some((s) => {
      const a = valueAt(s, fromTs, tol), b = valueAt(s, toTs, tol);
      /* A tenth of a kWh over a five-minute sample is about 1.2 kW — below
         that the counter is quantisation, not a charge. */
      return a != null && b != null && b - a > 0.1;
    });

  for (let i = 1; i < expS.length; i++) {
    const dt = expS[i].ts - expS[i - 1].ts;
    if (dt <= 0 || dt > GAP_GUARD_MS) continue;
    const kwh = expS[i].value - expS[i - 1].value;
    if (kwh <= 0) continue;

    exportByHour[istHour(expS[i].ts)] += kwh;

    /* Mean SOC across the cabinets at that instant. A site with one full pack
       and one empty one did have room, so the mean is the right reading — and
       a cabinet that reported nothing is left out rather than counted as
       empty, which would manufacture room that was not there. */
    const socs = socS.map((s) => valueAt(s, expS[i].ts, tol)).filter((v): v is number => v != null);
    if (!socs.length) continue;
    const soc = socs.reduce((a, b) => a + b, 0) / socs.length;
    if (soc >= FULL_SOC) continue;

    const k = dayKey(expS[i].ts);
    /* Room in the pack is necessary but not sufficient. A pack that was
       already charging at its scheduled rate was doing what it could with this
       energy; the export beside it is only recoverable if the converter had
       headroom to go faster, which needs a charge-power limit this does not
       read. Counting it as avoidable put 100% of a demo site's export in that
       bucket, including the middle of a charge window — and the remedy the
       screen then suggested, "move the charge window", was the one thing that
       would not have helped.

       The counters answer it for free: if no cabinet's charge register moved
       across the interval, the pack was idle or discharging while the site
       pushed power out, and that is unambiguous. */
    if (wasCharging(expS[i - 1].ts, expS[i].ts)) {
      chargingByDay.set(k, (chargingByDay.get(k) ?? 0) + kwh);
    } else {
      avoidableByDay.set(k, (avoidableByDay.get(k) ?? 0) + kwh);
    }
  }

  /* ── Load, integrated ──────────────────────────────────────────────────── */
  const loadByDay = new Map<string, number>();
  for (let i = 1; i < loadS.length; i++) {
    const dt = loadS[i].ts - loadS[i - 1].ts;
    if (dt <= 0 || dt > GAP_GUARD_MS) continue;
    /* Trapezium rather than left-endpoint: the load curve has real ramps at
       shift change and a rectangle rule biases them by half a sample. */
    const kw = (loadS[i].value + loadS[i - 1].value) / 2;
    const k = dayKey(loadS[i].ts);
    loadByDay.set(k, (loadByDay.get(k) ?? 0) + (kw * dt) / 3_600_000);
  }

  const impD = dayEdges(impS);
  const expD = dayEdges(expS);
  const chargeD = chargeS.map(dayEdges);
  const dischargeD = dischargeS.map(dayEdges);

  const keys = [...new Set([...impD.keys(), ...expD.keys()])].sort();
  const days: FlowDay[] = [];

  for (const k of keys) {
    const imp = impD.get(k);
    const exp = expD.get(k);
    if (!imp) continue;

    const partial = imp.last.ts - imp.first.ts < 20 * 3_600_000;

    const importKwh = Math.max(0, imp.last.value - imp.first.value);
    const exportKwh = exp ? Math.max(0, exp.last.value - exp.first.value) : 0;

    let batteryChargeKwh = 0, batteryDischargeKwh = 0;
    for (let i = 0; i < allSources.length; i++) {
      const c = chargeD[i]?.get(k);
      const d = dischargeD[i]?.get(k);
      if (c) batteryChargeKwh += Math.max(0, c.last.value - c.first.value);
      if (d) batteryDischargeKwh += Math.max(0, d.last.value - d.first.value);
    }

    const loadKwh = loadByDay.get(k) ?? 0;

    /* The balance. Reported as null rather than clamped when it comes out
       negative — a negative generation is the arithmetic telling you one of
       its inputs is wrong, and hiding that behind a zero would put a
       confident 0 kWh of sunshine on a day the sun was out. */
    const raw = loadKwh + exportKwh + batteryChargeKwh - importKwh - batteryDischargeKwh;
    const solarKwh = loadKwh > 0 && raw > -0.02 * Math.max(loadKwh, 1) ? Math.max(0, raw) : null;

    days.push({
      date: k,
      importKwh: r1(importKwh),
      exportKwh: r1(exportKwh),
      batteryChargeKwh: r1(batteryChargeKwh),
      batteryDischargeKwh: r1(batteryDischargeKwh),
      loadKwh: r1(loadKwh),
      solarKwh: solarKwh == null ? null : r1(solarKwh),
      avoidableExportKwh: r1(avoidableByDay.get(k) ?? 0),
      exportWhileChargingKwh: r1(chargingByDay.get(k) ?? 0),
      selfConsumptionPct: solarKwh && solarKwh > 1
        ? Math.round(((solarKwh - exportKwh) / solarKwh) * 1000) / 10
        : null,
      selfSufficiencyPct: loadKwh > 1
        ? Math.round(((loadKwh - importKwh) / loadKwh) * 1000) / 10
        : null,
      partial,
    });
  }

  /* Totals over the COMPLETE days only. A part-day at either end of the window
     has less energy in every counter, and folding it into a ratio drags the
     ratio rather than the totals — the one place a partial day does real
     damage. */
  const full = days.filter((d) => !d.partial);
  const sum = (f: (d: FlowDay) => number) => full.reduce((s, d) => s + f(d), 0);

  const solarTotal = full.every((d) => d.solarKwh == null)
    ? null
    : sum((d) => d.solarKwh ?? 0);

  const importKwh = sum((d) => d.importKwh);
  const exportKwh = sum((d) => d.exportKwh);
  const loadKwh = sum((d) => d.loadKwh);
  const avoidableExportKwh = sum((d) => d.avoidableExportKwh);

  const ov = overlayFor(sourceId);
  const importRateRs = ov.todRates?.flat ?? null;
  const exportRateRs = ov.exportRateRs ?? null;

  return {
    window: full.length || days.length
      ? {
          fromTs: impS[0].ts,
          toTs: impS[impS.length - 1].ts,
          days: days.length,
          cadenceMs,
        }
      : null,
    days,
    totals: full.length
      ? {
          importKwh: r1(importKwh),
          exportKwh: r1(exportKwh),
          loadKwh: r1(loadKwh),
          solarKwh: solarTotal == null ? null : r1(solarTotal),
          batteryChargeKwh: r1(sum((d) => d.batteryChargeKwh)),
          batteryDischargeKwh: r1(sum((d) => d.batteryDischargeKwh)),
          avoidableExportKwh: r1(avoidableExportKwh),
          exportWhileChargingKwh: r1(sum((d) => d.exportWhileChargingKwh)),
          selfConsumptionPct: solarTotal && solarTotal > 1
            ? Math.round(((solarTotal - exportKwh) / solarTotal) * 1000) / 10
            : null,
          selfSufficiencyPct: loadKwh > 1
            ? Math.round(((loadKwh - importKwh) / loadKwh) * 1000) / 10
            : null,
        }
      : null,
    exportByHour: exportByHour.map(r1),
    unbalancedDays: days.filter((d) => !d.partial && d.solarKwh == null).length,
    /* The gap between what a unit fetches on the way out and what it costs on
       the way back in. Exporting is not a loss; exporting energy you then buy
       back at four times the price is. */
    avoidableValueRs: importRateRs != null && exportRateRs != null
      ? Math.round(avoidableExportKwh * (importRateRs - exportRateRs))
      : null,
    importRateRs,
    exportRateRs,
    antiReverseFlow: arf,
  };
}
