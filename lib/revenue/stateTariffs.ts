/**
 * State ToD tariff templates — the starting point the Revenue settings fill
 * from when an operator picks their state.
 *
 * A template carries the SLOTS and their modifiers (regulatory, public), not
 * the base energy charge, which is the site's own bill and is typed in. Picking
 * a state fills the slot table; the operator then confirms or edits it, because
 * the exact percentages are DISCOM-specific and revised each financial year.
 *
 * `verified` marks the states whose slots come from a published order or review
 * (the ToD note of 24 Nov 2026). Every other state carries the central
 * framework default — an eight-hour solar rebate and an evening peak surcharge,
 * the shape the CERC/SERC framework mandates — flagged so it is confirmed
 * before use rather than shown as fact.
 *
 * Modifier is a percentage of the base EC, except where a state sets a flat
 * paise amount (Gujarat), which uses modifierRs instead.
 */

export interface TariffSlot {
  name: string;
  /** "HH:MM", 24 h, local. A slot may wrap past midnight (start > end). */
  start: string;
  end: string;
  /** Signed percent on the base energy charge (+ surcharge, − rebate). */
  modifierPct?: number;
  /** Signed flat ₹/kWh, where a state sets paise rather than a percentage. */
  modifierRs?: number;
}

export interface StateTariff {
  state: string;
  discom?: string;
  /** The order year these slots are taken from, so a stale template shows. */
  financialYear: string;
  /** True only where the slots come from a published order/review. */
  verified: boolean;
  /** A typical C&I energy charge for the state, ₹/kWh — a starting value the
   *  operator overwrites with their own bill. */
  baseEnergyChargeRs: number;
  /** Value of the energy used to charge (solar PPA / export), ₹/kWh. */
  solarChargeValueRs: number;
  slots: TariffSlot[];
  note?: string;
}

/* The central framework: solar hours rebated, the evening peak surcharged, the
   night a little cheaper. Used for every state without a published template. */
const FRAMEWORK: Pick<StateTariff, "slots" | "note" | "verified"> = {
  verified: false,
  note: "Standard ToD framework — confirm the slots and percentages against your DISCOM's current tariff order.",
  slots: [
    { name: "Solar",    start: "09:00", end: "17:00", modifierPct: -20 },
    { name: "Peak",     start: "18:00", end: "22:00", modifierPct: +20 },
    { name: "Off-Peak", start: "22:00", end: "06:00", modifierPct: -10 },
    { name: "Normal",   start: "06:00", end: "09:00", modifierPct: 0 },
  ],
};

/* A framework-default state in one line. */
const framework = (state: string, baseEnergyChargeRs = 8, solarChargeValueRs = 2.5): StateTariff => ({
  state, financialYear: "FY27", baseEnergyChargeRs, solarChargeValueRs, ...FRAMEWORK,
});

export const STATE_TARIFFS: StateTariff[] = [
  /* ── Verified from the ToD note (24 Nov 2026) ─────────────────────────── */
  {
    state: "Maharashtra", discom: "MSEDCL", financialYear: "FY27", verified: true,
    baseEnergyChargeRs: 8, solarChargeValueRs: 2.5,
    note: "MERC continues the 9 AM–5 PM solar-hours concession for C&I; peak surcharge applies evening onward. Confirm the exact percentages in the MERC order.",
    slots: [
      { name: "Solar",  start: "09:00", end: "17:00", modifierPct: -25 },
      { name: "Peak",   start: "17:00", end: "24:00", modifierPct: +25 },
      { name: "Normal", start: "06:00", end: "09:00", modifierPct: 0 },
      { name: "Night",  start: "00:00", end: "06:00", modifierPct: 0 },
    ],
  },
  {
    state: "Gujarat", discom: "GERC", financialYear: "FY27", verified: true,
    baseEnergyChargeRs: 7.5, solarChargeValueRs: 2.5,
    note: "FY27 replaces the night concession with a flat 30 paise/unit solar-hours rebate (11 AM–3 PM) for certain HT categories; peak is licensee-specific. Flat paise, not a percentage.",
    slots: [
      { name: "Solar", start: "11:00", end: "15:00", modifierRs: -0.30 },
      { name: "Peak",  start: "17:00", end: "23:00", modifierPct: +20 },
      { name: "Normal", start: "06:00", end: "11:00", modifierPct: 0 },
    ],
  },
  {
    state: "Uttarakhand", discom: "UPCL", financialYear: "FY27", verified: true,
    baseEnergyChargeRs: 7, solarChargeValueRs: 2.5,
    note: "22.5% solar-hours rebate (9 AM–5 PM) for LT/HT industrial above 25 kW; 25% off-peak rebate and 30% peak surcharge.",
    slots: [
      { name: "Solar",    start: "09:00", end: "17:00", modifierPct: -22.5 },
      { name: "Peak",     start: "18:00", end: "23:00", modifierPct: +30 },
      { name: "Off-Peak", start: "23:00", end: "06:00", modifierPct: -25 },
      { name: "Normal",   start: "06:00", end: "09:00", modifierPct: 0 },
    ],
  },
  {
    state: "Odisha", discom: "TPCODL / OERC", financialYear: "FY27", verified: true,
    baseEnergyChargeRs: 7, solarChargeValueRs: 2.5,
    note: "From 1 Jul 2026, smart-metered consumers above 10 kW: 10% lower in solar hours, 10% higher in peak.",
    slots: [
      { name: "Solar", start: "08:00", end: "16:00", modifierPct: -10 },
      { name: "Peak",  start: "18:00", end: "24:00", modifierPct: +10 },
      { name: "Normal", start: "06:00", end: "08:00", modifierPct: 0 },
    ],
  },
  {
    state: "Kerala", discom: "KSEB", financialYear: "FY27", verified: true,
    baseEnergyChargeRs: 7.5, solarChargeValueRs: 2.5,
    note: "HT schedule is night-based: normal 06–18, peak 18–22, off-peak 22–06. No solar-hours rebate slot; confirm the peak/off-peak percentages in the KSERC order.",
    slots: [
      { name: "Peak",     start: "18:00", end: "22:00", modifierPct: +10 },
      { name: "Off-Peak", start: "22:00", end: "06:00", modifierPct: -10 },
      { name: "Normal",   start: "06:00", end: "18:00", modifierPct: 0 },
    ],
  },
  {
    state: "Jammu & Kashmir", discom: "JPDCL / KPDCL", financialYear: "FY27", verified: true,
    baseEnergyChargeRs: 7, solarChargeValueRs: 2.5,
    note: "20% solar-hours rebate for consumers above 10 kW; 20% peak surcharge for industrial and commercial.",
    slots: [
      { name: "Solar", start: "09:00", end: "17:00", modifierPct: -20 },
      { name: "Peak",  start: "18:00", end: "22:00", modifierPct: +20 },
      { name: "Normal", start: "06:00", end: "09:00", modifierPct: 0 },
    ],
  },
  {
    state: "Delhi", discom: "BRPL / BYPL / TPDDL", financialYear: "FY27", verified: true,
    baseEnergyChargeRs: 8.5, solarChargeValueRs: 2.5,
    note: "Reported 20% off-peak rebate and 20% evening peak surcharge; verify against the DERC order.",
    slots: [
      { name: "Solar",    start: "09:00", end: "17:00", modifierPct: -20 },
      { name: "Peak",     start: "17:00", end: "23:00", modifierPct: +20 },
      { name: "Off-Peak", start: "23:00", end: "06:00", modifierPct: -20 },
      { name: "Normal",   start: "06:00", end: "09:00", modifierPct: 0 },
    ],
  },
  {
    state: "Uttar Pradesh", discom: "UPPCL", financialYear: "FY27", verified: true,
    baseEnergyChargeRs: 8, solarChargeValueRs: 2.5,
    note: "Reported 15% evening peak surcharge (5–11 PM); solar-hours rebate per the framework. Verify against the UPERC order.",
    slots: [
      { name: "Solar", start: "09:00", end: "17:00", modifierPct: -15 },
      { name: "Peak",  start: "17:00", end: "23:00", modifierPct: +15 },
      { name: "Normal", start: "06:00", end: "09:00", modifierPct: 0 },
    ],
  },

  /* ── Framework default (confirm against the state's order) ─────────────── */
  framework("Andhra Pradesh", 8),
  framework("Arunachal Pradesh", 7),
  framework("Assam", 7.5),
  framework("Bihar", 8),
  framework("Chhattisgarh", 7),
  framework("Goa", 6.5),
  framework("Haryana", 8),
  framework("Himachal Pradesh", 6.5),
  framework("Jharkhand", 7.5),
  framework("Karnataka", 8),
  framework("Madhya Pradesh", 8),
  framework("Manipur", 7),
  framework("Meghalaya", 7),
  framework("Mizoram", 7),
  framework("Nagaland", 7),
  framework("Punjab", 8),
  framework("Rajasthan", 8),
  framework("Sikkim", 7),
  framework("Tamil Nadu", 8),
  framework("Telangana", 8),
  framework("Tripura", 7),
  framework("West Bengal", 8),

  /* Union Territories with their own C&I supply. */
  framework("Chandigarh", 7),
  framework("Puducherry", 7.5),
  framework("Ladakh", 7),
];

/** The template for a state, or undefined. */
export const tariffFor = (state: string): StateTariff | undefined =>
  STATE_TARIFFS.find((t) => t.state === state);

/** Every state name, for the dropdown, alphabetical. */
export const STATE_NAMES: string[] = STATE_TARIFFS.map((t) => t.state).sort((a, b) => a.localeCompare(b));
