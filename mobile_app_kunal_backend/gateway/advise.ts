/**
 * The advisor — findings over measurements the application already computed.
 *
 * Server-only.
 *
 * ── The division of labour, which is the whole design ─────────────────────
 * The arithmetic happens in data.ts, on the client, over the historian's own
 * aggregates: round-trip efficiency is discharged ÷ charged integrated on the
 * server across every raw row, cell spread and pack temperature are read off
 * the live row, coverage and skipped time are the historian's own account of
 * what it holds. None of it is a model's opinion and all of it is on screen
 * next to the text.
 *
 * This module receives those figures, checks each one is a finite number, and
 * asks the model what they mean together. It returns sentences. The client
 * renders its own numbers beside them.
 *
 * The consequence worth stating: if the inference service is unavailable the
 * evidence is unaffected, because the evidence was never downstream of it. The
 * screen degrades to what the previous build showed — measurements without
 * commentary — rather than to a blank page.
 *
 * ── Why the caller may send the numbers ───────────────────────────────────
 * They are numbers, from an allowlist of known keys, each validated finite.
 * A modified client can therefore lie to itself about its own plant and get
 * prose about the lie — which is neither a security boundary we have lost nor
 * one we ever had, since the same client draws the same figures on screen. It
 * cannot inject instructions, which is the thing that would matter.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { ai, MODEL, systemPrefix, EFFORT, OUTPUT_CAP } from "./ai";
import {
  EVIDENCE, EVIDENCE_KEYS,
  type Evidence, type EvidenceKey, type Finding, type Advice,
} from "./aiTypes";

export type { Evidence, EvidenceKey, Finding, Advice };
export { EVIDENCE, EVIDENCE_KEYS };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "overall", "data_sufficiency"],
  properties: {
    findings: {
      type: "array",
      description:
        "At most four findings, most important first. Return an empty array when the evidence supports nothing worth an operator's attention — that is a good answer, not a failure.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "observation", "why_it_matters", "suggested_action", "confidence", "evidence"],
        properties: {
          title: { type: "string", description: "Under six words. A label, not a sentence." },
          observation: {
            type: "string",
            description:
              "What the figures show, in words. Describe magnitude and direction without stating any digit.",
          },
          why_it_matters: {
            type: "string",
            description: "The consequence for the plant, its output, or its lifetime.",
          },
          suggested_action: {
            type: "string",
            description:
              "What a person should do — inspect, monitor, or contact the operator. Never a control action or a setpoint change.",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description:
              "Low when the window is short, coverage is poor, or the figures admit another explanation.",
          },
          evidence: {
            type: "array",
            items: { type: "string", enum: EVIDENCE_KEYS },
            description: "Which supplied figures this finding rests on. Cite only what you used.",
          },
        },
      },
    },
    overall: {
      type: "string",
      description:
        "Two sentences on the state of the unit over this window, for someone who reads nothing else.",
    },
    data_sufficiency: {
      type: "string",
      enum: ["sufficient", "thin", "insufficient"],
      description:
        "Whether what you were given supports the findings you drew. Say 'insufficient' freely.",
    },
  },
} as const;

const TASK = `
Your task: read a set of measurements taken from one battery unit over a recent
window, and report what an operator should know. Return the structured advice.

How to weigh what you are given:
- These figures were computed by the application from the historian's own
  aggregates. Treat them as accurate. Your job is interpretation, not
  arithmetic, and you must not restate them as digits.
- A short window, poor coverage, or substantial skipped time all weaken every
  conclusion drawn from the window. Say so in 'confidence' rather than quietly
  reasoning as though the data were complete. Roughly thirty days is needed
  before a trend claim is credible and ninety before degradation is; a window
  of hours supports observations about this window and nothing beyond it.
- A single snapshot cannot establish a trend. You are given present values and
  window aggregates, not a baseline, so do not describe anything as rising,
  worsening or degrading over time. Describe what the window contains.
- Absent figures are absent, not zero. Reason only from what you were given.
- Configured protection limits reported as active alarms are the site's known
  gateway defect and are not a plant fault. Mention them only to reassure.
- Round-trip efficiency computed over a short window with little throughput is
  unreliable — a partial cycle can put it far from the true figure. Treat a low
  round-trip number over a thin window as a measurement artefact first.

Say nothing rather than pad. Four findings is a maximum, not a target, and an
empty list over a healthy unit is the right answer.
`.trim();

export class AdviseInputError extends Error {}

/**
 * Keep only known keys holding finite numbers.
 *
 * Unknown keys are dropped rather than refused: the client and this list will
 * drift across a deployment, and an older server silently ignoring a figure it
 * does not know is a better failure than a screen that errors after an update.
 */
export function sanitiseEvidence(input: unknown): Evidence {
  const out: Evidence = {};
  if (!input || typeof input !== "object") return out;
  const o = input as Record<string, unknown>;
  for (const k of EVIDENCE_KEYS) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** The figures, labelled by the same descriptions the schema's enum refers to. */
function evidenceBlock(ev: Evidence, unitLabel: string): string {
  const lines = EVIDENCE_KEYS.filter((k) => ev[k] !== undefined).map(
    (k) => `  ${k} = ${ev[k]}   (${EVIDENCE[k]})`,
  );
  const missing = EVIDENCE_KEYS.filter((k) => ev[k] === undefined);

  return [
    `Unit: ${unitLabel}`,
    "",
    "Measurements supplied:",
    ...lines,
    "",
    missing.length
      ? `Not available for this unit: ${missing.join(", ")}. Do not reason about these.`
      : "All figures available.",
  ].join("\n");
}

const LABEL_OK = /^[A-Za-z0-9 _-]{1,32}$/;

export async function advise(input: unknown, unitLabelRaw: unknown): Promise<Advice> {
  const ev = sanitiseEvidence(input);

  /* Two figures is not a plant to reason about, and asking anyway spends a
     call to be told so. The screen says this itself without a round trip. */
  if (Object.keys(ev).length < 3) {
    throw new AdviseInputError(
      "Not enough measurements were supplied to reason about this unit.",
    );
  }

  const unitLabel =
    typeof unitLabelRaw === "string" && LABEL_OK.test(unitLabelRaw) ? unitLabelRaw : "this unit";

  const msg = await ai().messages.create({
    model: MODEL,
    max_tokens: OUTPUT_CAP,
    thinking: { type: "adaptive" },
    output_config: {
      effort: EFFORT.advise,
      format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> },
    },
    system: systemPrefix(TASK),
    messages: [{ role: "user", content: evidenceBlock(ev, unitLabel) }],
  });

  return parseAdvice(msg);
}

function parseAdvice(msg: Anthropic.Message): Advice {
  if (msg.stop_reason === "refusal") {
    throw new AdviseInputError("The model declined to answer this request.");
  }

  const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new Error("No advice was returned.");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The advice could not be read.");
  }

  const o = raw as Record<string, unknown>;
  const known = new Set<string>(EVIDENCE_KEYS);

  const findings: Finding[] = (Array.isArray(o.findings) ? o.findings : [])
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .filter((f) => typeof f.title === "string" && typeof f.observation === "string")
    .map((f) => ({
      title: f.title as string,
      observation: f.observation as string,
      why_it_matters: typeof f.why_it_matters === "string" ? f.why_it_matters : "",
      suggested_action: typeof f.suggested_action === "string" ? f.suggested_action : "",
      confidence:
        f.confidence === "high" || f.confidence === "low" ? f.confidence : "medium",
      /* Re-filtered against the vocabulary rather than trusted from the enum.
         The UI resolves these to the figures it is already drawing, and a key
         it cannot resolve would render as a blank chip. */
      evidence: (Array.isArray(f.evidence) ? f.evidence : []).filter(
        (k): k is EvidenceKey => typeof k === "string" && known.has(k),
      ),
    }));

  return {
    findings,
    overall: typeof o.overall === "string" ? o.overall : "",
    data_sufficiency:
      o.data_sufficiency === "sufficient" || o.data_sufficiency === "insufficient"
        ? o.data_sufficiency
        : "thin",
  };
}
