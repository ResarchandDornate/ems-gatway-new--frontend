/**
 * What both sides of the AI wire agree on.
 *
 * Isomorphic on purpose: this file imports nothing. The modules that do the
 * work — ai.ts, explain.ts, advise.ts — pull in the Anthropic SDK and read
 * process.env, so they are server-only and importing one from a "use client"
 * module would drag the SDK into the browser bundle and the key-reading code
 * with it. The shapes and the evidence vocabulary are needed on both sides, so
 * they live here where neither side has to reach across.
 *
 * The rule to keep: nothing in this file may import anything.
 */

/* ── Alarm explanation ─────────────────────────────────────────────────────
   No numeric field, deliberately — see explain.ts for why the schema rather
   than the prompt is what enforces it. */

export interface AlarmExplanation {
  meaning: string;
  likely_causes: string[];
  what_to_check: string[];
  urgency: "routine" | "investigate" | "urgent";
  bottom_line: string;
}

/* ── Advisor ───────────────────────────────────────────────────────────────
   The evidence vocabulary is the single source of truth for the feature: it
   validates what a client may send, labels the figures in the prompt, and is
   the enum a finding must cite its sources from. The UI reads it too, to show
   which measurement a finding rests on. One list, four uses. */

export const EVIDENCE = {
  windowHours: "Length of the history window these figures cover, in hours",
  roundTripPct: "Round-trip efficiency over the window: energy discharged ÷ energy charged, percent",
  chargedKwh: "Energy charged over the window, kWh",
  dischargedKwh: "Energy discharged over the window, kWh",
  peakKw: "Greatest instantaneous power over the window, kW",
  socMinPct: "Lowest state of charge reached over the window, percent",
  socMaxPct: "Highest state of charge reached over the window, percent",
  tempMaxC: "Highest battery temperature over the window, degrees C",
  cellSpreadMv: "Present spread between the highest and lowest cell voltage, mV",
  sohPct: "Present state of health reported by the BMS, percent",
  assertedFaultBits: "How many of the 25 fault/alarm bits are presently asserted",
  reportedSetpoints: "How many configured protection limits the site is reporting as active alarms",
  coveragePct: "Share of the requested window the historian actually holds, percent",
  skippedMinutes: "Time within the window the historian recorded as missing, minutes",
  readingAgeSeconds: "Age of the most recent live reading, seconds",
} as const;

export type EvidenceKey = keyof typeof EVIDENCE;

export const EVIDENCE_KEYS = Object.keys(EVIDENCE) as EvidenceKey[];

/** Every figure is optional. A measurement that could not be taken is absent, never zero. */
export type Evidence = Partial<Record<EvidenceKey, number>>;

/** Short labels for the chips under a finding. The long text above is for the prompt. */
export const EVIDENCE_LABEL: Record<EvidenceKey, string> = {
  windowHours: "Window",
  roundTripPct: "Round-trip",
  chargedKwh: "Charged",
  dischargedKwh: "Discharged",
  peakKw: "Peak power",
  socMinPct: "SOC low",
  socMaxPct: "SOC high",
  tempMaxC: "Peak temp",
  cellSpreadMv: "Cell spread",
  sohPct: "SOH",
  assertedFaultBits: "Fault bits",
  reportedSetpoints: "Reported limits",
  coveragePct: "Coverage",
  skippedMinutes: "Missing time",
  readingAgeSeconds: "Reading age",
};

export interface Finding {
  title: string;
  observation: string;
  why_it_matters: string;
  suggested_action: string;
  confidence: "high" | "medium" | "low";
  evidence: EvidenceKey[];
  /**
   * A finding whose purpose is to reassure rather than to raise something.
   *
   * Set by the rules engine only, and deliberately absent from the model's
   * output schema — asking a model to classify its own findings this way
   * invites it to mark a real condition as reassurance. Anything without it is
   * treated as a condition, which is the safe default for both producers.
   *
   * The screen needs this because it counts findings to decide its own status:
   * without it, telling a customer that their site's reported limits are NOT
   * faults would itself put "Worth a look" on a healthy plant.
   */
  reassurance?: boolean;
}

export interface Advice {
  findings: Finding[];
  overall: string;
  data_sufficiency: "sufficient" | "thin" | "insufficient";
}
