/**
 * The one display name for a cabinet — "BESS 1" / "BESS 2", as the header's
 * picker shows it. Display only: ids used in logic and commands are untouched.
 *
 *   external_ems_2 · external_ems_2_pcs · bess_2 · BESS-2  →  "BESS 2"
 *   X / Y (the strategy controller's cabinet letters)       →  "BESS 1" / "BESS 2"
 */
export function bessLabel(id: string | null | undefined): string {
  if (!id) return "";
  const s = String(id).trim();
  const m = /^(?:external_ems_|bess[_\s-]?|cabinet[_\s-]?|unit[_\s-]?)(\d+)/i.exec(s);
  if (m) return `BESS ${m[1]}`;
  if (/^x$/i.test(s)) return "BESS 1";
  if (/^y$/i.test(s)) return "BESS 2";
  return s;
}
