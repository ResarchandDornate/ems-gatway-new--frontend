/**
 * The inference service, such as it is.
 *
 * Server-only. The API key is read from the environment here and never leaves
 * this process — the same rule the proxy applies to the gateway bearer, and
 * for the same reason: the packaged Android build is a static bundle on
 * someone else's phone, and anything the browser can read is a key we have
 * given away.
 *
 * ── What this is allowed to produce ───────────────────────────────────────
 * Prose, and nothing else. Every response schema in this module is checked at
 * the API layer to contain no numeric field of any kind, so a model that
 * wanted to invent a kilowatt-hour has nowhere to put it. The numbers on the
 * screen come from the historian and the live row exactly as they did before
 * this file existed; the model phrases a finding that was computed elsewhere.
 *
 * That is not a stylistic preference. §9.3 of the AI strategy is explicit that
 * no figure ever originates in the language model, and a fabricated kWh shown
 * to a C&I customer is a commercially fatal event. Making it structurally
 * impossible is cheaper than remembering not to do it.
 *
 * ── What it is allowed to read ────────────────────────────────────────────
 * The signal dictionary in signals.ts, and validated numbers from the caller.
 * Never free text from a client. Every prompt below is assembled from our own
 * constants plus values that have been checked against the dictionary or
 * checked to be finite numbers — so a modified client cannot write the prompt,
 * which is the only injection route a request-shaped API really has.
 *
 * It is also never given /api/logs. That endpoint carries other accounts'
 * authentication events (findings report, 2 Sep 2026, finding 9) and we
 * already decided not to put it on a screen; the same answer applies to a
 * model.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SIGNALS, isAlarmThreshold, isFaultBit, type SignalDef } from "./signals";

/* Opus 5. The task is small but it is customer-facing and it is reasoning
   about plant safety equipment; the per-call cost is dominated by the cached
   dictionary prefix either way, and effort is the knob we turn for cost
   rather than the model. See EFFORT_* below. */
export const MODEL = "claude-opus-5";

/**
 * Whether this deployment has been given a key.
 *
 * Deliberately the only switch. There is no separate feature flag to fall out
 * of step with it: a deployment without a key advertises no AI, the client
 * feature-detects and draws nothing, and the Play build therefore ships with
 * the feature dark until someone deliberately sets the variable.
 *
 * That matters beyond configuration tidiness. docs/PLAY_DATA_SAFETY.md
 * certifies what leaves the device, and its audit greps this repository for
 * third-party SDKs. Turning this on is the event that changes the answer, so
 * it should be one legible act rather than a flag someone flipped months ago.
 */
export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

let cached: Anthropic | null = null;

export function ai(): Anthropic {
  if (!cached) cached = new Anthropic();   // reads ANTHROPIC_API_KEY itself
  return cached;
}

/* ── Reasoning effort ──────────────────────────────────────────────────────
   Explaining one register against a dictionary that is already in the prompt
   is a lookup and a rewrite, and an operator is waiting on it — low is the
   right setting and the answers do not improve above it. Weighing several
   independent measurements against each other is genuinely harder, and the
   advisor is not on the critical path of anyone reading a fault, so it gets
   medium. Neither is a cost decision dressed as a quality one: raise them and
   measure if the output disappoints. */
const EFFORT_EXPLAIN = "low" as const;
const EFFORT_ADVISE = "medium" as const;

/* Bounded rather than lowballed. These outputs are a few hundred tokens in
   practice; the cap exists so a runaway generation cannot bill unbounded, and
   sits far enough above the real size that it never truncates a finding. */
const MAX_TOKENS = 16_000;

/* ── The dictionary, rendered once ─────────────────────────────────────────
   Prompt caching is a prefix match: one changed byte anywhere invalidates
   everything after it. This is built at module scope, from a constant array,
   with no timestamp and no per-request value in it — so every request in a
   process presents a byte-identical prefix and reads the cache instead of
   paying for 4k tokens again.

   Ordering is SIGNALS' own order rather than anything sorted here, because
   SIGNALS is generated and stable, and re-sorting would be one more thing that
   could quietly change and cost every deployment its cache. */
function renderSignal(s: SignalDef): string {
  const kind = isAlarmThreshold(s)
    ? "configured protection setpoint (a setting, not a state)"
    : isFaultBit(s)
      ? "fault/alarm bit (0 is healthy)"
      : "measurement";
  const enums = s.enumMap
    ? " · values: " + Object.entries(s.enumMap).map(([k, v]) => `${k}=${v}`).join(", ")
    : "";
  const unit = s.unit ? ` · unit: ${s.unit}` : "";
  return `- ${s.asset} ${s.name} — "${s.label}" · ${s.category} · ${kind}${unit}${enums}`;
}

export const DICTIONARY = [
  "The 63-signal fast historian profile published by the NorthBound EMS",
  "gateway for this site: 28 PCS signals and 35 BMS signals per BESS unit.",
  "",
  SIGNALS.map(renderSignal).join("\n"),
].join("\n");

/** Dictionary lookup by protocol name, for validating what a client asked about. */
const BY_NAME = new Map<string, SignalDef>(SIGNALS.map((s) => [s.name, s]));

export function lookupSignal(name: unknown): SignalDef | null {
  return typeof name === "string" ? BY_NAME.get(name) ?? null : null;
}

/* ── Standing instructions ─────────────────────────────────────────────────
   Shared by both tasks and placed ahead of the dictionary so the whole
   preamble is one stable cacheable prefix.

   The site-specific paragraph is here because without it the model reasons
   about a healthy plant as though it were broken. Every one of these facts is
   established in docs/gateway-findings-2026-09-02.md against the live system,
   and each has already caused a wrong reading on a screen. */
const GROUND_RULES = `
You are assisting an operator of a grid-scale battery energy storage site,
inside the UnityESS monitoring application. You explain equipment telemetry.

Absolute rules:
- NEVER state a numeric quantity. Not a power, energy, temperature, voltage,
  current, percentage, count, duration or money figure — not even one that
  appears in the input. The application displays every number itself, beside
  your text. Refer to quantities in words ("the spread has widened", "well
  above the commissioned limit"), never as digits.
- Never invent a signal, register, asset or threshold that is not in the
  dictionary below.
- Say plainly when the evidence does not support a conclusion. "This cannot be
  determined from the signals available" is a correct and welcome answer. Do
  not manufacture a plausible cause to fill the field.
- You are advisory only. This application cannot dispatch or control anything,
  and the reader may be a customer rather than an engineer. Recommend
  inspection, monitoring, or contacting the operator — never a switching
  action, a setpoint change, or anything done inside the enclosure.
- Write for a competent plant operator who is not a battery specialist. Plain
  sentences, no marketing register, no hedging padding.

Known conditions at this site, established against the live gateway and not to
be re-diagnosed as new faults:
- The gateway's alarm engine reports configured protection limits as active
  alarms. The overwhelming majority of "active alarms" are setpoints holding
  their correct commissioned values. A signal marked in the dictionary as a
  configured protection setpoint is a setting, not a fault.
- Four BMS pack-level protection thresholds read zero because they were never
  commissioned. Zero there means unset, not a limit of zero.
- Several liquid-cooling signals decode negative values as approximately 6553
  (an unsigned-16 wrap). A cooling reading near 6553 is a decode defect.
- The BMS yearly cumulative energy counters return their 32-bit words
  transposed and are not displayed. Do not reason from them.
- The utility grid meter at this site is not communicating; all of its signals
  read zero. Zero there is an absence of data, not a measurement of zero.
`.trim();

/**
 * The cached system prefix, identical on every request.
 *
 * One breakpoint at the end of the dictionary: everything above it is frozen
 * for the life of the deployment, and everything that varies per request
 * travels in the user turn below it. Verify with usage.cache_read_input_tokens
 * — a persistent zero there means something volatile has crept in above.
 */
export function systemPrefix(taskInstructions: string): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: GROUND_RULES },
    { type: "text", text: DICTIONARY, cache_control: { type: "ephemeral" } },
    { type: "text", text: taskInstructions },
  ];
}

export const EFFORT = { explain: EFFORT_EXPLAIN, advise: EFFORT_ADVISE };
export const OUTPUT_CAP = MAX_TOKENS;

/* ── Abuse control ─────────────────────────────────────────────────────────
   An authenticated endpoint that spends money per call needs a ceiling that
   does not depend on the client behaving. The proxy's app-token gate already
   keeps this to the packaged app, and the route requires a gateway bearer on
   top of that, but neither bounds how often one signed-in session may ask.

   A fixed window per caller, in memory. Deliberately not durable: the process
   is the unit of deployment here, a restart resetting the count is acceptable
   for a spend guard, and a shared store would be a dependency this app does
   not otherwise have. If this ever runs multi-instance, the ceiling becomes
   per-instance — which is a weaker guarantee, not a broken one. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

const hits = new Map<string, { n: number; resetAt: number }>();

export function rateLimit(callerKey: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const e = hits.get(callerKey);

  if (!e || now >= e.resetAt) {
    hits.set(callerKey, { n: 1, resetAt: now + WINDOW_MS });
    /* Bounded cleanup. Without it this map is a slow leak keyed by session. */
    if (hits.size > 5_000) {
      for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    }
    return { ok: true, retryAfterSec: 0 };
  }

  if (e.n >= MAX_PER_WINDOW) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((e.resetAt - now) / 1000)) };
  }
  e.n += 1;
  return { ok: true, retryAfterSec: 0 };
}
