/**
 * How much of the real question space the deterministic parser covers.
 *
 * Run:  npm run eval:parser
 * (Node 23+ strips TypeScript types natively — no build step, no dependency.)
 *
 * The `.ts` extension on the import below is required by Node's type stripping,
 * which resolves real paths rather than TypeScript's extensionless ones. That
 * is why the root tsconfig sets `allowImportingTsExtensions` — legal only
 * because it also sets `noEmit`, and invisible to the bundler, which resolves
 * app source separately and never sees a `.ts` specifier.
 *
 * ── What this is for ──────────────────────────────────────────────────────
 * The open question is not "does the parser work" but "is a language model
 * needed here at all, and for what". That is answered by a number, and this
 * produces the number: the share of questions an operator would plausibly type
 * that the grammar resolves correctly.
 *
 * A case marked `shouldFail` is not a gap. Refusing clearly and offering
 * alternatives is the correct behaviour for a question outside the historian's
 * seven fields, and a parser that guessed at those would be worse. Those cases
 * assert the refusal, so a later change that starts silently guessing is caught.
 *
 * The same set feeds scripts/eval-query-model.ts, so the two approaches are
 * measured on identical questions rather than on each side's favourites.
 */

import { parseHistoryQuery, parseTurn, type Aggregate, type Field, type Intent } from
  "../mobile_app_kunal_backend/gateway/queryParse.ts";

/**
 * A fixed clock. Every relative window below is relative to this instant, so
 * the expectations stay true tomorrow — which is the entire reason
 * parseHistoryQuery takes `now` instead of reading it.
 *
 * Wednesday 2 September 2026, 14:00 local.
 */
export const NOW = new Date(2026, 8, 2, 14, 0, 0).getTime();

export interface Expect {
  field?: Field;
  aggregate?: Aggregate;
  intent?: Intent;
  rangeLabel?: string;
  unit?: string;
  condition?: { op: string; value: number };
}

export interface Case {
  q: string;
  /** Why this question is in the set — what it is testing that others do not. */
  note: string;
  expect?: Expect;
  shouldFail?: true;
}

export const CASES: Case[] = [
  // ── The two from the brief ───────────────────────────────────────────────
  { q: "SOC on 25 August", note: "the canonical example",
    expect: { field: "soc", rangeLabel: "25 Aug", intent: "value", aggregate: "series" } },
  { q: "when did cell spread exceed 200 mV", note: "the other canonical example",
    expect: { field: "cellSpread", intent: "when", condition: { op: "gt", value: 200 } } },

  // ── Field vocabulary ─────────────────────────────────────────────────────
  { q: "state of charge yesterday", note: "spelled-out SOC",
    expect: { field: "soc", rangeLabel: "Yesterday" } },
  /* From real use on the device — the first questions typed by hand rather
     than written alongside the parser, which is the only kind that tests it. */
  { q: "today's power", note: "possessive apostrophe, stripped by normalise",
    expect: { field: "power", rangeLabel: "Today" } },
  { q: "todays power", note: "the apostrophe left out, as people type it",
    expect: { field: "power", rangeLabel: "Today" } },
  { q: "yesterday's peak temperature", note: "possessive plus an aggregate",
    expect: { field: "temperature", rangeLabel: "Yesterday", aggregate: "max" } },

  { q: "battery level today", note: "colloquial SOC",
    expect: { field: "soc", rangeLabel: "Today" } },
  { q: "how full was the battery yesterday", note: "question-shaped SOC",
    expect: { field: "soc", rangeLabel: "Yesterday" } },
  { q: "power last 3 days", note: "bare field + relative window",
    expect: { field: "power", rangeLabel: "Last 3 days" } },
  { q: "temperature on 28 August", note: "temperature, day-first date",
    expect: { field: "temperature", rangeLabel: "28 Aug" } },
  { q: "pack temperature last week", note: "two-word field, bare week",
    expect: { field: "temperature", rangeLabel: "Last 7 days" } },
  { q: "how hot did it get yesterday", note: "colloquial temperature",
    expect: { field: "temperature", rangeLabel: "Yesterday" } },
  { q: "cell voltage spread last 24 hours", note: "long form of the spread field",
    expect: { field: "cellSpread", rangeLabel: "Last 24 hours" } },
  { q: "cell imbalance this week", note: "the operator's word for spread",
    expect: { field: "cellSpread", rangeLabel: "Last 7 days" } },
  { q: "energy discharged last 7 days", note: "discharge totals",
    expect: { field: "discharged", aggregate: "total", rangeLabel: "Last 7 days" } },
  { q: "how much did we charge yesterday", note: "charge, colloquial",
    expect: { field: "charged", aggregate: "total", rangeLabel: "Yesterday" } },
  { q: "round trip efficiency last month", note: "RTE, defaults to mean",
    expect: { field: "roundTrip", aggregate: "mean", rangeLabel: "Last 30 days" } },
  { q: "rte last 7 days", note: "the acronym",
    expect: { field: "roundTrip", rangeLabel: "Last 7 days" } },

  // ── Precedence: specific terms must beat generic ones ────────────────────
  { q: "cell spread yesterday", note: "'spread' must not resolve as 'charge' or 'power'",
    expect: { field: "cellSpread" } },
  { q: "state of charge last 3 days", note: "'charge' inside 'state of charge' must not win",
    expect: { field: "soc", aggregate: "series" } },
  { q: "charging yesterday", note: "'charging' is the energy field, not SOC",
    expect: { field: "charged" } },
  { q: "charge level yesterday", note: "bare 'charge' must not steal this from SOC",
    expect: { field: "soc" } },

  // ── Date forms ───────────────────────────────────────────────────────────
  { q: "soc on august 25", note: "month-first",
    expect: { field: "soc", rangeLabel: "25 Aug" } },
  { q: "soc on 25 aug", note: "abbreviated month",
    expect: { field: "soc", rangeLabel: "25 Aug" } },
  { q: "soc on 25th august", note: "ordinal suffix",
    expect: { field: "soc", rangeLabel: "25 Aug" } },
  { q: "soc on 2026-08-25", note: "ISO date",
    expect: { field: "soc", rangeLabel: "25 Aug" } },
  { q: "power on 15 december", note: "a month later in the year than now — must be last year",
    expect: { field: "power", rangeLabel: "15 Dec" } },
  { q: "temperature past 12 hours", note: "sub-day relative window",
    expect: { field: "temperature", rangeLabel: "Last 12 hours" } },
  { q: "soc last two weeks", note: "number written as a word",
    expect: { field: "soc", rangeLabel: "Last 2 weeks" } },

  // ── Aggregates ───────────────────────────────────────────────────────────
  { q: "peak power last 7 days", note: "explicit max",
    expect: { field: "power", aggregate: "max", rangeLabel: "Last 7 days" } },
  { q: "highest temperature yesterday", note: "max by synonym",
    expect: { field: "temperature", aggregate: "max" } },
  { q: "lowest soc last 3 days", note: "explicit min",
    expect: { field: "soc", aggregate: "min" } },
  { q: "average power yesterday", note: "explicit mean",
    expect: { field: "power", aggregate: "mean" } },
  { q: "total energy discharged last week", note: "explicit total on a total field",
    expect: { field: "discharged", aggregate: "total" } },

  // ── Conditions ───────────────────────────────────────────────────────────
  { q: "when did temperature go above 40", note: "unitless threshold",
    expect: { field: "temperature", intent: "when", condition: { op: "gt", value: 40 } } },
  { q: "when was soc below 20%", note: "less-than with a percent unit",
    expect: { field: "soc", intent: "when", condition: { op: "lt", value: 20 } } },
  { q: "which days did cell spread exceed 150 mv", note: "'which days' is also a when-question",
    expect: { field: "cellSpread", intent: "when", condition: { op: "gt", value: 150 } } },
  { q: "in the last 3 days did spread exceed 200", note: "two numbers — the threshold is the one after the operator",
    expect: { field: "cellSpread", condition: { op: "gt", value: 200 }, rangeLabel: "Last 3 days" } },
  { q: "when did power go over 100 kw", note: "threshold with a kW unit",
    expect: { field: "power", intent: "when", condition: { op: "gt", value: 100 } } },
  { q: "temperature at least 35 yesterday", note: "gte phrasing",
    expect: { field: "temperature", condition: { op: "gte", value: 35 } } },

  // ── Units ────────────────────────────────────────────────────────────────
  { q: "soc on bess 2 yesterday", note: "named unit",
    expect: { field: "soc", unit: "bess_2", rangeLabel: "Yesterday" } },
  { q: "peak power unit 1 last week", note: "'unit N' phrasing",
    expect: { field: "power", unit: "bess_1", aggregate: "max" } },

  // ── Defaults ─────────────────────────────────────────────────────────────
  { q: "soc", note: "bare field — must default the window, not fail",
    expect: { field: "soc", rangeLabel: "Last 24 hours" } },
  { q: "cell spread", note: "bare field, two words",
    expect: { field: "cellSpread", rangeLabel: "Last 24 hours" } },

  // ── Must refuse ──────────────────────────────────────────────────────────
  { q: "who is the site operator", note: "not a telemetry question at all", shouldFail: true },
  { q: "what is the tariff on tuesday", note: "a field the historian does not hold", shouldFail: true },
  { q: "when was soc", note: "a when-question with no threshold to cross", shouldFail: true },
  { q: "how much did we save last month", note: "money — needs the tariff engine, not the historian", shouldFail: true },
  { q: "", note: "empty input", shouldFail: true },
  { q: "is the inverter ok", note: "a state question, not a series question", shouldFail: true },
];

/* ── Follow-ups ────────────────────────────────────────────────────────────
   A turn read in the context of the last answered one. These are what make
   the chat a conversation rather than a search box with bubbles, and they are
   covered here because the round trip on the device needs a gateway that is
   answering — which it is not, reliably. */

interface FollowCase {
  first: string;
  then: string;
  note: string;
  expect?: Expect;
  shouldFail?: true;
}

export const FOLLOW_CASES: FollowCase[] = [
  { first: "today's power", then: "and yesterday?", note: "keeps the field, changes the window",
    expect: { field: "power", rangeLabel: "Yesterday" } },
  { first: "today's power", then: "peak?", note: "keeps field and window, changes the aggregate",
    expect: { field: "power", rangeLabel: "Today", aggregate: "max" } },
  { first: "today's power", then: "what about bess 2?", note: "keeps everything, changes the unit",
    expect: { field: "power", rangeLabel: "Today", unit: "bess_2" } },
  { first: "soc yesterday", then: "cell spread", note: "a whole question wins over a follow-up — field changes, window resets",
    expect: { field: "cellSpread", rangeLabel: "Last 24 hours" } },
  { first: "cell spread today", then: "when did it exceed 200", note: "a threshold turns it into a when-question",
    expect: { field: "cellSpread", intent: "when", condition: { op: "gt", value: 200 } } },
  { first: "today's power", then: "who installed it", note: "still refused — a follow-up is not a licence to guess",
    shouldFail: true },
];

function runFollow(c: FollowCase): { pass: boolean; detail: string } {
  const first = parseHistoryQuery(c.first, NOW);
  if (!first.ok) return { pass: false, detail: `the setup question itself failed: ${c.first}` };

  const r = parseTurn(c.then, first.query, NOW);
  if (c.shouldFail) {
    return r.ok
      ? { pass: false, detail: `parsed as ${r.query.field}, expected a refusal` }
      : { pass: true, detail: "refused" };
  }
  if (!r.ok) return { pass: false, detail: `refused: ${r.reason.slice(0, 50)}…` };

  const e = c.expect ?? {};
  const miss: string[] = [];
  const chk = (n: string, w: unknown, g: unknown) => {
    if (w !== undefined && w !== g) miss.push(`${n}: want ${String(w)}, got ${String(g)}`);
  };
  chk("field", e.field, r.query.field);
  chk("rangeLabel", e.rangeLabel, r.query.range.label);
  chk("aggregate", e.aggregate, r.query.aggregate);
  chk("intent", e.intent, r.query.intent);
  chk("unit", e.unit, r.query.unit);
  if (e.condition) {
    chk("op", e.condition.op, r.query.condition?.op);
    chk("value", e.condition.value, r.query.condition?.value);
  }
  return miss.length ? { pass: false, detail: miss.join("; ") } : { pass: true, detail: r.query.field };
}

/* ── Runner ────────────────────────────────────────────────────────────── */

interface Outcome { c: Case; pass: boolean; detail: string }

export function runCase(c: Case): Outcome {
  const r = parseHistoryQuery(c.q, NOW);

  if (c.shouldFail) {
    if (r.ok) return { c, pass: false, detail: `parsed as ${r.query.field}, expected a refusal` };
    if (!r.suggestions.length) return { c, pass: false, detail: "refused with no suggestions" };
    return { c, pass: true, detail: "refused" };
  }

  if (!r.ok) return { c, pass: false, detail: `refused: ${r.reason.slice(0, 60)}…` };

  const e = c.expect ?? {};
  const misses: string[] = [];
  const check = (name: string, want: unknown, got: unknown) => {
    if (want !== undefined && want !== got) misses.push(`${name}: want ${String(want)}, got ${String(got)}`);
  };

  check("field", e.field, r.query.field);
  check("aggregate", e.aggregate, r.query.aggregate);
  check("intent", e.intent, r.query.intent);
  check("rangeLabel", e.rangeLabel, r.query.range.label);
  check("unit", e.unit, r.query.unit);

  if (e.condition) {
    check("condition.op", e.condition.op, r.query.condition?.op);
    check("condition.value", e.condition.value, r.query.condition?.value);
  }

  return misses.length
    ? { c, pass: false, detail: misses.join("; ") }
    : { c, pass: true, detail: r.query.field };
}

function main(): void {
  const results = CASES.map(runCase);
  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);

  console.log(`\n  Deterministic parser — ${CASES.length} questions\n`);

  for (const r of failures) {
    console.log(`  ✗ ${JSON.stringify(r.c.q)}`);
    console.log(`      ${r.detail}`);
    console.log(`      (${r.c.note})\n`);
  }

  const pct = ((passed / CASES.length) * 100).toFixed(1);
  console.log(`  ${passed}/${CASES.length} correct — ${pct}%`);
  console.log(`  ${CASES.filter((c) => c.shouldFail).length} of those are refusals it is expected to make.\n`);

  const follow = FOLLOW_CASES.map((c) => ({ c, ...runFollow(c) }));
  const fOk = follow.filter((f) => f.pass).length;
  console.log(`  Follow-ups — ${FOLLOW_CASES.length} two-turn exchanges\n`);
  for (const f of follow.filter((x) => !x.pass)) {
    console.log(`  ✗ ${JSON.stringify(f.c.first)} → ${JSON.stringify(f.c.then)}`);
    console.log(`      ${f.detail}`);
    console.log(`      (${f.c.note})\n`);
  }
  console.log(`  ${fOk}/${FOLLOW_CASES.length} correct\n`);

  if (failures.length || fOk !== FOLLOW_CASES.length) process.exitCode = 1;
}

/* Only when run directly, so eval-query-model.ts can import CASES without
   triggering a second report. */
if (process.argv[1] && process.argv[1].endsWith("eval-query-parser.ts")) main();
