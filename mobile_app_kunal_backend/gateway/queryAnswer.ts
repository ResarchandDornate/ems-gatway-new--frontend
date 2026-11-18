/**
 * A parsed question, plus a window of history, becomes an answer.
 *
 * Isomorphic and dependency-free — and deliberately decoupled from data.ts:
 * the two shapes below are structural, so a `CurveSample[]` and a
 * `HistoryWindow["totals"]` satisfy them without this module importing the
 * client data layer or the client data layer importing this.
 *
 * ── Every figure here is measured, none is generated ──────────────────────
 * The numbers come out of the historian's own aggregates, which were
 * integrated server-side over every raw row. This module selects and compares
 * them; it does not compute new ones. The same rule that governs the alarm
 * explanations and the advisor governs the search box.
 *
 * ── Absence is not zero ───────────────────────────────────────────────────
 * A field the window could not measure answers `null`, never 0, and the screen
 * renders that as a dash with the reason beside it. A search box that answers
 * "0 kWh" to a question about a period the historian never received is the
 * worst failure available here, because it looks exactly like a quiet plant.
 */

import type { Aggregate, Field, HistoryQuery } from "./queryParse";
import { FIELD_LABEL } from "./queryParse";

/** Structurally satisfied by CurveSample. */
export interface Sample {
  t: number;
  powerKw: number | null;
  soc: number | null;
  tempMax: number | null;
  cellSpreadMv: number | null;
}

/** Structurally satisfied by HistoryWindow["totals"]. */
export interface Totals {
  charged: number;
  discharged: number;
  ratioPct: number | null;
  peakKw: number | null;
  socMin: number | null;
  socMax: number | null;
  tempMax: number | null;
}

/** Units as they are written on screen, beside the figure. */
export const FIELD_UNIT: Record<Field, string> = {
  soc: "%",
  power: "kW",
  temperature: "°C",
  cellSpread: "mV",
  charged: "kWh",
  discharged: "kWh",
  roundTrip: "%",
};

/**
 * Which fields exist sample-by-sample.
 *
 * The other three are period totals: the historian integrates energy and
 * efficiency over the window and does not carry them per sample. That is why a
 * "when did we charge above 50 kWh" question cannot be answered — there is no
 * instant at which a total was anything — and the UI says so rather than
 * returning an empty list, which would read as "never".
 */
/**
 * What the chart actually draws.
 *
 * Only these two. Saying "drawn below" about cell voltage spread or battery
 * temperature sent the reader to a chart that does not contain them — the
 * plainest kind of wrong this app can be, because the sentence is confident
 * and the evidence for it is absent rather than incorrect. Anything not in
 * here gets summarised in the answer itself.
 */
const PLOTTED: ReadonlySet<Field> = new Set<Field>(["soc", "power"]);

const SERIES_FIELD: Partial<Record<Field, (s: Sample) => number | null>> = {
  soc: (s) => s.soc,
  power: (s) => s.powerKw,
  temperature: (s) => s.tempMax,
  cellSpread: (s) => s.cellSpreadMv,
};

export interface Crossing {
  from: number;
  to: number;
  /** The most extreme value reached inside this stretch. */
  peak: number;
}

export type Answer =
  | { kind: "value"; label: string; value: number | null; unit: string; note?: string }
  | { kind: "series"; label: string; note?: string }
  | { kind: "range"; label: string; low: number | null; high: number | null; unit: string; note: string }
  | { kind: "crossings"; label: string; crossings: Crossing[]; unit: string }
  | { kind: "unanswerable"; label: string; reason: string };

const cmp = (op: HistoryQuery["condition"] extends undefined ? never : "gt" | "gte" | "lt" | "lte",
             v: number, t: number): boolean =>
  op === "gt" ? v > t : op === "gte" ? v >= t : op === "lt" ? v < t : v <= t;

/**
 * Stretches where the field satisfied the condition.
 *
 * Consecutive qualifying samples are merged into one stretch, because an
 * operator asking "when did spread exceed 200" wants the episodes, not four
 * hundred timestamps. A `null` sample ends the current stretch rather than
 * extending it: a gap in the data is not evidence the condition held across it.
 */
export function findCrossings(
  samples: Sample[],
  read: (s: Sample) => number | null,
  op: "gt" | "gte" | "lt" | "lte",
  threshold: number,
): Crossing[] {
  const out: Crossing[] = [];
  let open: Crossing | null = null;

  for (const s of samples) {
    const v = read(s);
    const hit = v != null && cmp(op, v, threshold);

    if (hit) {
      if (!open) open = { from: s.t, to: s.t, peak: v! };
      else {
        open.to = s.t;
        /* "Peak" means furthest past the threshold, which is the largest value
           for an upper bound and the smallest for a lower one. */
        open.peak = op === "lt" || op === "lte" ? Math.min(open.peak, v!) : Math.max(open.peak, v!);
      }
    } else if (open) {
      out.push(open);
      open = null;
    }
  }
  if (open) out.push(open);
  return out;
}

/** Pick the figure an aggregate asks for out of the window's own totals. */
function fromTotals(field: Field, aggregate: Aggregate, totals: Totals): number | null {
  switch (field) {
    case "charged":    return totals.charged;
    case "discharged": return totals.discharged;
    case "roundTrip":  return totals.ratioPct;
    case "power":
      /* Only the peak is carried as a total. A mean or a minimum would have to
         be computed over the decimated series, which is a different figure
         from one integrated over every raw row — so it is refused rather than
         quietly answered with a worse number. */
      return aggregate === "max" ? totals.peakKw : null;
    case "temperature":
      return aggregate === "max" ? totals.tempMax : null;
    case "soc":
      return aggregate === "max" ? totals.socMax : aggregate === "min" ? totals.socMin : null;
    default:
      return null;
  }
}

export function answerQuery(q: HistoryQuery, samples: Sample[], totals: Totals): Answer {
  const label = FIELD_LABEL[q.field];
  const unit = FIELD_UNIT[q.field];

  if (q.intent === "when" && q.condition) {
    const read = SERIES_FIELD[q.field];
    if (!read) {
      return {
        kind: "unanswerable",
        label,
        reason:
          `${label} is a total for the period, not a reading at each instant, so there is no ` +
          `moment at which it crossed a level.`,
      };
    }
    return {
      kind: "crossings",
      label,
      unit,
      crossings: findCrossings(samples, read, q.condition.op, q.condition.value),
    };
  }

  if (q.aggregate === "series") {
    if (PLOTTED.has(q.field)) return { kind: "series", label };

    /* Not on the chart, so the answer has to carry the figures itself.

       These come from the plotted series rather than from a server-side
       integral — the historian carries no total for cell spread at all — so
       they are the extremes of the bucketed line, not of every raw row. That
       is a real difference at the margins and the note says so rather than
       presenting a decimated extreme as the period's true one. */
    const read = SERIES_FIELD[q.field];
    if (read) {
      const vals = samples.map(read).filter((v): v is number => v != null);
      return {
        kind: "range",
        label,
        low: vals.length ? Math.min(...vals) : null,
        high: vals.length ? Math.max(...vals) : null,
        unit,
        note: "The chart below shows power and state of charge only, so these are the highest and lowest points of the recorded series.",
      };
    }
    const total = fromTotals(q.field, "total", totals);
    return {
      kind: "value",
      label,
      value: total,
      unit,
      note: "Totalled over the period. The chart below shows power and state of charge only.",
    };
  }

  const value = fromTotals(q.field, q.aggregate, totals);
  if (value === null) {
    /* The window holds the series but not this summary of it. Saying which is
       the difference between a limitation the reader can work around and an
       apparent absence of data. */
    return {
      kind: "unanswerable",
      label,
      reason:
        `The historian summarises ${label} over a period as ` +
        `${q.field === "soc" ? "its highest and lowest" : "its peak"}, not as ` +
        `${q.aggregate === "mean" ? "an average" : `a ${q.aggregate}`}. The chart below covers the period.`,
    };
  }

  return { kind: "value", label, value, unit };
}
