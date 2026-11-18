/**
 * Round-trip efficiency, trended — and refused where it cannot be computed.
 *
 * ── The number ────────────────────────────────────────────────────────────
 * RTE is the energy the battery gave back divided by the energy put into it.
 * It is the earliest commercial signal of degradation — a pack loses a point
 * or two of efficiency long before it loses measurable capacity — and it is
 * the figure a warranty claim is argued with. The dashboard already shows a
 * round-trip percentage for whatever window is on screen. Nothing trends it,
 * and a single window's figure cannot tell you anything: RTE means something
 * only as a slope.
 *
 * ── Why discharged / charged is NOT round-trip efficiency ────────────────
 * This is the whole difficulty and it is worth being blunt about.
 *
 * Over any window that does not begin and end at the same state of charge,
 * the ratio of the two counters is not an efficiency. A window that ends
 * emptier than it began returns more than it took and reads ABOVE 100%; one
 * that ends fuller reads far below. Measured on this plant's own 20-hour
 * reference capture, unit 1 charged 53.7 kWh and discharged 74.0 kWh — a
 * naive ratio of 138%, which is not a battery, it is a window that started
 * full.
 *
 * So the stored energy has to come out of the denominator:
 *
 *     ΔStored = (socEnd − socStart) / 100 × usable capacity
 *     RTE     = discharged / (charged − ΔStored)
 *
 * which needs a capacity, and a capacity is a commercial fact this gateway
 * does not publish. Without `installedCapacity` on the site's overlay entry
 * there is no correction to make, and this returns the days unreported with
 * the reason attached rather than printing the uncorrected ratio. An
 * uncorrected ratio on a battery screen is worse than no number: it is
 * plausible, it is precise, and it is not an efficiency.
 *
 * ── Energy from counters, the same figures as the rest of the app ────────
 * A day's charge and discharge are fetchDailyEnergy's (dailyEnergyCentral):
 * the PCS DC counters (p0205 / p0206), anchored at IST midnight, for this one
 * cabinet. The AC pair (p0203 / p0204) is physically inconsistent on this
 * site — AC discharge reads above DC discharge — and produced only
 * "outside 60–100 %" days here while Curves › Power Quantity reported 95 %.
 * ΔStored is SOC at the day's two IST edges × the rated capacity, read the
 * same way as Curves (curveReport.fetchDaySocEdges), and the gates below are
 * the Curves gates, so the two screens agree day for day.
 *
 * ── What it refuses ──────────────────────────────────────────────────────
 * A day is reported only when the corrected figure is physically possible and
 * the correction is not doing most of the work. Both gates matter:
 *
 *   PLAUSIBILITY  outside 60-100% something is wrong with the inputs, not
 *                 with the battery. Reporting 128% would be reporting a
 *                 measurement fault as a performance figure.
 *   DOMINANCE     when |ΔStored| approaches the day's throughput, the answer
 *                 is mostly the SOC estimate rather than the counters, and the
 *                 SOC estimate on this firmware is not good enough to carry
 *                 it. A day that parked at 40% and did nothing has no round
 *                 trip in it to measure.
 *
 * Refused days are returned with a `reason`, not dropped, because a screen
 * that silently showed six of the last thirty days would be read as a battery
 * that ran six times.
 */

import { storedSeries, dayKey } from "./storedSeries";
import { overlayFor } from "../overlay/stations";
import { fetchDailyEnergy } from "./dailyEnergyCentral.service";
import { fetchDaySocEdges } from "./curveReport.service";
import { istDate, parseIst } from "@/lib/api/time";
import { appConfigInit } from "@/lib/central/appConfig";

/* ── Public shape ─────────────────────────────────────────────────────────── */

export type SkipReason =
  | "no-capacity"
  | "no-soc"
  | "no-throughput"
  | "drift-dominates"
  | "implausible"
  | "partial-day";

export interface DayEfficiency {
  /** Local date, YYYY-MM-DD. */
  date: string;
  chargedKwh: number;
  dischargedKwh: number;
  socStart: number | null;
  socEnd: number | null;
  /** Energy left in the pack over the day, kWh. Positive means it ended fuller. */
  storedDeltaKwh: number | null;
  /** Depth of discharge seen across the day, SOC points. */
  dodPct: number | null;
  meanTempC: number | null;
  /** SOC-corrected round-trip efficiency, %. Null when refused. */
  rtePct: number | null;
  /** Why it was refused, when it was. */
  reason?: SkipReason;
}

/** One rolling window's figures, read end to end from the counters. */
export interface WindowEfficiency {
  /** Last day in the window — where the point is plotted. */
  endDate: string;
  startDate: string;
  /** Actual span between the two outer samples, days. */
  spanDays: number;
  chargedKwh: number;
  dischargedKwh: number;
  storedDeltaKwh: number | null;
  rtePct: number | null;
  reason?: SkipReason;
}

export interface RoundTrip {
  window: { fromTs: number; toTs: number; days: number; cadenceMs: number | null } | null;
  /** Every day in the window, reported or refused. */
  days: DayEfficiency[];
  /** Days that produced a figure, count. */
  reported: number;
  /** Mean RTE across reported days, %. */
  meanRtePct: number | null;
  /** Fitted change in RTE, percentage points per month. Negative is degrading. */
  trendPctPerMonth: number | null;
  /** One standard error on that slope, same units. */
  trendSePctPerMonth: number | null;
  /**
   * Whether the fitted slope clears its own uncertainty (|slope| > 2 SE).
   *
   * False does not mean the battery is fine — it means this window cannot tell
   * you either way, which is a different statement and the one a short window
   * is entitled to make.
   */
  trendConfident: boolean;
  /** Day-to-day scatter about the trend, percentage points. Measurement noise. */
  scatterPct: number | null;
  /** Rolling windows, newest last. The series the trend is fitted on. */
  weekly: WindowEfficiency[];
  /** Rolling RTE aligned to `days` for charting; null before the first window. */
  rollingRtePct: (number | null)[];
  /** The most recent complete window — the figure to quote as "now". */
  currentRtePct: number | null;
  /** Same, for the windowed series. Directly comparable with `scatterPct`. */
  windowScatterPct: number | null;
  /** Days in a rolling window. */
  windowDays: number;
  /** Correlation of RTE against mean cell temperature, −1…1. */
  tempCorrelation: number | null;
  /** Capacity the correction used. Null when the overlay does not state one. */
  capacityKwh: number | null;
}

/**
 * Consecutive days a rolling window spans.
 *
 * Seven, so a window always covers the same mix of weekdays and weekend. The
 * site runs a skeleton shift on Sunday and the battery cycles differently for
 * it; a five- or ten-day window would slide across that pattern and put a
 * weekly ripple into the trend that has nothing to do with the pack.
 */
const WINDOW_DAYS = 7;

/**
 * How much the overlap in a rolling series inflates apparent significance.
 *
 * Consecutive 7-day windows share six days of data, so they are nothing like
 * independent observations. Ordinary least squares assumes they are, and would
 * report a standard error roughly √7 too small — which on this screen means
 * calling a trend confident on a fortnight of data because the smoothing made
 * the points look tidy. The effective sample size is about n/7, so the SE is
 * scaled by √7 to match. Conservative, and in the direction that matters: the
 * failure worth avoiding is a confident wrong answer, not a cautious one.
 */
const OVERLAP_SE_INFLATION = Math.sqrt(WINDOW_DAYS);

const EMPTY: RoundTrip = {
  window: null, days: [], reported: 0, meanRtePct: null,
  trendPctPerMonth: null, trendSePctPerMonth: null, trendConfident: false,
  scatterPct: null, weekly: [], rollingRtePct: [], currentRtePct: null,
  windowScatterPct: null, windowDays: WINDOW_DAYS,
  tempCorrelation: null, capacityKwh: null,
};

/** A day is worth measuring only once this much has moved through the pack. */
const MIN_THROUGHPUT_KWH = 20;
/** Beyond this share of throughput, the SOC correction is the answer. */
const MAX_DRIFT_SHARE = 0.35;
const RTE_MIN = 60;
const RTE_MAX = 100;

/**
 * Least-squares slope in value-units per 30 days, WITH its standard error.
 *
 * The error is not decoration. A day's RTE carries a few tenths of a point of
 * scatter from the SOC readings at its boundaries, and a real pack degrades by
 * roughly a third of a point a month — so over a short window the fit returns a
 * number that is entirely noise, and sometimes returns it with the wrong sign.
 * Measured on this plant's own demo data over twenty days, a true decline of
 * −0.3 pts/month fitted as +0.06. A screen that printed that would be telling
 * an operator their battery was improving.
 *
 * So the slope is reported with the uncertainty beside it, and the caller is
 * expected to say "too short to tell" when the one does not clear the other.
 */
function fitSlope(pts: { x: number; y: number }[]): { perMonth: number; sePerMonth: number } | null {
  const n = pts.length;
  if (n < 8) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const sxxCentred = sxx - (sx * sx) / n;
  if (sxxCentred < 1e-9) return null;
  const slope = (sxy - (sx * sy) / n) / sxxCentred;
  const intercept = sy / n - slope * (sx / n);

  /* Residual standard deviation, then the textbook SE of a regression slope.
     n − 2 because the fit spent two degrees of freedom on slope and intercept. */
  let ss = 0;
  for (const p of pts) { const r = p.y - (intercept + slope * p.x); ss += r * r; }
  const sigma = Math.sqrt(ss / (n - 2));
  const se = sigma / Math.sqrt(sxxCentred);

  /* x is in days; × 30 makes both a month, which is the period somebody
     compares against a warranty. */
  return { perMonth: slope * 30, sePerMonth: se * 30 };
}


/**
 * Scatter about the series' own trend line, not about its mean.
 *
 * Detrended on purpose. A series that is genuinely declining has a standard
 * deviation inflated by the decline itself, and the two scatter figures on
 * this screen exist to be COMPARED — daily against windowed — as a measure of
 * how much noise each carries. Measured about the mean, the windowed series
 * looked barely better than the daily one, because most of what was left in it
 * was the real trend the screen is trying to find. About the fitted line, what
 * remains is the measurement noise, which is the thing being compared.
 */
function detrendedStdev(pts: { x: number; y: number }[]): number | null {
  const n = pts.length;
  if (n < 4) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const sxxCentred = sxx - (sx * sx) / n;
  if (sxxCentred < 1e-9) return null;
  const slope = (sxy - (sx * sy) / n) / sxxCentred;
  const intercept = sy / n - slope * (sx / n);
  let ss = 0;
  for (const p of pts) { const r = p.y - (intercept + slope * p.x); ss += r * r; }
  return Math.round(Math.sqrt(ss / (n - 2)) * 100) / 100;
}

/** Pearson correlation. Null when either series is flat or too short. */
function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da < 1e-9 || db < 1e-9) return null;
  return Math.round((num / Math.sqrt(da * db)) * 100) / 100;
}

/** Days of history read. The collector stores a month; older days answer null. */
const HISTORY_DAYS = 30;

let gatewayP: Promise<string> | null = null;
function gatewayId(): Promise<string> {
  gatewayP ??= fetch("/api/app-config", appConfigInit())
    .then((r) => (r.ok ? r.json() : { gatewayId: "" }))
    .then((j: { gatewayId?: string }) => j.gatewayId ?? "")
    .catch(() => "");
  return gatewayP;
}

/**
 * Read one cabinet's efficiency history.
 *
 * Per cabinet rather than per site, because efficiency is a property of a
 * pack and averaging two of them would hide the one that is degrading.
 */
export async function fetchRoundTrip(sourceId: string, _limit = 12_000): Promise<RoundTrip> {
  if (!sourceId) return EMPTY;
  const gw = await gatewayId();
  if (!gw) return EMPTY;

  const n = /^external_ems_(\d+)/.exec(sourceId)?.[1];
  const bessId = n ? `bess_${n}` : null;
  const bms = `${sourceId}_bms_1`;
  const today = istDate();
  const fromYmd = istDate(parseIst(today) - (HISTORY_DAYS - 1) * 86_400_000);

  const [energy, soc, temp] = await Promise.all([
    fetchDailyEnergy(gw, fromYmd, today, [sourceId]).catch(() => null),
    storedSeries(bms, "display_soc", 0),
    storedSeries(bms, "average_temperature", 0),
  ]);
  const points = (energy?.points ?? []).filter((p) => p.charge != null && p.discharge != null);
  if (!points.length) return EMPTY;

  const capacityKwh = overlayFor(sourceId).installedCapacity || null;
  const edges = bessId
    ? await fetchDaySocEdges(gw, points[0].date, points[points.length - 1].date, [bessId]).catch(() => ({}))
    : {};

  const tempSum = new Map<string, { sum: number; n: number }>();
  for (const s of temp) {
    const k = dayKey(s.ts);
    const cur = tempSum.get(k) ?? { sum: 0, n: 0 };
    cur.sum += s.value; cur.n += 1;
    tempSum.set(k, cur);
  }
  const socRange = new Map<string, { lo: number; hi: number }>();
  for (const s of soc) {
    const k = dayKey(s.ts);
    const cur = socRange.get(k) ?? { lo: s.value, hi: s.value };
    cur.lo = Math.min(cur.lo, s.value); cur.hi = Math.max(cur.hi, s.value);
    socRange.set(k, cur);
  }

  const days: DayEfficiency[] = [];
  for (const p of points) {
    const k = p.date;
    const chargedKwh = p.charge!;
    const dischargedKwh = p.discharge!;
    const e = bessId ? (edges as Record<string, Record<string, { start: number | null; end: number | null }>>)[k]?.[bessId] : undefined;
    const socStart = e?.start ?? null;
    const socEnd = e?.end ?? null;
    const t = tempSum.get(k);
    const range = socRange.get(k);
    /* The day's SOC swing: the S1 readings plus its two edges. */
    const swing = [range?.lo, range?.hi, socStart, socEnd].filter((v): v is number => v != null);

    const storedDeltaKwh =
      capacityKwh != null && socStart != null && socEnd != null
        ? ((socEnd - socStart) / 100) * capacityKwh
        : null;

    const base: DayEfficiency = {
      date: k,
      chargedKwh: Math.round(chargedKwh * 10) / 10,
      dischargedKwh: Math.round(dischargedKwh * 10) / 10,
      socStart, socEnd,
      storedDeltaKwh: storedDeltaKwh == null ? null : Math.round(storedDeltaKwh * 10) / 10,
      dodPct: swing.length ? Math.round((Math.max(...swing) - Math.min(...swing)) * 10) / 10 : null,
      meanTempC: t && t.n ? Math.round((t.sum / t.n) * 10) / 10 : null,
      rtePct: null,
    };

    /* Today, or a day the counters do not cover from its midnight — the SOC
       edges span the whole day and the energy would not. */
    if (p.partial || !p.fromMidnight) { days.push({ ...base, reason: "partial-day" }); continue; }
    if (capacityKwh == null) { days.push({ ...base, reason: "no-capacity" }); continue; }
    if (storedDeltaKwh == null) { days.push({ ...base, reason: "no-soc" }); continue; }
    if (chargedKwh + dischargedKwh < MIN_THROUGHPUT_KWH) {
      days.push({ ...base, reason: "no-throughput" });
      continue;
    }
    if (Math.abs(storedDeltaKwh) > MAX_DRIFT_SHARE * Math.max(chargedKwh, 1)) {
      days.push({ ...base, reason: "drift-dominates" });
      continue;
    }

    const denom = chargedKwh - storedDeltaKwh;
    const rte = denom > 1 ? (dischargedKwh / denom) * 100 : NaN;
    if (!Number.isFinite(rte) || rte < RTE_MIN || rte > RTE_MAX) {
      days.push({ ...base, reason: "implausible" });
      continue;
    }

    days.push({ ...base, rtePct: Math.round(rte * 10) / 10 });
  }

  /* ── The rolling window ──────────────────────────────────────────────────
     Seven consecutive whole days, summed: energy over the seven, ΔStored from
     the SOC at the first day's start to the last day's end — two readings
     under seven days of throughput, so the correction's noise is a seventh
     of a single day's. */
  const keys = days.map((d) => d.date);
  const weekly: WindowEfficiency[] = [];
  const DAY = 86_400_000;
  for (let i = WINDOW_DAYS - 1; i < days.length; i++) {
    const win = days.slice(i - (WINDOW_DAYS - 1), i + 1);
    const first = win[0], last = win[win.length - 1];
    /* Consecutive calendar days only, every one counted from its midnight. */
    if (parseIst(last.date) - parseIst(first.date) !== (WINDOW_DAYS - 1) * DAY) continue;
    if (win.some((d) => d.reason === "partial-day")) continue;

    const charged = win.reduce((s, d) => s + d.chargedKwh, 0);
    const discharged = win.reduce((s, d) => s + d.dischargedKwh, 0);
    const s0 = first.socStart, s1 = last.socEnd;
    const stored = capacityKwh != null && s0 != null && s1 != null ? ((s1 - s0) / 100) * capacityKwh : null;

    const w: WindowEfficiency = {
      endDate: last.date,
      startDate: first.date,
      spanDays: WINDOW_DAYS,
      chargedKwh: Math.round(charged * 10) / 10,
      dischargedKwh: Math.round(discharged * 10) / 10,
      storedDeltaKwh: stored == null ? null : Math.round(stored * 10) / 10,
      rtePct: null,
    };

    if (capacityKwh == null) { weekly.push({ ...w, reason: "no-capacity" }); continue; }
    if (stored == null) { weekly.push({ ...w, reason: "no-soc" }); continue; }
    if (charged + discharged < MIN_THROUGHPUT_KWH * WINDOW_DAYS) {
      weekly.push({ ...w, reason: "no-throughput" }); continue;
    }
    if (Math.abs(stored) > MAX_DRIFT_SHARE * Math.max(charged, 1)) {
      weekly.push({ ...w, reason: "drift-dominates" }); continue;
    }
    const denom = charged - stored;
    const rte = denom > 1 ? (discharged / denom) * 100 : NaN;
    if (!Number.isFinite(rte) || rte < RTE_MIN || rte > RTE_MAX) {
      weekly.push({ ...w, reason: "implausible" }); continue;
    }
    weekly.push({ ...w, rtePct: Math.round(rte * 100) / 100 });
  }

  const goodWeeks = weekly.filter((w) => w.rtePct != null);

  const good = days.filter((d) => d.rtePct != null);
  const t0 = goodWeeks.length
    ? Date.parse(`${goodWeeks[0].endDate}T00:00:00`)
    : good.length ? Date.parse(`${good[0].date}T00:00:00`) : 0;

  /* The trend is fitted on the WINDOWED series, which is the whole point of
     computing it — the daily series is too noisy for a slope to survive a
     short window, as the fit's own error bar keeps saying. The SE is then
     inflated for the overlap, so the honesty guard still applies to a series
     whose points are not independent. */
  const rawFit = fitSlope(
    goodWeeks.map((w) => ({ x: (Date.parse(`${w.endDate}T00:00:00`) - t0) / 86_400_000, y: w.rtePct! })),
  );
  const fit = rawFit && {
    perMonth: rawFit.perMonth,
    sePerMonth: rawFit.sePerMonth * OVERLAP_SE_INFLATION,
  };
  /* Scatter of the daily figures about their own mean, which is what the
     trend has to be read against. Mostly SOC-reading noise at the day
     boundaries rather than the pack doing anything different. */
  const dayT0 = good.length ? Date.parse(`${good[0].date}T00:00:00`) : 0;
  const scatter = detrendedStdev(
    good.map((d) => ({ x: (Date.parse(`${d.date}T00:00:00`) - dayT0) / 86_400_000, y: d.rtePct! })),
  );


  return {
    window: {
      fromTs: parseIst(days[0].date),
      toTs: Math.min(Date.now(), parseIst(days[days.length - 1].date) + DAY),
      days: days.length,
      cadenceMs: null,
    },
    days,
    reported: good.length,
    meanRtePct: good.length
      ? Math.round((good.reduce((s, d) => s + d.rtePct!, 0) / good.length) * 10) / 10
      : null,
    trendPctPerMonth: fit == null ? null : Math.round(fit.perMonth * 100) / 100,
    trendSePctPerMonth: fit == null ? null : Math.round(fit.sePerMonth * 100) / 100,
    /* Two standard errors, i.e. roughly 95% — the ordinary bar for calling a
       slope real. Below it the honest answer is that the window is too short,
       not that the slope is zero. */
    trendConfident: fit != null && Math.abs(fit.perMonth) > 2 * fit.sePerMonth,
    scatterPct: scatter,
    weekly,
    /* Plotted at the window's END day, not its middle. A centred point would
       read as a measurement of that day, and it is not — it is the seven days
       up to and including the end, which is also the only form available in
       real time. */
    rollingRtePct: keys.map((k) => {
      const w = weekly.find((x) => x.endDate === k);
      return w?.rtePct ?? null;
    }),
    currentRtePct: goodWeeks.length ? goodWeeks[goodWeeks.length - 1].rtePct : null,
    windowScatterPct: detrendedStdev(
      goodWeeks.map((w) => ({ x: (Date.parse(`${w.endDate}T00:00:00`) - t0) / 86_400_000, y: w.rtePct! })),
    ),
    windowDays: WINDOW_DAYS,
    tempCorrelation: correlation(
      good.filter((d) => d.meanTempC != null).map((d) => d.rtePct!),
      good.filter((d) => d.meanTempC != null).map((d) => d.meanTempC!),
    ),
    capacityKwh,
  };
}
