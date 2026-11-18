/**
 * Maximum demand — what the DISCOM will bill, and what the battery took off it.
 *
 * ── Why this is the number ────────────────────────────────────────────────
 * An Indian HT/C&I bill has two halves. Energy is ₹/kWh on what was consumed.
 * Demand is ₹/kVA/month on the single highest block the meter saw all month —
 * one fifteen-minute stretch, once, sets a charge that is levied on every day
 * of the billing period. On a 500 kVA connection at ₹385/kVA that half of the
 * bill is around ₹1.9 lakh a month, and it is decided by 0.03% of the month.
 *
 * Which makes it the one figure where a BESS earns its keep without a tariff
 * order in hand: peak shaving does not need ToD slots, it needs the battery to
 * be discharging during the block that would otherwise have been the peak.
 *
 * ── What is measured and what is estimated ───────────────────────────────
 * Measured, from the meter: `total_apparent_power` in kVA, which is what the
 * tariff bills, published directly rather than derived from kW and a power
 * factor. `total_active_power` comes along to give it a SIGN — apparent power
 * is a magnitude, so a site exporting 200 kW reads 200 kVA and is not drawing
 * demand at all. Blocks whose active power is negative contribute zero.
 *
 * Estimated, and labelled as such everywhere it surfaces: the counterfactual —
 * what demand would have been without the battery. That is the site's own load
 * before the BESS displaced any of it, which in active power is exactly
 * `grid_kW + bess_kW` (discharge positive). Converting it back to kVA needs a
 * power factor, and the only one available is the one the meter measured WITH
 * the battery running. The assumption is that the BESS shifts active power
 * without much changing the site's reactive draw — true enough for a converter
 * held near unity PF, and stated rather than hidden, because the saving figure
 * rests on it.
 *
 * ── The block rule, which is where this usually goes wrong ───────────────
 * Demand blocks are FIXED wall-clock windows — 00:00-00:15, 00:15-00:30 — not
 * a rolling window from wherever the data starts. A rolling maximum over the
 * same data is always higher than the billed figure, sometimes by a lot, and a
 * screen that reported one would have operators chasing a peak the meter never
 * saw. Blocks here are floored to a 900 s multiple of epoch.
 *
 * That epoch alignment is also IST alignment, and not by luck: IST is UTC+5:30
 * and 330 minutes is exactly 22 blocks of 15. It would NOT hold for a
 * 20-minute block, or in a +5:45 zone. Stated because the day it stops holding
 * is the day this silently reports the wrong blocks.
 *
 * ── This is not the bill ─────────────────────────────────────────────────
 * The billed figure comes off the DISCOM's own meter, which integrates
 * continuously. This reads the gateway's snapshot store, which samples — so a
 * block is the mean of however many samples landed in it, and `samples` is
 * carried on every block so the screen can say when that is too few to trust.
 * It is an operational early warning, not a settlement document, and the UI
 * says so.
 */

import { fetchSourceTelemetry, signal } from "@/lib/gateway";
import { storedSeries, dayKey, cadenceOf } from "./storedSeries";
import { overlayFor } from "../overlay/stations";

/** Demand block width. Fifteen minutes is the Indian C&I norm. */
export const BLOCK_MS = 15 * 60_000;

/* ── Public shape ─────────────────────────────────────────────────────────── */

export interface DemandBlock {
  /** Block start, floored to a 15-minute multiple of epoch. */
  startTs: number;
  /** Mean import demand over the block, kVA. Null when nothing landed in it. */
  kva: number | null;
  /** Mean active import over the block, kW. */
  kw: number | null;
  /** Mean power factor the meter reported across the block. */
  pf: number | null;
  /** Estimated kVA had the battery not been running. See the header. */
  withoutBessKva: number | null;
  /** How many stored samples fell in this block. Fewer is less trustworthy. */
  samples: number;
}

export interface MaxDemand {
  window: { fromTs: number; toTs: number; blocks: number; cadenceMs: number | null } | null;
  blocks: DemandBlock[];
  /** The highest complete block — the one that would set the bill. */
  peak: DemandBlock | null;
  /** The highest block of the counterfactual, i.e. the peak without the BESS. */
  peakWithoutBess: DemandBlock | null;
  /** Each day's highest block, for the trend. */
  daily: { date: string; kva: number; withoutBessKva: number | null }[];
  /** Sanctioned demand and what it costs, from the overlay. Null when unset. */
  contractKva: number | null;
  demandChargeRs: number | null;
  /**
   * The block in progress: its running mean and where it lands if the site
   * holds its present draw to the end. This is the actionable half.
   */
  current: {
    startTs: number;
    /** Block time covered by readings: start → the newest sample (backend time, not the clock). */
    elapsedMs: number;
    meanSoFarKva: number | null;
    latestKva: number | null;
    /** sample_time of the newest reading, epoch ms. */
    latestTs: number | null;
    projectedKva: number | null;
  } | null;
  /**
   * The EMS's own demand-limiting configuration, read live.
   *
   * Surfaced because it answers "is anything actually defending this number?"
   * — and on a plant where the limiter is switched off, that is the finding.
   * `limitKw` is reported as the register is named; the dictionary gives
   * `demand` a unit of kW and does not say whether it is the measured demand
   * or the configured target, so it is labelled as the EMS's setting and not
   * asserted to be either.
   */
  emsLimiter: { enabled: boolean | null; demandKw: number | null; limitPct: number | null } | null;
}

const EMPTY: MaxDemand = {
  window: null, blocks: [], peak: null, peakWithoutBess: null, daily: [],
  contractKva: null, demandChargeRs: null, current: null, emsLimiter: null,
};

const blockOf = (ts: number) => Math.floor(ts / BLOCK_MS) * BLOCK_MS;
const r1 = (n: number) => Math.round(n * 10) / 10;

type Samples = Map<number, number>;

/**
 * One signal as timestamp → value.
 *
 * A Map rather than the shared module's array, because this service walks the
 * meter's own sample instants and looks the battery up AT them — an index is
 * what that needs, and building it here keeps the reading rules in one place
 * while leaving the shape to the caller.
 */
async function series(assetId: string, sig: string, limit: number): Promise<Samples> {
  const out: Samples = new Map();
  for (const s of await storedSeries(assetId, sig, limit)) out.set(s.ts, s.value);
  return out;
}

/**
 * Read the site's demand history.
 *
 * @param sourceId  Any source on the site. The METER is read from this one
 *                  only — see below.
 * @param allSources Every source behind the same gateway, so the battery's
 *                  contribution can be summed across cabinets.
 * @param limit     Stored rows per signal.
 */
export async function fetchMaxDemand(
  sourceId: string,
  allSources: string[],
  limit = 3000,
): Promise<MaxDemand> {
  if (!sourceId) return EMPTY;

  /* ONE grid connection, one meter, read from one source.

     Both EMS sources publish a `utility_meter` asset and an `ems_system`
     carrying `grid_current_total_power`, and on this site they are two
     reports of the SAME physical connection rather than two connections.
     Summing them would double the site's demand and halve its apparent
     headroom — the single most damaging arithmetic error available on this
     screen, because it would read as comfortably inside a contract the site
     was actually breaching. The battery, by contrast, IS per cabinet, and is
     summed below. */
  const meterAsset = `${sourceId}_grid_meter`;

  const [kvaS, kwS, pfS, limiter, ...bessS] = await Promise.all([
    series(meterAsset, "total_apparent_power", limit),
    series(meterAsset, "total_active_power", limit),
    series(meterAsset, "total_power_factor", limit),
    /* The limiter's configuration is a live reading, not a history — it is
       what the EMS is set to right now. Read off the same snapshot every other
       screen uses, and allowed to fail without taking the demand figures with
       it: a limiter whose state is unknown is a caveat, not an outage. */
    fetchSourceTelemetry(sourceId)
      .then((t) => ({
        enabled: (() => {
          const v = signal(t, "ems_system", "demand_enable");
          return v == null ? null : v === 1;
        })(),
        demandKw: signal(t, "ems_system", "demand"),
        limitPct: signal(t, "ems_system", "demand_limit_percentage"),
      }))
      .catch(() => null),
    ...allSources.map((s) => series(`${s}_pcs_1`, "total_active_power", limit)),
  ]);

  if (!kvaS.size && !kwS.size) return EMPTY;

  /* Accumulate into fixed blocks. The meter's own timestamps drive it: a
     battery sample with no meter sample at the same instant has no block to
     belong to, because demand is a property of the connection. */
  interface Acc { kva: number; kw: number; pf: number; cf: number; n: number; nPf: number; nCf: number }
  const acc = new Map<number, Acc>();

  const stamps = [...new Set([...kvaS.keys(), ...kwS.keys()])].sort((a, b) => a - b);
  for (const ts of stamps) {
    const kw = kwS.get(ts);
    const kva = kvaS.get(ts);
    if (kw == null && kva == null) continue;

    const b = blockOf(ts);
    const a = acc.get(b) ?? { kva: 0, kw: 0, pf: 0, cf: 0, n: 0, nPf: 0, nCf: 0 };

    /* Export contributes nothing to demand. Apparent power is unsigned, so
       without the active sign a site pushing 200 kW back would be recorded as
       200 kVA of demand it never drew. */
    const importing = kw == null ? true : kw > 0;
    a.kva += importing && kva != null ? kva : 0;
    a.kw += importing && kw != null ? kw : 0;
    a.n += 1;

    const pf = pfS.get(ts);
    if (pf != null && Math.abs(pf) > 0.05) { a.pf += Math.abs(pf); a.nPf += 1; }

    /* The counterfactual, in active power, then converted with the measured
       PF. Only computed where every cabinet reported at this instant — a
       partial sum would understate the battery's contribution and so overstate
       the saving, which is the direction that flatters us. */
    const bess = bessS.map((m) => m.get(ts));
    if (kw != null && bess.every((v) => v != null)) {
      const withoutKw = kw + bess.reduce((s, v) => s + (v as number), 0);
      const usePf = pf != null && Math.abs(pf) > 0.05 ? Math.abs(pf) : 1;
      a.cf += withoutKw > 0 ? withoutKw / usePf : 0;
      a.nCf += 1;
    }

    acc.set(b, a);
  }

  const blocks: DemandBlock[] = [...acc.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([startTs, a]) => ({
      startTs,
      kva: a.n ? r1(a.kva / a.n) : null,
      kw: a.n ? r1(a.kw / a.n) : null,
      pf: a.nPf ? Math.round((a.pf / a.nPf) * 1000) / 1000 : null,
      withoutBessKva: a.nCf ? r1(a.cf / a.nCf) : null,
      samples: a.n,
    }));

  if (!blocks.length) return EMPTY;

  /* The block in progress is not a billed block yet — it has only part of its
     samples, so its mean is not comparable with the completed ones and must
     not be allowed to win the month. Split off and reported separately. */
  const nowBlock = blockOf(Date.now());
  const complete = blocks.filter((b) => b.startTs < nowBlock);
  const inProgress = blocks.find((b) => b.startTs === nowBlock) ?? null;

  const peak = complete.reduce<DemandBlock | null>(
    (best, b) => (b.kva != null && (best?.kva == null || b.kva > best.kva) ? b : best), null,
  );
  const peakWithoutBess = complete.reduce<DemandBlock | null>(
    (best, b) => (b.withoutBessKva != null && (best?.withoutBessKva == null || b.withoutBessKva > best.withoutBessKva) ? b : best), null,
  );

  /* Each day's peak, and each day's peak WITHOUT the battery — maximised
     independently, because they are not generally the same block.

     This took the counterfactual of whichever block set the billed peak, which
     is a different quantity wearing the same label. On a quiet day the billed
     peak can be a small-hours block the battery itself created by charging; its
     counterfactual is the bare night load, near zero. Charted beside "billed
     peak" under a legend reading "without battery", that drew the site's
     demand collapsing to nothing on exactly the days the battery was working
     hardest — the opposite of what happened. The day's peak without the
     battery is the largest block the site would have drawn, wherever in the
     day it falls. */
  const byDay = new Map<string, { kva: number; withoutBessKva: number | null }>();
  for (const b of complete) {
    const k = dayKey(b.startTs);
    const cur = byDay.get(k) ?? { kva: Number.NEGATIVE_INFINITY, withoutBessKva: null };
    if (b.kva != null && b.kva > cur.kva) cur.kva = b.kva;
    if (b.withoutBessKva != null && (cur.withoutBessKva == null || b.withoutBessKva > cur.withoutBessKva)) {
      cur.withoutBessKva = b.withoutBessKva;
    }
    byDay.set(k, cur);
  }
  for (const [k, v] of byDay) if (!Number.isFinite(v.kva)) byDay.delete(k);

  const times = [...kvaS.keys(), ...kwS.keys()].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] !== times[i - 1]) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);

  const latestTs = times[times.length - 1];
  const latestKva = latestTs != null ? kvaS.get(latestTs) ?? null : null;

  let current: MaxDemand["current"] = null;
  if (inProgress) {
    /* Measured to the newest SAMPLE, not the clock: a gateway that stalls
       mid-block must not have its stale mean weighted as if time ran on. */
    const elapsedMs = latestTs != null ? Math.max(0, Math.min(BLOCK_MS, latestTs - inProgress.startTs)) : 0;
    const frac = Math.max(0, Math.min(1, elapsedMs / BLOCK_MS));
    current = {
      startTs: inProgress.startTs,
      elapsedMs,
      meanSoFarKva: inProgress.kva,
      latestKva: latestKva == null ? null : r1(latestKva),
      latestTs: latestTs ?? null,
      /* Where the block lands if the site holds its present draw for the rest
         of it. Not a forecast of behaviour — a statement of what the current
         draw implies, which is the thing somebody can act on before the block
         closes. */
      projectedKva:
        inProgress.kva != null && latestKva != null
          ? r1(inProgress.kva * frac + latestKva * (1 - frac))
          : inProgress.kva,
    };
  }

  const ov = overlayFor(sourceId);

  return {
    window: {
      fromTs: blocks[0].startTs,
      toTs: blocks[blocks.length - 1].startTs + BLOCK_MS,
      blocks: blocks.length,
      cadenceMs: gaps.length ? gaps[gaps.length >> 1] : null,
    },
    blocks,
    peak,
    peakWithoutBess,
    daily: [...byDay.entries()].sort().map(([date, v]) => ({ date, ...v })),
    contractKva: ov.contractDemandKva ?? null,
    demandChargeRs: ov.demandChargeRs ?? null,
    current,
    emsLimiter: limiter,
  };
}
