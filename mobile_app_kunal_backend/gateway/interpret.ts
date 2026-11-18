/**
 * The fallback for questions the grammar does not recognise.
 *
 * Server-only. Talks to a local Ollama, so it costs nothing to run and no
 * plant data leaves the machine the server is on.
 *
 * ── The model translates; it does not answer ──────────────────────────────
 * It is given one job: rewrite a question into the vocabulary
 * gateway/queryParse.ts already parses. "How much juice did we push out
 * yesterday" becomes "discharged yesterday", and the grammar takes it from
 * there.
 *
 * That shape is the whole safety argument, and it is worth being explicit
 * about why it beats the obvious alternative of having the model emit the
 * query directly:
 *
 *   - It cannot produce a query the grammar could not have produced. Its
 *     output is re-parsed by the same code path as a typed question, so
 *     every downstream guarantee — the seven fields, the refusals, the
 *     absence handling — still holds without being restated here.
 *   - Date arithmetic stays deterministic. Working out that "25 August"
 *     means 2026 rather than 2025 is arithmetic, and a 3-billion-parameter
 *     model is the wrong place for it. It writes the phrase; the parser
 *     resolves it.
 *   - A wrong interpretation is visible rather than silent. The rewrite is
 *     returned to the caller and shown on screen as "Read as: …", so a
 *     reader can see the question that was actually answered. A model that
 *     built the query directly would produce a chart with no way to tell
 *     that it had misunderstood.
 *
 * ── It is optional, and off unless configured ─────────────────────────────
 * No OLLAMA_URL, no fallback: the app behaves exactly as it does today and
 * refuses what it cannot parse. Nothing about the grammar path depends on
 * this module being reachable, and a model that is slow, wrong or down costs
 * a refusal rather than a broken screen.
 */

const DEFAULT_MODEL = "llama3.2:latest";

/** Bounded hard. A question is only worth a few seconds of a person's patience. */
const TIMEOUT_MS = 12_000;

/** Configured — which is not the same as working. See interpretReady. */
export function interpretConfigured(): boolean {
  return Boolean(process.env.OLLAMA_URL?.trim());
}

/* Reachability, cached briefly.

   Configured and reachable are different facts, and conflating them is what
   makes a deployment feel broken rather than unconfigured: with OLLAMA_URL
   set but nothing listening, the app would advertise the fallback, send every
   unparsed question into a timeout, and show the same refusal it would have
   shown anyway — several seconds later and with no clue why.

   Cached because this is asked on a capability probe that a client may repeat,
   and re-dialling a dead host on every call is the cost we are trying to
   avoid. Short enough that starting Ollama takes effect without a redeploy. */
const READY_TTL_MS = 30_000;
let readyCache: { at: number; ok: boolean } | null = null;

export async function interpretReady(): Promise<boolean> {
  if (!interpretConfigured()) return false;

  const now = Date.now();
  if (readyCache && now - readyCache.at < READY_TTL_MS) return readyCache.ok;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2_000);
  try {
    const r = await fetch(`${host()}/api/version`, { signal: ctl.signal });
    readyCache = { at: now, ok: r.ok };
  } catch {
    readyCache = { at: now, ok: false };
  } finally {
    clearTimeout(timer);
  }
  return readyCache.ok;
}

const host = () => (process.env.OLLAMA_URL ?? "").trim().replace(/\/+$/, "");
const model = () => (process.env.OLLAMA_MODEL ?? DEFAULT_MODEL).trim();

/* Constrained generation: Ollama holds the output to this schema at the token
   level, so `understood` is always a boolean and `question` is always a
   string. It cannot ramble, and it cannot answer the question instead. */
const SCHEMA = {
  type: "object",
  properties: {
    understood: { type: "boolean" },
    /* Named `rewrite`, not `question`. With a slot called "question" this
       model filled it with the question — verbatim, every time — which parsed
       as nothing and degraded to a refusal. The field name is doing real work
       here. */
    rewrite: { type: "string" },
  },
  required: ["understood", "rewrite"],
} as const;

/**
 * The vocabulary, stated as the only thing it may write.
 *
 * Deliberately shows the grammar's own shapes rather than describing them.
 * The model is not being asked to understand a battery — it is being asked to
 * map one phrasing onto another, which is what a small model is reliably good
 * at.
 */
const SYSTEM = `
You translate questions about a battery storage system into a fixed vocabulary
that a simple parser reads. You never answer a question and you never repeat it
back — you replace its wording with the vocabulary below.

Subjects: SOC · power · temperature · cell spread · charged · discharged · round trip efficiency
Periods:  today · yesterday · 25 August · last 3 days · last 7 days · past 12 hours · last month
Extras:   peak · lowest · average · total · above N · below N · BESS 1 · BESS 2

If the subject is in that list, however oddly it is worded, translate it.
If the subject is NOT in that list — money, savings, tariffs, revenue, people,
maintenance, alarms, faults, equipment health — set understood false.
`.trim();

/**
 * Worked examples, as real turns rather than prose.
 *
 * The prose version of these sat in the system prompt and did not take: this
 * model echoed the question back instead of translating it. Shown as an
 * exchange it has apparently already had, it translates. Small models imitate
 * the shape of a conversation far more reliably than they follow a description
 * of one.
 */
const FEWSHOT: Array<{ role: "user" | "assistant"; content: string }> = [
  { role: "user", content: "how much juice did we push out yesterday" },
  { role: "assistant", content: '{"understood":true,"rewrite":"discharged yesterday"}' },
  { role: "user", content: "was the pack hot at all last week" },
  { role: "assistant", content: '{"understood":true,"rewrite":"peak temperature last 7 days"}' },
  { role: "user", content: "are the cells drifting apart today" },
  { role: "assistant", content: '{"understood":true,"rewrite":"cell spread today"}' },
  { role: "user", content: "what did unit two do yesterday" },
  { role: "assistant", content: '{"understood":true,"rewrite":"power yesterday BESS 2"}' },
  { role: "user", content: "when did it get above 40 degrees" },
  { role: "assistant", content: '{"understood":true,"rewrite":"when did temperature exceed 40"}' },
  { role: "user", content: "how much did we save last month" },
  { role: "assistant", content: '{"understood":false,"rewrite":""}' },
  { role: "user", content: "is the inverter healthy" },
  { role: "assistant", content: '{"understood":false,"rewrite":""}' },
];

export class InterpretError extends Error {}

/**
 * Rewrite one question into the grammar's vocabulary.
 *
 * Returns null when the model declines, when it is unreachable, or when it is
 * not configured — all of which the caller treats identically, because all
 * three mean the same thing to a reader: this could not be understood.
 */
export async function interpret(question: unknown): Promise<string | null> {
  if (!interpretConfigured()) return null;

  const q = typeof question === "string" ? question.trim() : "";
  /* An upper bound on what is forwarded. The grammar's own inputs are short,
     and a very long body is either a paste or an attempt to crowd the system
     prompt out of the window. */
  if (!q || q.length > 300) return null;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(`${host()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctl.signal,
      body: JSON.stringify({
        model: model(),
        stream: false,
        format: SCHEMA,
        /* Zero temperature: the same question should rewrite the same way
           every time, or the screen becomes unreproducible. */
        options: { temperature: 0, num_predict: 120 },
        messages: [
          { role: "system", content: SYSTEM },
          ...FEWSHOT,
          { role: "user", content: q },
        ],
      }),
    });

    if (!r.ok) return null;

    const body = (await r.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(body.message?.content ?? "{}") as {
      understood?: boolean;
      rewrite?: string;
    };

    if (!parsed.understood) return null;
    const rewritten = typeof parsed.rewrite === "string" ? parsed.rewrite.trim() : "";

    /* A rewrite has to be shorter than a paragraph and longer than nothing.
       The caller re-parses it regardless, so this only catches the degenerate
       cases early. */
    if (!rewritten || rewritten.length > 120) return null;
    return rewritten;
  } catch {
    /* Unreachable, timed out, or unparseable. All the same answer: no
       interpretation. The grammar's refusal is what the reader sees, which is
       the behaviour of a deployment with no model at all. */
    return null;
  } finally {
    clearTimeout(timer);
  }
}
