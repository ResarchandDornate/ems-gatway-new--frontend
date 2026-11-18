/**
 * Timestamp formatting, shared across services and charts.
 *
 * Lifted out of lib/api/ugx.ts when that backend was removed. Nothing here was
 * ever UGX-specific — it is four date functions — but they lived in the client
 * module and half the app imported them from it, which is how a file called
 * `ugx` ended up on the import list of charts that had never spoken to UGX.
 */

export function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}

export function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * The site's time zone. Every timestamp from the backend is UTC; the plant and
 * its operators are in India, so everything shown — and every "today" — is
 * IST, whatever zone the browser or the server happens to run in.
 */
export const SITE_TZ = "Asia/Kolkata";
/** IST is UTC+05:30 all year — India has no daylight saving. */
const IST_OFFSET_MS = 330 * 60_000;

/** The IST calendar fields of an instant. */
function ist(ms: number) {
  const d = new Date(ms + IST_OFFSET_MS);   // read back with the UTC getters
  const p2 = (n: number) => String(n).padStart(2, "0");
  return {
    y: d.getUTCFullYear(), m: p2(d.getUTCMonth() + 1), d: p2(d.getUTCDate()),
    hh: p2(d.getUTCHours()), mm: p2(d.getUTCMinutes()),
  };
}

/** "YYYY-MM-DD HH:MM" in IST. (Was UTC, via toISOString, until 1 Oct 2026.) */
export function msToDtLocal(ms: number): string {
  const t = ist(ms);
  return `${t.y}-${t.m}-${t.d} ${t.hh}:${t.mm}`;
}

/** "HH:MM" in IST. */
export function msToHm(ms: number): string {
  const t = ist(ms);
  return `${t.hh}:${t.mm}`;
}

/** Hour of day in IST, 0–23. */
export function istHour(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCHours();
}

/** The IST calendar date, "YYYY-MM-DD" — use for "today", never toISOString. */
export function istDate(ms: number = Date.now()): string {
  const t = ist(ms);
  return `${t.y}-${t.m}-${t.d}`;
}

/** "YYYY-MM-DDTHH:MM" in IST, for a datetime-local input's value. */
export function istDateTimeInput(ms: number = Date.now()): string {
  const t = ist(ms);
  return `${t.y}-${t.m}-${t.d}T${t.hh}:${t.mm}`;
}

/** Epoch ms of IST midnight starting the day that contains `ms`. */
export function istMidnight(ms: number = Date.now()): number {
  return Math.floor((ms + IST_OFFSET_MS) / 86_400_000) * 86_400_000 - IST_OFFSET_MS;
}

/**
 * Parse a datetime-local value ("YYYY-MM-DDTHH:MM") or a date ("YYYY-MM-DD")
 * as IST. `new Date(value)` would read it in the browser's zone.
 */
export function parseIst(value: string): number {
  /* Already zoned ("…Z" or "…+05:30"): it says what it means. */
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return Date.parse(value);
  const v = value.length === 10 ? `${value}T00:00` : value;
  return Date.parse(`${v.length === 16 ? `${v}:00` : v}+05:30`);
}
