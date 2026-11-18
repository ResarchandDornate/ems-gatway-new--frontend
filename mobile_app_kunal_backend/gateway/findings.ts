/**
 * The advisor's findings, computed rather than generated.
 *
 * Isomorphic and dependency-free: this runs in the browser, costs nothing, and
 * needs no key and no network beyond the readings the app already has.
 *
 * ── Why rules and not a model ─────────────────────────────────────────────
 * §3 of the AI strategy makes the argument better than this comment can: the
 * majority of what a user experiences as intelligence in an EMS is arithmetic
 * and descriptive statistics, and the reason to prefer them is not cost. A
 * threshold can be shown to a customer, disputed, and corrected. A model's
 * judgement about the same reading cannot be any of those things, and when a
 * customer asks "why does it say that" the honest answer has to be a rule
 * someone wrote down.
 *
 * So the rules are here, in one file, each with the reasoning for its bands in
 * the comment beside it. The inference service in advise.ts remains available
 * to phrase these more fluently for a deployment that wants it, but it is an
 * enhancement over this file rather than a replacement for it, and nothing on
 * the Advisor screen depends on it being configured.
 *
 * ── What these bands are and are not ──────────────────────────────────────
 * They are conservative, generic starting points for a grid-scale LFP system,
 * chosen to under-report rather than over-report: a finding that fires on a
 * healthy plant trains its reader to ignore the screen, which is worse than
 * silence. They are NOT the vendor's commissioned limits — the pack's real
 * protection thresholds live in the BMS, four of them read zero on this
 * gateway, and nothing here should be read as the manufacturer's specification.
 * Where a band is crossed the finding says what was observed and asks for a
 * person, rather than declaring a fault.
 *
 * ── The one rule that outranks the others ─────────────────────────────────
 * A conclusion is only as good as the window it was drawn from. Coverage,
 * window length and throughput are checked first and demote the confidence of
 * everything else, because a round-trip efficiency computed over twenty
 * minutes of a partial cycle is arithmetic performed correctly on data that
 * cannot answer the question.
 */

import type { Advice, Evidence, Finding } from "./aiTypes";

/* ── Bands ─────────────────────────────────────────────────────────────────
   Each is a heuristic with its reasoning, not a specification. Named so the
   findings below read as prose and the numbers live in exactly one place. */

/** Cell voltage spread. A healthy pack sits tight; a widening spread is the
    classic early indicator of imbalance or a weak cell. Wide bands, because
    spread also rises legitimately at the extremes of a charge cycle. */
const SPREAD_WATCH_MV = 80;
const SPREAD_CONCERN_MV = 150;

/** Pack temperature. LFP tolerates warmth well, so these are set where cooling
    performance becomes the question rather than where cells are at risk. */
const TEMP_WATCH_C = 38;
const TEMP_CONCERN_C = 45;

/** Round-trip efficiency. A grid-scale system with its auxiliaries included
    should comfortably clear the watch band over a full cycle. */
const RTE_WATCH_PCT = 82;

/** State of health, as the BMS reports it. */
const SOH_WATCH_PCT = 95;

/** Below this the window cannot support a claim about the window. */
const COVERAGE_MIN_PCT = 70;

/** Round-trip needs a real cycle behind it. Below this the figure is noise. */
const THROUGHPUT_MIN_KWH = 20;

/** A reading older than this is not current. Matches data.ts's STALE_MS. */
const STALE_SECONDS = 60;

/** Long enough for a window claim to mean anything. */
const SHORT_WINDOW_HOURS = 6;

const has = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Findings for one unit, in the order an operator should read them.
 *
 * Safety and data-integrity first, then plant condition, then efficiency —
 * because a reader who stops after the first item should have stopped at the
 * most important one.
 */
export function computeFindings(ev: Evidence): Advice {
  const findings: Finding[] = [];

  /* ── Is this window worth reasoning about? ─────────────────────────────── */

  const thinCoverage = has(ev.coveragePct) && ev.coveragePct < COVERAGE_MIN_PCT;
  const shortWindow = has(ev.windowHours) && ev.windowHours < SHORT_WINDOW_HOURS;
  const thinThroughput =
    has(ev.chargedKwh) && has(ev.dischargedKwh)
      ? ev.chargedKwh + ev.dischargedKwh < THROUGHPUT_MIN_KWH
      : false;

  /* Demotes every window-derived finding below. Present values — temperature,
     spread, state of health — are unaffected, because they are readings now
     rather than conclusions about a period. */
  const windowConfidence: Finding["confidence"] =
    thinCoverage || shortWindow ? "low" : "medium";

  if (thinCoverage) {
    findings.push({
      title: "Incomplete history",
      observation:
        "The historian holds less than most of the window requested, so the totals below describe only the part it has rather than the whole period.",
      why_it_matters:
        "Energy totals and efficiency are sums over what was recorded. Missing stretches make them under-report, and there is no way to tell from the figures alone whether the gap was a quiet plant or an absent recording.",
      suggested_action:
        "Treat the window figures as a partial view. The System screen reports the historian's own status if the gaps persist.",
      confidence: "high",
      evidence: ["coveragePct", "skippedMinutes", "windowHours"].filter(
        (k) => has(ev[k as keyof Evidence]),
      ) as Finding["evidence"],
    });
  }

  if (has(ev.readingAgeSeconds) && ev.readingAgeSeconds > STALE_SECONDS) {
    findings.push({
      title: "Readings not current",
      observation:
        "The most recent reading from this unit is older than the interval at which it should be reporting.",
      why_it_matters:
        "Present values on this screen describe the last moment the unit reported, not this moment. A unit can stop reporting while continuing to operate, and it can stop reporting because it stopped operating; these figures cannot distinguish the two.",
      suggested_action:
        "Check the unit's connection status on the System screen. If it does not resume, contact your operator.",
      confidence: "high",
      evidence: ["readingAgeSeconds"],
    });
  }

  /* ── Plant condition ───────────────────────────────────────────────────── */

  if (has(ev.assertedFaultBits) && ev.assertedFaultBits > 0) {
    findings.push({
      title: "Fault bits asserted",
      observation:
        "One or more of the monitored fault and alarm bits on this unit are currently asserted.",
      why_it_matters:
        "These are the equipment's own protection reporting a condition it has detected. They are the most direct statement available about what is wrong.",
      suggested_action:
        "Open the Alarms screen, where each asserted bit is listed with an explanation of what it means and what to check.",
      confidence: "high",
      evidence: ["assertedFaultBits"],
    });
  }

  if (has(ev.cellSpreadMv) && ev.cellSpreadMv >= SPREAD_WATCH_MV) {
    const concern = ev.cellSpreadMv >= SPREAD_CONCERN_MV;
    findings.push({
      title: concern ? "Wide cell spread" : "Cell spread worth watching",
      observation: concern
        // No digits: the figure is drawn beside this text, from the reading.
        ? "The gap between the highest and lowest cell voltage is well above where a healthy pack normally sits."
        : "The gap between the highest and lowest cell voltage is above the range a well-balanced pack usually holds.",
      why_it_matters:
        "Cells that drift apart limit the whole pack: the first cell to reach a limit stops the charge or the discharge for all of them, so usable capacity falls even though most cells are healthy. A spread that keeps widening is the early sign of a weak cell.",
      suggested_action: concern
        ? "Raise this with your operator. Spread at this level is worth investigating rather than watching."
        : "Note it and watch whether it widens. Spread rises legitimately at the very top and bottom of a cycle, so compare at similar states of charge.",
      confidence: "medium",
      evidence: (["cellSpreadMv", "socMinPct", "socMaxPct"] as const).filter((k) =>
        has(ev[k]),
      ) as Finding["evidence"],
    });
  }

  if (has(ev.tempMaxC) && ev.tempMaxC >= TEMP_WATCH_C) {
    const concern = ev.tempMaxC >= TEMP_CONCERN_C;
    findings.push({
      title: concern ? "High pack temperature" : "Pack running warm",
      observation: concern
        ? "Peak battery temperature over this window is well above the range the pack normally runs in."
        : "Peak battery temperature over this window is above the range the pack normally runs in.",
      why_it_matters:
        "Sustained heat shortens cell life even when it stays within protection limits, and a pack that runs warmer than it used to is usually telling you something about the cooling system rather than about the cells.",
      suggested_action: concern
        ? "Contact your operator to have the cooling system checked."
        : "Watch whether it coincides with high throughput or with ambient heat. Persistent warmth at low load is the case worth reporting.",
      confidence: windowConfidence === "low" ? "low" : "medium",
      evidence: (["tempMaxC", "peakKw", "windowHours"] as const).filter((k) =>
        has(ev[k]),
      ) as Finding["evidence"],
    });
  }

  if (has(ev.sohPct) && ev.sohPct < SOH_WATCH_PCT) {
    findings.push({
      title: "State of health below nameplate",
      observation:
        "The battery management system is reporting usable capacity below the pack's original rating.",
      why_it_matters:
        "Some decline is normal and expected over a battery's life. What matters is the rate, and a single reading cannot establish one.",
      suggested_action:
        "Record it and compare against the same figure in future months. A trend is the meaningful quantity here, not today's value.",
      confidence: "low",
      evidence: ["sohPct"],
    });
  }

  /* ── Efficiency ────────────────────────────────────────────────────────── */

  if (has(ev.roundTripPct)) {
    if (thinThroughput) {
      findings.push({
        title: "Efficiency not measurable yet",
        observation:
          "Too little energy moved through the unit in this window to compute a meaningful round-trip efficiency.",
        why_it_matters:
          "Round-trip efficiency is discharged energy divided by charged energy. Over a partial cycle the two describe different portions of the same stored energy, so the ratio can land far from the truth in either direction.",
        suggested_action:
          "Compare over a longer window containing at least one full charge and discharge.",
        confidence: "high",
        evidence: ["roundTripPct", "chargedKwh", "dischargedKwh"],
      });
    } else if (ev.roundTripPct < RTE_WATCH_PCT) {
      findings.push({
        title: "Round-trip efficiency low",
        observation:
          "Energy recovered from the unit over this window was a smaller share of the energy put in than a healthy system of this type normally returns.",
        why_it_matters:
          "Losses appear as heat and as revenue that was paid for but never delivered. A persistently low figure usually points at the auxiliaries — cooling in particular — rather than at the cells.",
        suggested_action:
          "Compare across several windows before concluding anything. If it stays low, raise it with your operator along with the cooling readings.",
        confidence: windowConfidence,
        evidence: ["roundTripPct", "chargedKwh", "dischargedKwh"],
      });
    }
  }

  /* ── Reassurance ───────────────────────────────────────────────────────────
     Last, and deliberately included. The site reports its protection limits as
     active alarms; a customer who has seen that number does not need it
     explained again as a fault, they need to be told it is not one. */
  if (has(ev.reportedSetpoints) && ev.reportedSetpoints > 0) {
    findings.push({
      title: "Reported limits are not faults",
      observation:
        "The site is reporting a number of configured protection limits on its alarm endpoint. These are settings holding their commissioned values.",
      why_it_matters:
        "They inflate the apparent alarm count on this site. Nothing is wrong on account of them, and the Alarms screen lists them separately for this reason.",
      suggested_action: "No action. They are listed under Setpoints on the Alarms screen.",
      confidence: "high",
      evidence: ["reportedSetpoints"],
      reassurance: true,
    });
  }

  return {
    findings,
    overall: summarise(ev, findings, { thinCoverage, shortWindow }),
    data_sufficiency: thinCoverage || shortWindow ? "thin" : "sufficient",
  };
}

function summarise(
  ev: Evidence,
  findings: Finding[],
  ctx: { thinCoverage: boolean; shortWindow: boolean },
): string {
  const serious = findings.filter((f) => !f.reassurance);

  if (!serious.length) {
    return ctx.shortWindow || ctx.thinCoverage
      ? "Nothing in this window needs attention, though the window is short enough that it says little about the unit beyond the period it covers."
      : "Nothing in this window needs attention. The unit's readings sit within the ranges this screen watches.";
  }

  const faults = has(ev.assertedFaultBits) && ev.assertedFaultBits > 0;
  return faults
    ? "This unit has protection reporting an active condition. Start with the Alarms screen; the items below are the wider context."
    : "No protection is reporting a fault. The items below are conditions worth noticing rather than acting on immediately.";
}
