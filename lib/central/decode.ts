/**
 * Decoding the gateway gets wrong, corrected in one place so every screen that
 * shows these registers agrees.
 */

/**
 * A 32-bit counter whose two 16-bit words arrive in the wrong order.
 *
 * `yearly_cumulative_{charge,discharge}_energy` and
 * `total_cumulative_{charge,discharge}_capacity` read 488,570,880 kWh,
 * 471,269,376 kWh, 685,506,560 Ah and 670,433,280 Ah — each an EXACT multiple
 * of 65,536 (7455, 7191, 10460 and 10230 of them). That is the signature of a
 * word swap: the value sits in the high word and the low word is zero. Swapped
 * back they are 7,455 / 7,191 kWh a year and 10,460 / 10,230 Ah lifetime, and
 * they check out against registers that decode correctly — the monthly figures
 * (2,787 / 2,622 kWh) sit under the yearly ones, and 10,460 Ah at the pack's
 * ~870 V is ~9,100 kWh, against 9,426 kWh on the PCS's own DC charge counter.
 *
 * Swapped only at or above 65,536, so a backend that fixes the decode (and a
 * counter still under one word) passes through untouched. The one case this
 * gets wrong is a correctly-decoded counter that has grown past 65,535, which
 * none of these four is near. Fix belongs in the gateway's register map.
 */
export function wordSwapped(v: number | null): number | null {
  if (v == null || !Number.isInteger(v) || v < 65_536) return v;
  const hi = Math.floor(v / 65_536), lo = v % 65_536;
  return lo * 65_536 + hi;
}

/** The registers that arrive word-swapped (p1065–p1068, bms_extended). */
export const WORD_SWAPPED_SIGNALS = new Set([
  "yearly_cumulative_charge_energy",
  "yearly_cumulative_discharge_energy",
  "total_cumulative_charge_capacity",
  "total_cumulative_discharge_capacity",
]);

/**
 * A signed 16-bit ×0.001 register read as unsigned.
 *
 * PCS power factor (pcs_extended p0193–p0196) read ~65: a negative PF of
 * −0.506 stored as 65,030 and scaled ×0.001 unsigned. Checked against the
 * powers on cabinet 2, 8 Oct 2026: P/S = −8.0 / 13.5 = −0.59 (negative while
 * charging), against 65.03 − 65.536 = −0.506. Values ≤ 32.767 pass through.
 */
export function signedMilli(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return v;
  return v > 32.767 ? +(v - 65.536).toFixed(3) : v;
}

/** pcs_extended registers that need signedMilli. */
export const SIGNED_MILLI_SIGNALS = new Set([
  "phase_a_power_factor",
  "phase_b_power_factor",
  "phase_c_power_factor",
  "total_power_factor",
]);

/**
 * A register's value with the gateway's known decode faults undone, by
 * substream and signal. One place, so every screen agrees.
 */
export function decoded(substream: string | null | undefined, signal: string | null | undefined, v: number | null): number | null {
  if (!signal) return v;
  if (WORD_SWAPPED_SIGNALS.has(signal)) return wordSwapped(v);
  if (substream === "pcs_extended" && SIGNED_MILLI_SIGNALS.has(signal)) return signedMilli(v);
  return v;
}
