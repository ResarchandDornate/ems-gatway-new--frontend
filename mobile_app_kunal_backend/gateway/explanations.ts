/**
 * What each fault bit means, written once.
 *
 * ── Why this is a file and not an API call ────────────────────────────────
 * The Alarms screen can only ever show two kinds of signal: the 25 fault and
 * alarm bits, and the 4 configured protection setpoints. That is a closed set
 * of 29, fixed by the gateway's published profile, and signals.ts is generated
 * from that profile rather than hand-maintained. What `bmu_communication_fault`
 * means does not vary by request, by site, or by day — only its value does,
 * and that has three cases.
 *
 * So asking a language model at request time would be paying, repeatedly and
 * per user, to regenerate an answer that was the same every time. The content
 * below is what that would have produced, written once and shipped as data.
 *
 * The consequences are worth being explicit about, because they are the whole
 * argument for doing it this way:
 *
 *   - It costs nothing to run, per view or per month, forever.
 *   - It needs no API key, so nothing has to be held server-side.
 *   - It works with no network, which matters on a phone at a substation.
 *   - It is instant rather than several seconds.
 *   - No plant data leaves the device to obtain it, so the Play Data Safety
 *     declaration in docs/PLAY_DATA_SAFETY.md is unchanged and its audit still
 *     returns what it returned.
 *   - It can be read, reviewed and corrected by an engineer who disagrees with
 *     a sentence, which is not true of a model's output.
 *
 * This is not artificial intelligence and the screen does not claim it is. It
 * is the reference content an operator needed, in the place they needed it.
 *
 * ── The rules the text follows ────────────────────────────────────────────
 * The same three that constrain the model in ai.ts, for the same reasons:
 * no numeric quantity is ever stated (the app draws the figures beside this
 * text); nothing is recommended that happens inside the enclosure; and where
 * the signal genuinely does not narrow the cause, it says so rather than
 * offering a plausible guess.
 *
 * ── Maintenance ───────────────────────────────────────────────────────────
 * Keyed by the protocol name in signals.ts. If the gateway profile changes and
 * signals.ts is regenerated, `missingExplanations()` names any fault bit that
 * has arrived without an entry here; the screen falls back to a derived
 * explanation for those rather than showing nothing.
 */

import type { AlarmExplanation } from "./aiTypes";
import { SIGNALS, isAlarmThreshold, isFaultBit, type SignalDef } from "./signals";

/**
 * One signal's reference content, split by what the register is currently
 * saying. `asserted` is the interesting half; `clear` is what an operator sees
 * when they tap a healthy bit on the Monitored tab, and saying something
 * useful there is worth the extra line.
 */
interface Entry {
  asserted: Omit<AlarmExplanation, "urgency"> & { urgency: AlarmExplanation["urgency"] };
  /** Overrides the generic "this bit is healthy" note where the signal deserves one. */
  clearNote?: string;
}

const E = (
  urgency: AlarmExplanation["urgency"],
  meaning: string,
  likely_causes: string[],
  what_to_check: string[],
  bottom_line: string,
  clearNote?: string,
): Entry => ({
  asserted: { urgency, meaning, likely_causes, what_to_check, bottom_line },
  clearNote,
});

/* ── PCS: summary bits ─────────────────────────────────────────────────── */

const PCS_SUMMARY: Record<string, Entry> = {
  fault_status: E(
    "investigate",
    "The inverter is reporting that it is in a fault state. This is the PCS's own summary bit — it says a fault exists without saying which one, and the specific fault bits on this screen are where the detail is.",
    ["Any one of the specific PCS fault bits has asserted", "A fault the inverter reports internally but does not break out as its own register"],
    ["The individual PCS fault bits on this screen — one of them is usually asserted alongside this", "Whether the inverter is still exporting or has stopped", "Whether the fault cleared on its own, which points at a grid disturbance rather than the equipment"],
    "The inverter says something is wrong; the specific fault bits below identify what.",
  ),
  total_fault_status: E(
    "investigate",
    "The inverter's aggregate fault flag. It gathers every fault condition the PCS tracks into one bit, so it tells you that the unit is faulted without telling you why.",
    ["Any specific PCS fault is active", "A latched fault from an earlier event that has not been reset"],
    ["The specific fault bits on this screen", "Whether the unit has stopped converting", "Whether this clears and re-asserts, which suggests an intermittent external cause"],
    "An aggregate fault flag — read the specific bits to find the cause.",
  ),
  total_alarm_status: E(
    "routine",
    "The inverter's aggregate alarm flag. An alarm on a PCS is a warning condition rather than a trip: the unit is normally still running, and is reporting that something is outside its preferred operating range.",
    ["An operating value near a limit — temperature, voltage or current", "A grid condition the inverter is tolerating but not happy with"],
    ["Whether the unit is still converting power", "Grid voltage and frequency on this screen", "Whether the alarm is persistent or comes and goes with load"],
    "A warning rather than a trip; the unit is usually still running.",
  ),
};

/* ── PCS: AC-side faults ───────────────────────────────────────────────── */

const PCS_AC: Record<string, Entry> = {
  sw_fault_ac_over_voltage: E(
    "investigate",
    "The inverter measured grid voltage above its permitted ceiling and tripped in software protection. This is nearly always the grid's behaviour rather than a fault inside the container — the inverter is protecting itself from the network it is connected to.",
    ["Grid voltage excursion on the utility side", "Light network load raising local voltage, often at night or on weekends", "Transformer tap setting leaving the site sitting high", "Voltage rise from local generation on a weak feeder"],
    ["The phase voltages on the Signals screen, to see how close to the limit the site normally sits", "Whether this recurs at a particular time of day", "Whether other equipment on site has tripped at the same moment", "With your operator: whether the transformer tap or the grid connection agreement needs review"],
    "The grid went high and the inverter protected itself — usually a network condition, not an equipment fault.",
  ),
  sw_fault_ac_under_voltage: E(
    "investigate",
    "The inverter measured grid voltage below its permitted floor and tripped. Like its over-voltage counterpart this generally reflects the state of the network rather than a defect in the unit.",
    ["A grid sag, dip or brownout on the utility side", "A large load starting nearby", "A fault elsewhere on the feeder", "Heavily loaded network at peak hours"],
    ["The phase voltages on the Signals screen", "Whether the trip coincides with a known heavy load on site", "Whether other site equipment saw the same dip", "Whether it recurs at consistent times, which points at network loading"],
    "The grid dipped below the inverter's limit — check whether it is a recurring network condition.",
  ),
  sw_fault_ac_over_frequency: E(
    "investigate",
    "Grid frequency rose above the inverter's permitted band and it disconnected. Frequency is a property of the whole synchronous grid, not of this site, so this is an external event by definition.",
    ["A regional grid disturbance", "Loss of a large load on the network", "Islanding, where a section of network has separated and is running on local generation"],
    ["Whether other generation on site tripped at the same instant, which would confirm a network-wide event", "Grid frequency on the Signals screen", "With your operator, whether a grid event was recorded at that time"],
    "A grid-wide frequency excursion — the inverter did what it is required to do.",
  ),
  sw_fault_ac_under_frequency: E(
    "investigate",
    "Grid frequency fell below the inverter's permitted band and it disconnected. As with over-frequency this is a network event rather than a site one.",
    ["A regional grid disturbance", "Loss of large generation on the network", "Islanding of a network section"],
    ["Whether other generation on site tripped simultaneously", "Grid frequency on the Signals screen", "With your operator, whether a grid event was logged"],
    "A grid-wide frequency dip — external to this site.",
  ),
  sw_fault_ac_over_current: E(
    "urgent",
    "The inverter's software protection measured AC current above its limit and stopped conversion. Unlike the voltage and frequency trips this one more often points at something on the equipment side.",
    ["A fault on the AC side — cabling, connections or the transformer", "An attempt to export beyond the unit's rating", "A grid disturbance causing a current surge", "A developing fault in the inverter's output stage"],
    ["Whether the unit restarts and holds, or trips again immediately", "The phase currents on the Signals screen for imbalance between phases", "Whether this coincides with a particular dispatch or load condition", "Contact your operator before returning the unit to service if it trips repeatedly"],
    "An AC over-current trip — if it repeats, stop and involve your operator rather than restarting.",
  ),
  hw_fault_ac_over_current: E(
    "urgent",
    "The inverter's hardware protection tripped on AC over-current. This is the fast protection layer beneath the software one: it acts in hardware because the event was too rapid or too severe to leave to firmware. It should be treated as the more serious of the two.",
    ["A short circuit or earth fault on the AC side", "A severe grid transient", "A failure within the inverter's power stage"],
    ["Do not repeatedly restart the unit — hardware protection acting means the event was fast and large", "Whether the software over-current bit asserted at the same time", "Contact your operator; this warrants inspection before the unit returns to service"],
    "Hardware-level protection acted. Involve your operator before restarting.",
  ),
};

/* ── PCS: DC-side faults ───────────────────────────────────────────────── */

const PCS_DC: Record<string, Entry> = {
  sw_fault_dc_charge_over_current: E(
    "investigate",
    "The inverter measured DC current above its limit while charging the battery and stopped. The DC side is between the inverter and the battery, so this concerns the pair of them rather than the grid.",
    ["A charge command beyond what the battery or inverter is rated to accept", "A battery accepting more current than expected at low state of charge", "A DC-side wiring or connection fault", "Disagreement between the BMS current limit and what the inverter attempted"],
    ["Whether it happens only at particular states of charge", "The DC current and voltage on the Signals screen", "Whether the BMS reported a matching charge over-current at the same moment", "Whether it coincides with the start of a charge cycle"],
    "Charging current exceeded the limit — note the state of charge it happens at and tell your operator.",
  ),
  sw_fault_dc_discharge_over_current: E(
    "investigate",
    "The inverter measured DC current above its limit while discharging the battery and stopped.",
    ["A discharge demand beyond the rating of the battery or inverter", "A battery at low state of charge, where the same power draws more current", "A DC-side wiring or connection fault", "Disagreement between the BMS discharge limit and the inverter's demand"],
    ["Whether it occurs at low state of charge, where it is most likely", "The DC current and voltage on the Signals screen", "Whether the BMS reported a matching discharge over-current", "Whether it coincides with a peak site load"],
    "Discharge current exceeded the limit — most often at low state of charge under high demand.",
  ),
};

/* ── BMS: hardware and safety ──────────────────────────────────────────── */

const BMS_HARDWARE: Record<string, Entry> = {
  contactor_fault: E(
    "urgent",
    "The battery management system reports that a main contactor is not in the state it was commanded to. The contactors are the switches that connect the battery to the rest of the system, and the BMS checks that what it commanded actually happened.",
    ["A welded contactor, which can no longer open", "A contactor that failed to close on command", "A failure in the contactor's own control or auxiliary contacts", "Loss of the control supply that drives the coil"],
    ["Whether the unit will connect at all", "The contactor status signals on the Signals screen", "Contact your operator — a contactor that cannot open is a safety-relevant condition and this is not a customer-serviceable item"],
    "A main isolation device is not behaving as commanded. Contact your operator.",
  ),
  fuse_fault: E(
    "urgent",
    "The battery management system reports a blown fuse in the DC path. A fuse operates because current went far beyond normal, so the fuse itself is the symptom and the cause is upstream of it.",
    ["A short circuit or earth fault in the DC circuit", "A sustained over-current that the fuse cleared", "A fault within a battery rack"],
    ["Whether the unit will connect at all — it usually will not", "Whether an over-current fault asserted at the same time", "Contact your operator. A fuse is never replaced without first establishing what operated it"],
    "A DC fuse has operated. The unit is protected; the cause must be found before service resumes.",
  ),
  insulation_fault: E(
    "urgent",
    "The battery management system measured insulation resistance between the DC circuit and earth below its safe threshold. In a healthy system the battery is electrically isolated from the enclosure; this says that isolation has degraded.",
    ["Moisture ingress into the enclosure or a cable gland", "Damaged or chafed cable insulation", "A degraded cell, module or connector", "Condensation, which can appear and clear with temperature and humidity"],
    ["Whether it appears and clears with weather or time of day, which points at condensation", "The insulation resistance reading on the Signals screen", "Contact your operator promptly — reduced isolation is a personnel-safety matter and inspection means opening a live enclosure, which is their work and not yours"],
    "Electrical isolation from earth has degraded. This is a safety condition — contact your operator.",
  ),
  insulation_monitoring_fault: E(
    "investigate",
    "The insulation monitoring device itself has failed or cannot take a valid measurement. This is distinct from an insulation fault: it does not say the isolation is bad, it says nobody is currently able to tell.",
    ["A failed insulation monitoring device", "A wiring or communication fault to the monitor", "The device unable to complete a measurement"],
    ["Whether the insulation resistance reading is present or absent on the Signals screen", "Whether an actual insulation fault is also asserted", "Contact your operator — the protection is unavailable until this is repaired, so it should not be left"],
    "The insulation monitor is not working. Isolation is unmeasured rather than known to be bad.",
  ),
  battery_temperature_sensor_fault: E(
    "investigate",
    "One or more battery temperature sensors are returning implausible or absent readings. The BMS relies on these to protect the cells, so a failed sensor means it is protecting with less information than it should have.",
    ["A failed thermistor or temperature sensor", "A broken or disconnected sensor harness", "A communication fault to a battery module"],
    ["Whether the reported temperatures on this unit look plausible against the others", "Whether a module communication fault is also asserted", "Contact your operator to have the sensing repaired — the BMS may derate or restrict operation while this is present"],
    "A temperature sensor has failed. The BMS is protecting the pack with incomplete information.",
  ),
  voltage_sampling_fault: E(
    "investigate",
    "The battery management system cannot reliably measure one or more cell or module voltages. Cell voltage is the primary quantity the BMS protects against, so this degrades its ability to do its job.",
    ["A failed voltage sensing harness or connector", "A failed measurement channel on a monitoring board", "A communication fault to a battery module"],
    ["The cell voltage spread on this screen and on Signals — a sampling fault often shows as an implausible spread", "Whether a module communication fault is also asserted", "Contact your operator; the pack may be restricted until sensing is restored"],
    "Cell voltage measurement is unreliable — the BMS cannot fully protect the pack.",
  ),
  current_sampling_fault_functional_safety_fault: E(
    "urgent",
    "The battery management system cannot reliably measure pack current, and it is reporting this as a functional safety fault. Current measurement is what over-current protection depends on, so the BMS is telling you that a protective function is compromised.",
    ["A failed current sensor or shunt", "A failed measurement channel", "A wiring fault to the current sensing"],
    ["Whether the reported current is plausible against the power being converted", "Whether the unit has restricted or stopped operation, which it may do deliberately", "Contact your operator — a compromised protective function is not a condition to run on"],
    "Current sensing has failed and a protective function is compromised. Contact your operator.",
  ),
};

/* ── BMS: cell and pack conditions ─────────────────────────────────────── */

const BMS_CELLS: Record<string, Entry> = {
  charge_over_current: E(
    "investigate",
    "The battery management system measured charging current above its permitted limit. The BMS raises this to protect the cells, independently of whatever the inverter thinks it is doing.",
    ["A charge rate beyond what the pack is rated to accept", "A charge current limit the inverter did not observe", "Reduced acceptance at low temperature, where the safe charge rate falls", "A current sensing error"],
    ["The battery temperature on this screen — cold cells accept less current and the limit tightens", "Whether the inverter reported a matching DC charge over-current", "Whether it only happens at particular states of charge or temperatures"],
    "Charging current went above the pack's limit — temperature and state of charge are the usual context.",
  ),
  discharge_over_current_level_1: E(
    "investigate",
    "The battery management system measured discharge current above its first-level limit. Level one is the earliest warning stage, so this is the pack asking for attention rather than tripping hard.",
    ["A discharge demand beyond the pack's rating", "Low state of charge, where the same power requires more current", "Low temperature reducing the permitted discharge rate", "A current sensing error"],
    ["The state of charge at which it occurs — low charge is the common case", "Battery temperature on this screen", "Whether the inverter reported a matching DC discharge over-current", "Whether site demand peaked at that moment"],
    "Discharge current passed its first limit — usually a demand, state-of-charge or temperature combination.",
  ),
  cell_over_voltage_level_1: E(
    "investigate",
    "At least one cell has risen above its first over-voltage threshold. Level one is a warning stage: the BMS will normally reduce or stop charging rather than disconnect.",
    ["Charging continued past the point where the highest cell reached its ceiling", "Cell imbalance, where one cell runs ahead of the rest and hits the limit early", "A voltage sensing error reporting a cell incorrectly", "Reduced acceptance at low temperature"],
    ["The cell voltage spread on this screen — a wide spread with this fault points at imbalance rather than overcharge", "Whether it occurs only near the top of a charge cycle", "Whether a voltage sampling fault is also asserted", "Whether balancing has had opportunity to run"],
    "A cell reached its upper limit. A wide spread alongside this points at imbalance.",
  ),
  cell_under_voltage_level_1: E(
    "investigate",
    "At least one cell has fallen below its first under-voltage threshold. As with over-voltage, level one is a warning: the BMS will normally limit or stop discharging.",
    ["Discharging continued past the point where the lowest cell reached its floor", "Cell imbalance, where one weak cell reaches the limit before the rest", "A voltage sensing error", "A cell with reduced capacity relative to its neighbours"],
    ["The cell voltage spread on this screen — a wide spread here suggests one weak cell rather than a flat pack", "Whether it happens only at the end of deep discharges", "Whether a voltage sampling fault is also asserted", "Whether the same cell is involved each time, which your operator can determine"],
    "A cell reached its lower limit. If the spread is wide, one weak cell is the likely story.",
  ),
};

/* ── BMS: communication ────────────────────────────────────────────────── */

const BMS_COMMS: Record<string, Entry> = {
  bmu_communication_fault: E(
    "investigate",
    "The battery management system has lost communication with one or more battery monitoring units — the boards that measure individual cells inside a module. The pack keeps operating, but the BMS is blind to the cells behind the missing unit.",
    ["A failed or disconnected communication cable between modules", "A failed monitoring board", "A loose connector, often following vibration or maintenance", "Loss of supply to one monitoring unit"],
    ["Whether cell voltage or temperature readings look incomplete or implausible", "Whether the fault is steady or intermittent — intermittent points at a connector", "Whether it began after recent work on the unit", "Contact your operator; the pack should not run indefinitely with cells unmonitored"],
    "Some cells are no longer being monitored. The pack runs, but with reduced visibility.",
  ),
  bau_communication_fault: E(
    "investigate",
    "The battery management system has lost communication with a battery array unit — the controller aggregating a group of modules. This removes visibility of a larger portion of the pack than a single monitoring unit would.",
    ["A failed or disconnected communication link to the array controller", "A failed array controller", "Loss of supply to that controller", "A connector or wiring fault"],
    ["How much of the pack's data is missing on the Signals screen", "Whether monitoring unit faults are asserted alongside it", "Whether it began after recent maintenance", "Contact your operator — a whole array unmonitored is a significant loss of protection coverage"],
    "A section of the battery is no longer reporting. Contact your operator.",
  ),
  pcs_communication_fault: E(
    "urgent",
    "The battery management system has lost communication with the inverter. These two must talk continuously: the BMS sets the charge and discharge limits the inverter is required to respect, and without that link the inverter has no current instruction about what the battery can safely accept or deliver.",
    ["A failed communication cable between the BMS and the PCS", "The inverter powered down or restarted", "A configuration or address change on either device", "A failed communication port"],
    ["Whether the inverter is reporting at all elsewhere in the app", "Whether the unit has stopped converting — it normally should, and stopping is correct behaviour here", "Whether it followed a restart or recent work", "Contact your operator if it does not clear on its own"],
    "The battery and inverter have stopped talking. The unit should stop, and that is correct.",
  ),
};

const BY_NAME: Record<string, Entry> = {
  ...PCS_SUMMARY, ...PCS_AC, ...PCS_DC,
  ...BMS_HARDWARE, ...BMS_CELLS, ...BMS_COMMS,
};

/* ── Setpoints ─────────────────────────────────────────────────────────────
   The four pack-level protection thresholds. They are not faults and the whole
   value of explaining them is saying so — this is the case that accounts for
   the overwhelming majority of what the site reports as "active alarms".

   All four read zero on this gateway, which is itself a finding rather than a
   limit (findings report, 2 Sep 2026, finding 4), so the zero case is called
   out separately rather than described as a configured value. */

const SETPOINT: AlarmExplanation = {
  meaning:
    "This is a configured protection setpoint, not a fault. It is the threshold at which the battery management system will raise an alarm — a setting someone commissioned, holding its value as intended. The site's gateway reports these on its alarm endpoint alongside genuine alarms, which is why it appears in a list of alarms at all.",
  likely_causes: [],
  what_to_check: [
    "Nothing on the plant. This is a setting rather than a state",
    "That the value looks right for this equipment, if you know what it should be",
  ],
  urgency: "routine",
  bottom_line: "A protection setting holding its commissioned value. Nothing is wrong.",
};

const SETPOINT_UNSET: AlarmExplanation = {
  meaning:
    "This is a configured protection setpoint rather than a fault — the threshold at which the battery management system would raise an alarm. It is currently reading zero, which is not a usable protection limit. Either the register was never commissioned or it is not mapped through to the gateway.",
  likely_causes: [
    "The threshold was never commissioned on this equipment",
    "The register is not correctly mapped in the gateway's telemetry dictionary",
    "Protection is configured elsewhere in the system and this register is vestigial",
  ],
  what_to_check: [
    "Nothing on the plant — this is a configuration question, not a plant condition",
    "With your operator: whether pack-level protection is configured somewhere other than this register",
  ],
  urgency: "routine",
  bottom_line:
    "A protection threshold reading zero. Worth asking your operator about, but not a plant fault.",
};

/**
 * The first sentence of a paragraph, with its full stop.
 *
 * Not a split on "." — the entries contain decimal-free prose but also em
 * dashes and abbreviations, and a naive split drops everything after the first
 * one. This takes the first sentence-ending full stop followed by a space and
 * a capital, which is the boundary that actually separates these sentences.
 */
function firstSentence(text: string): string {
  const m = text.match(/^.*?\.(?=\s+[A-Z])/s);
  return (m ? m[0] : text).trim();
}

/** Lowercases the opening word unless it is an acronym the app writes upper. */
function lowerFirst(text: string): string {
  if (/^(BMS|PCS|EMS|BMU|BAU|SOC|SOH|AC|DC)\b/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Explain a signal without contacting anything.
 *
 * `value` decides which of the three cases applies. Returns null only for a
 * signal this file has no entry for and that is not a setpoint — the caller
 * then falls back to a derived explanation, or to the inference service if the
 * deployment has one.
 */
export function explainLocally(sig: SignalDef, value: number | null): AlarmExplanation | null {
  if (isAlarmThreshold(sig)) {
    return value === 0 ? SETPOINT_UNSET : SETPOINT;
  }

  const entry = BY_NAME[sig.name];
  if (!entry) return null;

  /* Not asserted. The bit is doing its job and saying so is more useful than
     repeating the fault description to someone who does not have that fault. */
  if (value === 0) {
    /* The asserted text is reused rather than written twice, introduced by a
       colon so the borrowed sentence stands on its own. Splicing it into a
       sentence of this one's instead produced "…inside a module is what it
       would mean if it asserted", which is what happens when a fragment is
       treated as a noun. */
    return {
      meaning:
        entry.clearNote ??
        `This is a fault bit and it is currently clear, which is the healthy reading. It is monitored continuously and would change if the condition it watches for occurred. What it watches for: ${lowerFirst(firstSentence(entry.asserted.meaning))}`,
      likely_causes: [],
      what_to_check: [],
      urgency: "routine",
      bottom_line: "Clear. Nothing to do.",
    };
  }

  /* Absent, which is not the same as clear — see the app's standing rule that
     a value the gateway did not return is never rendered as a zero. */
  if (value == null) {
    return {
      meaning:
        "This signal is not currently reporting a value, so its state is unknown. That is different from it being clear: nothing here can tell you whether the condition it watches for is present.",
      likely_causes: ["The unit is not currently being logged", "A communication fault between the gateway and this asset"],
      what_to_check: ["Whether this unit is reporting elsewhere in the app", "The System screen for gateway and logger status"],
      urgency: "investigate",
      bottom_line: "Not reporting. The state of this signal is unknown rather than clear.",
    };
  }

  return entry.asserted;
}

/**
 * A last-resort explanation assembled from the dictionary entry alone.
 *
 * Used when the gateway profile grows a fault bit this file has not caught up
 * with. It is deliberately thin: it states what the dictionary knows and does
 * not guess at causes, because a guessed cause on an unknown register is
 * exactly the fabrication this whole design exists to prevent.
 */
export function derivedExplanation(sig: SignalDef, value: number | null): AlarmExplanation {
  const word = value != null ? sig.enumMap?.[value] : undefined;
  const state = value == null ? "not reporting" : word ? `reporting "${word}"` : "reporting a non-zero value";

  return {
    meaning: `${sig.label} is a ${sig.category.replace("_", "/")} signal on the ${sig.asset}, currently ${state}. This build carries no written explanation for this particular register.`,
    likely_causes: [],
    what_to_check: [
      "The other signals on this asset, for context",
      "Your operator, who holds the vendor's register documentation for this equipment",
    ],
    urgency: isFaultBit(sig) ? "investigate" : "routine",
    bottom_line: "No written explanation is available for this signal in this build.",
  };
}

/**
 * Fault bits the profile carries that this file has no entry for.
 *
 * Not called at runtime — it exists so the gap is discoverable when signals.ts
 * is regenerated, rather than being found by a customer tapping a row and
 * getting the thin derived text.
 */
export function missingExplanations(): string[] {
  return SIGNALS.filter((s) => isFaultBit(s) && !BY_NAME[s.name]).map((s) => s.name);
}

/**
 * Explain a row from the gateway's /api/alarms endpoint.
 *
 * That endpoint reports the whole plant, not the 63-signal fast profile, so
 * most of what it returns — `rack_cell_over_voltage_l3_alarm_limit_early_warning`
 * and its 147 siblings — has no entry in signals.ts and never will. This is
 * the path for those rows.
 *
 * It still answers the question that matters for almost all of them. The
 * overwhelming majority are configured protection limits rather than faults,
 * and `isState` (the caller's own isAlarmState, which tests the name and the
 * value together) is what separates them. A reader tapping any of the 148
 * gets told plainly that it is a setting and that nothing is wrong — which is
 * the single most useful sentence this feature has to offer on this site.
 *
 * `sig` is passed when the name did resolve in the dictionary, in which case
 * the written entry is used and this is just a thin wrapper over it.
 */
export function explainAlarmRow(
  signalName: string,
  value: number | null,
  isState: boolean,
  sig?: SignalDef | null,
): AlarmExplanation {
  if (!isState) {
    return value === 0 ? SETPOINT_UNSET : SETPOINT;
  }
  if (sig) {
    return explainLocally(sig, value) ?? derivedExplanation(sig, value);
  }

  /* An asserted state on a signal outside the fast profile. The name is the
     only thing known about it, so the name is all that is said — no cause is
     guessed, which is the rule this whole file exists to keep. */
  const readable = signalName.replace(/_/g, " ").trim();
  return {
    meaning: `The site is reporting "${readable}" as an active state. This signal is outside the 63-signal profile this app carries reference content for, so no written explanation is available for it here.`,
    likely_causes: [],
    what_to_check: [
      "The Alarms and Signals screens, for anything asserted on the same asset at the same time",
      "Your operator, who holds the vendor's register documentation for this equipment",
    ],
    urgency: "investigate",
    bottom_line: "An active state this app has no written explanation for. Ask your operator.",
  };
}

/** Dictionary lookup by protocol name, for callers holding only a name. */
export function signalByName(name: string): SignalDef | null {
  return SIGNALS.find((s) => s.name === name) ?? null;
}
