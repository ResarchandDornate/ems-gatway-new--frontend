/**
 * The same questions, put to a local model instead of the grammar.
 *
 * Run:  ollama serve            (usually already running)
 *       npm run eval:model      (optionally: MODEL=qwen2.5:3b npm run eval:model)
 *
 * ── What is being compared, and what is not ───────────────────────────────
 * Five slots: the field, the intent, the aggregate, and the comparison
 * operator and threshold. Those are the language-understanding part, and they
 * are where a model could plausibly beat a synonym table.
 *
 * The date window is deliberately NOT compared. Asking a 3-billion-parameter
 * model to work out that "25 August" means 2026-08-25 rather than 2025-08-25
 * tests arithmetic, not comprehension — and in any design worth shipping the
 * model would emit a date expression that deterministic code resolves, exactly
 * as the parser already does. Scoring it here would flatter the parser for a
 * reason that has nothing to do with the choice being made.
 *
 * So the parser is re-scored on the same five slots, and both numbers are
 * printed together. A comparison is only worth having if it is fair to the
 * option you are arguing against.
 *
 * ── Structured output ─────────────────────────────────────────────────────
 * Ollama constrains generation to the JSON schema below, so the model cannot
 * emit a field name outside the enum. That is a stronger guarantee than the
 * hosted API's structured output — it is enforced at the token level — and it
 * is the property that would make a local model safe here if one were adopted.
 */

import { parseHistoryQuery } from "../mobile_app_kunal_backend/gateway/queryParse.ts";
import { CASES, NOW, type Case } from "./eval-query-parser.ts";

const MODEL = process.env.MODEL ?? "llama3.2:latest";
const HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

/* "unknown" and "none" are first-class answers. Without them the schema forces
   a guess on every out-of-scope question, which would measure the schema's
   rigidity rather than the model's judgement. */
const SCHEMA = {
  type: "object",
  properties: {
    field: {
      type: "string",
      enum: ["soc", "power", "temperature", "cellSpread", "charged", "discharged", "roundTrip", "unknown"],
    },
    intent: { type: "string", enum: ["value", "when"] },
    aggregate: { type: "string", enum: ["series", "max", "min", "mean", "total"] },
    op: { type: "string", enum: ["gt", "gte", "lt", "lte", "none"] },
    value: { type: "number" },
  },
  required: ["field", "intent", "aggregate", "op", "value"],
} as const;

const SYSTEM = `
You convert an operator's question about a battery energy storage system into
structured slots. You never answer the question; you only classify it.

field — what the historian should return:
  soc          state of charge, battery level, how full
  power        kW, output, load, dispatch
  temperature  pack or cell temperature, how hot
  cellSpread   cell voltage spread, imbalance, delta between highest and lowest cell
  charged      energy put INTO the battery over a period
  discharged   energy taken OUT of the battery over a period
  roundTrip    round-trip efficiency, RTE
  unknown      anything else — tariffs, money, who someone is, equipment health,
               or a question this list cannot express. Use it freely.

intent — "when" if the question asks at what time or on which days something
happened; "value" otherwise.

aggregate — "max" for peak/highest, "min" for lowest, "mean" for average,
"total" for a sum of energy, "series" for a plain reading over time.

op and value — the comparison, WHENEVER the question mentions a level or a
number to compare against. This is the slot most often filled in wrongly, so
read the question twice for it:
  "exceed 200 mV"      -> op "gt",  value 200
  "went above 40"      -> op "gt",  value 40
  "below 20%"          -> op "lt",  value 20
  "over 100 kw"        -> op "gt",  value 100
  "at least 35"        -> op "gte", value 35
  "at most 3.5"        -> op "lte", value 3.5
Strip the unit and keep the bare number. Use "none" and 0 ONLY when the
question names no threshold at all ("SOC yesterday", "peak power last week").

A "when" question almost always carries a threshold. If you chose intent
"when" and op "none", check again — you have probably missed the level.

Money is never a field here. "How much did we save", "what did it earn",
anything in rupees, is "unknown": this system stores energy, not value.
`.trim();

interface Slots {
  field: string;
  intent: string;
  aggregate: string;
  op: string;
  value: number;
}

async function ask(q: string): Promise<{ slots: Slots | null; ms: number }> {
  const t0 = Date.now();
  try {
    const r = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        format: SCHEMA,
        options: { temperature: 0, num_predict: 200 },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: q || "(empty)" },
        ],
      }),
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { slots: null, ms };
    const body = (await r.json()) as { message?: { content?: string } };
    const text = body.message?.content ?? "";
    return { slots: JSON.parse(text) as Slots, ms };
  } catch {
    return { slots: null, ms: Date.now() - t0 };
  }
}

/** The five comparable slots, as the parser would fill them. */
function parserSlots(c: Case): Slots | null {
  const r = parseHistoryQuery(c.q, NOW);
  if (!r.ok) return null;
  return {
    field: r.query.field,
    intent: r.query.intent,
    aggregate: r.query.aggregate,
    op: r.query.condition?.op ?? "none",
    value: r.query.condition?.value ?? 0,
  };
}

/** What the case says the five slots should be. `null` means "should refuse". */
function expectedSlots(c: Case): Slots | null {
  if (c.shouldFail) return null;
  const e = c.expect ?? {};
  return {
    field: e.field ?? "",
    intent: e.intent ?? "",
    aggregate: e.aggregate ?? "",
    op: e.condition?.op ?? "none",
    value: e.condition?.value ?? 0,
  };
}

/** Compare only the slots the case actually pins down. */
function score(got: Slots | null, want: Slots | null): { ok: boolean; why: string } {
  if (want === null) {
    return got === null || got.field === "unknown"
      ? { ok: true, why: "refused" }
      : { ok: false, why: `answered ${got.field}, expected a refusal` };
  }
  if (got === null) return { ok: false, why: "refused a valid question" };
  if (got.field === "unknown") return { ok: false, why: "said unknown for a valid question" };

  const miss: string[] = [];
  if (want.field && want.field !== got.field) miss.push(`field ${got.field}≠${want.field}`);
  if (want.intent && want.intent !== got.intent) miss.push(`intent ${got.intent}≠${want.intent}`);
  if (want.aggregate && want.aggregate !== got.aggregate) miss.push(`agg ${got.aggregate}≠${want.aggregate}`);
  if (want.op !== "none") {
    if (got.op !== want.op) miss.push(`op ${got.op}≠${want.op}`);
    if (got.value !== want.value) miss.push(`value ${got.value}≠${want.value}`);
  }
  return miss.length ? { ok: false, why: miss.join(", ") } : { ok: true, why: "" };
}

async function main(): Promise<void> {
  const ver = await fetch(`${HOST}/api/version`).then((r) => r.json()).catch(() => null);
  if (!ver) {
    console.error(`\n  Cannot reach Ollama at ${HOST}. Start it with:  ollama serve\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ${CASES.length} questions · model ${MODEL} · ollama ${(ver as { version: string }).version}`);
  console.log(`  Comparing five slots: field, intent, aggregate, op, value.`);
  console.log(`  Date windows are excluded — see the note at the top of this file.\n`);

  let modelOk = 0, parserOk = 0;
  const times: number[] = [];
  const modelMisses: string[] = [];
  const parserMisses: string[] = [];

  for (const c of CASES) {
    const want = expectedSlots(c);

    const { slots, ms } = await ask(c.q);
    times.push(ms);
    const m = score(slots, want);
    if (m.ok) modelOk++; else modelMisses.push(`  ✗ ${JSON.stringify(c.q)}\n      ${m.why}`);

    const p = score(parserSlots(c), want);
    if (p.ok) parserOk++; else parserMisses.push(`  ✗ ${JSON.stringify(c.q)}\n      ${p.why}`);
  }

  const pct = (n: number) => `${((n / CASES.length) * 100).toFixed(1)}%`;
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const slowest = times[times.length - 1];

  if (modelMisses.length) {
    console.log(`  Model missed ${modelMisses.length}:\n`);
    console.log(modelMisses.join("\n") + "\n");
  }
  if (parserMisses.length) {
    console.log(`  Parser missed ${parserMisses.length}:\n`);
    console.log(parserMisses.join("\n") + "\n");
  }

  console.log(`  ${"".padEnd(52, "─")}`);
  console.log(`  model ${MODEL.padEnd(22)} ${String(modelOk).padStart(3)}/${CASES.length}  ${pct(modelOk)}`);
  console.log(`  deterministic parser${"".padEnd(4)} ${String(parserOk).padStart(3)}/${CASES.length}  ${pct(parserOk)}`);
  console.log(`  ${"".padEnd(52, "─")}`);
  console.log(`  model latency: ${median} ms median, ${slowest} ms slowest`);
  console.log(`  parser latency: under 1 ms, and it runs on the phone.\n`);
}

main();
