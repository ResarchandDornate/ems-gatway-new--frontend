/**
 * Site load, as the site owner defines it (1 Oct 2026):
 *
 *     load = solar − battery charge          (solar hours: X − Y = Z)
 *     load = battery discharge               (no solar:    Y = Z)
 *
 * With battery power signed + discharge / − charge, both are one sum:
 * load = solar + battery. The grid is not in it.
 *
 * The battery discharges only when solar is 0, so a discharging battery gives
 * the load on its own. Any other moment needs the solar reading, and this
 * site's Solis inverter is not on the central backend — so until it is, a
 * charging or idle battery yields null, not a guess.
 *
 * @param solarKw PV output, kW, or null when it is not read.
 * @param battKw  Battery power, kW, + discharge / − charge, or null.
 */
const IDLE_KW = 0.5;

export function siteLoadKw(solarKw: number | null, battKw: number | null): number | null {
  if (battKw == null) return null;
  if (solarKw != null) return Math.max(0, solarKw + battKw);
  return battKw > IDLE_KW ? battKw : null;
}

/**
 * Revenue, ₹: load energy × the diesel rate it displaces. Load energy is the
 * battery's discharge for now — the solar share of load is not measured — so
 * this is the battery's part of it. Null when either input is unknown.
 */
export function dieselRevenueInr(loadKwh: number | null, rateRs: number | undefined): number | null {
  return loadKwh != null && rateRs != null ? loadKwh * rateRs : null;
}
