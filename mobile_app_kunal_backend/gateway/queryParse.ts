/**
 * "SOC on 25 August." → a window, a field, and an intent.
 *
 * Isomorphic and dependency-free. Runs in the browser, costs nothing, needs no
 * key and no network.
 *
 * ── Why a parser and not a model ──────────────────────────────────────────
 * The question space here is small and closed. The historian serves seven
 * fields. There are four comparison operators. Time expressions an operator
 * actually types fall into about a dozen shapes. That is a grammar, not a
 * reasoning problem, and a grammar answers in a millisecond, offline, for
 * nothing, and can be corrected by reading it.
 *
 * The same argument produced explanations.ts, and it has the same limit: it
 * covers what it covers and nothing else. So the important half of this module
 * is not what it parses — it is what it does when it fails.
 *
 * ── Failing visibly ───────────────────────────────────────────────────────
 * A miss returns `ok: false` with a reason and concrete suggestions, and the
 * screen shows them as tappable chips. That is frequently a better interface
 * than a model quietly guessing "temperature" when someone typed something
 * ambiguous — the person finds out immediately, in one tap, instead of reading
 * a chart of the wrong signal.
 *
 * Every unparsed question is also worth logging. The residual is the actual
 * evidence for whether a language model is needed here at all, and what for.
 *
 * ── The one rule it shares with everything else ───────────────────────────
 * This produces a QUERY, never an answer. The numbers come from the historian,
 * exactly as they do on every other screen.
 */

/* ── Vocabulary ────────────────────────────────────────────────────────────
   Fields are named for the aggregate they resolve to in HistoryWindow, so a
   caller can go from a parse straight to a value without a second mapping. */

export type Field =
  | "soc"
  | "power"
  | "temperature"
  | "cellSpread"
  | "charged"
  | "discharged"
  | "roundTrip";

export type Aggregate = "series" | "max" | "min" | "mean" | "total";
export type Op = "gt" | "gte" | "lt" | "lte";

/** What the asker wants back: the readings, or the times they crossed a line. */
export type Intent = "value" | "when";

export interface Condition {
  op: Op;
  value: number;
  /** The unit as typed, when one was. Kept for the UI to echo, not for maths. */
  unit?: string;
}

export interface Range {
  from: number;
  to: number;
  /** How the window will be described back to the reader. */
  label: string;
}

export interface HistoryQuery {
  field: Field;
  range: Range;
  aggregate: Aggregate;
  intent: Intent;
  condition?: Condition;
  /** "bess_1" / "bess_2" when the question named a unit. */
  unit?: string;
}

export type ParseResult =
  | {
      ok: true;
      query: HistoryQuery;
      /** Defaults the parser supplied that the question did not state. */
      assumptions: string[];
    }
  | {
      ok: false;
      /** Written for the person who typed it, not for a log. */
      reason: string;
      /** Concrete things to tap. Never empty. */
      suggestions: string[];
    };

/* ── Field synonyms ────────────────────────────────────────────────────────
   Ordered longest-first at match time so "cell voltage" cannot be swallowed by
   "voltage", and "state of charge" is not shadowed by "charge". That ordering
   is the whole reason this is a list of pairs rather than an object. */

const FIELD_TERMS: Array<[Field, string[]]> = [
  ["cellSpread", [
    "cell spread", "cell voltage spread", "voltage spread", "cell delta",
    "cell imbalance", "spread", "dv", "delta v", "cell difference",
  ]],
  ["roundTrip", [
    "round trip", "round-trip", "roundtrip", "rte", "efficiency",
  ]],
  ["temperature", [
    "temperature", "temp", "pack temperature", "cell temperature", "how hot", "heat",
  ]],
  ["soc", [
    "state of charge", "soc", "charge level", "battery level", "how full",
  ]],
  ["power", [
    "power", "kw", "output", "load", "how hard", "dispatch",
  ]],
  ["discharged", [
    "discharged", "discharge", "energy out", "exported",
  ]],
  ["charged", [
    "charged", "charging", "energy in", "imported",
    /* Bare "charge" is safe here only because matchTerm takes the LONGEST
       match across every field: "state of charge" (15) and "charge level"
       (12) both beat it, so those still resolve to SOC, while "how much did
       we charge" — where nothing longer matches — lands on the energy field.
       Shortening either SOC term would silently break this. */
    "charge",
  ]],
];

/** Human names, for assumptions and error copy. */
export const FIELD_LABEL: Record<Field, string> = {
  soc: "state of charge",
  power: "power",
  temperature: "battery temperature",
  cellSpread: "cell voltage spread",
  charged: "energy charged",
  discharged: "energy discharged",
  roundTrip: "round-trip efficiency",
};

/** Which aggregate a field defaults to when the question does not say. */
const DEFAULT_AGGREGATE: Record<Field, Aggregate> = {
  soc: "series",
  power: "series",
  temperature: "series",
  cellSpread: "series",
  charged: "total",
  discharged: "total",
  roundTrip: "mean",
};

const AGGREGATE_TERMS: Array<[Aggregate, string[]]> = [
  ["max", ["peak", "maximum", "max", "highest", "hottest", "worst", "most"]],
  ["min", ["minimum", "min", "lowest", "coldest", "least"]],
  ["mean", ["average", "avg", "mean", "typical"]],
  ["total", ["total", "sum", "altogether", "in total"]],
];

const OP_TERMS: Array<[Op, string[]]> = [
  ["gte", ["at least", "no lower than", ">=", "≥"]],
  ["lte", ["at most", "no higher than", "<=", "≤"]],
  ["gt", ["exceed", "exceeded", "exceeds", "above", "over", "greater than", "more than", "higher than", ">"]],
  ["lt", ["below", "under", "less than", "lower than", "beneath", "<"]],
];

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const DAY_MS = 86_400_000;

/* ── Normalisation ─────────────────────────────────────────────────────────
   Lowercase, collapse whitespace, and strip only the punctuation that never
   carries meaning here. Comparison symbols and the decimal point survive,
   because "> 200" and "3.5" both depend on them. */
function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[?!,;"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Start of the local day containing `ms`. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()][0].toUpperCase()}${MONTHS[d.getMonth()].slice(1, 3)}`;
}

/* ── Time ──────────────────────────────────────────────────────────────────
   Every branch returns an absolute window in epoch ms against a `now` the
   caller supplies. Nothing here reads the clock itself: a parser that consults
   Date.now() cannot be tested, because the same input gives a different answer
   tomorrow. */
function parseRange(q: string, now: number): { range: Range; assumed: boolean } | null {
  /* ISO first — unambiguous, and it must not be reached by the numeric-date
     branch below, which would read 2026-08-25 as day 2026. */
  const iso = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const from = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
    if (!Number.isNaN(from)) {
      return { range: { from, to: from + DAY_MS, label: dayLabel(from) }, assumed: false };
    }
  }

  /* "25 august", "august 25", "25 aug", "aug 25th" */
  const monthAlt = MONTHS.map((m) => m.slice(0, 3)).join("|");
  const dayFirst = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${monthAlt})[a-z]*\\b`));
  const monthFirst = q.match(new RegExp(`\\b(${monthAlt})[a-z]* (\\d{1,2})(?:st|nd|rd|th)?\\b`));
  const md = dayFirst
    ? { day: Number(dayFirst[1]), mon: dayFirst[2] }
    : monthFirst
      ? { day: Number(monthFirst[2]), mon: monthFirst[1] }
      : null;

  if (md) {
    const monthIdx = MONTHS.findIndex((m) => m.startsWith(md.mon));
    if (monthIdx >= 0 && md.day >= 1 && md.day <= 31) {
      /* No year given. Take the most recent occurrence at or before now —
         "25 August" in September means this year; in January it means last. */
      const nowD = new Date(now);
      let year = nowD.getFullYear();
      let from = new Date(year, monthIdx, md.day).getTime();
      if (from > now) from = new Date(--year, monthIdx, md.day).getTime();
      return { range: { from, to: from + DAY_MS, label: dayLabel(from) }, assumed: false };
    }
  }

  /* The optional trailing "s" catches both the possessive and the missing
     apostrophe. normalise() turns "today's" into "today s", so that half is
     already handled; "todays" is not, and it is a common enough typing that
     silently answering it with the last 24 hours would be a wrong window
     under a confident heading. */
  if (/\byesterdays?\b/.test(q)) {
    const from = startOfDay(now) - DAY_MS;
    return { range: { from, to: from + DAY_MS, label: "Yesterday" }, assumed: false };
  }

  if (/\btodays?\b/.test(q)) {
    return { range: { from: startOfDay(now), to: now, label: "Today" }, assumed: false };
  }

  /* "last 3 days", "past 24 hours", "last two weeks" */
  const WORD_NUM: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14, thirty: 30,
  };
  const rel = q.match(/\b(?:last|past|previous)\s+(\d+|[a-z]+)\s*(hour|hr|day|week|month)s?\b/);
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? Number(rel[1]) : WORD_NUM[rel[1]];
    if (n && n > 0) {
      const per =
        rel[2] === "hour" || rel[2] === "hr" ? 3_600_000
        : rel[2] === "day" ? DAY_MS
        : rel[2] === "week" ? 7 * DAY_MS
        : 30 * DAY_MS;
      const span = n * per;
      const unitWord = rel[2] === "hr" ? "hour" : rel[2];
      return {
        range: { from: now - span, to: now, label: `Last ${n} ${unitWord}${n === 1 ? "" : "s"}` },
        assumed: false,
      };
    }
  }

  /* Bare "last week" / "this week" / "last month", with no number. */
  if (/\b(?:last|past)\s+week\b/.test(q)) {
    return { range: { from: now - 7 * DAY_MS, to: now, label: "Last 7 days" }, assumed: false };
  }
  if (/\bthis\s+week\b/.test(q)) {
    return { range: { from: now - 7 * DAY_MS, to: now, label: "Last 7 days" }, assumed: false };
  }
  if (/\b(?:last|past)\s+month\b/.test(q)) {
    return { range: { from: now - 30 * DAY_MS, to: now, label: "Last 30 days" }, assumed: false };
  }

  /* Nothing said. The last 24 hours is the window every screen in this app
     already opens on, so it is the least surprising default — but it IS a
     default, and the caller is told so. */
  return { range: { from: now - DAY_MS, to: now, label: "Last 24 hours" }, assumed: true };
}

/** Longest-match search over a synonym table, so specific terms beat generic. */
function matchTerm<T>(q: string, table: Array<[T, string[]]>): T | null {
  let best: { key: T; len: number } | null = null;
  for (const [key, terms] of table) {
    for (const t of terms) {
      /* Word-boundary on both ends: "soc" must not fire inside "associated",
         and "temp" must not fire inside "attempt". */
      const re = new RegExp(`(?:^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`);
      if (re.test(q) && (!best || t.length > best.len)) best = { key, len: t.length };
    }
  }
  return best ? best.key : null;
}

function parseCondition(q: string): Condition | null {
  const op = matchTerm(q, OP_TERMS);
  if (!op) return null;

  /* The number after the operator, not merely the first number in the string —
     "in the last 3 days did spread exceed 200" has two, and only one of them
     is the threshold. */
  const opWords = OP_TERMS.flatMap(([, terms]) => terms);
  let tail = q;
  for (const w of opWords) {
    const i = q.indexOf(w);
    if (i >= 0) {
      const after = q.slice(i + w.length);
      if (/\d/.test(after) && after.length < tail.length) tail = after;
    }
  }

  const m = tail.match(/(-?\d+(?:\.\d+)?)\s*(mv|v|%|percent|kw|kwh|deg|degrees|°c|c\b)?/);
  if (!m) return null;

  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  return m[2] ? { op, value, unit: m[2] } : { op, value };
}

function parseUnit(q: string): string | null {
  const m = q.match(/\b(?:bess|unit|battery)\s*([12])\b/);
  return m ? `bess_${m[1]}` : null;
}

/**
 * Parse one question.
 *
 * `now` is required rather than defaulted, so the same input always produces
 * the same output in a test.
 */
export function parseHistoryQuery(raw: string, now: number): ParseResult {
  const q = normalise(raw);

  if (!q || q.length < 2) {
    return {
      ok: false,
      reason: "Nothing to look up yet.",
      suggestions: ["SOC yesterday", "Peak power last 7 days", "When did cell spread exceed 200 mV"],
    };
  }

  const field = matchTerm(q, FIELD_TERMS);
  if (!field) {
    return {
      ok: false,
      reason:
        "That does not name anything the historian records. It holds state of charge, " +
        "power, battery temperature, cell voltage spread, and the energy charged and discharged.",
      suggestions: ["SOC on 25 August", "Peak temperature last 3 days", "Cell spread yesterday"],
    };
  }

  const { range, assumed } = parseRange(q, now)!;
  const condition = parseCondition(q) ?? undefined;

  /* "when did X exceed Y" wants the crossings, not a chart. Recognised by the
     leading interrogative rather than by the presence of a condition, because
     "days where spread went above 200" is also a when-question and "show me
     spread above 200" is not. */
  const intent: Intent = /\bwhen\b|\bwhat time\b|\bwhich (?:day|days|hour|hours)\b/.test(q)
    ? "when"
    : "value";

  /* A when-question with no threshold cannot be answered — "when was SOC" has
     no crossing to find. Caught here rather than returned as an empty result. */
  if (intent === "when" && !condition) {
    return {
      ok: false,
      reason: `A "when" question needs a level to cross. ${FIELD_LABEL[field]} on its own has no crossing to find.`,
      suggestions: [
        `When did ${FIELD_LABEL[field]} exceed 200`,
        `${FIELD_LABEL[field]} yesterday`,
      ],
    };
  }

  const explicitAggregate = matchTerm(q, AGGREGATE_TERMS);
  const aggregate: Aggregate =
    intent === "when" ? "series" : explicitAggregate ?? DEFAULT_AGGREGATE[field];

  const unit = parseUnit(q) ?? undefined;

  const assumptions: string[] = [];
  if (assumed) assumptions.push("No period given — showing the last 24 hours");
  if (!explicitAggregate && intent === "value" && DEFAULT_AGGREGATE[field] !== "series") {
    assumptions.push(`Showing the ${DEFAULT_AGGREGATE[field]} for the period`);
  }
  if (!unit) assumptions.push("No unit named — using the one currently selected");

  return {
    ok: true,
    query: { field, range, aggregate, intent, condition, unit },
    assumptions,
  };
}

/* ── Follow-ups ────────────────────────────────────────────────────────────
   What makes a conversation different from a search box: "and yesterday?"
   means nothing on its own and everything after "today's power".

   A turn is read as a whole question first. Only if that fails is it read as
   a modification of the last one — so "cell spread" after "today's power"
   changes the field and keeps nothing else, which is what a person means,
   while "and yesterday" keeps the field and changes the window.

   Nothing here is inferred beyond the previous turn. There is no dialogue
   state machine, no coreference resolution, and no attempt to understand
   "it" — those are the parts that need a model, and pretending otherwise
   would produce exactly the confident wrong answer this module exists to
   avoid. A turn that modifies nothing is refused like any other miss. */

/** True when the text names a period explicitly, rather than getting the default. */
function hasExplicitRange(q: string, now: number): boolean {
  const r = parseRange(q, now);
  return Boolean(r && !r.assumed);
}

/**
 * Read one turn, in the context of the last answered question.
 *
 * `previous` is null on the first turn, which reduces this to
 * parseHistoryQuery exactly.
 */
export function parseTurn(raw: string, previous: HistoryQuery | null, now: number): ParseResult {
  const standalone = parseHistoryQuery(raw, now);
  if (standalone.ok || !previous) return standalone;

  const q = normalise(raw);

  /* Each part the turn actually supplies. Absent parts are inherited. */
  const range = hasExplicitRange(q, now) ? parseRange(q, now)!.range : null;
  const aggregate = matchTerm(q, AGGREGATE_TERMS);
  const unit = parseUnit(q);
  const condition = parseCondition(q);
  const asksWhen = /\bwhen\b|\bwhat time\b|\bwhich (?:day|days|hour|hours)\b/.test(q);

  if (!range && !aggregate && !unit && !condition && !asksWhen) {
    /* Nothing to carry forward. The standalone refusal is the better message,
       because it names what the historian holds rather than talking about the
       previous turn. */
    return standalone;
  }

  const intent: Intent = asksWhen ? "when" : condition && previous.intent === "when" ? "when" : "value";

  if (intent === "when" && !(condition ?? previous.condition)) {
    return {
      ok: false,
      reason: `A "when" question needs a level to cross. ${FIELD_LABEL[previous.field]} on its own has no crossing to find.`,
      suggestions: [`When did ${FIELD_LABEL[previous.field]} exceed 200`, `${FIELD_LABEL[previous.field]} yesterday`],
    };
  }

  const merged: HistoryQuery = {
    field: previous.field,
    range: range ?? previous.range,
    aggregate: intent === "when" ? "series" : aggregate ?? previous.aggregate,
    intent,
    condition: condition ?? (intent === "when" ? previous.condition : undefined),
    unit: unit ?? previous.unit,
  };

  const assumptions: string[] = [];
  /* Says what was carried over, not what was defaulted — on a follow-up those
     are different things, and the reader needs to know which parts of the
     previous question are still in force. */
  if (!range) assumptions.push(`Still ${merged.range.label.toLowerCase()}`);
  assumptions.push(`Still ${FIELD_LABEL[merged.field]}`);

  return { ok: true, query: merged, assumptions };
}
