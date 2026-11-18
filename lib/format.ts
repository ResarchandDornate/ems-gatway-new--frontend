// ── Shared number formatters ─────────────────────────────────────────────────

// Currency formatter — Indian comma grouping
export const fmtINR = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * Rupees for a column too narrow to hold the exact figure — the dashboard's
 * revenue block gets about 67px per value.
 *
 * Exact up to a lakh, then the Indian short scale: ₹98,750 stays as it is, and
 * ₹12,34,567 becomes ₹12.3L, which fits where the full figure is silently
 * clipped to "₹12,34,5…". Truncating money is worse than rounding it — a reader
 * cannot tell a cut-off figure from a shorter one, whereas the L and Cr suffixes
 * say plainly that a figure has been abbreviated.
 */
export const fmtINRCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return "₹" + (n / 1_00_00_000).toFixed(2).replace(/\.?0+$/, "") + "Cr";
  if (abs >= 1_00_000)    return "₹" + (n / 1_00_000).toFixed(1).replace(/\.0$/, "") + "L";
  return fmtINR(n);
};

export const fmtKwh = (n: number) => `${n.toLocaleString("en-IN")} kWh`;
export const fmtKw  = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kW`;
