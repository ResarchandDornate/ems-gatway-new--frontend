/**
 * "What does this fault actually mean?"
 *
 * Server-only. Turns one asserted register into something a plant operator can
 * act on, grounded in the signal dictionary rather than in the model's memory
 * of battery systems in general.
 *
 * ── Why this screen and not another ───────────────────────────────────────
 * The Alarms screen shows rows like `sw_fault_ac_over_voltage` and
 * `bmu_communication_fault`. Those are register names from a vendor's Modbus
 * map. An operator can read that something is asserted and cannot read what it
 * means, what tends to cause it, or whether it is the sort of thing that waits
 * until Monday. That gap is the whole feature.
 *
 * ── The injection boundary ────────────────────────────────────────────────
 * The client sends a signal NAME and a NUMBER, and nothing else reaches the
 * prompt. The name must resolve in signals.ts or the request is refused; the
 * label, unit, category, enum decoding and asset all come from our dictionary
 * rather than from the request. So the caller chooses which of 63 known
 * subjects to ask about and cannot compose the question — which is the shape
 * that makes prompt injection a non-event rather than a mitigation.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { ai, MODEL, systemPrefix, lookupSignal, EFFORT, OUTPUT_CAP } from "./ai";
import { isAlarmThreshold, isFaultBit, type SignalDef } from "./signals";
import type { AlarmExplanation } from "./aiTypes";

export type { AlarmExplanation };

/**
 * No numeric field anywhere, by construction.
 *
 * This is the structural half of the "the model never states a number" rule in
 * ai.ts — the instruction is the other half, and instructions can be talked
 * out of. There is simply nowhere in this object for a figure to go, so the
 * failure mode is a sentence that reads oddly, never a wrong kilowatt-hour
 * rendered as though the plant had reported it.
 *
 * `additionalProperties: false` and a complete `required` are mandatory for
 * structured outputs; every property must appear in both.
 */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["meaning", "likely_causes", "what_to_check", "urgency", "bottom_line"],
  properties: {
    meaning: {
      type: "string",
      description:
        "Two or three sentences: what this register is, and what its present state means for the plant.",
    },
    likely_causes: {
      type: "array",
      items: { type: "string" },
      description:
        "Plausible causes, most likely first, each a short phrase. Empty array if the signal does not narrow the cause.",
    },
    what_to_check: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete checks an operator can make — other signals on this screen, site conditions, or what to ask the operator. No actions inside the enclosure.",
    },
    urgency: {
      type: "string",
      enum: ["routine", "investigate", "urgent"],
      description:
        "How soon a person should look. 'urgent' is reserved for safety or for a state that worsens if left.",
    },
    bottom_line: {
      type: "string",
      description: "One sentence an operator could read aloud on a call.",
    },
  },
} as const;

const TASK = `
Your task: explain ONE telemetry signal that the monitoring application is
currently showing to an operator, and return the structured explanation.

You are told the signal's dictionary entry and its present raw value. Use the
dictionary entry as the authority on what the signal is. Interpret the value
through the entry's own enum decoding where it has one.

If the signal is a configured protection setpoint rather than a fault bit, say
so first and plainly — the correct explanation is that the site is reporting a
setting, not a fault, and that nothing is wrong on account of it. That case is
the majority of what this site raises as alarms and it is the single most
useful thing you can tell someone.

If the signal is a fault bit reading zero, the correct explanation is that it
is healthy and reporting normally.
`.trim();

/** How a value reads once the dictionary's own enum is applied to it. */
function decode(sig: SignalDef, value: number): string {
  const word = sig.enumMap?.[value];
  if (word) return `${value} (${word})`;
  return sig.unit ? `${value} ${sig.unit}` : String(value);
}

function kindOf(sig: SignalDef): string {
  if (isAlarmThreshold(sig)) return "configured protection setpoint — a setting, not a state";
  if (isFaultBit(sig)) return "fault/alarm bit — 0 is healthy";
  return "measurement";
}

/**
 * The volatile half of the prompt: this signal, this value, this unit.
 *
 * Everything here is drawn from the dictionary except `value` and `assetLabel`,
 * which the route has already validated as a finite number and a short
 * enumerated string. It sits in the user turn, below the cache breakpoint, so
 * the frozen prefix above it is still a cache hit on every request.
 */
function question(sig: SignalDef, value: number, assetLabel: string, unitLabel: string): string {
  return [
    "Signal to explain:",
    `  protocol name : ${sig.name}`,
    `  display label : ${sig.label}`,
    `  asset         : ${sig.asset} (${assetLabel})`,
    `  unit in plant : ${unitLabel}`,
    `  category      : ${sig.category}`,
    `  kind          : ${kindOf(sig)}`,
    `  present value : ${decode(sig, value)}`,
    `  behaviour in the reference capture: ${sig.observed}`,
  ].join("\n");
}

export class ExplainInputError extends Error {}

export interface ExplainRequest {
  signalName: unknown;
  value: unknown;
  /** Readable asset the row came from, e.g. "Bms" — enumerated by the caller, re-checked here. */
  assetLabel?: unknown;
  /** Which BESS unit, e.g. "bess_1". */
  unitLabel?: unknown;
}

/* Short, no punctuation that could restructure a prompt, and length-capped.
   These two strings are the only free-ish text that reaches the model, and
   this is what keeps them from being a sentence. */
const LABEL_OK = /^[A-Za-z0-9 _-]{1,32}$/;

function safeLabel(v: unknown, fallback: string): string {
  return typeof v === "string" && LABEL_OK.test(v) ? v : fallback;
}

export async function explainAlarm(req: ExplainRequest): Promise<AlarmExplanation> {
  const sig = lookupSignal(req.signalName);
  if (!sig) {
    /* Names the constraint rather than echoing what was sent. An error that
       repeats an unvalidated string back to a client is a small XSS gift. */
    throw new ExplainInputError(
      "Unknown signal. Only the 63 signals in the published fast historian profile can be explained.",
    );
  }

  const value = typeof req.value === "number" && Number.isFinite(req.value) ? req.value : null;
  if (value === null) {
    throw new ExplainInputError("A finite numeric value is required for the signal.");
  }

  const msg = await ai().messages.create({
    model: MODEL,
    max_tokens: OUTPUT_CAP,
    thinking: { type: "adaptive" },
    output_config: {
      effort: EFFORT.explain,
      format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> },
    },
    system: systemPrefix(TASK),
    messages: [
      {
        role: "user",
        content: question(
          sig,
          value,
          safeLabel(req.assetLabel, sig.asset),
          safeLabel(req.unitLabel, "this unit"),
        ),
      },
    ],
  });

  return parseExplanation(msg);
}

/**
 * Read the structured object back out.
 *
 * Structured outputs constrain generation, so the happy path is a single text
 * block of valid JSON. This still checks, because a refusal or a max_tokens
 * stop returns a well-formed response containing something else, and the
 * caller must get an error rather than a half-populated card.
 */
function parseExplanation(msg: Anthropic.Message): AlarmExplanation {
  if (msg.stop_reason === "refusal") {
    throw new ExplainInputError("The model declined to answer this request.");
  }

  const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new Error("No explanation was returned.");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The explanation could not be read.");
  }

  const o = raw as Record<string, unknown>;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  if (typeof o.meaning !== "string" || typeof o.bottom_line !== "string") {
    throw new Error("The explanation was incomplete.");
  }

  return {
    meaning: o.meaning,
    likely_causes: strings(o.likely_causes),
    what_to_check: strings(o.what_to_check),
    urgency:
      o.urgency === "urgent" || o.urgency === "investigate" || o.urgency === "routine"
        ? o.urgency
        : "investigate",
    bottom_line: o.bottom_line,
  };
}
